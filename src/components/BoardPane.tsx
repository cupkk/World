import { memo, useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { EditorContent, useEditor } from "@tiptap/react";
import StarterKit from "@tiptap/starter-kit";
import Placeholder from "@tiptap/extension-placeholder";
import { Copy, Download, Undo2, Redo2, Check, Heading1, Heading2 } from "lucide-react";
import type { BoardHighlightRequest, BoardSection } from "../types/workspace";
import { sanitizeHtml } from "../utils/sanitizeHtml";

interface BoardPaneProps {
  sections: BoardSection[];
  onSectionsChange: (sections: BoardSection[]) => void;
  onUndo: () => void;
  onRedo: () => void;
  canUndo: boolean;
  canRedo: boolean;
  highlightRequest?: BoardHighlightRequest | null;
}

const HTML_TAG_PATTERN = /<([a-z][\w-]*)(\s[^>]*)?>/i;
const HEADING_TAG_PATTERN = /^H[1-3]$/i;
const MIN_EDITOR_HTML = "<p></p>";
const EDITOR_CHANGE_DEBOUNCE_MS = 150;
const HIGHLIGHT_COLLAPSE_DELAY_MS = 1800;

function makeSectionId() {
  if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") {
    return crypto.randomUUID();
  }
  return `${Date.now().toString(16)}-${Math.random().toString(16).slice(2)}`;
}

function escapeHtml(value: string) {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/\"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function normalizeContent(value: string) {
  const trimmed = value.trim();
  if (!trimmed) return "";
  if (HTML_TAG_PATTERN.test(trimmed)) return sanitizeHtml(value);
  const escaped = escapeHtml(value).replace(/\n/g, "<br />");
  return `<p>${escaped}</p>`;
}

function htmlToPlainText(value: string) {
  const trimmed = value.trim();
  if (!trimmed) return "";
  if (typeof window === "undefined" || !HTML_TAG_PATTERN.test(trimmed)) return value;
  const container = document.createElement("div");
  container.innerHTML = value;
  const text = container.textContent ?? container.innerText ?? "";
  return text.replace(/\n{3,}/g, "\n\n").trim();
}

function formatTime(ts: number) {
  if (!Number.isFinite(ts) || ts <= 0) return "--";
  return new Date(ts).toLocaleTimeString("zh-CN", { hour: "2-digit", minute: "2-digit" });
}

function normalizeTitle(raw: string, index: number) {
  const title = raw.trim();
  if (title) return title;
  return index === 0 ? "未命名标题" : `小节 ${index}`;
}

