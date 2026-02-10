import type { AgentClientError } from "../ai/agentClient";
import type { AgentRunRequest } from "../ai/agentProtocol";
import type { BoardAction, BoardContent, BoardSection, ChatMessage, WorkspaceState } from "../types/workspace";
import { sanitizeHtml } from "../utils/sanitizeHtml";

export const HTML_TAG_PATTERN = /<([a-z][\w-]*)(\s[^>]*)?>/i;
export const UNDO_STACK_LIMIT = 80;
export const DEFAULT_DOCUMENT_TITLE = "未命名标题";

export type InlineHintReason = "kickoff" | "short_answer" | "missing_context";

export type InlineHint = {
  key: string;
  reason: InlineHintReason;
  text: string;
  actionLabel: string;
  prompt: string;
};

export type NormalizedAgentError = {
  type: "network" | "api_error" | "timeout" | "parse";
  message: string;
};

export function makeId(): string {
  if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") {
    return crypto.randomUUID();
  }
  return `${Date.now().toString(16)}-${Math.random().toString(16).slice(2)}`;
}

export function shortId(value: string) {
  if (value.length <= 10) return value;
  return `${value.slice(0, 6)}…${value.slice(-4)}`;
}

export function defaultWorkspaceState(seed?: { taskId?: string }): WorkspaceState {
  const sessionId = seed?.taskId?.trim() || makeId();
  return {
    sessionId,
    chatMessages: [],
    boardSections: [],
    undoStack: [],
    redoStack: [],
    isAiTyping: false,
    errorState: {
      hasError: false,
      errorType: null,
      message: "",
      retryCount: 0,
      lastErrorTime: 0,
      isOfflineMode: false
    }
  };
}

export function getBoardContent(sections: BoardSection[]): BoardContent {
  const rawMarkdown = sections.map((s) => `## ${s.title}\n\n${s.content}`).join("\n\n");
  return { sections, rawMarkdown };
}

