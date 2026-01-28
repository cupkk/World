import {
  ArrowRight,
  ChevronDown,
  Search,
  Sparkles,
  Zap
} from "lucide-react";
import type { ReactNode } from "react";
import { useNavigate } from "react-router-dom";
import { useAppState } from "../state/appState";

function PillButton({
  children,
  onClick
}: {
  children: ReactNode;
  onClick?: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="flex items-center gap-1.5 rounded-full border border-[#E5E7EB] bg-white px-3 py-2 text-[#111827]"
    >
      {children}
    </button>
  );
}

function TagButton({ label, onClick }: { label: string; onClick: () => void }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="rounded-full border border-[#E5E7EB] bg-white px-3.5 py-2.5 text-[14px] font-medium text-[#111827]"
    >
      {label}
    </button>
  );
}

export default function OnboardingPage() {
  const nav = useNavigate();
  const { state, setScenario, cycleTone, cycleOpponent } = useAppState();

  const start = () => {
    nav("/canvas");
  };

  return (
    <div className="min-h-screen bg-white">
      <div className="mx-auto flex min-h-screen max-w-[1440px] flex-col">
        <div className="flex h-16 items-center border-b border-[#E5E7EB] px-6">
          <div className="text-[16px] font-semibold text-[#111827]">AI-World</div>
        </div>

        <div className="flex flex-1 items-center justify-center p-8">
          <div className="flex w-[720px] flex-col items-center gap-4">
            <div className="text-center text-[40px] font-semibold text-[#111827]">今天，你想搞定什么难题？</div>
            <div className="text-center text-[16px] text-[#6B7280]">一句话描述目标，我会帮你推演成可执行的策略与话术。</div>

            <div className="flex items-center gap-1.5 rounded-full border border-[#C7D2FE] bg-[#EEF2FF] px-2.5 py-1.5">
              <Sparkles className="h-4 w-4 text-[#4F46E5]" />
              <div className="text-[12px] font-medium text-[#4338CA]">30 秒产出可复制/可导出的执行卡片</div>
            </div>

            <div className="flex items-center gap-2 rounded-xl border border-[#E5E7EB] bg-[#F9FAFB] px-3 py-2">
              <div className="flex items-center gap-1.5">
                <div className="flex h-[18px] w-[18px] items-center justify-center rounded-full bg-[#111827] text-[11px] font-semibold text-white">1</div>
                <div className="text-[12px] font-medium text-[#111827]">一句话描述目标</div>
              </div>
              <ArrowRight className="h-3.5 w-3.5 text-[#9CA3AF]" />
              <div className="flex items-center gap-1.5">
                <div className="flex h-[18px] w-[18px] items-center justify-center rounded-full bg-[#111827] text-[11px] font-semibold text-white">2</div>
                <div className="text-[12px] font-medium text-[#111827]">可选：选语气/对手</div>
              </div>
              <ArrowRight className="h-3.5 w-3.5 text-[#9CA3AF]" />
              <div className="flex items-center gap-1.5">
                <div className="flex h-[18px] w-[18px] items-center justify-center rounded-full bg-[#111827] text-[11px] font-semibold text-white">3</div>
                <div className="text-[12px] font-medium text-[#111827]">生成可复制/可导出卡片</div>
              </div>
            </div>

            <div className="flex h-14 w-full items-center justify-between rounded-xl border border-[#E5E7EB] bg-[#F9FAFB] px-4">
              <div className="flex flex-1 items-center gap-3">
                <Search className="h-5 w-5 text-[#6B7280]" />
                <input
                  value={state.scenario}
                  onChange={(e) => setScenario(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter") start();
                  }}
                  placeholder="例如：向老板提加薪"
                  className="w-full bg-transparent text-[16px] text-[#111827] outline-none placeholder:text-[#6B7280]"
                />
              </div>
              <div className="rounded-full border border-[#E5E7EB] bg-white px-2.5 py-1.5 text-[12px] text-[#6B7280]">Enter ↵ 开始</div>
            </div>

            <button
              type="button"
              onClick={() => {
                setScenario("向老板提加薪");
                start();
              }}
              className="flex items-center gap-1.5 rounded-full border border-[#E5E7EB] bg-white px-2.5 py-1.5 text-[#4F46E5]"
            >
              <Zap className="h-4 w-4" />
              <div className="text-[12px] font-semibold">一键示例：向老板提加薪</div>
            </button>

            <button
              type="button"
              onClick={start}
              className="flex w-full items-center justify-center gap-2 rounded-xl bg-[#111827] px-4 py-2.5 text-white"
            >
              <div className="text-[14px] font-semibold">开始推演（30 秒）</div>
              <ArrowRight className="h-4 w-4" />
            </button>

            <div className="flex items-center justify-center gap-3">
              <PillButton onClick={cycleTone}>
                <div className="text-[12px] font-normal">语气：{state.tone}</div>
                <ChevronDown className="h-4 w-4 text-[#6B7280]" />
              </PillButton>
              <PillButton onClick={cycleOpponent}>
                <div className="text-[12px] font-normal">对手：{state.opponent}</div>
                <ChevronDown className="h-4 w-4 text-[#6B7280]" />
              </PillButton>
            </div>

            <div className="pt-1 text-[12px] font-semibold text-[#6B7280]">场景模板（点击一键填充）</div>

            <div className="flex flex-wrap justify-center gap-3">
              <TagButton
                label="向老板提加薪"
                onClick={() => {
                  setScenario("向老板提加薪");
                  start();
                }}
              />
              <TagButton
                label="拒绝平级甩锅"
                onClick={() => {
                  setScenario("拒绝平级甩锅");
                  start();
                }}
              />
              <TagButton
                label="催促跨部门进度"
                onClick={() => {
                  setScenario("催促跨部门进度");
                  start();
                }}
              />
              <TagButton
                label="争取新项目资源"
                onClick={() => {
                  setScenario("争取新项目资源");
                  start();
                }}
              />
            </div>

            <div className="pt-2 text-center text-[13px] text-[#9CA3AF]">提示：你可以粘贴对方的原话/邮件，我会以批注方式帮你优化。</div>
          </div>
        </div>
      </div>
    </div>
  );
}
