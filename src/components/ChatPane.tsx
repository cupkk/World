import { memo, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Send, Pin, Loader2, Sparkles, X, Mic, MicOff } from "lucide-react";
import type { ChatMessage, TextSelection } from "../types/workspace";

type InlineHint = {
  key: string;
  reason: "kickoff" | "short_answer" | "missing_context";
  text: string;
  actionLabel: string;
  prompt: string;
};

type AssistantOption = {
  key: string;
  label: string;
  content: string;
};

type SpeechRecognitionAlternativeLike = {
  transcript: string;
};

type SpeechRecognitionResultLike = {
  isFinal?: boolean;
  0?: SpeechRecognitionAlternativeLike;
};

type SpeechRecognitionEventLike = {
  results: ArrayLike<SpeechRecognitionResultLike>;
};

type SpeechRecognitionLike = {
  lang: string;
  continuous: boolean;
  interimResults: boolean;
  onresult: ((event: SpeechRecognitionEventLike) => void) | null;
  onerror: (() => void) | null;
  onend: (() => void) | null;
  start: () => void;
  stop: () => void;
  abort: () => void;
};

type SpeechRecognitionCtor = new () => SpeechRecognitionLike;

interface ChatPaneProps {
  messages: ChatMessage[];
  isAiTyping: boolean;
  hint?: InlineHint | null;
  onHintAccept?: () => void;
  onHintDismiss?: () => void;
  onSendMessage: (content: string) => void;
  onPinToBoard: (messageId: string, selection?: TextSelection) => void;
  onAcceptMarginNote?: (messageId: string, noteIndex: number) => void;
  onUndoMarginNoteAccept?: (messageId: string, noteIndex: number) => void;
}

const TYPING_SCROLL_INTERVAL_MS = 180;
const OPTION_LINE_PATTERN = /^\s*(?:[-*]\s*)?([A-Da-d]|[1-4])[\.、:：)\-]\s*(.+)$/;
const OPTION_PREFIX_PATTERN = /^\s*(?:[-*]\s*)?(?:[A-Da-d]|[1-4])[\.、:：)\-]\s*/;

function getSpeechRecognitionCtor() {
  const speechWindow = window as Window & {
    SpeechRecognition?: SpeechRecognitionCtor;
    webkitSpeechRecognition?: SpeechRecognitionCtor;
  };
  return speechWindow.SpeechRecognition ?? speechWindow.webkitSpeechRecognition ?? null;
}

function stripOptionPrefix(value: string) {
  return value.replace(OPTION_PREFIX_PATTERN, "").trim();
}

function buildQuickOptionsFromStructured(message: ChatMessage): AssistantOption[] {
  const questions = message.nextQuestions ?? [];
  if (!questions.length) return [];

  const options: AssistantOption[] = [];
  const seen = new Set<string>();

  questions.forEach((questionItem, questionIndex) => {
    const question = questionItem.question?.trim();
    const candidates = (questionItem.options ?? []).map((value) => value.trim()).filter(Boolean);

    if (candidates.length > 0) {
      candidates.forEach((optionText, optionIndex) => {
        const normalized = stripOptionPrefix(optionText);
        if (!normalized) return;
        const key = normalized.toLowerCase();
        if (seen.has(key)) return;
        seen.add(key);
        const optionLabel = String.fromCharCode(65 + optionIndex);
        options.push({
          key: `structured-${questionIndex}-${optionIndex}`,
          label: `${optionLabel}. ${normalized}`,
          content: normalized
        });
      });
      return;
    }

    if (!question) return;
    const key = question.toLowerCase();
    if (seen.has(key)) return;
    seen.add(key);
    options.push({
      key: `structured-${questionIndex}`,
      label: question,
      content: question
    });
  });

  return options.slice(0, 6);
}

