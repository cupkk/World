import { Suspense, lazy, startTransition, useCallback, useEffect, useRef, useState } from "react";
import { MessageSquare, FileText, Plus, Sparkles, AlertTriangle, RotateCcw, X, Home } from "lucide-react";
import { useNavigate, useSearchParams } from "react-router-dom";
import ChatPane from "../components/ChatPane";
import { loadBoardPane } from "../components/boardPaneLoader";
import { runAgent, runAgentStream } from "../ai/agentClient";
import type { AgentRunResponse } from "../ai/agentProtocol";
import type {
  WorkspaceState,
  ChatMessage,
  BoardSection,
  BoardTemplateType,
  TextSelection,
  BoardHighlightRequest,
  AgentNextQuestion
} from "../types/workspace";
import { track } from "../analytics";
import { consumeCanvasNavigationLatency } from "../utils/perfMarks";
import { createPersistedSnapshot, persistWorkspaceSnapshot } from "./workspacePersistence";
import type { InlineHint } from "./workspaceCore";
import {
  applyBoardActions,
  buildAgentRequest,
  buildHintCandidate,
  defaultWorkspaceState,
  getBoardCharCount,
  getBoardContent,
  htmlToPlainText,
  makeId,
  normalizeAgentError,
  pushUndoSnapshot,
  resolveBoardTemplateTypeFromActions,
  syncDocumentTitle
} from "./workspaceCore";

const STORAGE_KEY = "ai-world-workspace-v2";
const EDIT_SNAPSHOT_INTERVAL_MS = 1200;
const HINT_COOLDOWN_MS = 45_000;
const STREAM_FLUSH_INTERVAL_MS = 80;
const STORAGE_DEBOUNCE_MS = 650;
const STORAGE_IDLE_TIMEOUT_MS = 1200;
const BoardPane = lazy(() => loadBoardPane());

type StreamBoardPreview = {
  sections: BoardSection[];
  template: BoardTemplateType;
};

function appendAssistantDelta(messages: ChatMessage[], assistantMessageId: string, chunk: string): ChatMessage[] {
  const lastIndex = messages.length - 1;
  if (lastIndex >= 0 && messages[lastIndex]?.id === assistantMessageId) {
    const next = messages.slice();
    const target = next[lastIndex];
    next[lastIndex] = { ...target, content: `${target.content}${chunk}` };
    return next;
  }

  let changed = false;
  const next = messages.map((message) => {
    if (message.id !== assistantMessageId) return message;
    changed = true;
    return { ...message, content: `${message.content}${chunk}` };
  });
  return changed ? next : messages;
}

function areBoardSectionsEqual(left: BoardSection[], right: BoardSection[]) {
  if (left.length !== right.length) return false;
  for (let i = 0; i < left.length; i += 1) {
    const a = left[i];
    const b = right[i];
    if (!a || !b) return false;
    if (a.id !== b.id) return false;
    if (a.title !== b.title) return false;
    if (a.content !== b.content) return false;
    if (a.source !== b.source) return false;
  }
  return true;
}

function nowPerfMs() {
  if (typeof performance !== "undefined" && typeof performance.now === "function") {
    return performance.now();
  }
  return Date.now();
}

function parseMarginAnchor(anchor?: string): { sectionId?: string; text?: string; raw?: string } {
  const raw = anchor?.trim();
  if (!raw) return {};

  if (raw.startsWith("{") && raw.endsWith("}")) {
    try {
      const parsed = JSON.parse(raw) as Record<string, unknown>;
      const sectionId =
        typeof parsed.section_id === "string"
          ? parsed.section_id
          : typeof parsed.sectionId === "string"
            ? parsed.sectionId
            : undefined;
      const text =
        typeof parsed.text === "string"
          ? parsed.text
          : typeof parsed.quote === "string"
            ? parsed.quote
            : typeof parsed.anchor_text === "string"
              ? parsed.anchor_text
              : undefined;
      return { sectionId: sectionId?.trim(), text: text?.trim(), raw };
    } catch {
      // fallback to string heuristics
    }
  }

  for (const delimiter of ["::", "|"]) {
    if (raw.includes(delimiter)) {
      const [left, right] = raw.split(delimiter, 2).map((item) => item.trim());
      if (left && right) return { sectionId: left, text: right, raw };
    }
  }

  return { raw, text: raw };
}

function resolveMarginNoteTargetSectionId(
  sections: BoardSection[],
  anchor?: string
): { sectionId: string | null; anchorText?: string } {
  const parsed = parseMarginAnchor(anchor);
  const normalizedAnchor = parsed.raw?.trim();
  const normalizedText = parsed.text?.trim();
  if (!normalizedAnchor && !parsed.sectionId && !parsed.text) {
    return { sectionId: sections[sections.length - 1]?.id ?? null, anchorText: undefined };
  }

  const bySectionId = parsed.sectionId
    ? sections.find((section) => section.id === parsed.sectionId)
    : null;
  if (bySectionId) return { sectionId: bySectionId.id, anchorText: parsed.text };

  const byId = sections.find((section) => section.id === normalizedAnchor);
  if (byId) return { sectionId: byId.id, anchorText: parsed.text };

  const keyword = (normalizedAnchor ?? normalizedText ?? "").toLowerCase();
  const byTitle = sections.find((section) => section.title.trim().toLowerCase().includes(keyword));
  if (byTitle) return { sectionId: byTitle.id, anchorText: parsed.text };

  const byContent = sections.find((section) =>
    htmlToPlainText(section.content).toLowerCase().includes((normalizedText ?? keyword).toLowerCase())
  );
  if (byContent) return { sectionId: byContent.id, anchorText: parsed.text ?? normalizedAnchor };

  return {
    sectionId: sections[sections.length - 1]?.id ?? null,
    anchorText: parsed.text ?? normalizedAnchor
  };
}

