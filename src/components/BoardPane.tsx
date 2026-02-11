
import { memo, useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { EditorContent, useEditor } from "@tiptap/react";
import StarterKit from "@tiptap/starter-kit";
import Placeholder from "@tiptap/extension-placeholder";
import { Copy, Download, Undo2, Redo2, Check, Heading1, Heading2 } from "lucide-react";
import type { BoardHighlightRequest, BoardSection, BoardTemplateType } from "../types/workspace";
import { sanitizeHtml } from "../utils/sanitizeHtml";

interface BoardPaneProps {
  sections: BoardSection[];
  onSectionsChange: (sections: BoardSection[]) => void;
  onUndo: () => void;
  onRedo: () => void;
  canUndo: boolean;
  canRedo: boolean;
  highlightRequest?: BoardHighlightRequest | null;
  templateType?: BoardTemplateType;
  onTemplateTypeChange?: (template: BoardTemplateType) => void;
  readOnly?: boolean;
}

const HTML_TAG_PATTERN = /<([a-z][\w-]*)(\s[^>]*)?>/i;
const HEADING_TAG_PATTERN = /^H[1-3]$/i;
const MIN_EDITOR_HTML = "<p></p>";
const EDITOR_CHANGE_DEBOUNCE_MS = 150;
const STRUCTURED_CHANGE_DEBOUNCE_MS = 150;
const HIGHLIGHT_COLLAPSE_DELAY_MS = 1800;

const TEMPLATE_OPTIONS: Array<{ value: BoardTemplateType; label: string }> = [
  { value: "document", label: "文档" },
  { value: "table", label: "表格" },
  { value: "code", label: "代码" }
];

const TEMPLATE_PLACEHOLDER: Record<BoardTemplateType, string> = {
  document: "从空白页开始：先写标题，再逐步补充小标题和正文...",
  table: "# 分析表\n\n| 维度 | 现状 | 目标 | 动作 |\n| --- | --- | --- | --- |\n| 用户 |  |  |  |",
  code: "# 代码草稿\n\n```ts\n// 在这里继续完善代码\n```"
};

type EditableTableSection = {
  id: string;
  title: string;
  headers: string[];
  rows: string[][];
};

const DEFAULT_TABLE_HEADERS = ["维度", "现状", "目标", "动作"] as const;
const TABLE_COLUMN_HINTS: Array<ReadonlyArray<string>> = [
  ["维度", "主题", "模块", "对象", "受众", "目标用户", "场景", "领域", "类别", "方向", "任务", "问题"],
  ["现状", "当前", "进展", "状态", "背景", "问题描述", "痛点", "约束", "限制"],
  ["目标", "期望", "结果", "产出", "指标", "成功标准", "里程碑"],
  ["动作", "行动", "下一步", "计划", "策略", "建议", "措施", "执行"]
];

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

function buildStructuredTextFromSections(sections: BoardSection[]) {
  if (!sections.length) return "";
  return sections
    .map((section, index) => {
      const title = normalizeTitle(section.title, index);
      const body = htmlToPlainText(section.content);
      return `${index === 0 ? "#" : "##"} ${title}\n${body}`.trim();
    })
    .join("\n\n");
}

function splitMarkdownTableLine(line: string) {
  const normalized = line.trim();
  if (!normalized.includes("|")) return [];
  const noEdge = normalized.replace(/^\|/, "").replace(/\|$/, "");
  return noEdge.split("|").map((cell) => cell.trim());
}

function normalizeTableRows(rows: string[][], colCount: number) {
  if (!rows.length) return [Array.from({ length: colCount }, () => "")];
  return rows.map((row) => {
    const next = row.slice(0, colCount);
    while (next.length < colCount) next.push("");
    return next;
  });
}

function stripLinePrefix(value: string) {
  return value
    .replace(/^[-*•]\s+/, "")
    .replace(/^\d+[.)、]\s+/, "")
    .trim();
}

function mergeCell(current: string, incoming: string) {
  const nextValue = incoming.trim();
  if (!nextValue) return current;
  if (!current.trim()) return nextValue;
  if (current.includes(nextValue)) return current;
  return `${current}；${nextValue}`;
}

function resolveTableColumnIndex(label: string) {
  const normalized = label.trim().toLowerCase();
  if (!normalized) return -1;
  for (let col = 0; col < TABLE_COLUMN_HINTS.length; col += 1) {
    if (TABLE_COLUMN_HINTS[col].some((hint) => normalized.includes(hint.toLowerCase()))) {
      return col;
    }
  }
  return -1;
}

