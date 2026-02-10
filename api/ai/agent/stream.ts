import { randomUUID } from "node:crypto";
import type { AgentRunRequest } from "../../../server/src/agentProtocol.js";
import { buildAgentSystemPrompt, buildAgentUserPrompt } from "../../../server/src/agentPrompt.js";
import { loadConfig } from "../../../server/src/config.js";
import { callDeepSeekJsonStreamRaw } from "../../../server/src/deepseek.js";
import { logger } from "../../../server/src/logger.js";
import { FixedWindowRateLimiter } from "../../../server/src/rateLimit.js";
import { createAgentRequestSchema } from "../../../server/src/requestSchemas.js";
import { AgentRunResponseSchema } from "../../../server/src/schemas.js";
import { extractAssistantMessageFromJsonPrefix, extractBoardActionsFromJsonPrefix } from "../../../server/src/streaming.js";

const REQUEST_ID_HEADER = "x-request-id";

function getHeader(req: any, name: string): string | undefined {
  const raw = req?.headers?.[name] ?? req?.headers?.[name.toLowerCase()];
  if (Array.isArray(raw)) return raw[0];
  return typeof raw === "string" ? raw : undefined;
}

function setCommonHeaders(res: any) {
  res.setHeader("X-Content-Type-Options", "nosniff");
  res.setHeader("X-Frame-Options", "DENY");
  res.setHeader("Referrer-Policy", "no-referrer");
  res.setHeader("Cross-Origin-Resource-Policy", "same-site");
}

function writeSseEvent(res: any, event: string, payload: unknown) {
  res.write(`event: ${event}\n`);
  res.write(`data: ${JSON.stringify(payload)}\n\n`);
}

function getRequestId(res: any) {
  const value = res.getHeader?.(REQUEST_ID_HEADER);
  return typeof value === "string" ? value : "unknown";
}

function sendErrorEvent(res: any, code: string, message: string, details?: unknown) {
  writeSseEvent(res, "error", {
    code,
    message,
    details,
    request_id: getRequestId(res)
  });
}

async function readRawBody(req: any) {
  if (typeof req.body === "string") return req.body;
  if (req.body && typeof req.body === "object") return JSON.stringify(req.body);

  const chunks: Buffer[] = [];
  for await (const chunk of req) {
    chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
  }
  return Buffer.concat(chunks).toString("utf8");
}

async function readJsonBody(req: any) {
  if (req.body && typeof req.body === "object") return req.body;
  const raw = await readRawBody(req);
  if (!raw.trim()) return null;
  return JSON.parse(raw);
}

function getClientIp(req: any) {
  const forwarded = getHeader(req, "x-forwarded-for");
  if (forwarded?.trim()) {
    return forwarded.split(",")[0].trim();
  }
  return req?.socket?.remoteAddress || "unknown";
}

function getSingletonLimiter(config: ReturnType<typeof loadConfig>) {
  const key = "__ai_world_rate_limiter__";
  const g = globalThis as any;
  if (!g[key]) {
    g[key] = new FixedWindowRateLimiter(config.rateLimit.windowMs, config.rateLimit.maxRequests);
  }
  return g[key] as FixedWindowRateLimiter;
}