function setMarginNoteAccepted(messages: ChatMessage[], messageId: string, noteIndex: number, accepted: boolean) {
  return messages.map((message) => {
    if (message.id !== messageId) return message;
    const marginNotes = message.marginNotes ?? [];
    if (!marginNotes[noteIndex]) return message;
    const nextNotes = marginNotes.map((note, index) =>
      index === noteIndex
        ? {
            ...note,
            accepted,
            acceptedAt: accepted ? Date.now() : undefined
          }
        : note
    );
    return {
      ...message,
      marginNotes: nextNotes
    };
  });
}

type QuestionOptionExample = {
  label: string;
  example: string;
};

function sanitizeQuestionText(question: string) {
  return question.trim().replace(/^\d+\s*[.)、．]\s*/, "").trim();
}

function normalizeOptionText(option: string) {
  return option
    .trim()
    .replace(/^\s*(?:[-*]\s*)?(?:[A-Da-d]|[1-4])[.、:：)\-]\s*/, "")
    .trim();
}

function isPlaceholderQuestionOption(value: string) {
  return /^[A-Da-d1-4]$/.test(value.trim());
}

function pickQuestionOptionExamples(question: string): QuestionOptionExample[] {
  const q = question.toLowerCase();

  if (/(核心|问题|需求|痛点|解决)/.test(q)) {
    return [
      { label: "提升业务指标", example: "3个月内注册转化率提升20%" },
      { label: "解决流程效率", example: "将处理时长从2天缩短到4小时" },
      { label: "验证想法可行性", example: "验证新功能是否值得上线" },
      { label: "其他（请补充）", example: "降低客服投诉率或退款率" }
    ];
  }

  if (/(用户|受众|对象|面向|人群)/.test(q)) {
    return [
      { label: "B端企业角色", example: "连锁门店运营负责人" },
      { label: "C端个人用户", example: "18-30岁内容消费用户" },
      { label: "内部协作团队", example: "销售、客服、运营团队" },
      { label: "其他（请补充）", example: "特定行业或地区人群" }
    ];
  }

  if (/(成果|结果|交付|形式|产出)/.test(q)) {
    return [
      { label: "文档方案", example: "可直接汇报的PPT大纲+执行计划" },
      { label: "结构化清单", example: "里程碑、资源、风险列表" },
      { label: "可执行产物", example: "原型、脚本或代码草案" },
      { label: "其他（请补充）", example: "会议纪要、邮件草稿等" }
    ];
  }

  return [
    { label: "先做方案框架", example: "先给3-5步执行路径" },
    { label: "先明确关键约束", example: "预算、时间、人力边界" },
    { label: "先定义成功标准", example: "用1-2个可量化指标衡量" },
    { label: "其他（请补充）", example: "你当前最关心的问题" }
  ];
}

function enrichNextQuestionsWithExamples(nextQuestions?: AgentNextQuestion[]) {
  if (!nextQuestions?.length) {
    return {
      normalizedNextQuestions: nextQuestions,
      exampleBlock: ""
    };
  }

  const normalized: AgentNextQuestion[] = [];
  const lines: string[] = [];

  nextQuestions.forEach((item, questionIndex) => {
    const question = sanitizeQuestionText(item.question ?? "");
    if (!question) return;

    const templates = pickQuestionOptionExamples(question);
    const providedOptions = (item.options ?? [])
      .map(normalizeOptionText)
      .filter((option) => option && !isPlaceholderQuestionOption(option));
    const optionLabels = (providedOptions.length ? providedOptions : templates.map((entry) => entry.label)).slice(0, 4);

    normalized.push({
      ...item,
      question,
      options: optionLabels
    });

    lines.push(`${questionIndex + 1}. ${question}`);
    optionLabels.forEach((option, optionIndex) => {
      const letter = String.fromCharCode(65 + optionIndex);
      const fallbackExample = templates[optionIndex]?.example ?? "请补充你的实际场景";
      lines.push(`${letter}. ${option}（示例：${fallbackExample}）`);
    });
    lines.push("");
  });

  if (!normalized.length) {
    return {
      normalizedNextQuestions: nextQuestions,
      exampleBlock: ""
    };
  }

  return {
    normalizedNextQuestions: normalized,
    exampleBlock: ["", "你可参考以下选项回答：", ...lines].join("\n").trimEnd()
  };
}

function ErrorBanner({
  message,
  onRetry,
  onDismiss,
  busy
}: {
  message: string;
  onRetry: () => void;
  onDismiss: () => void;
  busy: boolean;
}) {
  return (
    <div
      className="border-b border-[var(--danger)]/20 bg-[rgba(168,59,42,0.08)] px-4 py-3"
      role="alert"
      aria-live="assertive"
    >
      <div className="flex items-start justify-between gap-3">
        <div className="flex items-start gap-2">
          <AlertTriangle className="mt-0.5 h-4 w-4 text-[var(--danger)]" />
          <div className="text-[12px] leading-relaxed text-[var(--danger)]">{message}</div>
        </div>

        <div className="flex items-center gap-1">
          <button
            type="button"
            onClick={onRetry}
            disabled={busy}
            className="flex h-7 items-center gap-1 rounded-md border border-[var(--danger)]/25 bg-white px-2 text-[11px] text-[var(--danger)] transition hover:bg-[var(--bg-muted)] disabled:cursor-not-allowed disabled:opacity-50"
          >
            <RotateCcw className="h-3.5 w-3.5" />
            重试
          </button>
          <button
            type="button"
            onClick={onDismiss}
            className="flex h-7 w-7 items-center justify-center rounded-md border border-transparent text-[var(--danger)] transition hover:border-[var(--danger)]/25 hover:bg-white"
            aria-label="关闭错误提示"
          >
            <X className="h-3.5 w-3.5" />
          </button>
        </div>
      </div>
    </div>
  );
}