function parseFallbackTableRows(raw: string, fallbackDimension: string): string[][] {
  const lines = raw
    .split("\n")
    .map((line) => stripLinePrefix(line))
    .filter(Boolean);

  if (!lines.length) return [["", "", "", ""]];

  const rows: string[][] = [];
  let current = ["", "", "", ""];

  const flush = () => {
    if (!current.some((cell) => cell.trim())) return;
    rows.push([...current]);
    current = ["", "", "", ""];
  };

  for (const line of lines) {
    const segments = line
      .split(/[；;]+/)
      .map((segment) => segment.trim())
      .filter(Boolean);
    let handled = false;

    for (const segment of segments) {
      const match = segment.match(/^([^：:]{1,24})[：:]\s*(.+)$/);
      if (!match) continue;
      handled = true;
      const label = match[1]?.trim() ?? "";
      const value = (match[2] ?? "").trim();
      const colIndex = resolveTableColumnIndex(label);

      if (colIndex === 0) {
        if (current[0] && (current[1] || current[2] || current[3])) flush();
        current[0] = mergeCell(current[0], value || label);
        continue;
      }

      if (colIndex > 0) {
        if (!current[0]) current[0] = fallbackDimension;
        current[colIndex] = mergeCell(current[colIndex], value);
        continue;
      }

      if (current[0] && (current[1] || current[2] || current[3])) flush();
      current[0] = mergeCell(current[0], label);
      current[1] = mergeCell(current[1], value);
    }

    if (handled) continue;
    if (!current[0]) {
      current[0] = line;
      continue;
    }
    if (!current[1]) {
      current[1] = line;
      continue;
    }
    if (!current[2]) {
      current[2] = line;
      continue;
    }
    current[3] = mergeCell(current[3], line);
  }

  flush();
  return rows.length > 0 ? rows : [[raw.trim(), "", "", ""]];
}

function parseEditableTableFromSection(section: BoardSection, index: number): EditableTableSection {
  const plain = htmlToPlainText(section.content).replace(/\r\n/g, "\n");
  const lines = plain
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean);

  const tableLines = lines.filter((line) => line.includes("|"));
  if (tableLines.length >= 2) {
    const headers = splitMarkdownTableLine(tableLines[0]);
    const delimiterCells = splitMarkdownTableLine(tableLines[1]);
    const isDelimiter = delimiterCells.length > 0 && delimiterCells.every((cell) => /^:?-{3,}:?$/.test(cell));
    const bodyStart = isDelimiter ? 2 : 1;
    const bodyRows = tableLines.slice(bodyStart).map(splitMarkdownTableLine);
    if (headers.length > 0) {
      const normalizedHeaders = headers.map((cell, colIndex) => cell || `列${colIndex + 1}`);
      return {
        id: section.id,
        title: normalizeTitle(section.title, index),
        headers: normalizedHeaders,
        rows: normalizeTableRows(bodyRows, normalizedHeaders.length)
      };
    }
  }

  return {
    id: section.id,
    title: normalizeTitle(section.title, index),
    headers: [...DEFAULT_TABLE_HEADERS],
    rows: normalizeTableRows(parseFallbackTableRows(plain.trim(), normalizeTitle(section.title, index)), DEFAULT_TABLE_HEADERS.length)
  };
}

function buildEditableTablesFromSections(sections: BoardSection[]) {
  if (!sections.length) {
    return [
      {
        id: makeSectionId(),
        title: "分析表",
        headers: [...DEFAULT_TABLE_HEADERS],
        rows: [["", "", "", ""]]
      }
    ] satisfies EditableTableSection[];
  }
  return sections.map((section, index) => parseEditableTableFromSection(section, index));
}

function escapeMarkdownCell(cell: string) {
  return cell.replace(/\|/g, "\\|").replace(/\n/g, " ");
}

function buildMarkdownTableContent(table: EditableTableSection) {
  const safeHeaders = table.headers.map((header) => escapeMarkdownCell(header.trim() || " "));
  const headerLine = `| ${safeHeaders.join(" | ")} |`;
  const delimiterLine = `| ${safeHeaders.map(() => "---").join(" | ")} |`;
  const bodyLines = normalizeTableRows(table.rows, safeHeaders.length).map(
    (row) => `| ${row.map((cell) => escapeMarkdownCell(cell.trim())).join(" | ")} |`
  );
  return [headerLine, delimiterLine, ...bodyLines].join("\n");
}

