type DeepSeekChatMessage = { role: "system" | "user" | "assistant"; content: string };

type DeepSeekChatCompletionResponse = {
  choices: Array<{
    message: {
      content: string;
      reasoning_content?: string;
    };
  }>;
};

export type DeepSeekCallParams = {
  apiKey: string;
  model: "deepseek-reasoner" | "deepseek-chat";
  messages: DeepSeekChatMessage[];
  maxTokens?: number;
  timeoutMs?: number;
};

export type DeepSeekStreamCallParams = DeepSeekCallParams & {
  onToken?: (token: string) => void;
};

function extractFirstJsonObject(raw: string): string | null {
  const s = raw.trim();
  if (!s) return null;
  if (s.startsWith("{") && s.endsWith("}")) return s;

  const startIdx = s.indexOf("{");
  if (startIdx < 0) return null;

  let depth = 0;
  let inString = false;
  let escape = false;
  for (let i = startIdx; i < s.length; i++) {
    const ch = s[i];
    if (inString) {
      if (escape) {
        escape = false;
      } else if (ch === "\\") {
        escape = true;
      } else if (ch === "\"") {
        inString = false;
      }
      continue;
    }

    if (ch === "\"") {
      inString = true;
      continue;
    }

    if (ch === "{") depth++;
    if (ch === "}") depth--;

    if (depth === 0) {
      return s.slice(startIdx, i + 1);
    }
  }

  return null;
}

function extractDeltaContent(payload: unknown): string {
  if (!payload || typeof payload !== "object") return "";
  const choices = (payload as { choices?: Array<{ delta?: { content?: string } }> }).choices;
  const value = choices?.[0]?.delta?.content;
  return typeof value === "string" ? value : "";
}

async function createDeepSeekResponse(params: {
  apiKey: string;
  body: Record<string, unknown>;
  timeoutMs?: number;
}) {
  const url = "https://api.deepseek.com/chat/completions";
  const ac = new AbortController();
  const timeoutMs = params.timeoutMs ?? 60_000;
  const timer = setTimeout(() => ac.abort(), timeoutMs);

  let res: Response;
  try {
    res = await fetch(url, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${params.apiKey}`
      },
      body: JSON.stringify(params.body),
      signal: ac.signal
    });
  } catch (e) {
    if (e instanceof Error && e.name === "AbortError") {
      throw new Error(`DeepSeek request timed out after ${timeoutMs}ms`);
    }
    throw new Error(`DeepSeek request failed: ${e instanceof Error ? e.message : String(e)}`);
  } finally {
    clearTimeout(timer);
  }

  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(`DeepSeek request failed: ${res.status} ${res.statusText} ${text}`.trim());
  }

  return res;
}

export async function callDeepSeekJsonRaw(params: DeepSeekCallParams): Promise<{ parsed: unknown; raw: string }> {
  const body: Record<string, unknown> = {
    model: params.model,
    messages: params.messages,
    max_tokens: params.maxTokens ?? 4096,
    response_format: { type: "json_object" }
  };

  const res = await createDeepSeekResponse({
    apiKey: params.apiKey,
    body,
    timeoutMs: params.timeoutMs
  });

  const json = (await res.json()) as DeepSeekChatCompletionResponse;
  const content = json?.choices?.[0]?.message?.content;
  if (typeof content !== "string" || !content.trim()) {
    throw new Error("DeepSeek response missing choices[0].message.content");
  }

  const extracted = extractFirstJsonObject(content) ?? content.trim();
  try {
    const parsed = JSON.parse(extracted) as unknown;
    return { parsed, raw: extracted };
  } catch {
    throw new Error("DeepSeek response is not valid JSON (cannot parse extracted JSON object)");
  }
}

export async function callDeepSeekJsonStreamRaw(
  params: DeepSeekStreamCallParams
): Promise<{ parsed: unknown; raw: string }> {
  const body: Record<string, unknown> = {
    model: params.model,
    messages: params.messages,
    max_tokens: params.maxTokens ?? 4096,
    response_format: { type: "json_object" },
    stream: true
  };

  const res = await createDeepSeekResponse({
    apiKey: params.apiKey,
    body,
    timeoutMs: params.timeoutMs
  });

  if (!res.body) {
    throw new Error("DeepSeek stream response has no body");
  }

  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  let raw = "";
  let done = false;

  while (!done) {
    const { done: streamDone, value } = await reader.read();
    done = streamDone;
    if (!value) continue;

    buffer += decoder.decode(value, { stream: true });
    const lines = buffer.split(/\r?\n/);
    buffer = lines.pop() ?? "";

    for (const line of lines) {
      const trimmed = line.trim();
      if (!trimmed.startsWith("data:")) continue;

      const payload = trimmed.slice(5).trim();
      if (!payload || payload === "[DONE]") continue;

      try {
        const parsedLine = JSON.parse(payload) as unknown;
        const delta = extractDeltaContent(parsedLine);
        if (delta) {
          raw += delta;
          params.onToken?.(delta);
        }
      } catch {
        // Ignore malformed SSE frame chunks and keep reading.
      }
    }
  }

  const extracted = extractFirstJsonObject(raw) ?? raw.trim();
  try {
    const parsed = JSON.parse(extracted) as unknown;
    return { parsed, raw: extracted };
  } catch {
    throw new Error("DeepSeek stream response is not valid JSON (cannot parse extracted JSON object)");
  }
}