function escapeHtml(value: string) {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/\"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

export function toHtmlSegment(value: string) {
  const trimmed = value.trim();
  if (!trimmed) return "";
  if (HTML_TAG_PATTERN.test(trimmed)) return sanitizeHtml(value);
  return `<p>${escapeHtml(value).replace(/\n/g, "<br />")}</p>`;
}

export function appendBoardContent(existing: string, addition: string) {
  if (!addition.trim()) return existing;
  if (!existing.trim()) return addition;
  const existingHtml = HTML_TAG_PATTERN.test(existing);
  const additionHtml = HTML_TAG_PATTERN.test(addition);
  if (existingHtml || additionHtml) {
    return `${toHtmlSegment(existing)}${toHtmlSegment(addition)}`;
  }
  return `${existing}\n${addition}`;
}

function dedupePlainTextLines(value: string) {
  const lines = value.split(/\n+/);
  const seen = new Set<string>();
  const next: string[] = [];
  for (const line of lines) {
    const key = line.trim();
    if (!key) continue;
    if (seen.has(key)) continue;
    seen.add(key);
    next.push(line.trim());
  }
  return next.join("\n");
}

function mergeContentWithoutDuplication(existing: string, incoming: string) {
  const left = existing.trim();
  const right = incoming.trim();
  if (!right) return existing;
  if (!left) return incoming;

  const leftPlain = htmlToPlainText(left).replace(/\s+/g, " ").trim();
  const rightPlain = htmlToPlainText(right).replace(/\s+/g, " ").trim();
  if (leftPlain && rightPlain) {
    if (leftPlain === rightPlain || leftPlain.includes(rightPlain)) return existing;
    if (rightPlain.includes(leftPlain)) return incoming;
  }

  if (left === right || left.includes(right)) return existing;
  if (right.includes(left)) return incoming;

  const merged = appendBoardContent(existing, incoming);
  const hasHtml = HTML_TAG_PATTERN.test(existing) || HTML_TAG_PATTERN.test(incoming);
  return hasHtml ? merged : dedupePlainTextLines(merged);
}

function isPlaceholderTitle(value: string) {
  const trimmed = value.trim();
  if (!trimmed) return true;
  if (trimmed === DEFAULT_DOCUMENT_TITLE) return true;
  return /^小节\s+\d+$/i.test(trimmed);
}

function pickAutoDocumentTitle(sections: BoardSection[]) {
  const fromOtherSection = sections.find((section, index) => index > 0 && !isPlaceholderTitle(section.title));
  if (fromOtherSection) return fromOtherSection.title.trim();

  const firstLine = sections
    .map((section) => htmlToPlainText(section.content))
    .join("\n")
    .split(/\n+/)
    .map((line) => line.trim())
    .find(Boolean);

  if (!firstLine) return "";
  const normalized = firstLine.replace(/^主题[:：]\s*/i, "");
  if (!normalized) return "";
  return normalized.length > 24 ? `${normalized.slice(0, 24)}…` : normalized;
}

export function syncDocumentTitle(sections: BoardSection[]) {
  if (!sections.length) return sections;
  const first = sections[0];
  if (!isPlaceholderTitle(first.title)) return sections;

  const candidate = pickAutoDocumentTitle(sections);
  if (!candidate || candidate === first.title) return sections;

  const next = sections.slice();
  next[0] = {
    ...first,
    title: candidate,
    lastUpdated: Date.now()
  };
  return next;
}

export function htmlToPlainText(value: string) {
  const trimmed = value.trim();
  if (!trimmed) return "";
  if (typeof window === "undefined" || !HTML_TAG_PATTERN.test(trimmed)) return value;
  const container = document.createElement("div");
  container.innerHTML = value;
  const text = container.textContent ?? container.innerText ?? "";
  return text.replace(/\n{3,}/g, "\n\n").trim();
}

export function getBoardCharCount(sections: BoardSection[]) {
  return sections
    .map((s) => htmlToPlainText(s.content))
    .join("\n")
    .replace(/\s+/g, "").length;
}

export function pushUndoSnapshot(stack: BoardContent[], snapshot: BoardContent) {
  const last = stack[stack.length - 1];
  if (last && last.rawMarkdown === snapshot.rawMarkdown) return stack;
  const next = [...stack, snapshot];
  return next.length > UNDO_STACK_LIMIT ? next.slice(next.length - UNDO_STACK_LIMIT) : next;
}

function getLastUserMessage(messages: ChatMessage[]) {
  for (let i = messages.length - 1; i >= 0; i--) {
    if (messages[i].role === "user") return messages[i];
  }
  return null;
}

export function buildHintCandidate(state: WorkspaceState): InlineHint | null {
  const userTurns = state.chatMessages.filter((m) => m.role === "user").length;
  const boardChars = getBoardCharCount(state.boardSections);
  const lastUser = getLastUserMessage(state.chatMessages);

  if (userTurns === 0) {
    return {
      key: "kickoff",
      reason: "kickoff",
      text: "可以先让我提问 3 个关键问题，快速把目标讲清楚。",
      actionLabel: "先提问我",
      prompt: "我还比较模糊，请你先问我 3 个关键问题，帮助我快速澄清目标。"
    };
  }

  if (lastUser && lastUser.content.trim().length < 12) {
    return {
      key: "short_answer",
      reason: "short_answer",
      text: "你的信息有点短，补充“目标/对象/限制”会让结果更快成型。",
      actionLabel: "给我补充提纲",
      prompt: "请告诉我你还缺哪些关键信息，并给我一个最小补充模板（目标、对象、限制、截止时间）。"
    };
  }

  if (userTurns >= 2 && boardChars < 80) {
    return {
      key: "missing_context",
      reason: "missing_context",
      text: "白板信息还少，可以先让 AI 搭一个初始结构再细化。",
      actionLabel: "先搭结构",
      prompt: "请先帮我在白板搭一个 3-5 段的初始结构，然后告诉我先补哪一段。"
    };
  }

  return null;
}

export function normalizeAgentError(err: unknown): NormalizedAgentError {
  const fallback = "AI 服务暂时不可用，请稍后再试。";
  if (!err || typeof err !== "object" || !("kind" in err)) {
    return { type: "api_error", message: fallback };
  }

  const value = err as AgentClientError;
  if (value.kind === "network") {
    const timedOut = /timeout|timed out/i.test(value.message);
    return {
      type: timedOut ? "timeout" : "network",
      message: timedOut ? "请求超时，请点击重试。" : "网络连接异常，请检查网络后重试。"
    };
  }

  if (value.kind === "parse") {
    return { type: "parse", message: "响应解析失败，请点击重试。" };
  }

  if (value.kind === "server") {
    if (value.message) return { type: "api_error", message: value.message };
    if (value.status === 429) return { type: "api_error", message: "请求过于频繁，请稍后重试。" };
    if (value.status && value.status >= 500) {
      return { type: "api_error", message: "服务端暂时不可用，请稍后重试。" };
    }
    return { type: "api_error", message: fallback };
  }

  return { type: "api_error", message: fallback };
}

function resolveSectionIndex(sections: BoardSection[], action: BoardAction) {
  const normalizeTitleKey = (value: string) => value.trim().replace(/\s+/g, " ").toLowerCase();

  if (action.section_id) {
    const idx = sections.findIndex((s) => s.id === action.section_id);
    if (idx >= 0) return idx;
  }
  if (action.section_title) {
    const target = normalizeTitleKey(action.section_title);
    const idx = sections.findIndex((s) => normalizeTitleKey(s.title) === target);
    if (idx >= 0) return idx;
  }
  return -1;
}

export function applyBoardActions(sections: BoardSection[], actions: BoardAction[]) {
  if (!actions.length) return { sections, didChange: false };
  let nextSections = [...sections];
  let didChange = false;
  const now = Date.now();

  actions.forEach((action) => {
    const title = action.section_title?.trim();
    const rawContent = action.content ?? "";
    const content = HTML_TAG_PATTERN.test(rawContent.trim()) ? sanitizeHtml(rawContent) : rawContent;
    const index = resolveSectionIndex(nextSections, action);

    if (action.action === "create_structure") {
      if (!title) return;
      if (index >= 0) {
        if (content.trim() && !nextSections[index].content.trim()) {
          nextSections[index] = {
            ...nextSections[index],
            content,
            source: "ai",
            lastUpdated: now
          };
          didChange = true;
        }
        return;
      }
      nextSections = [
        ...nextSections,
        {
          id: action.section_id ?? makeId(),
          title,
          content,
          source: "ai",
          lastUpdated: now
        }
      ];
      didChange = true;
      return;
    }

    if (action.action === "update_section") {
      if (index >= 0) {
        nextSections[index] = {
          ...nextSections[index],
          content,
          source: "ai",
          lastUpdated: now
        };
        didChange = true;
        return;
      }
      if (title) {
        nextSections = [
          ...nextSections,
          {
            id: action.section_id ?? makeId(),
            title,
            content,
            source: "ai",
            lastUpdated: now
          }
        ];
        didChange = true;
      }
      return;
    }

    if (action.action === "append_section") {
      if (!content.trim()) return;
      if (index >= 0) {
        const target = nextSections[index];
        const nextContent = mergeContentWithoutDuplication(target.content, content);
        if (nextContent === target.content) return;
        nextSections[index] = {
          ...target,
          content: nextContent,
          source: "ai",
          lastUpdated: now
        };
        didChange = true;
        return;
      }
      if (title) {
        nextSections = [
          ...nextSections,
          {
            id: action.section_id ?? makeId(),
            title,
            content,
            source: "ai",
            lastUpdated: now
          }
        ];
        didChange = true;
      }
      return;
    }

    if (action.action === "clear_section" && index >= 0) {
      nextSections[index] = {
        ...nextSections[index],
        content: "",
        source: "ai",
        lastUpdated: now
      };
      didChange = true;
    }
  });

  const normalizedSections = syncDocumentTitle(nextSections);
  const normalizedChanged = normalizedSections !== nextSections;
  return { sections: normalizedSections, didChange: didChange || normalizedChanged };
}

export function buildAgentRequest(state: WorkspaceState, nextMessages: ChatMessage[]): AgentRunRequest {
  return {
    session_id: state.sessionId,
    messages: nextMessages.map((msg) => ({ role: msg.role, content: msg.content })),
    board_sections: state.boardSections.map((section) => ({
      id: section.id,
      title: section.title,
      content: section.content,
      source: section.source
    }))
  };
}