function dedupeSections(sections: BoardSection[]) {
  const seen = new Set<string>();
  return sections.filter((section) => {
    const key = `${section.title.trim().toLowerCase()}::${htmlToPlainText(section.content).trim()}`;
    if (!key.replace("::", "").trim()) return false;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function buildDocumentHtml(sections: BoardSection[]) {
  if (!sections.length) return MIN_EDITOR_HTML;

  return sections
    .map((section, index) => {
      const tag = index === 0 ? "h1" : "h2";
      const title = escapeHtml(normalizeTitle(section.title, index));
      const content = normalizeContent(section.content) || MIN_EDITOR_HTML;
      return `<${tag}>${title}</${tag}>${content}`;
    })
    .join("");
}

function areSectionsEqual(left: BoardSection[], right: BoardSection[]) {
  if (left.length !== right.length) return false;
  for (let i = 0; i < left.length; i += 1) {
    const l = left[i];
    const r = right[i];
    if (!l || !r) return false;
    if (l.id !== r.id) return false;
    if (l.title !== r.title) return false;
    if (l.content !== r.content) return false;
  }
  return true;
}

function parseSectionsFromDocument(documentHtml: string, previousSections: BoardSection[]): BoardSection[] {
  const container = document.createElement("div");
  container.innerHTML = sanitizeHtml(documentHtml);

  const now = Date.now();
  const usedIds = new Set<string>();
  const nextSections: BoardSection[] = [];
  let currentTitle = "";
  let currentBody: string[] = [];

  const takeSectionId = (title: string, index: number) => {
    const byTitle = previousSections.find((section) => !usedIds.has(section.id) && section.title.trim() === title.trim());
    if (byTitle) return byTitle.id;
    const byIndex = previousSections[index];
    if (byIndex && !usedIds.has(byIndex.id)) return byIndex.id;
    return makeSectionId();
  };

  const flush = () => {
    const rawContent = currentBody.join("").trim();
    if (!currentTitle && !rawContent) return;

    const title = normalizeTitle(currentTitle, nextSections.length);
    const id = takeSectionId(title, nextSections.length);
    usedIds.add(id);

    nextSections.push({
      id,
      title,
      content: rawContent || MIN_EDITOR_HTML,
      source: "user",
      lastUpdated: now
    });

    currentTitle = "";
    currentBody = [];
  };

  for (const node of Array.from(container.childNodes)) {
    if (node.nodeType === Node.ELEMENT_NODE) {
      const element = node as HTMLElement;
      if (HEADING_TAG_PATTERN.test(element.tagName)) {
        flush();
        currentTitle = element.textContent?.trim() ?? "";
        continue;
      }
      currentBody.push(element.outerHTML);
      continue;
    }

    if (node.nodeType === Node.TEXT_NODE) {
      const text = (node.textContent ?? "").trim();
      if (text) {
        currentBody.push(`<p>${escapeHtml(text)}</p>`);
      }
    }
  }

  flush();
  return dedupeSections(nextSections);
}

function findSectionRangeById(
  doc: { descendants: (cb: (node: { type: { name: string } }, pos: number) => void) => void; content: { size: number } },
  sections: BoardSection[],
  sectionId: string
): { from: number; to: number } | null {
  const sectionIndex = sections.findIndex((section) => section.id === sectionId);
  if (sectionIndex < 0) return null;

  const headingPositions: number[] = [];
  doc.descendants((node, pos) => {
    if (node.type.name === "heading") {
      headingPositions.push(pos);
    }
  });

  if (!headingPositions.length) return null;
  const index = Math.min(sectionIndex, headingPositions.length - 1);
  const from = headingPositions[index] + 1;
  const to = index + 1 < headingPositions.length ? headingPositions[index + 1] - 1 : doc.content.size;
  return { from: Math.max(1, from), to: Math.max(from, to) };
}

function findTextRangeInSection(
  doc: {
    nodesBetween: (
      from: number,
      to: number,
      cb: (node: { isText?: boolean; text?: string }, pos: number) => void
    ) => void;
  },
  from: number,
  to: number,
  anchorText?: string
): { from: number; to: number } | null {
  const normalized = anchorText?.trim();
  if (!normalized) return null;

  const candidates = [
    normalized,
    ...normalized
      .split(/[\s,，。；;:：()\[\]【】]+/)
      .map((token) => token.trim())
      .filter((token) => token.length >= 2)
      .sort((a, b) => b.length - a.length)
  ];

  for (const candidate of candidates) {
    const loweredCandidate = candidate.toLowerCase();
    let match: { from: number; to: number } | null = null;
    doc.nodesBetween(from, to, (node, pos) => {
      if (match || !node.isText || !node.text) return;
      const index = node.text.toLowerCase().indexOf(loweredCandidate);
      if (index < 0) return;
      match = {
        from: pos + index,
        to: pos + index + candidate.length
      };
    });
    if (match) return match;
  }

  return null;
}

function ToolbarButton({
  active,
  onClick,
  disabled,
  label,
  ariaLabel,
  icon
}: {
  active: boolean;
  onClick: () => void;
  disabled?: boolean;
  label: string;
  ariaLabel?: string;
  icon?: ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      aria-label={ariaLabel ?? label}
      className={`flex h-8 items-center justify-center gap-1 rounded-lg border px-2 text-[11px] font-semibold transition disabled:cursor-not-allowed disabled:opacity-40 ${
        active
          ? "border-[var(--accent-strong)] bg-[var(--accent-strong)] text-white"
          : "border-subtle bg-[var(--bg-surface)] text-secondary hover:bg-[var(--bg-muted)]"
      }`}
    >
      {icon}
      <span>{label}</span>
    </button>
  );
}

const BoardPane = memo(function BoardPane({
  sections,
  onSectionsChange,
  onUndo,
  onRedo,
  canUndo,
  canRedo,
  highlightRequest = null
}: BoardPaneProps) {
  const [copySuccess, setCopySuccess] = useState(false);
  const sectionsRef = useRef(sections);
  const onSectionsChangeRef = useRef(onSectionsChange);
  const pendingHtmlRef = useRef<string | null>(null);
  const flushTimerRef = useRef<number | null>(null);
  const highlightTimerRef = useRef<number | null>(null);

  const latestUpdatedAt = useMemo(
    () => sections.reduce((max, section) => Math.max(max, section.lastUpdated || 0), 0),
    [sections]
  );

  const totalChars = useMemo(() => {
    const content = sections
      .map((section) => htmlToPlainText(section.content))
      .join("\n")
      .replace(/\s+/g, "");
    return content.length;
  }, [sections]);

  const documentHtml = useMemo(() => buildDocumentHtml(sections), [sections]);
  const documentHtmlRef = useRef(documentHtml);

  useEffect(() => {
    sectionsRef.current = sections;
  }, [sections]);

  useEffect(() => {
    onSectionsChangeRef.current = onSectionsChange;
  }, [onSectionsChange]);

  const clearFlushTimer = useCallback(() => {
    if (flushTimerRef.current !== null) {
      window.clearTimeout(flushTimerRef.current);
      flushTimerRef.current = null;
    }
  }, []);

  const flushPendingEditorUpdate = useCallback(() => {
    const pendingHtml = pendingHtmlRef.current;
    if (pendingHtml === null) return;
    pendingHtmlRef.current = null;

    if (pendingHtml === documentHtmlRef.current) return;

    const parsed = parseSectionsFromDocument(pendingHtml, sectionsRef.current);
    if (areSectionsEqual(parsed, sectionsRef.current)) return;

    sectionsRef.current = parsed;
    onSectionsChangeRef.current(parsed);
  }, []);

  const scheduleEditorFlush = useCallback(() => {
    clearFlushTimer();
    flushTimerRef.current = window.setTimeout(() => {
      flushTimerRef.current = null;
      flushPendingEditorUpdate();
    }, EDITOR_CHANGE_DEBOUNCE_MS);
  }, [clearFlushTimer, flushPendingEditorUpdate]);

  useEffect(() => {
    return () => {
      clearFlushTimer();
      if (highlightTimerRef.current !== null) {
        window.clearTimeout(highlightTimerRef.current);
        highlightTimerRef.current = null;
      }
    };
  }, [clearFlushTimer]);

  const editor = useEditor({
    extensions: [
      StarterKit.configure({
        heading: { levels: [1, 2, 3] }
      }),
      Placeholder.configure({
        placeholder: "从空白页开始：先写标题，再逐步补充小标题和正文..."
      })
    ],
    content: documentHtml,
    editorProps: {
      attributes: {
        class: "tiptap-editor tiptap-a4-editor"
      }
    },
    onUpdate: ({ editor: nextEditor }) => {
      const safeHtml = sanitizeHtml(nextEditor.getHTML());
      if (safeHtml === documentHtmlRef.current) {
        pendingHtmlRef.current = null;
        clearFlushTimer();
        return;
      }

      pendingHtmlRef.current = safeHtml;
      scheduleEditorFlush();
    },
    onBlur: () => {
      clearFlushTimer();
      flushPendingEditorUpdate();
    }
  });

  useEffect(() => {
    if (!editor) return;
    const nextHtml = documentHtml || MIN_EDITOR_HTML;
    documentHtmlRef.current = nextHtml;
    pendingHtmlRef.current = null;
    clearFlushTimer();
    if (editor.getHTML() !== nextHtml) {
      editor.commands.setContent(nextHtml, false);
    }
  }, [clearFlushTimer, documentHtml, editor]);

  useEffect(() => {
    if (!editor || !highlightRequest) return;

    const sectionRange = findSectionRangeById(editor.state.doc, sections, highlightRequest.sectionId);
    if (!sectionRange) return;

    const matched = findTextRangeInSection(
      editor.state.doc,
      sectionRange.from,
      sectionRange.to,
      highlightRequest.anchorText
    );

    const from = matched?.from ?? sectionRange.from;
    const to = matched?.to ?? Math.min(sectionRange.to, from + 12);

    editor.chain().focus().setTextSelection({ from, to }).scrollIntoView().run();

    if (highlightTimerRef.current !== null) {
      window.clearTimeout(highlightTimerRef.current);
    }
    highlightTimerRef.current = window.setTimeout(() => {
      if (!editor.isDestroyed) {
        editor.chain().focus().setTextSelection(to).run();
      }
      highlightTimerRef.current = null;
    }, HIGHLIGHT_COLLAPSE_DELAY_MS);
  }, [editor, highlightRequest, sections]);

  const getAllContent = useCallback(() => {
    return sections
      .map((section, index) => `${index === 0 ? "#" : "##"} ${section.title}\n\n${htmlToPlainText(section.content)}`)
      .join("\n\n");
  }, [sections]);

  const handleCopy = useCallback(async () => {
    const content = getAllContent();
    if (!content.trim()) return;

    try {
      await navigator.clipboard.writeText(content);
      setCopySuccess(true);
      setTimeout(() => setCopySuccess(false), 1500);
    } catch {
      const textarea = document.createElement("textarea");
      textarea.value = content;
      document.body.appendChild(textarea);
      textarea.select();
      document.execCommand("copy");
      document.body.removeChild(textarea);
      setCopySuccess(true);
      setTimeout(() => setCopySuccess(false), 1500);
    }
  }, [getAllContent]);

  const handleDownload = useCallback(() => {
    const content = getAllContent();
    if (!content.trim()) return;

    const blob = new Blob([content], { type: "text/markdown" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `思考文档-${new Date().toISOString().slice(0, 10)}.md`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  }, [getAllContent]);

  const toolbarDisabled = !editor;

  return (
    <div className="flex h-full flex-col bg-transparent">
      <div className="flex min-h-12 flex-wrap items-center justify-between gap-2 border-b border-subtle bg-[var(--bg-surface)] px-4 py-2.5">
        <div className="flex items-center gap-3 text-[13px] font-medium text-secondary">
          <span>白板文档</span>
          <span className="text-[12px] text-muted">段落 {sections.length}</span>
          <span className="text-[12px] text-muted">字数 {totalChars}</span>
          <span className="text-[12px] text-muted">更新于 {formatTime(latestUpdatedAt)}</span>
        </div>

        <div className="flex flex-wrap items-center gap-1">
          <ToolbarButton
            label="H1"
            ariaLabel="一级标题"
            icon={<Heading1 className="h-3.5 w-3.5" />}
            active={editor?.isActive("heading", { level: 1 }) ?? false}
            onClick={() => editor?.chain().focus().toggleHeading({ level: 1 }).run()}
            disabled={toolbarDisabled}
          />
          <ToolbarButton
            label="H2"
            ariaLabel="二级标题"
            icon={<Heading2 className="h-3.5 w-3.5" />}
            active={editor?.isActive("heading", { level: 2 }) ?? false}
            onClick={() => editor?.chain().focus().toggleHeading({ level: 2 }).run()}
            disabled={toolbarDisabled}
          />
          <ToolbarButton
            label="B"
            ariaLabel="加粗"
            active={editor?.isActive("bold") ?? false}
            onClick={() => editor?.chain().focus().toggleBold().run()}
            disabled={toolbarDisabled}
          />
          <ToolbarButton
            label="I"
            ariaLabel="斜体"
            active={editor?.isActive("italic") ?? false}
            onClick={() => editor?.chain().focus().toggleItalic().run()}
            disabled={toolbarDisabled}
          />
          <ToolbarButton
            label="列表"
            ariaLabel="无序列表"
            active={editor?.isActive("bulletList") ?? false}
            onClick={() => editor?.chain().focus().toggleBulletList().run()}
            disabled={toolbarDisabled}
          />
          <ToolbarButton
            label="编号"
            ariaLabel="有序列表"
            active={editor?.isActive("orderedList") ?? false}
            onClick={() => editor?.chain().focus().toggleOrderedList().run()}
            disabled={toolbarDisabled}
          />

          <div className="mx-2 h-4 w-px bg-[var(--border-subtle)]" />

          <button
            type="button"
            onClick={onUndo}
            disabled={!canUndo}
            aria-label="撤销"
            className="flex h-8 w-8 items-center justify-center rounded-lg border border-transparent transition hover:border-subtle hover:bg-[var(--bg-muted)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent-brand)] disabled:cursor-not-allowed disabled:opacity-40"
            title="撤销"
          >
            <Undo2 className="h-4 w-4 text-secondary" />
          </button>
          <button
            type="button"
            onClick={onRedo}
            disabled={!canRedo}
            aria-label="重做"
            className="flex h-8 w-8 items-center justify-center rounded-lg border border-transparent transition hover:border-subtle hover:bg-[var(--bg-muted)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent-brand)] disabled:cursor-not-allowed disabled:opacity-40"
            title="重做"
          >
            <Redo2 className="h-4 w-4 text-secondary" />
          </button>
          <button
            type="button"
            onClick={handleCopy}
            disabled={sections.length === 0}
            aria-label="复制全部"
            className="flex h-8 items-center gap-1.5 rounded-lg px-2 transition hover:bg-[var(--bg-muted)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent-brand)] disabled:cursor-not-allowed disabled:opacity-40"
            title="复制全部"
          >
            {copySuccess ? (
              <Check className="h-4 w-4 text-[var(--success)]" />
            ) : (
              <Copy className="h-4 w-4 text-secondary" />
            )}
            <span className="text-[12px] text-secondary">{copySuccess ? "已复制" : "复制"}</span>
          </button>
          <button
            type="button"
            onClick={handleDownload}
            disabled={sections.length === 0}
            aria-label="下载 markdown"
            className="flex h-8 items-center gap-1.5 rounded-lg px-2 transition hover:bg-[var(--bg-muted)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent-brand)] disabled:cursor-not-allowed disabled:opacity-40"
            title="下载"
          >
            <Download className="h-4 w-4 text-secondary" />
            <span className="text-[12px] text-secondary">下载</span>
          </button>
        </div>
      </div>

      <div className="editor-paper-bg flex-1 overflow-y-auto p-4 sm:p-5" aria-label="白板文档区域">
        <div className="mx-auto w-full max-w-[900px] rounded-[20px] border border-subtle bg-[var(--bg-surface)] p-5 shadow-soft sm:min-h-[900px] sm:p-10">
          <EditorContent editor={editor} aria-label="白板文档编辑器" />
        </div>
      </div>
    </div>
  );
});

export default BoardPane;

