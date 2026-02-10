export type AnalyticsEventName =
  | "entry_viewed"
  | "task_created"
  | "schema_completed"
  | "draft_generated"
  | "draft_confirmed"
  | "copy_clicked"
  | "export_clicked"
  | "perf_canvas_interactive"
  | "perf_stream_first_token"
  | "perf_export_first_response"
  | "ai_hint_shown"
  | "ai_hint_dismissed"
  | "ai_hint_accepted"
  | "margin_note_accepted";

type SessionState = {
  session_id: string;
  last_activity_ms: number;
};

export type AnalyticsEvent = {
  event: AnalyticsEventName;
  created_at: string;
  anonymous_id: string;
  session_id: string;
} & Record<string, unknown>;

const ANON_ID_KEY = "ai-world-anonymous-id-v1";
const SESSION_KEY = "ai-world-session-v1";
const EVENT_LOG_KEY = "ai-world-event-log-v1";
const DRAFT_CONFIRMED_KEY = "ai-world-draft-confirmed-v1";
const ENTRY_VIEWED_SESSION_KEY = "ai-world-entry-viewed-session-v1";

const SESSION_TIMEOUT_MS = 30 * 60 * 1000;
const MAX_EVENTS = 200;

function nowMs() {
  return Date.now();
}

function makeId() {
  if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") {
    return crypto.randomUUID();
  }
  return `${nowMs().toString(16)}-${Math.random().toString(16).slice(2)}`;
}

function safeRead(key: string): string | null {
  try {
    return localStorage.getItem(key);
  } catch {
    return null;
  }
}

function safeWrite(key: string, value: string) {
  try {
    localStorage.setItem(key, value);
  } catch {
    // ignore
  }
}

function safeJsonParse<T>(raw: string | null): T | null {
  if (!raw) return null;
  try {
    return JSON.parse(raw) as T;
  } catch {
    return null;
  }
}

function safeJsonStringify(value: unknown): string {
  try {
    return JSON.stringify(value);
  } catch {
    return "[]";
  }
}

export function getAnonymousId() {
  const existing = safeRead(ANON_ID_KEY);
  if (existing) return existing;

  const next = makeId();
  safeWrite(ANON_ID_KEY, next);
  return next;
}

export function getSessionId() {
  const now = nowMs();
  const stored = safeJsonParse<SessionState>(safeRead(SESSION_KEY));
  if (stored && typeof stored.session_id === "string" && typeof stored.last_activity_ms === "number") {
    if (now - stored.last_activity_ms <= SESSION_TIMEOUT_MS) {
      const next: SessionState = { ...stored, last_activity_ms: now };
      safeWrite(SESSION_KEY, safeJsonStringify(next));
      return stored.session_id;
    }
  }

  const next: SessionState = { session_id: makeId(), last_activity_ms: now };
  safeWrite(SESSION_KEY, safeJsonStringify(next));
  return next.session_id;
}

function appendEvent(e: AnalyticsEvent) {
  const existing = safeJsonParse<AnalyticsEvent[]>(safeRead(EVENT_LOG_KEY)) ?? [];
  const next = [...existing, e].slice(-MAX_EVENTS);
  safeWrite(EVENT_LOG_KEY, safeJsonStringify(next));
}

function hasDraftConfirmed(taskId: string) {
  const existing = safeJsonParse<Record<string, true>>(safeRead(DRAFT_CONFIRMED_KEY)) ?? {};
  return Boolean(existing[taskId]);
}

function markDraftConfirmed(taskId: string) {
  const existing = safeJsonParse<Record<string, true>>(safeRead(DRAFT_CONFIRMED_KEY)) ?? {};
  if (existing[taskId]) return false;

  const next = { ...existing, [taskId]: true };
  safeWrite(DRAFT_CONFIRMED_KEY, safeJsonStringify(next));
  return true;
}

function trackInternal(event: AnalyticsEventName, payload: Record<string, unknown>) {
  const e: AnalyticsEvent = {
    event,
    created_at: new Date().toISOString(),
    anonymous_id: getAnonymousId(),
    session_id: getSessionId(),
    ...payload
  };

  appendEvent(e);

  console.log("[analytics]", e.event, e);
}

export function track(event: AnalyticsEventName, payload: Record<string, unknown> = {}) {
  if (event === "entry_viewed") {
    const sessionId = getSessionId();
    const lastEntryViewedSessionId = safeRead(ENTRY_VIEWED_SESSION_KEY);
    if (lastEntryViewedSessionId === sessionId) {
      return;
    }
    safeWrite(ENTRY_VIEWED_SESSION_KEY, sessionId);
  }

  trackInternal(event, payload);

  if ((event === "copy_clicked" || event === "export_clicked") && typeof payload.task_id === "string") {
    const taskId = payload.task_id;
    if (!hasDraftConfirmed(taskId) && markDraftConfirmed(taskId)) {
      trackInternal("draft_confirmed", { task_id: taskId, source_event: event });
    }
  }
}

export function getEventLog(): AnalyticsEvent[] {
  return safeJsonParse<AnalyticsEvent[]>(safeRead(EVENT_LOG_KEY)) ?? [];
}

export function clearEventLog() {
  safeWrite(EVENT_LOG_KEY, "[]");
}
