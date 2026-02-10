export type LogLevel = "info" | "warn" | "error";

type LogPayload = Record<string, unknown>;

function nowIso() {
  return new Date().toISOString();
}

function emit(level: LogLevel, message: string, payload: LogPayload = {}) {
  const line = JSON.stringify({
    ts: nowIso(),
    level,
    message,
    ...payload
  });

  if (level === "error") {
    console.error(line);
    return;
  }
  if (level === "warn") {
    console.warn(line);
    return;
  }
  console.log(line);
}

export const logger = {
  info: (message: string, payload?: LogPayload) => emit("info", message, payload),
  warn: (message: string, payload?: LogPayload) => emit("warn", message, payload),
  error: (message: string, payload?: LogPayload) => emit("error", message, payload)
};
