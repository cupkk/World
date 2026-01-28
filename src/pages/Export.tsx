import {
  ArrowLeft,
  Check,
  ChevronDown,
  Copy,
  FileText,
  Image
} from "lucide-react";
import { toPng } from "html-to-image";
import { jsPDF } from "jspdf";
import { useRef, useState, type ReactNode } from "react";
import { useNavigate } from "react-router-dom";
import DeliverableCard from "../components/DeliverableCard";
import ToastLayer, { type ToastState } from "../components/ToastLayer";
import type { DeliverableInclude } from "../state/appState";
import { useAppState } from "../state/appState";

type ExportFormat = "image" | "pdf" | "text";

function classNames(...parts: Array<string | false | null | undefined>) {
  return parts.filter(Boolean).join(" ");
}

function ActionButton({
  icon,
  label,
  primary,
  onClick
}: {
  icon: ReactNode;
  label: string;
  primary: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={classNames(
        "flex items-center gap-2 rounded-[10px] px-3 py-2",
        primary
          ? "bg-[#111827] text-white"
          : "border border-[#E5E7EB] bg-white text-[#111827]"
      )}
    >
      {icon}
      <div className={classNames("text-[13px]", primary ? "font-semibold" : "font-medium")}>
        {label}
      </div>
    </button>
  );
}

function SelectButton({
  selected,
  label,
  onClick
}: {
  selected: boolean;
  label: string;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={classNames(
        "rounded-[10px] px-3 py-2 text-[13px]",
        selected
          ? "bg-[#111827] font-semibold text-white"
          : "border border-[#E5E7EB] bg-white font-medium text-[#111827]"
      )}
    >
      {label}
    </button>
  );
}

function CheckboxRow({
  checked,
  label,
  onToggle
}: {
  checked: boolean;
  label: string;
  onToggle: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onToggle}
      className="flex w-full items-center gap-2.5 text-left"
    >
      <div
        className={classNames(
          "flex h-4 w-4 items-center justify-center rounded-[4px]",
          checked ? "bg-[#111827]" : "border border-[#E5E7EB] bg-white"
        )}
      >
        {checked ? <Check className="h-3 w-3 text-white" /> : null}
      </div>
      <div className="text-[13px] font-normal text-[#111827]">{label}</div>
    </button>
  );
}

