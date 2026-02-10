import { ArrowLeft, ChevronDown, Copy, FileText, Image, Loader2 } from "lucide-react";
import { useCallback, useEffect, useRef, useState, type ReactNode } from "react";
import { useNavigate } from "react-router-dom";
import { track } from "../analytics";
import BoardExportCard from "../components/BoardExportCard";
import ToastLayer, { type ToastState } from "../components/ToastLayer";
import type { BoardSection } from "../types/workspace";

type ExportFormat = "image" | "pdf" | "text";

type ExportDeps = {
  toPng: typeof import("html-to-image").toPng;
  jsPDF: typeof import("jspdf").jsPDF;
};

type WorkspaceSnapshot = {
  sessionId: string;
  boardSections: BoardSection[];
};

const STORAGE_KEY = "ai-world-workspace-v2";

function classNames(...parts: Array<string | false | null | undefined>) {
  return parts.filter(Boolean).join(" ");
}

function ActionButton({
  icon,
  label,
  primary,
  disabled,
  ariaLabel,
  onClick
}: {
  icon: ReactNode;
  label: string;
  primary: boolean;
  disabled?: boolean;
  ariaLabel?: string;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      aria-label={ariaLabel ?? label}
      className={classNames(
        "flex h-10 items-center gap-2 rounded-full border px-4 transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent-brand)] focus-visible:ring-offset-2 focus-visible:ring-offset-[var(--bg-base)] disabled:cursor-not-allowed disabled:opacity-50",
        primary
          ? "border-[var(--accent-strong)] bg-[var(--accent-strong)] text-white"
          : "border-subtle bg-[var(--bg-surface)] text-primary hover:bg-[var(--bg-muted)]"
      )}
    >
      {icon}
      <div className={classNames("text-[13px]", primary ? "font-semibold" : "font-medium")}>{label}</div>
    </button>
  );
}

function SelectButton({
  selected,
  label,
  disabled,
  onClick
}: {
  selected: boolean;
  label: string;
  disabled?: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      role="radio"
      aria-checked={selected}
      aria-label={`选择格式：${label}`}
      className={classNames(
        "rounded-full border px-3.5 py-2 text-[13px] transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent-brand)] focus-visible:ring-offset-2 focus-visible:ring-offset-[var(--bg-base)] disabled:cursor-not-allowed disabled:opacity-50",
        selected
          ? "border-[var(--accent-strong)] bg-[var(--accent-strong)] font-semibold text-white"
          : "border-subtle bg-[var(--bg-surface)] font-medium text-primary hover:bg-[var(--bg-muted)]"
      )}
    >
      {label}
    </button>
  );
}