function buildSectionsFromEditableTables(tables: EditableTableSection[], previousSections: BoardSection[]): BoardSection[] {
  const now = Date.now();
  const usedIds = new Set<string>();
  return tables.map((table, index) => {
    const matchedById = previousSections.find((section) => section.id === table.id && !usedIds.has(section.id));
    const matchedByIndex =
      previousSections[index] && !usedIds.has(previousSections[index].id) ? previousSections[index] : null;
    const id = matchedById?.id ?? matchedByIndex?.id ?? makeSectionId();
    usedIds.add(id);
    return {
      id,
      title: normalizeTitle(table.title, index),
      content: buildMarkdownTableContent(table),
      source: "user",
      lastUpdated: now
    } satisfies BoardSection;
  });
}
function areTableSectionsEqual(left: EditableTableSection[], right: EditableTableSection[]) {
  if (left.length !== right.length) return false;
  for (let i = 0; i < left.length; i += 1) {
    const l = left[i];
    const r = right[i];
    if (!l || !r) return false;
    if (l.id !== r.id || l.title !== r.title) return false;
    if (l.headers.length !== r.headers.length || l.rows.length !== r.rows.length) return false;
    for (let col = 0; col < l.headers.length; col += 1) {
      if (l.headers[col] !== r.headers[col]) return false;
    }
    for (let row = 0; row < l.rows.length; row += 1) {
      const leftRow = l.rows[row];
      const rightRow = r.rows[row];
      if (!leftRow || !rightRow || leftRow.length !== rightRow.length) return false;
      for (let col = 0; col < leftRow.length; col += 1) {
        if (leftRow[col] !== rightRow[col]) return false;
      }
    }
  }
  return true;
}

