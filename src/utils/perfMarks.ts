export const CANVAS_NAV_START_KEY = "ai-world-canvas-nav-start-ms";

const MAX_MARK_AGE_MS = 120_000;

function safeReadSessionStorage(key: string) {
  try {
    return window.sessionStorage.getItem(key);
  } catch {
    return null;
  }
}

function safeWriteSessionStorage(key: string, value: string) {
  try {
    window.sessionStorage.setItem(key, value);
  } catch {
    // ignore session storage failures
  }
}

function safeRemoveSessionStorage(key: string) {
  try {
    window.sessionStorage.removeItem(key);
  } catch {
    // ignore session storage failures
  }
}

export function markCanvasNavigationStart(atMs = Date.now()) {
  safeWriteSessionStorage(CANVAS_NAV_START_KEY, String(atMs));
}

export function consumeCanvasNavigationLatency(
  nowMs = Date.now(),
  maxAgeMs = MAX_MARK_AGE_MS
): number | null {
  const raw = safeReadSessionStorage(CANVAS_NAV_START_KEY);
  safeRemoveSessionStorage(CANVAS_NAV_START_KEY);
  if (!raw) return null;

  const startMs = Number(raw);
  if (!Number.isFinite(startMs)) return null;

  const latency = nowMs - startMs;
  if (latency < 0 || latency > maxAgeMs) return null;

  return latency;
}