function toSafeFilename(raw: string) {
  const trimmed = raw.trim() ? raw.trim() : "思考白板";
  return trimmed.replace(/[\\/:*?"<>|]/g, "_");
}

function loadWorkspaceSnapshot(): WorkspaceSnapshot | null {
  try {
    const stored = localStorage.getItem(STORAGE_KEY);
    if (!stored) return null;
    const parsed = JSON.parse(stored) as Partial<WorkspaceSnapshot>;
    if (!parsed.sessionId) return null;
    return {
      sessionId: parsed.sessionId,
      boardSections: Array.isArray(parsed.boardSections) ? parsed.boardSections : []
    };
  } catch {
    return null;
  }
}

const HTML_TAG_PATTERN = /<([a-z][\w-]*)(\s[^>]*)?>/i;

function htmlToPlainText(value: string) {
  const trimmed = value.trim();
  if (!trimmed) return "";
  if (typeof window === "undefined" || !HTML_TAG_PATTERN.test(trimmed)) return value;
  const container = document.createElement("div");
  container.innerHTML = value;
  const text = container.textContent ?? container.innerText ?? "";
  return text.replace(/\n{3,}/g, "\n\n").trim();
}

function buildBoardText({
  title,
  sections
}: {
  title: string;
  sections: BoardSection[];
}) {
  const lines: string[] = [title];
  sections.forEach((section) => {
    lines.push("", section.title, htmlToPlainText(section.content));
  });
  return lines.join("\n");
}

function nowPerfMs() {
  if (typeof performance !== "undefined" && typeof performance.now === "function") {
    return performance.now();
  }
  return Date.now();
}

export default function ExportPage() {
  const nav = useNavigate();
  const [workspace] = useState(() => loadWorkspaceSnapshot());
  const boardSections = workspace?.boardSections ?? [];
  const exportTitle = boardSections[0]?.title?.trim() ? `${boardSections[0].title.trim()} · 白板` : "思考白板交付稿";
  const sessionId = workspace?.sessionId ?? "unknown";

  const [format, setFormat] = useState<ExportFormat>("pdf");
  const [toast, setToast] = useState<ToastState>(null);
  const [busyAction, setBusyAction] = useState<ExportFormat | null>(null);
  const isBusy = busyAction !== null;
  const canExport = boardSections.length > 0;
  const firstActionTrackedRef = useRef(false);

  const exportNodeRef = useRef<HTMLDivElement | null>(null);
  const exportDepsPromiseRef = useRef<Promise<ExportDeps> | null>(null);

  const showToast = useCallback((next: ToastState) => {
    setToast(next);
    window.setTimeout(() => setToast(null), 1600);
  }, []);

  const loadExportDeps = useCallback(() => {
    if (!exportDepsPromiseRef.current) {
      exportDepsPromiseRef.current = Promise.all([import("html-to-image"), import("jspdf")]).then(
        ([htmlToImage, jspdf]) => ({
          toPng: htmlToImage.toPng,
          jsPDF: jspdf.jsPDF
        })
      );
    }
    return exportDepsPromiseRef.current;
  }, []);

  const trackFirstExportResponse = useCallback(
    ({
      format,
      startedAt,
      status
    }: {
      format: ExportFormat;
      startedAt: number;
      status: "ok" | "error";
    }) => {
      if (firstActionTrackedRef.current) return;
      firstActionTrackedRef.current = true;
      track("perf_export_first_response", {
        task_id: sessionId,
        format,
        status,
        latency_ms: Math.max(0, Math.round(nowPerfMs() - startedAt)),
        board_section_count: boardSections.length
      });
    },
    [boardSections.length, sessionId]
  );

  useEffect(() => {
    if (!canExport) return;
    const idleWindow = window as Window & {
      requestIdleCallback?: (callback: () => void, options?: { timeout: number }) => number;
      cancelIdleCallback?: (handle: number) => void;
    };
    if (typeof idleWindow.requestIdleCallback !== "function") return;
    let idleHandle: number | null = null;
    const warmup = () => {
      void loadExportDeps().catch(() => undefined);
    };

    const timer = window.setTimeout(() => {
      idleHandle = idleWindow.requestIdleCallback?.(warmup, { timeout: 1000 }) ?? null;
    }, 260);

    return () => {
      window.clearTimeout(timer);
      if (idleHandle !== null && typeof idleWindow.cancelIdleCallback === "function") {
        idleWindow.cancelIdleCallback(idleHandle);
      }
    };
  }, [canExport, loadExportDeps]);

  const copyText = useCallback(async () => {
    if (!navigator.clipboard?.writeText) {
      showToast({ kind: "error", message: "复制失败：当前环境不支持剪贴板。" });
      return;
    }

    if (!canExport) {
      showToast({ kind: "error", message: "白板内容为空，无法复制。" });
      return;
    }

    const text = buildBoardText({
      title: exportTitle,
      sections: boardSections
    });

    try {
      await navigator.clipboard.writeText(text);
      showToast({ kind: "copy", message: "已复制到剪贴板。" });
      track("copy_clicked", {
        task_id: sessionId,
        session_id: sessionId,
        page: "export",
        format: "text",
        board_section_count: boardSections.length
      });
    } catch {
      showToast({ kind: "error", message: "复制失败：请检查浏览器权限。" });
    }
  }, [boardSections, canExport, exportTitle, sessionId, showToast]);

  const exportImage = useCallback(async () => {
    const node = exportNodeRef.current;
    if (!node) {
      showToast({ kind: "error", message: "导出失败：未找到渲染节点。" });
      return;
    }

    if (!canExport) {
      showToast({ kind: "error", message: "白板内容为空，无法导出。" });
      return;
    }

    try {
      const { toPng } = await loadExportDeps();
      const dataUrl = await toPng(node, { cacheBust: true, pixelRatio: 1 });
      const a = document.createElement("a");
      a.href = dataUrl;
      a.download = `${toSafeFilename(exportTitle)}-1080x1350.png`;
      a.click();
      showToast({ kind: "export", message: "图片导出成功。" });
      track("export_clicked", {
        task_id: sessionId,
        session_id: sessionId,
        page: "export",
        format: "image",
        size: "1080x1350",
        board_section_count: boardSections.length
      });
    } catch {
      showToast({ kind: "error", message: "导出失败：图片生成错误。" });
    }
  }, [boardSections.length, canExport, exportTitle, loadExportDeps, sessionId, showToast]);

  const exportPdf = useCallback(async () => {
    const node = exportNodeRef.current;
    if (!node) {
      showToast({ kind: "error", message: "导出失败：未找到渲染节点。" });
      return;
    }

    if (!canExport) {
      showToast({ kind: "error", message: "白板内容为空，无法导出。" });
      return;
    }

    try {
      const { toPng, jsPDF } = await loadExportDeps();
      const dataUrl = await toPng(node, { cacheBust: true, pixelRatio: 1 });

      const pdf = new jsPDF({
        orientation: "portrait",
        unit: "px",
        format: [1080, 1350]
      });

      pdf.addImage(dataUrl, "PNG", 0, 0, 1080, 1350);
      pdf.save(`${toSafeFilename(exportTitle)}-1080x1350.pdf`);
      showToast({ kind: "export", message: "PDF 导出成功。" });
      track("export_clicked", {
        task_id: sessionId,
        session_id: sessionId,
        page: "export",
        format: "pdf",
        size: "1080x1350",
        board_section_count: boardSections.length
      });
    } catch {
      showToast({ kind: "error", message: "导出失败：PDF 生成错误。" });
    }
  }, [boardSections.length, canExport, exportTitle, loadExportDeps, sessionId, showToast]);

  const onActionCopy = useCallback(async () => {
    if (busyAction) return;
    const startedAt = nowPerfMs();
    setFormat("text");
    setBusyAction("text");
    try {
      await copyText();
      trackFirstExportResponse({ format: "text", startedAt, status: canExport ? "ok" : "error" });
    } finally {
      setBusyAction(null);
    }
  }, [busyAction, canExport, copyText, trackFirstExportResponse]);

  const onActionImage = useCallback(async () => {
    if (busyAction) return;
    const startedAt = nowPerfMs();
    setFormat("image");
    setBusyAction("image");
    try {
      await exportImage();
      trackFirstExportResponse({ format: "image", startedAt, status: canExport ? "ok" : "error" });
    } finally {
      setBusyAction(null);
    }
  }, [busyAction, canExport, exportImage, trackFirstExportResponse]);

  const onActionPdf = useCallback(async () => {
    if (busyAction) return;
    const startedAt = nowPerfMs();
    setFormat("pdf");
    setBusyAction("pdf");
    try {
      await exportPdf();
      trackFirstExportResponse({ format: "pdf", startedAt, status: canExport ? "ok" : "error" });
    } finally {
      setBusyAction(null);
    }
  }, [busyAction, canExport, exportPdf, trackFirstExportResponse]);

  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement | null;
      const tag = target?.tagName;
      const isTyping =
        tag === "INPUT" || tag === "TEXTAREA" || Boolean((target as HTMLElement | null)?.isContentEditable);
      if (isTyping) return;

      const mod = e.metaKey || e.ctrlKey;
      if (!mod) return;

      if (e.key === "Enter") {
        e.preventDefault();
        if (format === "text") {
          void onActionCopy();
        } else if (format === "image") {
          void onActionImage();
        } else {
          void onActionPdf();
        }
      }

      if (e.shiftKey && e.key.toLowerCase() === "c") {
        e.preventDefault();
        void onActionCopy();
      }
    };

    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [format, onActionCopy, onActionImage, onActionPdf]);

  return (
    <main className="min-h-screen bg-[var(--bg-base)] p-3 sm:p-4" aria-label="白板导出页面">
      <ToastLayer toast={toast} />

      <div className="mx-auto flex min-h-[calc(100vh-1.5rem)] max-w-[1320px] flex-col overflow-hidden rounded-[20px] border border-subtle bg-[rgba(255,255,255,0.92)] shadow-card">
        <header className="flex h-16 items-center justify-between border-b border-subtle bg-[var(--bg-surface)] px-5 sm:px-6">
          <div className="flex items-center gap-3">
            <button
              type="button"
              onClick={() => nav("/canvas")}
              aria-label="返回工作台"
              className="flex h-9 w-9 items-center justify-center rounded-full border border-subtle bg-[var(--bg-surface)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent-brand)]"
            >
              <ArrowLeft className="h-4 w-4 text-secondary" />
            </button>

            <div className="flex flex-col gap-0.5">
              <div className="text-[15px] font-semibold text-primary">白板导出</div>
              <div className="text-[12px] text-secondary">统一版式预览与交付导出</div>
            </div>
          </div>

          <div className="hidden items-center gap-2 sm:flex">
            <ActionButton
              onClick={onActionCopy}
              disabled={isBusy || !canExport}
              primary={format === "text"}
              ariaLabel="复制文本"
              icon={
                busyAction === "text" ? (
                  <Loader2 className={classNames("h-4 w-4 animate-spin", format === "text" ? "text-white" : "text-secondary")} />
                ) : (
                  <Copy className={classNames("h-4 w-4", format === "text" ? "text-white" : "text-secondary")} />
                )
              }
              label="复制文本"
            />
            <ActionButton
              onClick={onActionImage}
              disabled={isBusy || !canExport}
              primary={format === "image"}
              ariaLabel="导出图片"
              icon={
                busyAction === "image" ? (
                  <Loader2 className={classNames("h-4 w-4 animate-spin", format === "image" ? "text-white" : "text-secondary")} />
                ) : (
                  <Image className={classNames("h-4 w-4", format === "image" ? "text-white" : "text-secondary")} />
                )
              }
              label="导出图片"
            />
            <ActionButton
              onClick={onActionPdf}
              disabled={isBusy || !canExport}
              primary={format === "pdf"}
              ariaLabel="导出 PDF"
              icon={
                busyAction === "pdf" ? (
                  <Loader2 className={classNames("h-4 w-4 animate-spin", format === "pdf" ? "text-white" : "text-secondary")} />
                ) : (
                  <FileText className={classNames("h-4 w-4", format === "pdf" ? "text-white" : "text-secondary")} />
                )
              }
              label="导出 PDF"
            />
          </div>
        </header>

        <div className="flex flex-1 flex-col gap-4 p-4 lg:flex-row lg:gap-5 lg:p-5">
          <section className="w-full rounded-[16px] border border-subtle bg-[var(--bg-surface)] p-4 lg:w-[360px]" aria-labelledby="export-settings-title">
            <div className="flex flex-col gap-1">
              <div id="export-settings-title" className="text-[14px] font-semibold text-primary">
                导出设置
              </div>
              <div className="text-[12px] text-secondary">选择导出格式，预览会实时更新。</div>
            </div>

            <div className="mt-4 text-[12px] font-semibold text-secondary">格式</div>
            <div className="mt-2 flex flex-wrap items-center gap-2" role="radiogroup" aria-label="导出格式">
              <SelectButton disabled={isBusy} selected={format === "image"} label="图片" onClick={() => setFormat("image")} />
              <SelectButton disabled={isBusy} selected={format === "pdf"} label="PDF" onClick={() => setFormat("pdf")} />
              <SelectButton disabled={isBusy} selected={format === "text"} label="文本" onClick={() => setFormat("text")} />
            </div>

            <div className="mt-4 text-[12px] font-semibold text-secondary">包含内容</div>
            <div className="mt-2 rounded-xl border border-subtle bg-[var(--bg-muted)] px-3.5 py-3">
              <div className="text-[13px] font-medium text-primary">白板区块</div>
              <div className="mt-1 text-[12px] text-secondary">当前将导出全部 {boardSections.length} 个区块的标题和内容。</div>
            </div>

            <div className="mt-4 text-[12px] font-semibold text-secondary">尺寸</div>
            <button
              type="button"
              disabled
              aria-disabled="true"
              aria-label="导出尺寸：1080x1350（推荐）"
              className="mt-2 flex h-11 w-full items-center justify-between rounded-xl border border-subtle bg-[var(--bg-surface)] px-3.5 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent-brand)]"
            >
              <div className="text-[13px] font-normal text-primary">1080x1350（推荐）</div>
              <ChevronDown className="h-4 w-4 text-secondary" />
            </button>

            <div className="mt-3 text-[12px] text-secondary">图片适合分享，PDF 适合归档，文本适合继续编辑。</div>

            <div className="mt-4 flex gap-2 sm:hidden">
              <ActionButton
                onClick={onActionCopy}
                disabled={isBusy || !canExport}
                primary={format === "text"}
                ariaLabel="复制文本（移动端）"
                icon={<Copy className={classNames("h-4 w-4", format === "text" ? "text-white" : "text-secondary")} />}
                label="复制"
              />
              <ActionButton
                onClick={onActionImage}
                disabled={isBusy || !canExport}
                primary={format === "image"}
                ariaLabel="导出图片（移动端）"
                icon={<Image className={classNames("h-4 w-4", format === "image" ? "text-white" : "text-secondary")} />}
                label="图片"
              />
              <ActionButton
                onClick={onActionPdf}
                disabled={isBusy || !canExport}
                primary={format === "pdf"}
                ariaLabel="导出 PDF（移动端）"
                icon={<FileText className={classNames("h-4 w-4", format === "pdf" ? "text-white" : "text-secondary")} />}
                label="PDF"
              />
            </div>
          </section>

          <section className="flex min-h-0 flex-1 flex-col" aria-labelledby="export-preview-title">
            <div className="mb-2 flex items-center justify-between">
              <div id="export-preview-title" className="text-[12px] font-semibold text-secondary">
                交付预览
              </div>
              <div className="text-[12px] text-muted">确认无误后即可导出</div>
            </div>

            <div className="flex flex-1 items-start justify-center overflow-auto rounded-[16px] border border-subtle bg-[var(--bg-muted)] p-3">
              <BoardExportCard title={exportTitle} sections={boardSections} size="preview" />
            </div>
          </section>
        </div>
      </div>

      <div className="fixed left-[-9999px] top-0" aria-hidden="true">
        <div ref={exportNodeRef}>
          <BoardExportCard title={exportTitle} sections={boardSections} size="export" />
        </div>
      </div>
    </main>
  );
}
