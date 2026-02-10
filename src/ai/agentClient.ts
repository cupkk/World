import type { AgentRunRequest, AgentRunResponse } from "./agentProtocol";

export type AgentClientError = {
  kind: "network" | "server" | "parse";
  message: string;
  status?: number;
};

export type AgentStreamCallbacks = {
  onAssistantDelta?: (delta: string) => void;
};

const CLIENT_REQUEST_TIMEOUT_MS = 65_000;

type ServerErrorPayload = {
  error?: { message?: string; code?: string; request_id?: string };
};

async function fetchWithTimeout(
  input: RequestInfo | URL,
  init: RequestInit = {},
  timeoutMs = CLIENT_REQUEST_TIMEOUT_MS
) {
  const ac = new AbortController();
  const externalSignal = init.signal;
  const onExternalAbort = () => ac.abort();
  if (externalSignal) {
    if (externalSignal.aborted) {
      ac.abort();
    } else {
      externalSignal.addEventListener("abort", onExternalAbort, { once: true });
    }
  }

  const timer = window.setTimeout(() => ac.abort(), timeoutMs);

  try {
    return await fetch(input, { ...init, signal: ac.signal });
  } catch (err) {
    if (err instanceof Error && err.name === "AbortError") {
      throw new Error(`Request timed out after ${timeoutMs}ms`);
    }
    throw err;
  } finally {
    window.clearTimeout(timer);
    if (externalSignal) {
      externalSignal.removeEventListener("abort", onExternalAbort);
    }
  }
}

function parseServerErrorMessage(text: string, status: number, statusText: string) {
  let message = text || `AI agent failed: ${status} ${statusText}`;
  try {
    const parsed = JSON.parse(text) as ServerErrorPayload;
    if (parsed.error?.message) {
      message = parsed.error.message;
    }
    if (parsed.error?.request_id) {
      message = `${message} (request_id: ${parsed.error.request_id})`;
    }
  } catch {
    // keep raw text fallback
  }
  return message;
}

export async function runAgent(request: AgentRunRequest): Promise<AgentRunResponse> {
  let res: Response;
  try {
    res = await fetchWithTimeout("/api/ai/agent", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(request)
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    throw { kind: "network", message } satisfies AgentClientError;
  }

  const text = await res.text().catch(() => "");
  if (!res.ok) {
    const message = parseServerErrorMessage(text, res.status, res.statusText);

    const err: AgentClientError = {
      kind: "server",
      status: res.status,
      message
    };
    throw err;
  }

  try {
    return JSON.parse(text) as AgentRunResponse;
  } catch {
    throw { kind: "parse", message: "Failed to parse agent response JSON" } satisfies AgentClientError;
  }
}

function parseSseFrame(frame: string) {
  const lines = frame.split(/\r?\n/);
  let event = "message";
  const data: string[] = [];

  for (const line of lines) {
    if (!line || line.startsWith(":")) continue;
    if (line.startsWith("event:")) {
      event = line.slice(6).trim();
      continue;
    }
    if (line.startsWith("data:")) {
      data.push(line.slice(5).trim());
    }
  }

  return { event, data: data.join("\n") };
}

export async function runAgentStream(
  request: AgentRunRequest,
  callbacks: AgentStreamCallbacks = {}
): Promise<AgentRunResponse> {
  let res: Response;
  try {
    res = await fetchWithTimeout("/api/ai/agent/stream", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(request)
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    throw { kind: "network", message } satisfies AgentClientError;
  }

  if (!res.ok) {
    const text = await res.text().catch(() => "");
    const message = parseServerErrorMessage(text, res.status, res.statusText);
    throw { kind: "server", status: res.status, message } satisfies AgentClientError;
  }

  if (!res.body) {
    throw { kind: "parse", message: "Missing stream response body" } satisfies AgentClientError;
  }

  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  let finalResult: AgentRunResponse | null = null;

  const processFrame = (frame: string) => {
    const { event, data } = parseSseFrame(frame);
    if (!data) return;

    if (event === "assistant_delta") {
      try {
        const parsed = JSON.parse(data) as { delta?: string };
        if (typeof parsed.delta === "string" && parsed.delta) {
          callbacks.onAssistantDelta?.(parsed.delta);
        }
      } catch {
        // ignore malformed stream event
      }
      return;
    }

    if (event === "result") {
      try {
        finalResult = JSON.parse(data) as AgentRunResponse;
      } catch {
        throw { kind: "parse", message: "Failed to parse stream result" } satisfies AgentClientError;
      }
      return;
    }

    if (event === "error") {
      try {
        const parsed = JSON.parse(data) as { message?: string; details?: string; request_id?: string };
        const message = parsed.message || "AI stream failed";
        const withRequest = parsed.request_id ? `${message} (request_id: ${parsed.request_id})` : message;
        throw { kind: "server", message: withRequest } satisfies AgentClientError;
      } catch (err) {
        if (err && typeof err === "object" && "kind" in err) throw err;
        throw { kind: "server", message: "AI stream failed" } satisfies AgentClientError;
      }
    }
  };

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    if (!value) continue;

    buffer += decoder.decode(value, { stream: true });
    const frames = buffer.split("\n\n");
    buffer = frames.pop() ?? "";

    for (const frame of frames) {
      processFrame(frame);
    }
  }

  buffer += decoder.decode();
  if (buffer.trim()) {
    for (const frame of buffer.split("\n\n")) {
      if (!frame.trim()) continue;
      processFrame(frame);
    }
  }

  if (!finalResult) {
    throw { kind: "parse", message: "Stream completed without final result" } satisfies AgentClientError;
  }

  return finalResult;
}
