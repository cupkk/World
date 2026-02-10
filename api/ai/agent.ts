import { randomUUID } from "node:crypto";
import type { AgentRunRequest } from "../../server/src/agentProtocol";
import { buildAgentSystemPrompt, buildAgentUserPrompt } from "../../server/src/agentPrompt";
import { loadConfig } from "../../server/src/config";
import { callDeepSeekJsonRaw } from "../../server/src/deepseek";
import { logger } from "../../server/src/logger";
import { FixedWindowRateLimiter } from "../../server/src/rateLimit";
import { createAgentRequestSchema } from "../../server/src/requestSchemas";
import { AgentRunResponseSchema } from "../../server/src/schemas";

const REQUEST_ID_HEADER = "x-request-id";
const STRICT_JSON_HINT =
  "Your previous output failed validation. Return ONLY a single JSON object exactly matching the schema. No markdown, no comments.";

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

function sendJson(res: any, status: number, payload: unknown) {
  res.statusCode = status;
  res.setHeader("Content-Type", "application/json; charset=utf-8");
  res.end(JSON.stringify(payload));
}

function getRequestId(res: any) {
  const value = res.getHeader?.(REQUEST_ID_HEADER);
  return typeof value === "string" ? value : "unknown";
}

function sendError(res: any, status: number, code: string, message: string, details?: unknown) {
  const payload = {
    error: {
      code,
      message,
      request_id: getRequestId(res),
      ...(details !== undefined ? { details } : {})
    }
  };
  sendJson(res, status, payload);
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
      sendError(res, 405, "METHOD_NOT_ALLOWED", "Only POST is supported");
      return;
    }

    let config: ReturnType<typeof loadConfig>;
    try {
      config = loadConfig(process.env);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      sendError(res, 500, "CONFIG_ERROR", message);
      return;
    }
    const limiter = getSingletonLimiter(config);
    limiter.cleanup();
    const rate = limiter.consume(getClientIp(req));
    res.setHeader("X-RateLimit-Limit", String(limiter.maxRequests));
    res.setHeader("X-RateLimit-Remaining", String(rate.remaining));
    res.setHeader("X-RateLimit-Reset", String(Math.floor(rate.resetAt / 1000)));
    if (!rate.allowed) {
      res.setHeader("Retry-After", String(rate.retryAfterSec));
      sendError(res, 429, "RATE_LIMITED", "Too many requests. Please try again later.");
      return;
    }

    if (!config.deepseekApiKey) {
      sendError(res, 500, "CONFIG_ERROR", "Missing DEEPSEEK_API_KEY env var");
      return;
    }

    let body: unknown;
    try {
      body = await readJsonBody(req);
    } catch {
      sendError(res, 400, "INVALID_JSON", "Invalid JSON body");
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
      sendError(res, 400, "INVALID_REQUEST", "Invalid request payload", parsedReq.error.flatten());
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

    const baseMessages = [
      { role: "system" as const, content: system },
      { role: "user" as const, content: user }
    ];

    const attempts: Array<{ model: "deepseek-reasoner" | "deepseek-chat"; hint?: string }> = [
      { model: config.ai.primaryModel },
      { model: config.ai.primaryModel, hint: STRICT_JSON_HINT }
    ];

    if (config.ai.fallbackModel !== config.ai.primaryModel) {
      attempts.push({ model: config.ai.fallbackModel });
      attempts.push({ model: config.ai.fallbackModel, hint: STRICT_JSON_HINT });
    }

    const errors: string[] = [];
    for (let i = 0; i < attempts.length; i += 1) {
      const attempt = attempts[i];
      try {
        const messages = attempt.hint
          ? [...baseMessages, { role: "user" as const, content: attempt.hint }]
          : baseMessages;

        const { parsed } = await callDeepSeekJsonRaw({
          apiKey: config.deepseekApiKey,
          model: attempt.model,
          messages,
          maxTokens: config.ai.maxTokens,
          timeoutMs: config.ai.timeoutMs
        });

        const ok = AgentRunResponseSchema.parse(parsed);
        sendJson(res, 200, ok);
        return;
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        errors.push(`attempt_${i + 1}[${attempt.model}${attempt.hint ? ":strict" : ""}]: ${message}`);
      }
    }

    logger.error("agent.failed", {
      request_id: getRequestId(res),
      session_id: payload.session_id,
      attempts: errors
    });

    sendError(res, 502, "AI_AGENT_FAILED", "AI agent failed after retries", { attempts: errors });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    try {
      sendError(res, 500, "INTERNAL_SERVER_ERROR", message);
    } catch {
      res.statusCode = 500;
      res.end();
    }
  }
}