function toSafeFilename(raw: string) {
  const trimmed = raw.trim() ? raw.trim() : "执行卡片";
  return trimmed.replace(/[\\/:*?"<>|]/g, "_");
}

function buildDeliverableText({
  include,
  title,
  opening,
  keyPoints,
  objections,
  rubricTotal,
  coachNote
}: {
  include: DeliverableInclude;
  title: string;
  opening: string;
  keyPoints: string[];
  objections: string;
  rubricTotal: number;
  coachNote: string;
}) {
  const lines: string[] = [title];

  if (include.opening) {
    lines.push("", "开场白", opening);
  }

  if (include.keyPoints) {
    lines.push("", "3 个核心论点", keyPoints.join("\n"));
  }

  if (include.objections) {
    lines.push("", "应对预案（对方说 No）", objections);
  }

  if (include.rubric) {
    lines.push("", "评分与建议", `质量评分：${rubricTotal}/100`, coachNote);
  }

  return lines.join("\n");
}

export default function ExportPage() {
  const nav = useNavigate();
  const { state } = useAppState();

  const [format, setFormat] = useState<ExportFormat>("pdf");
  const [include, setInclude] = useState<DeliverableInclude>({
    opening: true,
    keyPoints: true,
    objections: true,
    rubric: false
  });
  const [toast, setToast] = useState<ToastState>(null);

  const exportNodeRef = useRef<HTMLDivElement | null>(null);

  const showToast = (next: ToastState) => {
    setToast(next);
    window.setTimeout(() => setToast(null), 1600);
  };

  const copyText = async () => {
    const d = state.deliverable;
    const text = buildDeliverableText({
      include,
      title: d.title,
      opening: d.opening,
      keyPoints: d.keyPoints,
      objections: d.objections,
      rubricTotal: d.rubricTotal,
      coachNote: d.coachNote
    });

    await navigator.clipboard.writeText(text);
    showToast({ kind: "copy", message: "复制成功：已复制到剪贴板" });
  };

  const exportImage = async () => {
    const node = exportNodeRef.current;
    if (!node) {
      showToast({ kind: "error", message: "导出失败：未找到渲染节点" });
      return;
    }

    const dataUrl = await toPng(node, { cacheBust: true, pixelRatio: 1 });
    const a = document.createElement("a");
    a.href = dataUrl;
    a.download = `${toSafeFilename(state.scenario)}-1080x1350.png`;
    a.click();

    showToast({ kind: "export", message: "导出成功：1080×1350 图片已生成" });
  };

  const exportPdf = async () => {
    const node = exportNodeRef.current;
    if (!node) {
      showToast({ kind: "error", message: "导出失败：未找到渲染节点" });
      return;
    }

    const dataUrl = await toPng(node, { cacheBust: true, pixelRatio: 1 });

    const pdf = new jsPDF({
      orientation: "portrait",
      unit: "px",
      format: [1080, 1350]
    });

    pdf.addImage(dataUrl, "PNG", 0, 0, 1080, 1350);
    pdf.save(`${toSafeFilename(state.scenario)}-1080x1350.pdf`);

    showToast({ kind: "export", message: "导出成功：PDF 已生成" });
  };

  const onActionCopy = async () => {
    setFormat("text");
    await copyText();
  };

  const onActionImage = async () => {
    setFormat("image");
    await exportImage();
  };

  const onActionPdf = async () => {
    setFormat("pdf");
    await exportPdf();
  };

  return (
    <div className="min-h-screen bg-[#F9FAFB]">
      <ToastLayer toast={toast} />

      <div className="mx-auto flex min-h-screen max-w-[1440px] flex-col">
        <div className="flex h-16 items-center justify-between border-b border-[#E5E7EB] bg-white px-6">
          <div className="flex items-center gap-3">
            <button
              type="button"
              onClick={() => nav("/canvas")}
              className="flex h-8 w-8 items-center justify-center rounded-[10px] border border-[#E5E7EB] bg-white"
            >
              <ArrowLeft className="h-4 w-4 text-[#6B7280]" />
            </button>

            <div className="flex flex-col gap-0.5">
              <div className="text-[14px] font-semibold text-[#111827]">交付执行卡片</div>
              <div className="text-[12px] font-normal text-[#6B7280]">最后一步：复制/导出交付</div>
            </div>
          </div>

          <div className="flex items-center gap-2.5">
            <ActionButton
              onClick={onActionCopy}
              primary={format === "text"}
              icon={<Copy className={classNames("h-4 w-4", format === "text" ? "text-white" : "text-[#6B7280]")} />}
              label="复制文本"
            />
            <ActionButton
              onClick={onActionImage}
              primary={format === "image"}
              icon={<Image className={classNames("h-4 w-4", format === "image" ? "text-white" : "text-[#6B7280]")} />}
              label="导出图片"
            />
            <ActionButton
              onClick={onActionPdf}
              primary={format === "pdf"}
              icon={<FileText className={classNames("h-4 w-4", format === "pdf" ? "text-white" : "text-[#6B7280]")} />}
              label="导出 PDF"
            />
          </div>
        </div>

        <div className="flex flex-1 gap-6 p-6">
          <div className="h-full w-[420px] rounded-2xl border border-[#E5E7EB] bg-white p-[14px]">
            <div className="flex flex-col gap-1">
              <div className="text-[14px] font-semibold text-[#111827]">导出设置</div>
              <div className="text-[13px] font-normal text-[#6B7280]">选择格式与内容，预览实时更新。</div>
            </div>

            <div className="mt-4 text-[12px] font-semibold text-[#6B7280]">格式</div>
            <div className="mt-2 flex items-center gap-2">
              <SelectButton selected={format === "image"} label="图片" onClick={() => setFormat("image")} />
              <SelectButton selected={format === "pdf"} label="PDF" onClick={() => setFormat("pdf")} />
              <SelectButton selected={format === "text"} label="文本" onClick={() => setFormat("text")} />
            </div>

            <div className="mt-4 text-[12px] font-semibold text-[#6B7280]">包含内容</div>
            <div className="mt-2 flex flex-col gap-2">
              <CheckboxRow
                checked={include.opening}
                label="开场白"
                onToggle={() => setInclude((s) => ({ ...s, opening: !s.opening }))}
              />
              <CheckboxRow
                checked={include.keyPoints}
                label="3 个核心论点"
                onToggle={() => setInclude((s) => ({ ...s, keyPoints: !s.keyPoints }))}
              />
              <CheckboxRow
                checked={include.objections}
                label="应对预案"
                onToggle={() => setInclude((s) => ({ ...s, objections: !s.objections }))}
              />
              <CheckboxRow
                checked={include.rubric}
                label="评分与建议"
                onToggle={() => setInclude((s) => ({ ...s, rubric: !s.rubric }))}
              />
            </div>

            <div className="mt-4 text-[12px] font-semibold text-[#6B7280]">尺寸</div>
            <button
              type="button"
              className="mt-2 flex h-11 w-full items-center justify-between rounded-xl border border-[#E5E7EB] bg-[#F9FAFB] px-3.5"
            >
              <div className="text-[13px] font-normal text-[#111827]">1080×1350（推荐）</div>
              <ChevronDown className="h-4 w-4 text-[#6B7280]" />
            </button>

            <div className="mt-2 text-[12px] font-normal text-[#6B7280]">提示：图片适合粘贴到聊天；PDF 适合归档。</div>
          </div>

          <div className="flex flex-1 flex-col items-center gap-4">
            <div className="flex w-[592px] items-center justify-between">
              <div className="text-[12px] font-semibold text-[#6B7280]">交付预览</div>
              <div className="text-[12px] font-normal text-[#9CA3AF]">确认无误后即可复制/导出</div>
            </div>

            <DeliverableCard deliverable={state.deliverable} size="preview" include={include} />
          </div>
        </div>
      </div>

      <div className="fixed left-[-9999px] top-0">
        <div ref={exportNodeRef}>
          <DeliverableCard deliverable={state.deliverable} size="export" include={include} />
        </div>
      </div>
    </div>
  );
}