function BoardPaneFallback() {
  return (
    <div className="flex h-full flex-col bg-[var(--bg-base)] p-5">
      <div className="h-12 rounded-xl border border-subtle bg-white/70" />
      <div className="mt-4 flex-1 rounded-2xl border border-subtle bg-white/70" />
    </div>
  );
}

export default function DualPaneWorkspace() {
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const queryTaskId = (searchParams.get("task_id") ?? "").trim();
  const forceNew = searchParams.get("new") === "1";

  const [state, setState] = useState<WorkspaceState>(() => {
    const base = defaultWorkspaceState({ taskId: queryTaskId || undefined });

    if (!forceNew) {
      try {
        const stored = localStorage.getItem(STORAGE_KEY);
        if (stored) {
          const parsed = JSON.parse(stored) as Partial<WorkspaceState>;
          return {
            ...base,
            ...parsed,
            sessionId: queryTaskId || parsed.sessionId || base.sessionId,
            chatMessages: Array.isArray(parsed.chatMessages) ? parsed.chatMessages : [],
            boardSections: Array.isArray(parsed.boardSections) ? syncDocumentTitle(parsed.boardSections) : [],
            boardTemplate:
              parsed.boardTemplate === "document" || parsed.boardTemplate === "table" || parsed.boardTemplate === "code"
                ? parsed.boardTemplate
                : base.boardTemplate,
            undoStack: Array.isArray(parsed.undoStack) ? parsed.undoStack : [],
            redoStack: Array.isArray(parsed.redoStack) ? parsed.redoStack : [],
            errorState: {
              ...base.errorState,
              ...(parsed.errorState ?? {})
            }
          };
        }
      } catch {
        // ignore parse errors
      }
    }

    return base;
  });

  const stateRef = useRef(state);
  const schemaTrackedRef = useRef(false);
  const lastEditSnapshotRef = useRef<{ sectionId: string; at: number }>({ sectionId: "", at: 0 });
  const lastHintShownAtRef = useRef(0);
  const dismissedHintsRef = useRef<Set<string>>(new Set());
  const canvasPerfTrackedRef = useRef(false);
  const chatPaneHeadingRef = useRef<HTMLDivElement | null>(null);
  const boardPaneHeadingRef = useRef<HTMLDivElement | null>(null);

  const [activeTab, setActiveTab] = useState<"chat" | "board">("chat");
  const [isMobile, setIsMobile] = useState(false);
  const [activeHint, setActiveHint] = useState<InlineHint | null>(null);
  const [boardHighlightRequest, setBoardHighlightRequest] = useState<BoardHighlightRequest | null>(null);
  const [streamBoardPreview, setStreamBoardPreview] = useState<StreamBoardPreview | null>(null);

  useEffect(() => {
    stateRef.current = state;
  }, [state]);

  useEffect(() => {
    const checkMobile = () => {
      setIsMobile(window.innerWidth < 768);
    };
    checkMobile();
    window.addEventListener("resize", checkMobile);
    return () => window.removeEventListener("resize", checkMobile);
  }, []);

  useEffect(() => {
    const snapshot = createPersistedSnapshot(state);
    const idleWindow = window as Window & {
      requestIdleCallback?: (callback: () => void, options?: { timeout: number }) => number;
      cancelIdleCallback?: (handle: number) => void;
    };

    let idleHandle: number | null = null;
    const persist = () => {
      persistWorkspaceSnapshot(localStorage, STORAGE_KEY, snapshot);
    };

    const timer = window.setTimeout(() => {
      if (typeof idleWindow.requestIdleCallback === "function") {
        idleHandle = idleWindow.requestIdleCallback(persist, { timeout: STORAGE_IDLE_TIMEOUT_MS });
      } else {
        persist();
      }
    }, STORAGE_DEBOUNCE_MS);

    return () => {
      window.clearTimeout(timer);
      if (idleHandle !== null && typeof idleWindow.cancelIdleCallback === "function") {
        idleWindow.cancelIdleCallback(idleHandle);
      }
    };
  }, [state]);

  useEffect(() => {
    track("entry_viewed", { page: "canvas" });
  }, []);

  useEffect(() => {
    if (canvasPerfTrackedRef.current) return;
    canvasPerfTrackedRef.current = true;

    const latencyMs = consumeCanvasNavigationLatency();
    const payload: Record<string, unknown> = {
      task_id: state.sessionId,
      source: latencyMs === null ? "direct" : "onboarding"
    };
    if (latencyMs !== null) {
      payload.latency_ms = latencyMs;
    }
    track("perf_canvas_interactive", payload);
  }, [state.sessionId]);

  useEffect(() => {
    if (state.boardSections.length >= 3 && state.chatMessages.length >= 3 && !schemaTrackedRef.current) {
      schemaTrackedRef.current = true;
      track("schema_completed", { task_id: state.sessionId });
    }
  }, [state.boardSections.length, state.chatMessages.length, state.sessionId]);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (!event.altKey) return;
      if (event.key === "1") {
        event.preventDefault();
        chatPaneHeadingRef.current?.focus();
      }
      if (event.key === "2") {
        event.preventDefault();
        boardPaneHeadingRef.current?.focus();
      }
    };

    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, []);

  useEffect(() => {
    if (state.isAiTyping || state.errorState.hasError || activeHint) return;

    const now = Date.now();
    if (now - lastHintShownAtRef.current < HINT_COOLDOWN_MS) return;

    const candidate = buildHintCandidate(state);
    if (!candidate) return;
    if (dismissedHintsRef.current.has(candidate.key)) return;

    setActiveHint(candidate);
    lastHintShownAtRef.current = now;
    track("ai_hint_shown", {
      task_id: state.sessionId,
      hint_key: candidate.key,
      reason: candidate.reason
    });
  }, [activeHint, state]);

  const updateStreamBoardPreview = useCallback(
    (baseSections: BoardSection[], baseTemplate: BoardTemplateType, boardActions: AgentRunResponse["board_actions"]) => {
      const previewResult = applyBoardActions(baseSections, boardActions ?? []);
      const previewTemplate = resolveBoardTemplateTypeFromActions(baseTemplate, boardActions ?? []);
      setStreamBoardPreview((prev) => {
        const next: StreamBoardPreview = {
          sections: previewResult.sections,
          template: previewTemplate
        };
        if (prev && prev.template === next.template && areBoardSectionsEqual(prev.sections, next.sections)) {
          return prev;
        }
        return next;
      });
    },
    []
  );

  const finalizeAgentSuccess = useCallback(
    ({
      assistantMessageId,
      response,
      source,
      baseBoardSections,
      baseBoardTemplate,
      taskId,
      conversationTurnCount
    }: {
      assistantMessageId: string;
      response: AgentRunResponse;
      source: "ai_sync" | "retry_sync";
      baseBoardSections: BoardSection[];
      baseBoardTemplate: BoardTemplateType;
      taskId: string;
      conversationTurnCount: number;
    }) => {
      const preview = applyBoardActions(baseBoardSections, response.board_actions ?? []);
      const previewTemplate = resolveBoardTemplateTypeFromActions(baseBoardTemplate, response.board_actions ?? []);
      const templateChanged = previewTemplate !== baseBoardTemplate;
      if (preview.didChange || templateChanged) {
        track("draft_generated", {
          task_id: taskId,
          source,
          conversation_turn_count: conversationTurnCount,
          board_char_count: getBoardCharCount(preview.sections),
          board_section_count: preview.sections.length
        });
      }
      setStreamBoardPreview(null);

      setState((prev) => {
        const result = applyBoardActions(prev.boardSections, response.board_actions ?? []);
        const nextTemplate = resolveBoardTemplateTypeFromActions(prev.boardTemplate, response.board_actions ?? []);
        const shouldSnapshot = result.didChange;
        const { normalizedNextQuestions, exampleBlock } = enrichNextQuestionsWithExamples(response.next_questions);
        const assistantMessageText =
          exampleBlock && !/示例[:：]/.test(response.assistant_message)
            ? `${response.assistant_message.trim()}\n\n${exampleBlock}`
            : response.assistant_message;
        const nextMessage: ChatMessage = {
          id: assistantMessageId,
          role: "assistant",
          content: assistantMessageText,
          timestamp: Date.now(),
          boardActions: response.board_actions,
          nextQuestions: normalizedNextQuestions,
          marginNotes: response.margin_notes
        };

        const hasPlaceholder = prev.chatMessages.some((msg) => msg.id === assistantMessageId);
        const chatMessages = hasPlaceholder
          ? prev.chatMessages.map((msg) => (msg.id === assistantMessageId ? nextMessage : msg))
          : [...prev.chatMessages, nextMessage];

        return {
          ...prev,
          chatMessages,
          boardSections: result.sections,
          boardTemplate: nextTemplate,
          undoStack: shouldSnapshot
            ? pushUndoSnapshot(prev.undoStack, getBoardContent(prev.boardSections))
            : prev.undoStack,
          redoStack: shouldSnapshot ? [] : prev.redoStack,
          isAiTyping: false,
          errorState: { ...prev.errorState, hasError: false, errorType: null, message: "" }
        };
      });
    },
    []
  );

  const handleSendMessage = useCallback(
    async (content: string) => {
      const userMessage: ChatMessage = {
        id: makeId(),
        role: "user",
        content,
        timestamp: Date.now()
      };
      const assistantMessageId = makeId();
      const baseState = stateRef.current;
      const nextMessages = [...baseState.chatMessages, userMessage];
      const request = buildAgentRequest(baseState, nextMessages);
      const streamStartedAt = nowPerfMs();
      let firstTokenTracked = false;

      let bufferedDelta = "";
      let flushTimer: number | null = null;
      const flushAssistantDelta = () => {
        if (!bufferedDelta) return;
        const chunk = bufferedDelta;
        bufferedDelta = "";
        startTransition(() => {
          setState((prev) => ({
            ...prev,
            chatMessages: appendAssistantDelta(prev.chatMessages, assistantMessageId, chunk)
          }));
        });
      };
      const clearFlushTimer = () => {
        if (flushTimer !== null) {
          window.clearTimeout(flushTimer);
          flushTimer = null;
        }
      };
      const scheduleFlush = () => {
        if (flushTimer !== null) return;
        flushTimer = window.setTimeout(() => {
          flushTimer = null;
          flushAssistantDelta();
        }, STREAM_FLUSH_INTERVAL_MS);
      };

      setState((prev) => ({
        ...prev,
        chatMessages: [
          ...prev.chatMessages,
          userMessage,
          {
            id: assistantMessageId,
            role: "assistant",
            content: "",
            timestamp: Date.now()
          }
        ],
        isAiTyping: true,
        errorState: { ...prev.errorState, hasError: false, errorType: null, message: "" }
      }));
      setActiveHint(null);
      setStreamBoardPreview(null);

      try {
        const response = await runAgentStream(request, {
          onAssistantDelta: (delta) => {
            if (!firstTokenTracked && delta) {
              firstTokenTracked = true;
              track("perf_stream_first_token", {
                task_id: baseState.sessionId,
                source: "send_message",
                latency_ms: Math.max(0, Math.round(nowPerfMs() - streamStartedAt))
              });
            }
            bufferedDelta += delta;
            scheduleFlush();
          },
          onBoardActionsPreview: (boardActions) => {
            updateStreamBoardPreview(baseState.boardSections, baseState.boardTemplate, boardActions);
          }
        });

        clearFlushTimer();
        flushAssistantDelta();
        finalizeAgentSuccess({
          assistantMessageId,
          response,
          source: "ai_sync",
          baseBoardSections: baseState.boardSections,
          baseBoardTemplate: baseState.boardTemplate,
          taskId: baseState.sessionId,
          conversationTurnCount: nextMessages.length + 1
        });
      } catch (streamErr) {
        clearFlushTimer();
        flushAssistantDelta();
        setStreamBoardPreview(null);
        try {
          const response = await runAgent(request);
          finalizeAgentSuccess({
            assistantMessageId,
            response,
            source: "ai_sync",
            baseBoardSections: baseState.boardSections,
            baseBoardTemplate: baseState.boardTemplate,
            taskId: baseState.sessionId,
            conversationTurnCount: nextMessages.length + 1
          });
        } catch (err) {
          const normalized = normalizeAgentError(err);
          setState((prev) => ({
            ...prev,
            chatMessages: prev.chatMessages.filter((msg) => !(msg.id === assistantMessageId && !msg.content.trim())),
            isAiTyping: false,
            errorState: {
              ...prev.errorState,
              hasError: true,
              errorType: normalized.type,
              message: normalized.message,
              retryCount: prev.errorState.retryCount + 1,
              lastErrorTime: Date.now()
            }
          }));
        }

        if (streamErr) {
          // Stream failed and normal request fallback is attempted above.
        }
      }
    },
    [finalizeAgentSuccess, updateStreamBoardPreview]
  );

  const handlePinToBoard = useCallback((messageId: string, selection?: TextSelection) => {
    setState((prev) => {
      const message = prev.chatMessages.find((m) => m.id === messageId);
      if (!message) return prev;

      const contentToPin = selection?.text ?? message.content;
      const newSection: BoardSection = {
        id: makeId(),
        title: "摘录",
        content: contentToPin,
        source: "pinned",
        lastUpdated: Date.now()
      };

      const currentContent = getBoardContent(prev.boardSections);
      track("ai_hint_accepted", { task_id: prev.sessionId, source: "pin_to_board" });

      return {
        ...prev,
        boardSections: [...prev.boardSections, newSection],
        undoStack: pushUndoSnapshot(prev.undoStack, currentContent),
        redoStack: []
      };
    });
  }, []);

  const handleAcceptMarginNote = useCallback((messageId: string, noteIndex: number) => {
    let nextHighlightRequest: BoardHighlightRequest | null = null;

    setState((prev) => {
      const message = prev.chatMessages.find((item) => item.id === messageId);
      const note = message?.marginNotes?.[noteIndex];
      const suggestion = note?.suggestion?.trim();

      if (!message || !note || note.accepted || !suggestion) return prev;

      const target = resolveMarginNoteTargetSectionId(prev.boardSections, note.anchor);
      const actions = target.sectionId
        ? [{ action: "append_section", section_id: target.sectionId, content: suggestion } as const]
        : [{ action: "create_structure", section_title: "优化建议采纳", content: suggestion } as const];

      const result = applyBoardActions(prev.boardSections, actions);
      if (!result.didChange) return prev;

      const highlightedSectionId = target.sectionId ?? result.sections[result.sections.length - 1]?.id ?? null;
      if (highlightedSectionId) {
        nextHighlightRequest = {
          key: makeId(),
          sectionId: highlightedSectionId,
          anchorText: target.anchorText
        };
      }

      track("margin_note_accepted", {
        task_id: prev.sessionId,
        source: "margin_note_button",
        message_id: messageId,
        note_index: noteIndex,
        note_dimension: note.dimension ?? null,
        anchor: note.anchor ?? null,
        board_char_count: getBoardCharCount(result.sections),
        board_section_count: result.sections.length
      });

      return {
        ...prev,
        chatMessages: setMarginNoteAccepted(prev.chatMessages, messageId, noteIndex, true),
        boardSections: result.sections,
        undoStack: pushUndoSnapshot(prev.undoStack, getBoardContent(prev.boardSections)),
        redoStack: []
      };
    });

    if (nextHighlightRequest) {
      setBoardHighlightRequest(nextHighlightRequest);
      if (isMobile) {
        setActiveTab("board");
      }
    }
  }, [isMobile]);

  const handleUndoMarginNoteAccept = useCallback((messageId: string, noteIndex: number) => {
    setState((prev) => {
      if (!prev.undoStack.length) return prev;

      const previousContent = prev.undoStack[prev.undoStack.length - 1];
      const currentContent = getBoardContent(prev.boardSections);

      return {
        ...prev,
        chatMessages: setMarginNoteAccepted(prev.chatMessages, messageId, noteIndex, false),
        boardSections: previousContent.sections,
        undoStack: prev.undoStack.slice(0, -1),
        redoStack: [...prev.redoStack, currentContent]
      };
    });
  }, []);

  const handleBoardSectionsChange = useCallback((nextSections: BoardSection[]) => {
    const now = Date.now();

    setState((prev) => {
      const normalizedSections = syncDocumentTitle(nextSections.map((section, index) => ({
        ...section,
        title: section.title.trim() || (index === 0 ? "未命名标题" : `小节 ${index}`),
        content: section.content.trim() ? section.content : "<p></p>",
        source: "user" as const,
        lastUpdated: section.lastUpdated || now
      })));

      if (areBoardSectionsEqual(prev.boardSections, normalizedSections)) {
        return prev;
      }

      const currentContent = getBoardContent(prev.boardSections);
      const shouldSnapshot = now - lastEditSnapshotRef.current.at >= EDIT_SNAPSHOT_INTERVAL_MS;
      if (shouldSnapshot) {
        lastEditSnapshotRef.current = { sectionId: "document", at: now };
      }

      return {
        ...prev,
        boardSections: normalizedSections,
        undoStack: shouldSnapshot ? pushUndoSnapshot(prev.undoStack, currentContent) : prev.undoStack,
        redoStack: []
      };
    });
  }, []);

  const handleBoardTemplateChange = useCallback((template: BoardTemplateType) => {
    setStreamBoardPreview(null);
    setState((prev) => {
      if (prev.boardTemplate === template) return prev;
      return {
        ...prev,
        boardTemplate: template
      };
    });
  }, []);

  const handleUndo = useCallback(() => {
    setState((prev) => {
      if (prev.undoStack.length === 0) return prev;
      const currentContent = getBoardContent(prev.boardSections);
      const previousContent = prev.undoStack[prev.undoStack.length - 1];
      return {
        ...prev,
        boardSections: previousContent.sections,
        undoStack: prev.undoStack.slice(0, -1),
        redoStack: [...prev.redoStack, currentContent]
      };
    });
  }, []);

  const handleRedo = useCallback(() => {
    setState((prev) => {
      if (prev.redoStack.length === 0) return prev;
      const currentContent = getBoardContent(prev.boardSections);
      const nextContent = prev.redoStack[prev.redoStack.length - 1];
      return {
        ...prev,
        boardSections: nextContent.sections,
        undoStack: [...prev.undoStack, currentContent],
        redoStack: prev.redoStack.slice(0, -1)
      };
    });
  }, []);

  const handleRetryLastRequest = useCallback(
    async () => {
      const baseState = stateRef.current;
      if (baseState.isAiTyping || baseState.chatMessages.length === 0) return;

      const assistantMessageId = makeId();
      const request = buildAgentRequest(baseState, baseState.chatMessages);
      const streamStartedAt = nowPerfMs();
      let firstTokenTracked = false;
      let bufferedDelta = "";
      let flushTimer: number | null = null;

      const flushAssistantDelta = () => {
        if (!bufferedDelta) return;
        const chunk = bufferedDelta;
        bufferedDelta = "";
        startTransition(() => {
          setState((prev) => ({
            ...prev,
            chatMessages: appendAssistantDelta(prev.chatMessages, assistantMessageId, chunk)
          }));
        });
      };
      const clearFlushTimer = () => {
        if (flushTimer !== null) {
          window.clearTimeout(flushTimer);
          flushTimer = null;
        }
      };
      const scheduleFlush = () => {
        if (flushTimer !== null) return;
        flushTimer = window.setTimeout(() => {
          flushTimer = null;
          flushAssistantDelta();
        }, STREAM_FLUSH_INTERVAL_MS);
      };

      setState((prev) => ({
        ...prev,
        chatMessages: [
          ...prev.chatMessages,
          {
            id: assistantMessageId,
            role: "assistant",
            content: "",
            timestamp: Date.now()
          }
        ],
        isAiTyping: true,
        errorState: { ...prev.errorState, hasError: false, errorType: null, message: "" }
      }));
      setActiveHint(null);
      setStreamBoardPreview(null);

      try {
        const response = await runAgentStream(request, {
          onAssistantDelta: (delta) => {
            if (!firstTokenTracked && delta) {
              firstTokenTracked = true;
              track("perf_stream_first_token", {
                task_id: baseState.sessionId,
                source: "retry",
                latency_ms: Math.max(0, Math.round(nowPerfMs() - streamStartedAt))
              });
            }
            bufferedDelta += delta;
            scheduleFlush();
          },
          onBoardActionsPreview: (boardActions) => {
            updateStreamBoardPreview(baseState.boardSections, baseState.boardTemplate, boardActions);
          }
        });

        clearFlushTimer();
        flushAssistantDelta();
        finalizeAgentSuccess({
          assistantMessageId,
          response,
          source: "retry_sync",
          baseBoardSections: baseState.boardSections,
          baseBoardTemplate: baseState.boardTemplate,
          taskId: baseState.sessionId,
          conversationTurnCount: baseState.chatMessages.length + 1
        });
      } catch (streamErr) {
        clearFlushTimer();
        flushAssistantDelta();
        setStreamBoardPreview(null);
        try {
          const response = await runAgent(request);
          finalizeAgentSuccess({
            assistantMessageId,
            response,
            source: "retry_sync",
            baseBoardSections: baseState.boardSections,
            baseBoardTemplate: baseState.boardTemplate,
            taskId: baseState.sessionId,
            conversationTurnCount: baseState.chatMessages.length + 1
          });
        } catch (err) {
          const normalized = normalizeAgentError(err);
          setState((prev) => ({
            ...prev,
            chatMessages: prev.chatMessages.filter((msg) => !(msg.id === assistantMessageId && !msg.content.trim())),
            isAiTyping: false,
            errorState: {
              ...prev.errorState,
              hasError: true,
              errorType: normalized.type,
              message: normalized.message,
              retryCount: prev.errorState.retryCount + 1,
              lastErrorTime: Date.now()
            }
          }));
        }

        if (streamErr) {
          // Stream failed and normal request fallback is attempted above.
        }
      }
    },
    [finalizeAgentSuccess, updateStreamBoardPreview]
  );

  const handleDismissError = useCallback(() => {
    setState((prev) => ({
      ...prev,
      errorState: { ...prev.errorState, hasError: false, errorType: null, message: "" }
    }));
  }, []);

  const handleHintDismiss = useCallback(() => {
    if (!activeHint) return;
    dismissedHintsRef.current.add(activeHint.key);
    track("ai_hint_dismissed", {
      task_id: stateRef.current.sessionId,
      hint_key: activeHint.key,
      reason: activeHint.reason
    });
    setActiveHint(null);
  }, [activeHint]);

  const handleHintAccept = useCallback(() => {
    if (!activeHint) return;
    const nextPrompt = activeHint.prompt;
    track("ai_hint_accepted", {
      task_id: stateRef.current.sessionId,
      hint_key: activeHint.key,
      reason: activeHint.reason,
      source: "inline_hint"
    });
    setActiveHint(null);
    void handleSendMessage(nextPrompt);
  }, [activeHint, handleSendMessage]);

  const handleNewSession = useCallback(() => {
    const next = defaultWorkspaceState();
    setState(next);
    schemaTrackedRef.current = false;
    lastEditSnapshotRef.current = { sectionId: "", at: 0 };
    setActiveHint(null);
    setBoardHighlightRequest(null);
    setStreamBoardPreview(null);
    track("task_created", {
      task_id: next.sessionId,
      source: "workspace_new_session"
    });
  }, []);

  const canUndo = state.undoStack.length > 0;
  const canRedo = state.redoStack.length > 0;
  const userTurnCount = state.chatMessages.filter((message) => message.role === "user").length;
  const boardSectionsForRender = streamBoardPreview?.sections ?? state.boardSections;
  const boardTemplateForRender = streamBoardPreview?.template ?? state.boardTemplate;

  const MobileHeader = (
    <div className="flex h-16 items-center justify-end border-b border-subtle bg-[var(--bg-surface)] px-4">
      <div className="flex items-center gap-2">
        <button
          type="button"
          onClick={() => navigate("/")}
          className="flex h-9 items-center gap-1.5 rounded-xl border border-subtle bg-[var(--bg-surface)] px-3 text-[13px] text-secondary transition hover:bg-[var(--bg-muted)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent-brand)]"
        >
          <Home className="h-4 w-4" />
          首页
        </button>
        <button
          type="button"
          onClick={handleNewSession}
          className="flex h-9 items-center gap-1.5 rounded-xl border border-subtle bg-[var(--bg-muted)] px-3 text-[13px] text-primary transition hover:bg-[var(--bg-subtle)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent-brand)]"
        >
          <Plus className="h-4 w-4" />
          新建
        </button>
      </div>
    </div>
  );

  if (isMobile) {
    return (
      <div className="flex h-screen flex-col bg-[var(--bg-base)]">
        {MobileHeader}

        <div className="flex-1 overflow-hidden">
          {activeTab === "chat" ? (
            <div
              className="flex h-full flex-col"
              role="tabpanel"
              id="workspace-mobile-chat-panel"
              aria-labelledby="workspace-mobile-chat-tab"
            >
              {state.errorState.hasError ? (
                <ErrorBanner
                  message={state.errorState.message || "请求失败，请重试。"}
                  onRetry={handleRetryLastRequest}
                  onDismiss={handleDismissError}
                  busy={state.isAiTyping}
                />
              ) : null}
              <div className="flex-1 overflow-hidden">
                <ChatPane
                  messages={state.chatMessages}
                  isAiTyping={state.isAiTyping}
                  hint={activeHint}
                  onHintAccept={handleHintAccept}
                  onHintDismiss={handleHintDismiss}
                  onSendMessage={handleSendMessage}
                  onPinToBoard={handlePinToBoard}
                  onAcceptMarginNote={handleAcceptMarginNote}
                  onUndoMarginNoteAccept={handleUndoMarginNoteAccept}
                />
              </div>
            </div>
          ) : (
            <div
              className="flex h-full flex-col"
              role="tabpanel"
              id="workspace-mobile-board-panel"
              aria-labelledby="workspace-mobile-board-tab"
            >
              <div className="flex-1 overflow-hidden">
                <Suspense fallback={<BoardPaneFallback />}>
                  <BoardPane
                    sections={boardSectionsForRender}
                    onSectionsChange={handleBoardSectionsChange}
                    onUndo={handleUndo}
                    onRedo={handleRedo}
                    canUndo={canUndo}
                    canRedo={canRedo}
                    templateType={boardTemplateForRender}
                    onTemplateTypeChange={handleBoardTemplateChange}
                    readOnly={state.isAiTyping}
                    highlightRequest={boardHighlightRequest}
                  />
                </Suspense>
              </div>
            </div>
          )}
        </div>

        <div
          className="flex h-14 items-center justify-around border-t border-subtle bg-[var(--bg-surface)]"
          role="tablist"
          aria-label="工作台视图切换"
        >
          <button
            id="workspace-mobile-chat-tab"
            type="button"
            onClick={() => setActiveTab("chat")}
            role="tab"
            aria-selected={activeTab === "chat"}
            aria-controls="workspace-mobile-chat-panel"
            className={`flex flex-1 flex-col items-center gap-1 py-2 ${
              activeTab === "chat" ? "text-primary" : "text-muted"
            }`}
          >
            <MessageSquare className="h-5 w-5" />
            <span className="text-[11px]">对话</span>
          </button>
          <button
            id="workspace-mobile-board-tab"
            type="button"
            onClick={() => setActiveTab("board")}
            role="tab"
            aria-selected={activeTab === "board"}
            aria-controls="workspace-mobile-board-panel"
            className={`flex flex-1 flex-col items-center gap-1 ${
              activeTab === "board" ? "text-primary" : "text-muted"
            } py-2`}
          >
            <FileText className="h-5 w-5" />
            <span className="text-[11px]">白板</span>
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="flex h-screen flex-col overflow-hidden bg-[var(--bg-base)] p-2.5 lg:p-4">
      <div className="workspace-shell mx-auto flex h-full w-full max-w-[1440px] flex-col overflow-hidden">
      <div className="flex h-16 items-center justify-end border-b border-subtle bg-[var(--bg-surface)] px-5 lg:px-6">
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={() => navigate("/")}
            className="flex h-9 items-center gap-1.5 rounded-xl border border-subtle bg-[var(--bg-surface)] px-3 py-1.5 text-[13px] text-secondary transition hover:bg-[var(--bg-muted)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent-brand)]"
          >
            <Home className="h-4 w-4" />
            首页
          </button>
          <button
            type="button"
            onClick={handleNewSession}
            className="flex h-9 items-center gap-1.5 rounded-xl border border-subtle bg-[var(--bg-muted)] px-3 py-1.5 text-[13px] text-primary transition hover:bg-[var(--bg-subtle)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent-brand)]"
          >
            <Plus className="h-4 w-4" />
            新建会话
          </button>
        </div>
      </div>

      <div className="flex min-h-0 flex-1 gap-3 p-3 overflow-hidden">
        <div className="workspace-pane flex w-[40%] flex-col overflow-hidden" aria-label="对话面板">
          <div className="workspace-pane-head flex h-11 items-center justify-between px-4">
            <div
              ref={chatPaneHeadingRef}
              tabIndex={-1}
              aria-keyshortcuts="Alt+1"
              className="flex items-center gap-2 text-[12px] font-semibold text-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent-brand)]"
            >
              <MessageSquare className="h-3.5 w-3.5 text-secondary" />
              对话区
            </div>
            <div className="chip px-2 py-0.5 text-[11px]">已交流 {userTurnCount} 轮</div>
          </div>
          {state.errorState.hasError ? (
            <ErrorBanner
              message={state.errorState.message || "请求失败，请重试。"}
              onRetry={handleRetryLastRequest}
              onDismiss={handleDismissError}
              busy={state.isAiTyping}
            />
          ) : null}
          <div className="flex-1 overflow-hidden">
            <ChatPane
              messages={state.chatMessages}
              isAiTyping={state.isAiTyping}
              hint={activeHint}
              onHintAccept={handleHintAccept}
              onHintDismiss={handleHintDismiss}
              onSendMessage={handleSendMessage}
              onPinToBoard={handlePinToBoard}
              onAcceptMarginNote={handleAcceptMarginNote}
              onUndoMarginNoteAccept={handleUndoMarginNoteAccept}
            />
          </div>
        </div>

        <div className="workspace-pane flex w-[60%] flex-col overflow-hidden" aria-label="白板面板">
          <div className="workspace-pane-head flex h-11 items-center justify-between px-4">
            <div
              ref={boardPaneHeadingRef}
              tabIndex={-1}
              aria-keyshortcuts="Alt+2"
              className="flex items-center gap-2 text-[12px] font-semibold text-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent-brand)]"
            >
              <FileText className="h-3.5 w-3.5 text-secondary" />
              白板文档
            </div>
            <div className="flex items-center gap-1 text-[11px] text-secondary">
              <Sparkles className="h-3 w-3" />
              AI 自动写入 + 手动精修
            </div>
          </div>
          <div className="flex-1 overflow-hidden">
            <Suspense fallback={<BoardPaneFallback />}>
              <BoardPane
                sections={boardSectionsForRender}
                onSectionsChange={handleBoardSectionsChange}
                onUndo={handleUndo}
                onRedo={handleRedo}
                canUndo={canUndo}
                canRedo={canRedo}
                templateType={boardTemplateForRender}
                onTemplateTypeChange={handleBoardTemplateChange}
                readOnly={state.isAiTyping}
                highlightRequest={boardHighlightRequest}
              />
            </Suspense>
          </div>
        </div>
      </div>
      </div>
    </div>
  );
}