export default async function handler(req: any, res: any) {
  try {
    setCommonHeaders(res);

    const incoming = getHeader(req, REQUEST_ID_HEADER);
    const requestId = incoming && incoming.trim() ? incoming.trim() : randomUUID();
    res.setHeader(REQUEST_ID_HEADER, requestId);

    if (req.method !== "POST") {
      res.statusCode = 405;
      res.setHeader("Content-Type", "application/json; charset=utf-8");
      res.end(
        JSON.stringify({
          error: {
            code: "METHOD_NOT_ALLOWED",
            message: "Only POST is supported",
            request_id: getRequestId(res)
          }
        })
      );
      return;
    }

    let config: ReturnType<typeof loadConfig>;
    try {
      config = loadConfig(process.env);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      res.statusCode = 500;
      res.setHeader("Content-Type", "application/json; charset=utf-8");
      res.end(
        JSON.stringify({
          error: {
            code: "CONFIG_ERROR",
            message,
            request_id: getRequestId(res)
          }
        })
      );
      return;
    }

    const limiter = getSingletonLimiter(config);
    limiter.cleanup();
    const rate = limiter.consume(getClientIp(req));
    res.setHeader("X-RateLimit-Limit", String(limiter.maxRequests));
    res.setHeader("X-RateLimit-Remaining", String(rate.remaining));
    res.setHeader("X-RateLimit-Reset", String(Math.floor(rate.resetAt / 1000)));
    if (!rate.allowed) {
      res.statusCode = 429;
      res.setHeader("Retry-After", String(rate.retryAfterSec));
      res.setHeader("Content-Type", "application/json; charset=utf-8");
      res.end(
        JSON.stringify({
          error: {
            code: "RATE_LIMITED",
            message: "Too many requests. Please try again later.",
            request_id: getRequestId(res)
          }
        })
      );
      return;
    }

    if (!config.deepseekApiKey) {
      res.statusCode = 500;
      res.setHeader("Content-Type", "application/json; charset=utf-8");
      res.end(
        JSON.stringify({
          error: {
            code: "CONFIG_ERROR",
            message: "Missing DEEPSEEK_API_KEY env var",
            request_id: getRequestId(res)
          }
        })
      );
      return;
    }

    let body: unknown;
    try {
      body = await readJsonBody(req);
    } catch {
      res.statusCode = 400;
      res.setHeader("Content-Type", "application/json; charset=utf-8");
      res.end(
        JSON.stringify({
          error: {
            code: "INVALID_JSON",
            message: "Invalid JSON body",
            request_id: getRequestId(res)
          }
        })
      );
      return;
    }

    const agentRequestSchema = createAgentRequestSchema({
      maxMessages: config.limits.maxMessages,
      maxMessageChars: config.limits.maxMessageChars,
      maxBoardSections: config.limits.maxBoardSections,
      maxSectionTitleChars: config.limits.maxSectionTitleChars,
      maxSectionContentChars: config.limits.maxSectionContentChars
    });

    const parsedReq = agentRequestSchema.safeParse(body);
    if (!parsedReq.success) {
      res.statusCode = 400;
      res.setHeader("Content-Type", "application/json; charset=utf-8");
      res.end(
        JSON.stringify({
          error: {
            code: "INVALID_REQUEST",
            message: "Invalid request payload",
            details: parsedReq.error.flatten(),
            request_id: getRequestId(res)
          }
        })
      );
      return;
    }

    const payload = parsedReq.data as AgentRunRequest;
    const system = buildAgentSystemPrompt();
    const user = buildAgentUserPrompt(payload, {
      maxMessages: config.limits.maxMessages,
      maxMessageChars: config.limits.maxMessageChars,
      maxBoardSections: config.limits.maxBoardSections,
      maxSectionChars: config.limits.maxSectionContentChars
    });

    const streamModel =
      config.ai.primaryModel === "deepseek-reasoner" ? config.ai.fallbackModel : config.ai.primaryModel;

    res.statusCode = 200;
    res.setHeader("Content-Type", "text/event-stream; charset=utf-8");
    res.setHeader("Cache-Control", "no-cache, no-transform");
    res.setHeader("Connection", "keep-alive");

    writeSseEvent(res, "meta", {
      request_id: getRequestId(res),
      session_id: payload.session_id,
      mode: "stream"
    });

    let assistantSnapshot = "";
    let lastEmittedLength = 0;
    let lastBoardActionsPreviewSignature = "";

    try {
      const messages = [
        { role: "system" as const, content: system },
        { role: "user" as const, content: user }
      ];

      const { parsed } = await callDeepSeekJsonStreamRaw({
        apiKey: config.deepseekApiKey,
        model: streamModel,
        messages,
        maxTokens: config.ai.maxTokens,
        timeoutMs: config.ai.timeoutMs,
        onToken: (token) => {
          assistantSnapshot += token;
          const partialText = extractAssistantMessageFromJsonPrefix(assistantSnapshot);
          if (partialText.length > lastEmittedLength) {
            const delta = partialText.slice(lastEmittedLength);
            lastEmittedLength = partialText.length;
            writeSseEvent(res, "assistant_delta", { delta });
          }

          const boardActionsPreview = extractBoardActionsFromJsonPrefix(assistantSnapshot);
          if (boardActionsPreview.length > 0) {
            const signature = JSON.stringify(boardActionsPreview);
            if (signature !== lastBoardActionsPreviewSignature) {
              lastBoardActionsPreviewSignature = signature;
              writeSseEvent(res, "board_actions_preview", { board_actions: boardActionsPreview });
            }
          }
        }
      });

      const ok = AgentRunResponseSchema.parse(parsed);
      if (ok.assistant_message.length > lastEmittedLength) {
        const delta = ok.assistant_message.slice(lastEmittedLength);
        writeSseEvent(res, "assistant_delta", { delta });
      }

      writeSseEvent(res, "result", ok);
      res.end();
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      logger.error("agent.stream_failed", {
        request_id: getRequestId(res),
        session_id: payload.session_id,
        model: streamModel,
        message
      });

      sendErrorEvent(res, "AI_AGENT_STREAM_FAILED", "AI stream failed", message);
      res.end();
    }
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    try {
      res.statusCode = 500;
      res.setHeader("Content-Type", "application/json; charset=utf-8");
      res.end(
        JSON.stringify({
          error: {
            code: "INTERNAL_SERVER_ERROR",
            message,
            request_id: getRequestId(res)
          }
        })
      );
    } catch {
      res.statusCode = 500;
      res.end();
    }
  }
}
