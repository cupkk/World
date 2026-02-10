import { z } from "zod";

const TRUTHY = new Set(["1", "true", "yes", "on"]);

const BoolFromEnv = z.preprocess((value) => {
  if (typeof value === "boolean") return value;
  if (typeof value === "number") return value !== 0;
  if (typeof value === "string") return TRUTHY.has(value.trim().toLowerCase());
  return false;
}, z.boolean());

const EnvSchema = z.object({
  NODE_ENV: z.enum(["development", "test", "production"]).default("development"),
  PORT: z.coerce.number().int().min(1).max(65535).default(8787),

  DEEPSEEK_API_KEY: z.string().trim().min(1).optional(),
  AI_MODEL_PRIMARY: z.enum(["deepseek-reasoner", "deepseek-chat"]).default("deepseek-reasoner"),
  AI_MODEL_FALLBACK: z.enum(["deepseek-reasoner", "deepseek-chat"]).default("deepseek-chat"),
  AI_MAX_TOKENS: z.coerce.number().int().min(256).max(8192).default(4096),
  AI_TIMEOUT_MS: z.coerce.number().int().min(5_000).max(180_000).default(60_000),

  MAX_MESSAGES: z.coerce.number().int().min(1).max(100).default(30),
  MAX_MESSAGE_CHARS: z.coerce.number().int().min(64).max(20_000).default(4_000),
  MAX_BOARD_SECTIONS: z.coerce.number().int().min(1).max(100).default(30),
  MAX_SECTION_TITLE_CHARS: z.coerce.number().int().min(8).max(512).default(120),
  MAX_SECTION_CONTENT_CHARS: z.coerce.number().int().min(64).max(30_000).default(8_000),

  RATE_LIMIT_WINDOW_MS: z.coerce.number().int().min(1_000).max(600_000).default(60_000),
  RATE_LIMIT_MAX: z.coerce.number().int().min(1).max(500).default(30),
  TRUST_PROXY: BoolFromEnv.default(false),

  CORS_ORIGINS: z.string().optional()
});

function parseCorsOrigins(raw?: string): "*" | string[] {
  if (!raw || !raw.trim()) return "*";
  const trimmed = raw.trim();
  if (trimmed === "*") return "*";
  const origins = trimmed
    .split(",")
    .map((v) => v.trim())
    .filter(Boolean);
  return origins.length ? origins : "*";
}

export type AppConfig = ReturnType<typeof loadConfig>;

export function loadConfig(input: NodeJS.ProcessEnv = process.env) {
  const parsed = EnvSchema.safeParse(input);
  if (!parsed.success) {
    const issues = parsed.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`).join("; ");
    throw new Error(`Invalid server environment configuration: ${issues}`);
  }

  const env = parsed.data;
  return {
    nodeEnv: env.NODE_ENV,
    port: env.PORT,
    trustProxy: env.TRUST_PROXY,
    corsOrigins: parseCorsOrigins(env.CORS_ORIGINS),

    deepseekApiKey: env.DEEPSEEK_API_KEY,
    ai: {
      primaryModel: env.AI_MODEL_PRIMARY,
      fallbackModel: env.AI_MODEL_FALLBACK,
      maxTokens: env.AI_MAX_TOKENS,
      timeoutMs: env.AI_TIMEOUT_MS
    },

    limits: {
      maxMessages: env.MAX_MESSAGES,
      maxMessageChars: env.MAX_MESSAGE_CHARS,
      maxBoardSections: env.MAX_BOARD_SECTIONS,
      maxSectionTitleChars: env.MAX_SECTION_TITLE_CHARS,
      maxSectionContentChars: env.MAX_SECTION_CONTENT_CHARS
    },

    rateLimit: {
      windowMs: env.RATE_LIMIT_WINDOW_MS,
      maxRequests: env.RATE_LIMIT_MAX
    }
  } as const;
}