function parseSectionsFromStructuredText(structuredText: string, previousSections: BoardSection[]): BoardSection[] {
  const normalizedText = structuredText.replace(/\r\n/g, "\n").trim();
  if (!normalizedText) return [];

  const lines = normalizedText.split("\n");
  const now = Date.now();
  const parsed: Array<{ title: string; content: string }> = [];
  let currentTitle = "";
  let currentBody: string[] = [];

  const flush = () => {
    const body = currentBody.join("\n").trim();
    if (!currentTitle && !body) return;
    parsed.push({
      title: normalizeTitle(currentTitle, parsed.length),
      content: body
    });
    currentTitle = "";
    currentBody = [];
  };

  for (const line of lines) {
    const heading = line.match(/^#{1,3}\s+(.+)$/);
    if (heading) {
      flush();
      currentTitle = heading[1]?.trim() ?? "";
      continue;
    }
    currentBody.push(line);
  }
  flush();

  if (!parsed.length) {
    parsed.push({
      title: normalizeTitle(previousSections[0]?.title ?? "内容", 0),
      content: normalizedText
    });
  }

  const usedIds = new Set<string>();
  const takeSectionId = (title: string, index: number) => {
    const byTitle = previousSections.find((section) => !usedIds.has(section.id) && section.title.trim() === title.trim());
    if (byTitle) return byTitle.id;
    const byIndex = previousSections[index];
    if (byIndex && !usedIds.has(byIndex.id)) return byIndex.id;
    return makeSectionId();
  };

  const sections = parsed.map((entry, index) => {
    const id = takeSectionId(entry.title, index);
    usedIds.add(id);
    return {
      id,
      title: normalizeTitle(entry.title, index),
      content: entry.content,
      source: "user" as const,
      lastUpdated: now
    };
  });

  return dedupeSections(sections);
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
      .split(/[\s,，。；;:：()（）[\]【】]+/)
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
function findStructuredHighlightRange(
  value: string,
  sections: BoardSection[],
  request: BoardHighlightRequest
): { start: number; end: number } | null {
  function findAnchorRangeInWindow(
    source: string,
    anchorText: string,
    windowStart: number,
    windowEnd: number
  ): { start: number; end: number } | null {
    const normalized = anchorText.trim();
    if (!normalized) return null;

    const segment = source.slice(windowStart, windowEnd);
    const loweredSegment = segment.toLowerCase();
    const candidates = [
      normalized,
      ...normalized
        .split(/[\s,，。；;:：()（）[\]【】]+/)
        .map((token) => token.trim())
        .filter((token) => token.length >= 2)
        .sort((a, b) => b.length - a.length)
    ];

    for (const candidate of candidates) {
      const loweredCandidate = candidate.toLowerCase();
      const index = loweredSegment.indexOf(loweredCandidate);
      if (index < 0) continue;
      return {
        start: windowStart + index,
        end: Math.min(source.length, windowStart + index + candidate.length)
      };
    }

    return null;
  }

  function findStructuredSectionWindow(
    source: string,
    sectionTitle: string
  ): { headingStart: number; headingEnd: number; sectionEnd: number } | null {
    const normalizedTitle = sectionTitle.trim().toLowerCase();
    if (!normalizedTitle) return null;

    const headingRegex = /^#{1,3}\s+(.+)$/gm;
    const headings: Array<{ start: number; end: number; title: string }> = [];
    let match: RegExpExecArray | null = headingRegex.exec(source);
    while (match) {
      headings.push({
        start: match.index,
        end: match.index + match[0].length,
        title: (match[1] ?? "").trim()
      });
      match = headingRegex.exec(source);
    }

    if (!headings.length) return null;

    const headingIndex = headings.findIndex((heading) => heading.title.toLowerCase() === normalizedTitle);
    if (headingIndex < 0) return null;
    const heading = headings[headingIndex];
    const nextHeading = headings[headingIndex + 1];

    return {
      headingStart: heading.start,
      headingEnd: heading.end,
      sectionEnd: nextHeading ? nextHeading.start : source.length
    };
  }

  const section = sections.find((item) => item.id === request.sectionId);
  const anchor = request.anchorText?.trim();

  if (section) {
    const sectionWindow = findStructuredSectionWindow(value, section.title);
    if (sectionWindow) {
      if (anchor) {
        const matched = findAnchorRangeInWindow(value, anchor, sectionWindow.headingEnd, sectionWindow.sectionEnd);
        if (matched) return matched;
      }
      return {
        start: sectionWindow.headingStart,
        end: sectionWindow.headingEnd
      };
    }
  }

  if (anchor) {
    const globalMatch = findAnchorRangeInWindow(value, anchor, 0, value.length);
    if (globalMatch) return globalMatch;
  }

  if (section) {
    const headingTokens = [`# ${section.title}`, `## ${section.title}`];
    for (const heading of headingTokens) {
      const headingIndex = value.indexOf(heading);
      if (headingIndex >= 0) {
        return { start: headingIndex, end: Math.min(value.length, headingIndex + heading.length) };
      }
    }

    const contentToken = htmlToPlainText(section.content).trim();
    if (contentToken) {
      const snippet = contentToken.slice(0, Math.min(40, contentToken.length)).toLowerCase();
      const snippetIndex = value.toLowerCase().indexOf(snippet);
      if (snippetIndex >= 0) {
        return {
          start: snippetIndex,
          end: Math.min(value.length, snippetIndex + Math.max(8, snippet.length))
        };
      }
    }
  }

  return null;
}

function findAnchorCellInTable(table: EditableTableSection, anchorText?: string): { row: number; col: number } | null {
  const anchor = anchorText?.trim().toLowerCase();
  if (!anchor) return null;

  for (let row = 0; row < table.rows.length; row += 1) {
    const rowCells = table.rows[row] ?? [];
    for (let col = 0; col < rowCells.length; col += 1) {
      const cell = (rowCells[col] ?? "").toLowerCase();
      if (!cell) continue;
      if (cell.includes(anchor) || anchor.includes(cell)) {
        return { row, col };
      }
    }
  }

  for (let col = 0; col < table.headers.length; col += 1) {
    const header = (table.headers[col] ?? "").toLowerCase();
    if (header.includes(anchor) || anchor.includes(header)) {
      return { row: -1, col };
    }
  }

  return null;
}

function buildTableCellKey(sectionId: string, row: number, col: number) {
  return `${sectionId}:${row}:${col}`;
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
      aria-pressed={active}
      title={ariaLabel ?? label}
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
  highlightRequest = null,
  templateType = "document",
  onTemplateTypeChange,
  readOnly = false
}: BoardPaneProps) {
  const [copySuccess, setCopySuccess] = useState(false);
  const [structuredDraft, setStructuredDraft] = useState(() => buildStructuredTextFromSections(sections));
  const [tableDraft, setTableDraft] = useState<EditableTableSection[]>(() => buildEditableTablesFromSections(sections));
  const sectionsRef = useRef(sections);
  const onSectionsChangeRef = useRef(onSectionsChange);
  const pendingHtmlRef = useRef<string | null>(null);
  const pendingStructuredTextRef = useRef<string | null>(null);
  const pendingTableSectionsRef = useRef<BoardSection[] | null>(null);
  const flushTimerRef = useRef<number | null>(null);
  const structuredFlushTimerRef = useRef<number | null>(null);
  const highlightTimerRef = useRef<number | null>(null);
  const structuredInputRef = useRef<HTMLTextAreaElement | null>(null);
  const tableCellRefs = useRef<Record<string, HTMLInputElement | null>>({});
  const previousTemplateRef = useRef(templateType);

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
  const isDocumentMode = templateType === "document";
  const isTableMode = templateType === "table";

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

  const clearStructuredFlushTimer = useCallback(() => {
    if (structuredFlushTimerRef.current !== null) {
      window.clearTimeout(structuredFlushTimerRef.current);
      structuredFlushTimerRef.current = null;
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

  const flushPendingStructuredUpdate = useCallback(() => {
    const pendingTableSections = pendingTableSectionsRef.current;
    if (pendingTableSections) {
      pendingTableSectionsRef.current = null;
      if (areSectionsEqual(pendingTableSections, sectionsRef.current)) return;
      sectionsRef.current = pendingTableSections;
      onSectionsChangeRef.current(pendingTableSections);
      return;
    }

    const pendingText = pendingStructuredTextRef.current;
    if (pendingText === null) return;
    pendingStructuredTextRef.current = null;

    const parsed = parseSectionsFromStructuredText(pendingText, sectionsRef.current);
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

  const scheduleStructuredFlush = useCallback(() => {
    clearStructuredFlushTimer();
    structuredFlushTimerRef.current = window.setTimeout(() => {
      structuredFlushTimerRef.current = null;
      flushPendingStructuredUpdate();
    }, STRUCTURED_CHANGE_DEBOUNCE_MS);
  }, [clearStructuredFlushTimer, flushPendingStructuredUpdate]);

  const queueTableSectionsUpdate = useCallback(
    (nextTables: EditableTableSection[]) => {
      const parsedSections = buildSectionsFromEditableTables(nextTables, sectionsRef.current);
      pendingTableSectionsRef.current = parsedSections;
      scheduleStructuredFlush();
    },
    [scheduleStructuredFlush]
  );

  useEffect(() => {
    return () => {
      clearFlushTimer();
      clearStructuredFlushTimer();
      if (highlightTimerRef.current !== null) {
        window.clearTimeout(highlightTimerRef.current);
        highlightTimerRef.current = null;
      }
    };
  }, [clearFlushTimer, clearStructuredFlushTimer]);

  const editor = useEditor({
    extensions: [
      StarterKit.configure({
        heading: { levels: [1, 2, 3] }
      }),
      Placeholder.configure({
        placeholder: TEMPLATE_PLACEHOLDER.document
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
    editor.setEditable(!readOnly && isDocumentMode);
  }, [editor, isDocumentMode, readOnly]);

  useEffect(() => {
    if (previousTemplateRef.current === templateType) return;
    previousTemplateRef.current = templateType;
    if (readOnly) return;

    if (isDocumentMode) {
      if (!editor || editor.isDestroyed) return;
      const raf = window.requestAnimationFrame(() => {
        if (!editor.isDestroyed) {
          editor.chain().focus("end").run();
        }
      });
      return () => window.cancelAnimationFrame(raf);
    }

    if (isTableMode) {
      const firstTable = tableDraft[0];
      if (!firstTable) return;
      const firstCell = tableCellRefs.current[buildTableCellKey(firstTable.id, 0, 0)];
      if (!firstCell) return;
      const raf = window.requestAnimationFrame(() => firstCell.focus());
      return () => window.cancelAnimationFrame(raf);
    }

    const textarea = structuredInputRef.current;
    if (!textarea) return;
    const raf = window.requestAnimationFrame(() => textarea.focus());
    return () => window.cancelAnimationFrame(raf);
  }, [editor, isDocumentMode, isTableMode, readOnly, tableDraft, templateType]);

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
    if (isDocumentMode) return;
    clearStructuredFlushTimer();
    pendingStructuredTextRef.current = null;
    pendingTableSectionsRef.current = null;

    if (isTableMode) {
      const nextTables = buildEditableTablesFromSections(sections);
      setTableDraft((prev) => (areTableSectionsEqual(prev, nextTables) ? prev : nextTables));
      return;
    }

    setStructuredDraft(buildStructuredTextFromSections(sections));
  }, [clearStructuredFlushTimer, isDocumentMode, isTableMode, sections]);

  useEffect(() => {
    if (!highlightRequest) return;

    if (isDocumentMode) {
      if (!editor) return;
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
      return;
    }

    if (isTableMode) {
      const targetTable = tableDraft.find((table) => table.id === highlightRequest.sectionId);
      if (!targetTable) return;
      const cellPos =
        findAnchorCellInTable(targetTable, highlightRequest.anchorText) ??
        (targetTable.rows[0]?.length ? { row: 0, col: 0 } : null);
      if (!cellPos) return;

      const cell = tableCellRefs.current[buildTableCellKey(targetTable.id, cellPos.row, cellPos.col)];
      if (!cell) return;

      cell.focus();
      cell.select();
      if (highlightTimerRef.current !== null) {
        window.clearTimeout(highlightTimerRef.current);
      }
      highlightTimerRef.current = window.setTimeout(() => {
        if (document.activeElement === cell) {
          const end = cell.value.length;
          cell.setSelectionRange(end, end);
        }
        highlightTimerRef.current = null;
      }, HIGHLIGHT_COLLAPSE_DELAY_MS);
      return;
    }

    const textarea = structuredInputRef.current;
    if (!textarea) return;
    const range = findStructuredHighlightRange(textarea.value, sections, highlightRequest);
    if (!range) return;

    textarea.focus();
    textarea.setSelectionRange(range.start, range.end);
    if (highlightTimerRef.current !== null) {
      window.clearTimeout(highlightTimerRef.current);
    }
    highlightTimerRef.current = window.setTimeout(() => {
      textarea.setSelectionRange(range.end, range.end);
      highlightTimerRef.current = null;
    }, HIGHLIGHT_COLLAPSE_DELAY_MS);
  }, [editor, highlightRequest, isDocumentMode, isTableMode, sections, tableDraft]);

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
  const handleStructuredChange = useCallback(
    (value: string) => {
      setStructuredDraft(value);
      pendingStructuredTextRef.current = value;
      scheduleStructuredFlush();
    },
    [scheduleStructuredFlush]
  );

  const handleTableTitleChange = useCallback(
    (tableIndex: number, value: string) => {
      setTableDraft((prev) => {
        const next = prev.map((table, index) => (index === tableIndex ? { ...table, title: value } : table));
        queueTableSectionsUpdate(next);
        return next;
      });
    },
    [queueTableSectionsUpdate]
  );

  const handleTableHeaderChange = useCallback(
    (tableIndex: number, colIndex: number, value: string) => {
      setTableDraft((prev) => {
        const next = prev.map((table, index) => {
          if (index !== tableIndex) return table;
          const nextHeaders = table.headers.map((header, col) => (col === colIndex ? value : header));
          return { ...table, headers: nextHeaders };
        });
        queueTableSectionsUpdate(next);
        return next;
      });
    },
    [queueTableSectionsUpdate]
  );

  const handleTableCellChange = useCallback(
    (tableIndex: number, rowIndex: number, colIndex: number, value: string) => {
      setTableDraft((prev) => {
        const next = prev.map((table, index) => {
          if (index !== tableIndex) return table;
          const nextRows = table.rows.map((row, rowCursor) => {
            if (rowCursor !== rowIndex) return row;
            return row.map((cell, colCursor) => (colCursor === colIndex ? value : cell));
          });
          return { ...table, rows: nextRows };
        });
        queueTableSectionsUpdate(next);
        return next;
      });
    },
    [queueTableSectionsUpdate]
  );

  const handleAddTableRow = useCallback(
    (tableIndex: number) => {
      setTableDraft((prev) => {
        const next = prev.map((table, index) => {
          if (index !== tableIndex) return table;
          const newRow = Array.from({ length: table.headers.length }, () => "");
          return { ...table, rows: [...table.rows, newRow] };
        });
        queueTableSectionsUpdate(next);
        return next;
      });
    },
    [queueTableSectionsUpdate]
  );

  const handleAddTableColumn = useCallback(
    (tableIndex: number) => {
      setTableDraft((prev) => {
        const next = prev.map((table, index) => {
          if (index !== tableIndex) return table;
          const nextHeaders = [...table.headers, `列${table.headers.length + 1}`];
          const nextRows = table.rows.map((row) => [...row, ""]);
          return { ...table, headers: nextHeaders, rows: nextRows };
        });
        queueTableSectionsUpdate(next);
        return next;
      });
    },
    [queueTableSectionsUpdate]
  );

  const toolbarDisabled = !editor || readOnly || !isDocumentMode;

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
          {TEMPLATE_OPTIONS.map((option) => (
            <ToolbarButton
              key={option.value}
              label={option.label}
              ariaLabel={`切换到${option.label}模板`}
              active={templateType === option.value}
              onClick={() => onTemplateTypeChange?.(option.value)}
              disabled={readOnly || !onTemplateTypeChange}
            />
          ))}

          <div className="mx-1 h-4 w-px bg-[var(--border-subtle)]" />

          <ToolbarButton label="H1" ariaLabel="一级标题" icon={<Heading1 className="h-3.5 w-3.5" />} active={editor?.isActive("heading", { level: 1 }) ?? false} onClick={() => editor?.chain().focus().toggleHeading({ level: 1 }).run()} disabled={toolbarDisabled} />
          <ToolbarButton label="H2" ariaLabel="二级标题" icon={<Heading2 className="h-3.5 w-3.5" />} active={editor?.isActive("heading", { level: 2 }) ?? false} onClick={() => editor?.chain().focus().toggleHeading({ level: 2 }).run()} disabled={toolbarDisabled} />
          <ToolbarButton label="B" ariaLabel="加粗" active={editor?.isActive("bold") ?? false} onClick={() => editor?.chain().focus().toggleBold().run()} disabled={toolbarDisabled} />
          <ToolbarButton label="I" ariaLabel="斜体" active={editor?.isActive("italic") ?? false} onClick={() => editor?.chain().focus().toggleItalic().run()} disabled={toolbarDisabled} />
          <ToolbarButton label="列表" ariaLabel="无序列表" active={editor?.isActive("bulletList") ?? false} onClick={() => editor?.chain().focus().toggleBulletList().run()} disabled={toolbarDisabled} />
          <ToolbarButton label="编号" ariaLabel="有序列表" active={editor?.isActive("orderedList") ?? false} onClick={() => editor?.chain().focus().toggleOrderedList().run()} disabled={toolbarDisabled} />

          <div className="mx-2 h-4 w-px bg-[var(--border-subtle)]" />

          <button type="button" onClick={onUndo} disabled={!canUndo || readOnly} aria-label="撤销" className="flex h-8 w-8 items-center justify-center rounded-lg border border-transparent transition hover:border-subtle hover:bg-[var(--bg-muted)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent-brand)] disabled:cursor-not-allowed disabled:opacity-40" title="撤销"><Undo2 className="h-4 w-4 text-secondary" /></button>
          <button type="button" onClick={onRedo} disabled={!canRedo || readOnly} aria-label="重做" className="flex h-8 w-8 items-center justify-center rounded-lg border border-transparent transition hover:border-subtle hover:bg-[var(--bg-muted)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent-brand)] disabled:cursor-not-allowed disabled:opacity-40" title="重做"><Redo2 className="h-4 w-4 text-secondary" /></button>
          <button type="button" onClick={handleCopy} disabled={sections.length === 0} aria-label="复制全部" className="flex h-8 items-center gap-1.5 rounded-lg px-2 transition hover:bg-[var(--bg-muted)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent-brand)] disabled:cursor-not-allowed disabled:opacity-40" title="复制全部">{copySuccess ? <Check className="h-4 w-4 text-[var(--success)]" /> : <Copy className="h-4 w-4 text-secondary" />}<span className="text-[12px] text-secondary">{copySuccess ? "已复制" : "复制"}</span></button>
          <button type="button" onClick={handleDownload} disabled={sections.length === 0} aria-label="下载 markdown" className="flex h-8 items-center gap-1.5 rounded-lg px-2 transition hover:bg-[var(--bg-muted)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent-brand)] disabled:cursor-not-allowed disabled:opacity-40" title="下载"><Download className="h-4 w-4 text-secondary" /><span className="text-[12px] text-secondary">下载</span></button>
        </div>
      </div>

      <div className="editor-paper-bg flex-1 overflow-y-auto p-4 sm:p-5" aria-label="白板文档区域">
        <div className="mx-auto w-full max-w-[900px] rounded-[20px] border border-subtle bg-[var(--bg-surface)] p-5 shadow-soft sm:min-h-[900px] sm:p-10">
          {isDocumentMode ? (
            <EditorContent editor={editor} aria-label="白板文档编辑器" />
          ) : isTableMode ? (
            <div className="space-y-4" data-testid="board-table-editor" aria-label="白板表格编辑器">
              {tableDraft.map((table, tableIndex) => (
                <section key={table.id} className="rounded-2xl border border-subtle bg-[var(--bg-surface)] p-3.5" aria-label={`表格分区 ${tableIndex + 1}`}>
                  <div className="mb-3 flex flex-wrap items-center gap-2">
                    <input type="text" value={table.title} onChange={(event) => handleTableTitleChange(tableIndex, event.target.value)} readOnly={readOnly} aria-label={`表格标题 ${tableIndex + 1}`} className="h-9 min-w-[220px] rounded-lg border border-subtle bg-[var(--bg-surface)] px-3 text-[13px] font-semibold text-primary outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent-brand)] read-only:cursor-default read-only:opacity-80" />
                    <button type="button" onClick={() => handleAddTableRow(tableIndex)} disabled={readOnly} aria-label={`为 ${table.title} 添加行`} className="h-8 rounded-lg border border-subtle px-3 text-[12px] font-medium text-secondary transition hover:bg-[var(--bg-muted)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent-brand)] disabled:cursor-not-allowed disabled:opacity-40">添加行</button>
                    <button type="button" onClick={() => handleAddTableColumn(tableIndex)} disabled={readOnly} aria-label={`为 ${table.title} 添加列`} className="h-8 rounded-lg border border-subtle px-3 text-[12px] font-medium text-secondary transition hover:bg-[var(--bg-muted)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent-brand)] disabled:cursor-not-allowed disabled:opacity-40">添加列</button>
                  </div>

                  <div className="overflow-x-auto rounded-xl border border-subtle">
                    <table className="min-w-full border-collapse">
                      <thead><tr>{table.headers.map((header, colIndex) => (<th key={`${table.id}-header-${colIndex}`} className="border-b border-subtle bg-[var(--bg-muted)] p-1.5"><input ref={(node) => { tableCellRefs.current[buildTableCellKey(table.id, -1, colIndex)] = node; }} type="text" value={header} onChange={(event) => handleTableHeaderChange(tableIndex, colIndex, event.target.value)} readOnly={readOnly} aria-label={`${table.title} 表头 ${colIndex + 1}`} className="h-8 w-full rounded-md border border-transparent bg-transparent px-2 text-[12px] font-semibold text-primary outline-none focus-visible:border-subtle focus-visible:bg-[var(--bg-surface)] focus-visible:ring-2 focus-visible:ring-[var(--accent-brand)] read-only:cursor-default" /></th>))}</tr></thead>
                      <tbody>{table.rows.map((row, rowIndex) => (<tr key={`${table.id}-row-${rowIndex}`}>{row.map((cell, colIndex) => (<td key={`${table.id}-cell-${rowIndex}-${colIndex}`} className="border-b border-subtle p-1.5 align-top"><input ref={(node) => { tableCellRefs.current[buildTableCellKey(table.id, rowIndex, colIndex)] = node; }} type="text" value={cell} onChange={(event) => handleTableCellChange(tableIndex, rowIndex, colIndex, event.target.value)} readOnly={readOnly} aria-label={`${table.title} 第 ${rowIndex + 1} 行第 ${colIndex + 1} 列`} className="h-8 w-full rounded-md border border-transparent bg-transparent px-2 text-[12px] text-primary outline-none focus-visible:border-subtle focus-visible:bg-[var(--bg-surface)] focus-visible:ring-2 focus-visible:ring-[var(--accent-brand)] read-only:cursor-default" /></td>))}</tr>))}</tbody>
                    </table>
                  </div>
                </section>
              ))}
            </div>
          ) : (
            <textarea ref={structuredInputRef} value={structuredDraft} onChange={(event) => handleStructuredChange(event.target.value)} readOnly={readOnly} aria-label="白板文档编辑器" placeholder={TEMPLATE_PLACEHOLDER[templateType]} className={`min-h-[760px] w-full resize-none rounded-xl border border-subtle bg-[var(--bg-surface)] p-4 text-[14px] leading-[1.7] text-primary outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent-brand)] ${templateType === "code" ? "font-mono" : "font-medium"}`} />
          )}
        </div>
      </div>
    </div>
  );
});

export default BoardPane;
