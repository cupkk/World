import type { ReactNode } from "react";
import type { BoardSection } from "../types/workspace";
import { sanitizeHtml } from "../utils/sanitizeHtml";

type Size = "preview" | "export";

const HTML_TAG_PATTERN = /<([a-z][\w-]*)(\s[^>]*)?>/i;

function escapeHtml(value: string) {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/\"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function toHtmlSegment(value: string) {
  const trimmed = value.trim();
  if (!trimmed) return "";
  if (HTML_TAG_PATTERN.test(trimmed)) return sanitizeHtml(value);
  return `<p>${escapeHtml(value).replace(/\n/g, "<br />")}</p>`;
}

function Section({
  label,
  children,
  size
}: {
  label: string;
  children: ReactNode;
  size: Size;
}) {
  const labelSize = size === "export" ? "text-[18px]" : "text-[13px]";
  const labelGap = size === "export" ? "gap-[10px]" : "gap-[6px]";

  return (
    <div className={`flex flex-col ${labelGap}`}>
      <div className={`${labelSize} font-semibold text-primary`}>{label}</div>
      <div>{children}</div>
    </div>
  );
}

function SectionContent({ content, size }: { content: string; size: Size }) {
  const bodySize = size === "export" ? "text-[22px]" : "text-[13px]";
  const html = toHtmlSegment(content);
  return (
    <div
      className={`${bodySize} tiptap-editor font-normal leading-[1.6] text-primary`}
      dangerouslySetInnerHTML={{ __html: html }}
    />
  );
}

export default function BoardExportCard({
  title,
  sections,
  size
}: {
  title: string;
  sections: BoardSection[];
  size: Size;
}) {
  const isExport = size === "export";
  const cardW = isExport ? "w-[1080px]" : "w-full max-w-[592px]";
  const cardH = isExport ? "h-[1350px]" : "min-h-[740px]";
  const radius = isExport ? "rounded-[24px]" : "rounded-[18px]";
  const pad = isExport ? "p-[72px]" : "p-6";
  const metaSize = isExport ? "text-[18px]" : "text-[12px]";
  const titleSize = isExport ? "text-[36px]" : "text-[20px]";
  const contentGap = isExport ? "gap-6" : "gap-4";
  const divH = isExport ? "h-[2px]" : "h-px";
  const footerTextSize = isExport ? "text-[16px]" : "text-[12px]";

  return (
    <div
      className={`${cardW} ${cardH} ${radius} border border-subtle bg-[var(--bg-surface)] ${pad} ${
        isExport ? "shadow-none" : "shadow-soft"
      } flex flex-col justify-between overflow-hidden`}
    >
      <div className={`flex flex-col ${contentGap}`}>
        <div className="flex items-center justify-between">
          <div className={`${metaSize} font-semibold text-primary`}>AI-World</div>
          <div className={`${metaSize} font-normal text-secondary`}>白板导出 · 交付稿</div>
        </div>

        <div className={`${titleSize} font-semibold text-primary font-display`}>{title}</div>

        <div className={`${divH} w-full bg-[var(--border-subtle)]`} />

        {sections.length === 0 ? (
          <div className="rounded-xl border border-dashed border-subtle bg-[var(--bg-muted)] px-6 py-10 text-center">
            <div className="text-[14px] font-medium text-primary">白板内容为空</div>
            <div className="mt-2 text-[12px] text-muted">回到工作台补充信息后再导出</div>
          </div>
        ) : (
          sections.map((section) => (
            <Section key={section.id} label={section.title} size={size}>
              <SectionContent content={section.content} size={size} />
            </Section>
          ))
        )}
      </div>

      <div className="mt-8 flex flex-col gap-3">
        <div className={`${divH} w-full bg-[var(--border-subtle)]`} />
        <div className={`${footerTextSize} font-normal text-muted`}>可复制 · 可导出 · 内容可撤销 · 以你的最终确认为准</div>
      </div>
    </div>
  );
}
