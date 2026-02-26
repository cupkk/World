/**
 * BullMQ-based async AI task queue.
 * Allows long-running AI tasks to be processed in background workers
 * instead of blocking HTTP requests (which can timeout at 30-60s).
 */
import { Queue, Worker, Job } from "bullmq";
import { randomUUID } from "node:crypto";
import { EventEmitter } from "node:events";
import { loadConfig } from "./config";
import { buildAgentSystemPrompt, buildAgentUserPrompt } from "./agentPrompt";
import { callDeepSeekJsonRaw } from "./deepseek";
import { AgentRunResponseSchema } from "./schemas";
import { logger } from "./logger";
import type { AgentRunRequest } from "./agentProtocol";

const config = loadConfig();

// ── Redis connection ────────────────────────────────────────────────────────
const REDIS_URL = config.redisUrl || "redis://127.0.0.1:6379";
const redisConnection = (() => {
  try {
    const url = new URL(REDIS_URL);
    return {
      host: url.hostname || "127.0.0.1",
      port: Number(url.port) || 6379,
      password: url.password || undefined,
    };
  } catch {
    return { host: "127.0.0.1", port: 6379 };
  }
})();

const STRICT_JSON_HINT =
  "Your previous output failed validation. Return ONLY a single JSON object exactly matching the schema. No markdown, no comments.";

// ── Types ───────────────────────────────────────────────────────────────────
export interface AiTaskJobData {
  taskId: string;
  requestId: string;
  payload: AgentRunRequest;
}

export type AiTaskStatus = "queued" | "processing" | "completed" | "failed";

export interface AiTaskProgress {
  taskId: string;
  status: AiTaskStatus;
  progress?: number; // 0-100
  attempt?: number;
  totalAttempts?: number;
  result?: unknown;
  error?: string;
  createdAt: number;
  updatedAt: number;
}

// ── In-memory task progress store ───────────────────────────────────────────
// In production, this should be backed by Redis for multi-process support.
const taskStore = new Map<string, AiTaskProgress>();
export const taskEvents = new EventEmitter();
taskEvents.setMaxListeners(200);

export function getTaskProgress(taskId: string): AiTaskProgress | undefined {
  return taskStore.get(taskId);
}

function updateTask(taskId: string, updates: Partial<AiTaskProgress>) {
  const existing = taskStore.get(taskId);
  if (!existing) return;
  const updated = { ...existing, ...updates, updatedAt: Date.now() };
  taskStore.set(taskId, updated);
  taskEvents.emit(`task:${taskId}`, updated);
}

// Auto-cleanup completed tasks after 10 minutes
setInterval(() => {
  const cutoff = Date.now() - 10 * 60 * 1000;
  for (const [id, task] of taskStore) {
    if ((task.status === "completed" || task.status === "failed") && task.updatedAt < cutoff) {
      taskStore.delete(id);
    }
  }
}, 60_000);

// ── Queue & Worker ──────────────────────────────────────────────────────────
let aiQueue: Queue<AiTaskJobData> | null = null;
let aiWorker: Worker<AiTaskJobData> | null = null;

export function initAiTaskQueue() {
  aiQueue = new Queue<AiTaskJobData>("ai-agent-tasks", {
    connection: redisConnection,
    defaultJobOptions: {
      attempts: 1,
      removeOnComplete: { age: 600 },
      removeOnFail: { age: 600 },
    },
  });

  aiWorker = new Worker<AiTaskJobData>(
    "ai-agent-tasks",
    async (job: Job<AiTaskJobData>) => {
      const { taskId, requestId, payload } = job.data;

      updateTask(taskId, { status: "processing", progress: 10 });

      if (!config.deepseekApiKey) {
        throw new Error("Missing DEEPSEEK_API_KEY");
      }

      const system = buildAgentSystemPrompt();
      const user = buildAgentUserPrompt(payload, {
        maxMessages: config.limits.maxMessages,
        maxMessageChars: config.limits.maxMessageChars,
        maxBoardSections: config.limits.maxBoardSections,
        maxSectionChars: config.limits.maxSectionContentChars,
      });

      const baseMessages = [
        { role: "system" as const, content: system },
        { role: "user" as const, content: user },
      ];

      const attempts: Array<{ model: "deepseek-reasoner" | "deepseek-chat"; hint?: string }> = [
        { model: config.ai.primaryModel },
        { model: config.ai.primaryModel, hint: STRICT_JSON_HINT },
      ];

      if (config.ai.fallbackModel !== config.ai.primaryModel) {
        attempts.push({ model: config.ai.fallbackModel });
        attempts.push({ model: config.ai.fallbackModel, hint: STRICT_JSON_HINT });
      }

      const errors: string[] = [];
      for (let i = 0; i < attempts.length; i++) {
        const attempt = attempts[i];
        const progressPct = 10 + Math.round(((i + 1) / attempts.length) * 80);

        updateTask(taskId, {
          progress: progressPct,
          attempt: i + 1,
          totalAttempts: attempts.length,
        });

        try {
          const messages = attempt.hint
            ? [...baseMessages, { role: "user" as const, content: attempt.hint }]
            : baseMessages;

          const { parsed } = await callDeepSeekJsonRaw({
            apiKey: config.deepseekApiKey,
            model: attempt.model,
            messages,
            maxTokens: config.ai.maxTokens,
            timeoutMs: config.ai.timeoutMs,
          });

          const result = AgentRunResponseSchema.parse(parsed);

          if (i > 0) {
            logger.warn("agent.async_retry_success", {
              request_id: requestId,
              task_id: taskId,
              attempt: i + 1,
              model: attempt.model,
            });
          }

          updateTask(taskId, { status: "completed", progress: 100, result });
          return result;
        } catch (err) {
          const message = err instanceof Error ? err.message : String(err);
          errors.push(`attempt_${i + 1}[${attempt.model}${attempt.hint ? ":strict" : ""}]: ${message}`);
        }
      }

      const errorMessage = `AI agent failed after ${attempts.length} attempts`;
      logger.error("agent.async_failed", {
        request_id: requestId,
        task_id: taskId,
        session_id: payload.session_id,
        attempts: errors,
      });

      updateTask(taskId, { status: "failed", progress: 100, error: errorMessage });
      throw new Error(errorMessage);
    },
    {
      connection: redisConnection,
      concurrency: 3,
      limiter: { max: 10, duration: 60_000 },
    }
  );

  aiWorker.on("failed", (job, err) => {
    if (job) {
      const { taskId } = job.data;
      updateTask(taskId, {
        status: "failed",
        progress: 100,
        error: err.message,
      });
    }
  });

  logger.info("ai_queue.initialized", { redis: REDIS_URL });
}

/**
 * Submit an AI agent task to the queue.
 * Returns a task ID that can be used to poll for progress.
 */
export async function submitAiTask(
  payload: AgentRunRequest,
  requestId: string
): Promise<string> {
  if (!aiQueue) {
    throw new Error("AI task queue not initialized. Is Redis running?");
  }

  const taskId = randomUUID();
  const now = Date.now();

  taskStore.set(taskId, {
    taskId,
    status: "queued",
    progress: 0,
    createdAt: now,
    updatedAt: now,
  });

  await aiQueue.add("agent-run", { taskId, requestId, payload }, {
    jobId: taskId,
  });

  return taskId;
}
