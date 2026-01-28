import type { Deliverable, DeliverableInclude } from "../state/appState";
import type { ReactNode } from "react";

type Size = "preview" | "export";

function TagPill({ text, size }: { text: string; size: Size }) {
  const pad = size === "export" ? "px-3 py-1.5" : "px-2 py-1";
  const textSize = size === "export" ? "text-[16px]" : "text-[12px]";

  return (
    <div className={`rounded-full border border-[#E5E7EB] bg-[#F3F4F6] ${pad}`}>
      <div className={`${textSize} font-normal text-[#6B7280]`}>{text}</div>
    </div>
  );
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
  const labelSize = size === "export" ? "text-[18px]" : "text-[12px]";
  const labelGap = size === "export" ? "gap-[10px]" : "gap-[6px]";

  return (
    <div className={`flex flex-col ${labelGap}`}>
      <div className={`${labelSize} font-semibold text-[#6B7280]`}>{label}</div>
      <div>{children}</div>
    </div>
  );
}

export default function DeliverableCard({
  deliverable,
  size,
  include
}: {
  deliverable: Deliverable;
  size: Size;
  include: DeliverableInclude;
}) {
  const isExport = size === "export";
  const cardW = isExport ? "w-[1080px]" : "w-[592px]";
  const cardH = isExport ? "h-[1350px]" : "h-[740px]";
  const radius = isExport ? "rounded-[24px]" : "rounded-2xl";
  const pad = isExport ? "p-[72px]" : "p-6";
  const metaSize = isExport ? "text-[18px]" : "text-[12px]";
  const titleSize = isExport ? "text-[36px]" : "text-[20px]";
  const bodySize = isExport ? "text-[22px]" : "text-[13px]";
  const contentGap = isExport ? "gap-6" : "gap-4";
  const divH = isExport ? "h-[2px]" : "h-px";
  const footerTextSize = isExport ? "text-[16px]" : "text-[12px]";

  return (
    <div
      className={`${cardW} ${cardH} ${radius} border border-[#E5E7EB] bg-white ${pad} ${
        isExport ? "shadow-none" : "shadow-[0_10px_24px_rgba(0,0,0,0.08)]"
      } flex flex-col justify-between overflow-hidden`}
    >
      <div className={`flex flex-col ${contentGap}`}>
        <div className="flex items-center justify-between">
          <div className={`${metaSize} font-semibold text-[#111827]`}>AI-World</div>
          <div className={`${metaSize} font-normal text-[#6B7280]`}>执行卡片 · 交付版</div>
        </div>

        <div className={`${titleSize} font-semibold text-[#111827]`}>{deliverable.title}</div>

        <div className="flex items-center gap-2">
          <TagPill size={size} text={`语气：${deliverable.tone}`} />
          <TagPill size={size} text={`对手：${deliverable.opponent}`} />
        </div>

        <div className={`${divH} w-full bg-[#E5E7EB]`} />

        {include.opening ? (
          <Section size={size} label="开场白">
            <div className={`${bodySize} font-normal leading-[1.5] text-[#111827]`}>{deliverable.opening}</div>
          </Section>
        ) : null}

        {include.keyPoints ? (
          <Section size={size} label="3 个核心论点">
            <div className={`${bodySize} whitespace-pre-line font-normal leading-[1.5] text-[#111827]`}>
              {deliverable.keyPoints.join("\n")}
            </div>
          </Section>
        ) : null}

        {include.objections ? (
          <Section size={size} label={isExport ? "应对预案（对方说 No）" : "应对预案（对方说 No）"}>
            <div className={`${bodySize} whitespace-pre-line font-normal leading-[1.5] text-[#111827]`}>{deliverable.objections}</div>
          </Section>
        ) : null}

        {include.rubric ? (
          <Section size={size} label="评分与建议">
            <div className={`${bodySize} whitespace-pre-line font-normal leading-[1.5] text-[#111827]`}>
              {`质量评分：${deliverable.rubricTotal}/100\n${deliverable.coachNote}`}
            </div>
          </Section>
        ) : null}
      </div>

      <div className="flex flex-col gap-3">
        <div className={`${divH} w-full bg-[#E5E7EB]`} />
        <div className={`${footerTextSize} font-normal text-[#9CA3AF]`}>可复制/可导出 · 内容可撤销 · 以你的最终确认为准</div>
      </div>
    </div>
  );
}