function buildQuickOptions(messages: ChatMessage[]): AssistantOption[] {
  const latestAssistant = [...messages]
    .reverse()
    .find((message) => message.role === "assistant" && (message.content.trim() || (message.nextQuestions?.length ?? 0) > 0));
  if (!latestAssistant) return [];

  const structuredOptions = buildQuickOptionsFromStructured(latestAssistant);
  if (structuredOptions.length > 0) return structuredOptions;

  const seen = new Set<string>();
  const options: AssistantOption[] = [];
  for (const line of latestAssistant.content.split(/\n+/)) {
    const match = line.match(OPTION_LINE_PATTERN);
    if (!match) continue;
    const optionText = match[2]?.trim();
    if (!optionText) continue;

    const key = optionText.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);

    options.push({
      key: `${match[1]}-${options.length}`,
      label: `${String(match[1]).toUpperCase()}. ${optionText}`,
      content: optionText
    });

    if (options.length >= 4) break;
  }

  return options;
}

function appendTranscript(prev: string, transcript: string) {
  const next = transcript.trim();
  if (!next) return prev;
  if (!prev.trim()) return next;
  return `${prev}\n${next}`;
}

const MessageBubble = memo(function MessageBubble({
  message,
  onPinToBoard,
  onAcceptMarginNote,
  onUndoMarginNoteAccept
}: {
  message: ChatMessage;
  onPinToBoard: (messageId: string, selection?: TextSelection) => void;
  onAcceptMarginNote: (messageId: string, noteIndex: number) => void;
  onUndoMarginNoteAccept: (messageId: string, noteIndex: number) => void;
}) {
  const isUser = message.role === "user";
  const [showPinButton, setShowPinButton] = useState(false);
  const rubricDimensions = message.rubric?.dimensions
    ? Object.entries(message.rubric.dimensions).slice(0, 4)
    : [];
  const marginNotes = message.marginNotes?.filter((note) => note.comment.trim()).slice(0, 3) ?? [];

  const handlePin = useCallback(() => {
    const selection = window.getSelection();
    if (selection && selection.toString().trim()) {
      const range = selection.getRangeAt(0);
      onPinToBoard(message.id, {
        start: range.startOffset,
        end: range.endOffset,
        text: selection.toString()
      });
    } else {
      onPinToBoard(message.id);
    }
  }, [message.id, onPinToBoard]);

  return (
    <div
      role="listitem"
      className={`group flex ${isUser ? "justify-end" : "justify-start"}`}
      onMouseEnter={() => setShowPinButton(true)}
      onMouseLeave={() => setShowPinButton(false)}
    >
      <div
        className={`relative max-w-[90%] rounded-2xl px-4 py-3 ${
          isUser
            ? "bg-[#202123] text-white"
            : "border border-subtle bg-[var(--bg-surface)] text-primary"
        }`}
      >
        <div className="whitespace-pre-wrap text-[14px] leading-relaxed text-inherit">{message.content}</div>

        {!isUser && (message.rubric || marginNotes.length > 0) ? (
          <div className="mt-3 space-y-2 rounded-xl border border-subtle bg-[var(--bg-muted)] p-2.5">
            {message.rubric ? (
              <div aria-label="质量评分摘要" role="group">
                <div className="text-[11px] font-semibold text-secondary">
                  质量评分
                  {typeof message.rubric.total === "number" ? ` · ${message.rubric.total}` : ""}
                </div>
                {rubricDimensions.length > 0 ? (
                  <div className="mt-1.5 grid grid-cols-2 gap-1.5">
                    {rubricDimensions.map(([name, value]) => (
                      <div key={name} className="rounded-lg border border-subtle bg-[var(--bg-surface)] px-2 py-1.5">
                        <div className="text-[10px] font-medium text-secondary">{name}</div>
                        <div className="mt-0.5 text-[11px] font-semibold text-primary">
                          {typeof value.score === "number" ? `${value.score}` : "—"}
                        </div>
                      </div>
                    ))}
                  </div>
                ) : null}
              </div>
            ) : null}

            {marginNotes.length > 0 ? (
              <div aria-label="批注建议" role="group">
                <div className="text-[11px] font-semibold text-secondary">批注建议</div>
                <div className="mt-1.5 space-y-1.5" role="list">
                  {marginNotes.map((note, index) => (
                    <div
                      key={`${note.comment}-${index}`}
                      role="listitem"
                      className="rounded-lg border border-subtle bg-[var(--bg-surface)] px-2 py-1.5"
                    >
                      <div className="text-[11px] leading-relaxed text-primary">{note.comment}</div>
                      {note.suggestion ? (
                        <div className="mt-0.5 text-[10px] leading-relaxed text-secondary">建议：{note.suggestion}</div>
                      ) : null}
                      <div className="mt-2 flex items-center gap-1.5">
                        {note.accepted ? (
                          <button
                            type="button"
                            data-testid={`margin-note-undo-${message.id}-${index}`}
                            onClick={() => onUndoMarginNoteAccept(message.id, index)}
                            className="flex h-7 items-center rounded-full border border-subtle bg-[var(--bg-surface)] px-2.5 text-[10px] font-medium text-secondary transition hover:bg-[var(--bg-muted)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent-brand)]"
                            aria-label={`撤销采纳批注 ${index + 1}`}
                          >
                            撤销采纳
                          </button>
                        ) : (
                          <button
                            type="button"
                            data-testid={`margin-note-accept-${message.id}-${index}`}
                            onClick={() => onAcceptMarginNote(message.id, index)}
                            disabled={!note.suggestion}
                            className="flex h-7 items-center rounded-full border border-subtle bg-[var(--bg-surface)] px-2.5 text-[10px] font-medium text-secondary transition hover:bg-[var(--bg-muted)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent-brand)] disabled:cursor-not-allowed disabled:opacity-50"
                            aria-label={`采纳批注 ${index + 1}`}
                          >
                            采纳建议
                          </button>
                        )}
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            ) : null}
          </div>
        ) : null}

        {!isUser && (
          <button
            type="button"
            data-testid={`pin-${message.id}`}
            onClick={handlePin}
            className={`absolute -right-2 -top-2 flex h-8 w-8 items-center justify-center rounded-full border border-subtle bg-[var(--bg-surface)] transition hover:bg-[var(--bg-muted)] focus-visible:opacity-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent-brand)] ${
              showPinButton ? "opacity-100" : "opacity-100 md:opacity-0 md:group-hover:opacity-100"
            }`}
            title="添加到白板"
            aria-label="添加到白板"
          >
            <Pin className="h-3.5 w-3.5 text-secondary" />
          </button>
        )}
      </div>
    </div>
  );
});

const ChatPane = memo(function ChatPane({
  messages,
  isAiTyping,
  hint,
  onHintAccept = () => {},
  onHintDismiss = () => {},
  onSendMessage,
  onPinToBoard,
  onAcceptMarginNote = () => {},
  onUndoMarginNoteAccept = () => {}
}: ChatPaneProps) {
  const [inputValue, setInputValue] = useState("");
  const [isComposing, setIsComposing] = useState(false);
  const [speechSupported, setSpeechSupported] = useState(false);
  const [isListening, setIsListening] = useState(false);
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const recognitionRef = useRef<SpeechRecognitionLike | null>(null);
  const quickOptions = useMemo(() => buildQuickOptions(messages), [messages]);

  useEffect(() => {
    setSpeechSupported(Boolean(getSpeechRecognitionCtor()));
  }, []);

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: isAiTyping ? "auto" : "smooth" });
  }, [messages.length, isAiTyping]);

  useEffect(() => {
    if (!isAiTyping) return;
    const timer = window.setInterval(() => {
      messagesEndRef.current?.scrollIntoView({ behavior: "auto" });
    }, TYPING_SCROLL_INTERVAL_MS);

    return () => window.clearInterval(timer);
  }, [isAiTyping]);

  useEffect(() => {
    if (!inputRef.current) return;
    inputRef.current.style.height = "auto";
    inputRef.current.style.height = `${Math.min(inputRef.current.scrollHeight, 120)}px`;
  }, [inputValue]);

  useEffect(() => {
    const node = inputRef.current;
    if (!node) return;
    const raf = window.requestAnimationFrame(() => {
      if (document.activeElement === document.body) {
        node.focus();
      }
    });
    return () => window.cancelAnimationFrame(raf);
  }, []);

  useEffect(() => {
    return () => {
      try {
        recognitionRef.current?.abort();
      } catch {
        // ignore recognition cleanup error
      }
    };
  }, []);

  const stopVoiceInput = useCallback(() => {
    try {
      recognitionRef.current?.stop();
    } catch {
      // ignore
    }
  }, []);

  const startVoiceInput = useCallback(() => {
    const Recognition = getSpeechRecognitionCtor();
    if (!Recognition || isListening || isAiTyping) return;

    try {
      const recognition = new Recognition();
      recognitionRef.current = recognition;
      recognition.lang = "zh-CN";
      recognition.continuous = false;
      recognition.interimResults = true;

      recognition.onresult = (event) => {
        let transcript = "";
        for (let i = 0; i < event.results.length; i += 1) {
          const alternative = event.results[i]?.[0];
          if (alternative?.transcript) {
            transcript = alternative.transcript;
          }
        }

        if (!transcript.trim()) return;
        setInputValue((prev) => appendTranscript(prev, transcript));
      };

      recognition.onerror = () => {
        setIsListening(false);
      };

      recognition.onend = () => {
        setIsListening(false);
      };

      recognition.start();
      setIsListening(true);
    } catch {
      setIsListening(false);
    }
  }, [isAiTyping, isListening]);

  const handleSubmit = useCallback(() => {
    const trimmed = inputValue.trim();
    if (!trimmed || isAiTyping) return;
    if (isListening) {
      stopVoiceInput();
    }
    onSendMessage(trimmed);
    setInputValue("");
    window.requestAnimationFrame(() => inputRef.current?.focus());
  }, [inputValue, isAiTyping, isListening, onSendMessage, stopVoiceInput]);

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      if (isComposing || e.nativeEvent.isComposing) return;
      if (e.key === "Enter" && !e.shiftKey) {
        e.preventDefault();
        handleSubmit();
      }
    },
    [handleSubmit, isComposing]
  );

  const handleOptionSelect = useCallback(
    (option: AssistantOption) => {
      if (isAiTyping) return;
      onSendMessage(option.content);
      setInputValue("");
    },
    [isAiTyping, onSendMessage]
  );

  return (
    <div className="flex h-full flex-col bg-transparent">
      <div
        className="flex-1 overflow-y-auto px-4 py-5 sm:px-5"
        role="log"
        aria-live="polite"
        aria-relevant="additions text"
        aria-busy={isAiTyping}
        aria-label="对话消息列表"
      >
        {messages.length === 0 ? (
          <div className="flex h-full flex-col items-center justify-center text-center">
            <div className="flex h-12 w-12 items-center justify-center rounded-2xl border border-subtle bg-[var(--bg-surface)]">
              <Sparkles className="h-5 w-5 text-secondary" />
            </div>
            <div className="mt-4 text-[22px] font-semibold text-primary">从你的目标开始，我们一起把它写清楚。</div>
            <div className="mt-3 max-w-[420px] text-[13px] leading-relaxed text-secondary">
              你可以直接描述场景、目标和约束条件。左侧对话会推进思路，右侧白板会同步形成可交付文档。
            </div>
            <div className="mt-4 flex flex-wrap justify-center gap-2">
              <div className="chip px-3 py-1 text-[11px]">例如：帮我写一份课程大纲</div>
              <div className="chip px-3 py-1 text-[11px]">例如：整理这次会议纪要</div>
            </div>
          </div>
        ) : (
          <div className="space-y-4" role="list" aria-label="对话记录">
            {messages.map((message) => (
              <MessageBubble
                key={message.id}
                message={message}
                onPinToBoard={onPinToBoard}
                onAcceptMarginNote={onAcceptMarginNote}
                onUndoMarginNoteAccept={onUndoMarginNoteAccept}
              />
            ))}

            {isAiTyping && (
              <div className="flex justify-start">
                <div
                  className="flex items-center gap-2 rounded-2xl border border-subtle bg-[var(--bg-surface)] px-4 py-3"
                  role="status"
                  aria-live="polite"
                >
                  <Loader2 className="h-4 w-4 animate-spin text-secondary" />
                  <span className="text-[14px] text-secondary">正在思考...</span>
                </div>
              </div>
            )}

            <div ref={messagesEndRef} />
          </div>
        )}
      </div>

      <div className="border-t border-subtle bg-[rgba(255,255,255,0.92)] p-3.5">
        {hint ? (
          <div
            className="mb-2 rounded-2xl border border-subtle bg-[var(--bg-muted)] px-3 py-2.5"
            role="status"
            aria-live="polite"
          >
            <div className="flex items-start justify-between gap-2">
              <div className="flex items-start gap-2">
                <Sparkles className="mt-0.5 h-3.5 w-3.5 text-secondary" />
                <div className="text-[12px] leading-relaxed text-secondary">{hint.text}</div>
              </div>

              <button
                type="button"
                data-testid="hint-dismiss-button"
                onClick={onHintDismiss}
                className="flex h-6 w-6 items-center justify-center rounded-md text-muted transition hover:bg-[var(--bg-subtle)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent-brand)]"
                aria-label="关闭提示"
              >
                <X className="h-3.5 w-3.5" />
              </button>
            </div>

            <button
              type="button"
              onClick={onHintAccept}
              disabled={isAiTyping}
              className="mt-2 flex h-7 items-center gap-1 rounded-full border border-subtle bg-[var(--bg-surface)] px-3 text-[11px] text-secondary transition hover:bg-[var(--bg-subtle)] disabled:cursor-not-allowed disabled:opacity-50"
            >
              <Sparkles className="h-3.5 w-3.5" />
              {hint.actionLabel}
            </button>
          </div>
        ) : null}

        {quickOptions.length > 0 ? (
          <div className="mb-2 flex flex-wrap gap-2" role="group" aria-label="快速选项">
            {quickOptions.map((option) => (
              <button
                key={option.key}
                type="button"
                onClick={() => handleOptionSelect(option)}
                disabled={isAiTyping}
                className="chip px-3 py-1.5 text-[12px] transition hover:bg-[var(--bg-muted)] disabled:cursor-not-allowed disabled:opacity-50"
              >
                {option.label}
              </button>
            ))}
          </div>
        ) : null}

        <div className="rounded-[30px] border border-[var(--border-strong)] bg-[linear-gradient(180deg,#ffffff_0%,#f7f8fa_100%)] px-2.5 py-2 shadow-soft transition focus-within:border-[var(--accent-brand)] focus-within:shadow-[0_0_0_4px_rgba(16,163,127,0.1)]">
          <div className="flex items-end gap-1.5">
            <div className="min-w-0 flex-1 px-2.5 py-1">
              <textarea
                ref={inputRef}
                value={inputValue}
                onChange={(e) => setInputValue(e.target.value)}
                onKeyDown={handleKeyDown}
                onCompositionStart={() => setIsComposing(true)}
                onCompositionEnd={() => setIsComposing(false)}
                aria-label="输入消息"
                aria-keyshortcuts="Enter"
                placeholder="给 AI 发送消息..."
                rows={1}
                className="w-full resize-none bg-transparent text-[15px] leading-[1.5] text-primary outline-none placeholder:text-muted"
                style={{ minHeight: "28px", maxHeight: "132px" }}
              />
            </div>

            <div className="flex items-center gap-2">
              <button
                type="button"
                onClick={isListening ? stopVoiceInput : startVoiceInput}
                disabled={!speechSupported || isAiTyping}
                aria-label={isListening ? "停止语音输入" : "语音输入"}
                aria-pressed={isListening}
                className={`flex h-10 w-10 items-center justify-center rounded-full border border-subtle text-secondary transition disabled:cursor-not-allowed disabled:opacity-40 ${
                  isListening
                    ? "bg-[var(--accent-strong)] text-white"
                    : "bg-[var(--bg-surface)] hover:bg-[var(--bg-muted)]"
                }`}
              >
                {isListening ? <MicOff className="h-[18px] w-[18px]" /> : <Mic className="h-[18px] w-[18px]" />}
              </button>

              <button
                type="button"
                onClick={handleSubmit}
                disabled={!inputValue.trim() || isAiTyping}
                aria-label="发送消息"
                aria-keyshortcuts="Enter"
                className="flex h-10 w-10 items-center justify-center rounded-full bg-[var(--accent-strong)] text-white transition hover:bg-[var(--accent-strong-hover)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent-brand)] disabled:cursor-not-allowed disabled:bg-[var(--bg-subtle)] disabled:text-muted"
              >
                <Send className="h-[18px] w-[18px]" />
              </button>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
});

export default ChatPane;
