import { randomUUID } from "node:crypto";
import cors from "cors";
import "dotenv/config";
import express from "express";
import type { AgentRunRequest } from "./agentProtocol";
import { buildAgentSystemPrompt, buildAgentUserPrompt } from "./agentPrompt";
import { loadConfig } from "./config";
import { callDeepSeekJsonRaw, callDeepSeekJsonStreamRaw } from "./deepseek";
import { logger } from "./logger";
import { createRateLimitMiddleware, FixedWindowRateLimiter } from "./rateLimit";
import { createAgentRequestSchema } from "./requestSchemas";
import { AgentRunResponseSchema } from "./schemas";
import { extractAssistantMessageFromJsonPrefix } from "./streaming";

const REQUEST_ID_HEADER = "x-request-id";
const STRICT_JSON_HINT =
  "Your previous output failed validation. Return ONLY a single JSON object exactly matching the schema. No markdown, no comments.";

type ApiErrorPayload = {
  code: string;
  message: string;
  request_id: string;
  details?: unknown;
};

function writeSseEvent(res: express.Response, event: string, payload: unknown) {
  res.write(`event: ${event}\n`);
  res.write(`data: ${JSON.stringify(payload)}\n\n`);
}

function getRequestId(res: express.Response) {
  const value = res.getHeader(REQUEST_ID_HEADER);
  return typeof value === "string" ? value : "unknown";
}

function sendError(
  res: express.Response,
  status: number,
  code: string,
  message: string,
  details?: unknown
) {
  const payload: ApiErrorPayload = {
    code,
    message,
    request_id: getRequestId(res),
    ...(details !== undefined ? { details } : {})
  };
  res.status(status).json({ error: payload });
}

function buildCorsOptions(origins: "*" | string[]): cors.CorsOptions {
  if (origins === "*") {
    return { origin: true };
  }

  return {
    origin(origin, callback) {
      if (!origin || origins.includes(origin)) {
        callback(null, true);
        return;
      }
      callback(new Error("CORS_ORIGIN_DENIED"));
    }
  };
}

const config = loadConfig();
const app = express();
const limiter = new FixedWindowRateLimiter(config.rateLimit.windowMs, config.rateLimit.maxRequests);
const agentRequestSchema = createAgentRequestSchema(config.limits);
const corsOptions = buildCorsOptions(config.corsOrigins);

app.disable("x-powered-by");
app.set("trust proxy", config.trustProxy);

app.use((req, res, next) => {
  const incoming = req.header(REQUEST_ID_HEADER);
  const requestId = incoming && incoming.trim() ? incoming.trim() : randomUUID();
  res.setHeader(REQUEST_ID_HEADER, requestId);

  const startMs = Date.now();
  res.on("finish", () => {
    logger.info("request.completed", {
      request_id: requestId,
      method: req.method,
      path: req.originalUrl,
      status_code: res.statusCode,
      duration_ms: Date.now() - startMs,
      ip: req.ip
    });
  });
  next();
});

app.use((_, res, next) => {
  res.setHeader("X-Content-Type-Options", "nosniff");
  res.setHeader("X-Frame-Options", "DENY");
  res.setHeader("Referrer-Policy", "no-referrer");
  res.setHeader("Cross-Origin-Resource-Policy", "same-site");
  next();
});

app.use(cors(corsOptions));
app.use(express.json({ limit: "1mb" }));

app.use((err: unknown, _req: express.Request, res: express.Response, next: express.NextFunction) => {
  if (err && typeof err === "object" && "type" in err && (err as { type?: string }).type === "entity.parse.failed") {
    sendError(res, 400, "INVALID_JSON", "Invalid JSON body");
    return;
  }
  if (err instanceof Error && err.message === "CORS_ORIGIN_DENIED") {
    sendError(res, 403, "CORS_ORIGIN_DENIED", "Origin is not allowed by CORS policy");
    return;
  }
  next(err);
});

app.get("/api/health", (_req, res) => {
  res.json({
    ok: true,
    service: "ai-world-proxy",
    env: config.nodeEnv,
    time: new Date().toISOString(),
    uptime_sec: Math.round(process.uptime())
  });
});

app.get("/api/ready", (_req, res) => {
  const ready = Boolean(config.deepseekApiKey);
  if (!ready) {
    sendError(res, 503, "NOT_READY", "Missing DEEPSEEK_API_KEY env var");
    return;
  }
  res.json({ ok: true, ready: true });
});

app.post("/api/ai/agent", createRateLimitMiddleware(limiter), async (req, res) => {
  if (!config.deepseekApiKey) {
    sendError(res, 500, "CONFIG_ERROR", "Missing DEEPSEEK_API_KEY env var");
    return;
  }

  const parsedReq = agentRequestSchema.safeParse(req.body);
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
  for (let i = 0; i < attempts.length; i++) {
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

      if (i > 0) {
        logger.warn("agent.retry_success", {
          request_id: getRequestId(res),
          attempt: i + 1,
          model: attempt.model,
          used_strict_hint: Boolean(attempt.hint)
        });
      }

      res.json(ok);
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
});

app.post("/api/ai/agent/stream", createRateLimitMiddleware(limiter), async (req, res) => {
  if (!config.deepseekApiKey) {
    sendError(res, 500, "CONFIG_ERROR", "Missing DEEPSEEK_API_KEY env var");
    return;
  }

  const parsedReq = agentRequestSchema.safeParse(req.body);
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

  const streamModel = config.ai.primaryModel === "deepseek-reasoner" ? config.ai.fallbackModel : config.ai.primaryModel;
  const messages = [
    { role: "system" as const, content: system },
    { role: "user" as const, content: user }
  ];

  res.status(200);
  res.setHeader("Content-Type", "text/event-stream; charset=utf-8");
  res.setHeader("Cache-Control", "no-cache, no-transform");
  res.setHeader("Connection", "keep-alive");
  res.flushHeaders();

  writeSseEvent(res, "meta", {
    request_id: getRequestId(res),
    session_id: payload.session_id,
    mode: "stream"
  });

  let assistantSnapshot = "";
  let lastEmittedLength = 0;
  try {
    const { parsed } = await callDeepSeekJsonStreamRaw({
      apiKey: config.deepseekApiKey,
      model: streamModel,
      messages,
      maxTokens: config.ai.maxTokens,
      timeoutMs: config.ai.timeoutMs,
      onToken: (token) => {
        assistantSnapshot += token;
        const partialText = extractAssistantMessageFromJsonPrefix(assistantSnapshot);
        if (partialText.length <= lastEmittedLength) return;
        const delta = partialText.slice(lastEmittedLength);
        lastEmittedLength = partialText.length;
        writeSseEvent(res, "assistant_delta", { delta });
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
    writeSseEvent(res, "error", {
      code: "AI_AGENT_STREAM_FAILED",
      message: "AI stream failed",
      details: message,
      request_id: getRequestId(res)
    });
    res.end();
  }
});

app.use((err: unknown, _req: express.Request, res: express.Response, _next: express.NextFunction) => {
  const message = err instanceof Error ? err.message : String(err);
  logger.error("server.unhandled_error", {
    request_id: getRequestId(res),
    message
  });
  sendError(res, 500, "INTERNAL_ERROR", "Internal server error");
});

app.listen(config.port, () => {
  logger.info("server.started", {
    url: `http://localhost:${config.port}`,
    env: config.nodeEnv,
    rate_limit: `${config.rateLimit.maxRequests}/${config.rateLimit.windowMs}ms`
  });
});
