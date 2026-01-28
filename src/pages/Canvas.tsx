import {
  ArrowLeft,
  Check,
  ChevronDown,
  Copy,
  Download,
  Info,
  RefreshCw,
  Sparkles,
  Swords,
  Zap
} from "lucide-react";
import type { ReactNode } from "react";
import { useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import ToastLayer, { type ToastState } from "../components/ToastLayer";
import { useAppState } from "../state/appState";

function PillButton({
  label,
  onClick
}: {
  label: string;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="flex items-center gap-1.5 rounded-full border border-[#E5E7EB] bg-white px-3 py-2"
    >
      <div className="text-[12px] font-normal text-[#111827]">{label}</div>
      <ChevronDown className="h-4 w-4 text-[#6B7280]" />
    </button>
  );
}

function IconButton({
  onClick,
  children
}: {
  onClick: () => void;
  children: ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="flex h-8 w-8 items-center justify-center rounded-[10px] border border-[#E5E7EB] bg-white"
    >
      {children}
    </button>
  );
}

function SecondaryButton({
  icon,
  label,
  onClick
}: {
  icon?: ReactNode;
  label: string;
  onClick?: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="flex items-center gap-2 rounded-[10px] border border-[#E5E7EB] bg-white px-3.5 py-2.5"
    >
      {icon}
      <div className="text-[13px] font-medium text-[#111827]">{label}</div>
    </button>
  );
}

function PrimaryButton({
  icon,
  label,
  onClick
}: {
  icon?: ReactNode;
  label: string;
  onClick?: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="flex items-center gap-2 rounded-[10px] bg-[#111827] px-3.5 py-2.5 text-white"
    >
      {icon}
      <div className="text-[13px] font-semibold">{label}</div>
    </button>
  );
}

function formatDraftText({
  title,
  opening,
  keyPoints,
  objections
}: {
  title: string;
  opening: string;
  keyPoints: string[];
  objections: string;
}) {
  return [
    title,
    "",
    "开场白",
    opening,
    "",
    "3 个核心论点",
    keyPoints.join("\n"),
    "",
    "应对预案（对方说 No）",
    objections
  ].join("\n");
}

export default function CanvasPage() {
  const nav = useNavigate();
  const {
    state,
    cycleTone,
    cycleOpponent,
    setOpponentProfile,
    updateDeliverable,
    updateKeyPoint,
    quickDraft
  } = useAppState();

  const [toast, setToast] = useState<ToastState>(null);
  const [rtReply, setRtReply] = useState("");

  const taskTitle = useMemo(() => {
    const s = state.scenario.trim() ? state.scenario.trim() : "未命名任务";
    return `任务：${s}`;
  }, [state.scenario]);

  const showToast = (next: ToastState) => {
    setToast(next);
    window.setTimeout(() => setToast(null), 1600);
  };

  const copyDraft = async () => {
    const d = state.deliverable;
    const text = formatDraftText({
      title: d.title,
      opening: d.opening,
      keyPoints: d.keyPoints,
      objections: d.objections
    });

    await navigator.clipboard.writeText(text);
    showToast({ kind: "copy", message: "复制成功：已复制到剪贴板" });
  };

  return (
    <div className="min-h-screen bg-[#F9FAFB]">
      <ToastLayer toast={toast} />

      <div className="mx-auto flex min-h-screen max-w-[1440px] flex-col">
        <div className="flex h-16 items-center justify-between border-b border-[#E5E7EB] bg-white px-6">
          <div className="flex items-center gap-3">
            <IconButton onClick={() => nav("/")}> 
              <ArrowLeft className="h-5 w-5 text-[#6B7280]" />
            </IconButton>
            <div className="text-[16px] font-semibold text-[#111827]">{taskTitle}</div>
            <div className="rounded-full border border-[#E5E7EB] bg-[#F3F4F6] px-2.5 py-1.5 text-[12px] text-[#6B7280]">
              进度 1/5
            </div>
          </div>

          <div className="flex items-center gap-3">
            <PillButton label={`语气：${state.tone}`} onClick={cycleTone} />
            <PillButton label={`对手：${state.opponent}`} onClick={cycleOpponent} />
            <SecondaryButton
              icon={<Zap className="h-4 w-4 text-[#6B7280]" />}
              label="快速草稿"
              onClick={quickDraft}
            />
            <PrimaryButton
              icon={<Check className="h-4 w-4" />}
              label="完成"
              onClick={() => nav("/export")}
            />
          </div>
        </div>

        <div className="flex flex-1 gap-6 p-6">
          <div className="flex flex-1 items-center justify-center rounded-2xl border border-[#E5E7EB] bg-white p-6">
            <div className="flex w-full max-w-[720px] flex-col items-center gap-4">
              <div className="w-[560px] rounded-[14px] border border-[#E5E7EB] bg-white p-[18px]">
                <div className="flex items-center justify-between">
                  <div className="text-[12px] font-medium text-[#6B7280]">1/5  对手画像</div>
                  <div className="rounded-full border border-[#E5E7EB] bg-[#F3F4F6] px-2 py-1 text-[12px] text-[#6B7280]">
                    需要补充
                  </div>
                </div>

                <div className="mt-3 text-[18px] font-semibold text-[#111827]">
                  告诉我，你这次沟通的目标对象是谁？他是个怎样的人？
                </div>

                <div className="mt-3 rounded-xl border border-[#E5E7EB] bg-[#F9FAFB] px-3.5 py-2.5">
                  <textarea
                    value={state.opponentProfile}
                    onChange={(e) => setOpponentProfile(e.target.value)}
                    placeholder="例如：我的老板，比较强势，最近很关注绩效…"
                    className="h-[64px] w-full resize-none bg-transparent text-[14px] text-[#111827] outline-none placeholder:text-[#9CA3AF]"
                  />
                </div>

                <div className="mt-3 flex items-center justify-between">
                  <SecondaryButton
                    icon={<Info className="h-4 w-4 text-[#6B7280]" />}
                    label="我卡住了"
                  />
                  <PrimaryButton label="继续" onClick={() => {}} />
                </div>
              </div>

              <div className="w-[560px] rounded-[14px] border border-[#C7D2FE] bg-[#EEF2FF] p-4">
                <div className="flex items-start gap-3">
                  <Sparkles className="mt-0.5 h-[18px] w-[18px] text-[#6366F1]" />
                  <div className="flex-1">
                    <div className="text-[14px] text-[#374151]">
                      为了帮你拿下他，我需要知道：他最近在为哪些 KPI 焦虑？
                    </div>
                    <div className="mt-2 flex items-center gap-2">
                      <button
                        type="button"
                        className="rounded-full border border-[#E5E7EB] bg-white px-2.5 py-1.5 text-[12px] text-[#111827]"
                      >
                        知道了
                      </button>
                      <button
                        type="button"
                        className="rounded-full border border-[#E5E7EB] bg-white px-2.5 py-1.5 text-[12px] text-[#6B7280]"
                      >
                        不想回答
                      </button>
                    </div>
                  </div>
                </div>
              </div>

              <div className="w-[560px] rounded-[14px] border border-[#E5E7EB] bg-white p-4">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2.5">
                    <Swords className="h-[18px] w-[18px] text-[#6366F1]" />
                    <div className="text-[13px] font-semibold text-[#111827]">对手视角彩排</div>
                  </div>
                  <div className="rounded-full border border-[#E5E7EB] bg-[#F3F4F6] px-2 py-1 text-[12px] text-[#6B7280]">
                    老板 · {state.opponent}
                  </div>
                </div>

                <div className="mt-3 rounded-xl border border-[#E5E7EB] bg-[#F9FAFB] p-3">
                  <div className="text-[12px] font-semibold text-[#6B7280]">老板：</div>
                  <div className="mt-1 text-[13px] text-[#111827]">
                    如果我听到你这么说，我会觉得你只是在抱怨工作多。给我一个更“硬”的理由：你具体创造了什么结果？
                  </div>
                </div>

                <div className="mt-3 rounded-xl border border-[#E5E7EB] bg-white px-3.5 py-2.5">
                  <input
                    value={rtReply}
                    onChange={(e) => setRtReply(e.target.value)}
                    placeholder="写下你的回应…"
                    className="w-full bg-transparent text-[13px] text-[#111827] outline-none placeholder:text-[#9CA3AF]"
                  />
                </div>

                <div className="mt-3 flex items-center justify-between">
                  <SecondaryButton
                    icon={<RefreshCw className="h-4 w-4 text-[#6B7280]" />}
                    label="再来一轮"
                    onClick={() => setRtReply("")}
                  />
                  <PrimaryButton label="结束彩排" onClick={() => {}} />
                </div>
              </div>
            </div>
          </div>

          <div className="w-[420px] rounded-2xl border border-[#E5E7EB] bg-white p-[14px]">
            <div className="flex items-center justify-between">
              <div className="text-[14px] font-semibold text-[#111827]">执行稿</div>
              <div className="flex items-center gap-2.5">
                <IconButton onClick={copyDraft}>
                  <Copy className="h-4 w-4 text-[#6B7280]" />
                </IconButton>
                <IconButton onClick={() => nav("/export")}>
                  <Download className="h-4 w-4 text-[#6B7280]" />
                </IconButton>
              </div>
            </div>

            <div className="mt-3 rounded-[14px] border border-[#E5E7EB] bg-[#F9FAFB] p-[14px]">
              <div className="text-[12px] font-semibold text-[#6B7280]">开场白</div>
              <textarea
                value={state.deliverable.opening}
                onChange={(e) => updateDeliverable({ opening: e.target.value })}
                className="mt-1 h-[52px] w-full resize-none bg-transparent text-[13px] text-[#111827] outline-none"
              />

              <div className="mt-3 text-[12px] font-semibold text-[#6B7280]">3 个核心论点</div>
              <div className="mt-1 flex flex-col gap-2">
                {state.deliverable.keyPoints.map((kp, idx) => (
                  <input
                    key={idx}
                    value={kp}
                    onChange={(e) => updateKeyPoint(idx, e.target.value)}
                    className="w-full bg-transparent text-[13px] text-[#111827] outline-none"
                  />
                ))}
              </div>

              <div className="mt-3 text-[12px] font-semibold text-[#6B7280]">应对预案（对方说 No）</div>
              <textarea
                value={state.deliverable.objections}
                onChange={(e) => updateDeliverable({ objections: e.target.value })}
                className="mt-1 h-[92px] w-full resize-none bg-transparent text-[13px] text-[#111827] outline-none"
              />
            </div>

            <div className="mt-3 rounded-[14px] border border-[#E5E7EB] bg-white p-[14px]">
              <div className="flex items-center justify-between">
                <div className="text-[13px] font-semibold text-[#111827]">质量评分</div>
                <div className="flex items-baseline gap-1">
                  <div className="text-[20px] font-bold text-[#111827]">{state.deliverable.rubricTotal}</div>
                  <div className="text-[12px] text-[#6B7280]">/100</div>
                </div>
              </div>

              <div className="mt-3 space-y-2">
                {([
                  ["共情", state.deliverable.rubric.empathy],
                  ["逻辑", state.deliverable.rubric.logic],
                  ["语气", state.deliverable.rubric.tone],
                  ["防守", state.deliverable.rubric.defense]
                ] as const).map(([label, score]) => (
                  <div key={label} className="flex items-center gap-3">
                    <div className="w-10 text-[12px] text-[#6B7280]">{label}</div>
                    <div className="h-2 flex-1 rounded-full bg-[#F3F4F6]">
                      <div
                        className="h-2 rounded-full bg-[#111827]"
                        style={{ width: `${Math.min(100, Math.round((score / 25) * 100))}%` }}
                      />
                    </div>
                    <div className="w-8 text-right text-[12px] text-[#111827]">{score}</div>
                  </div>
                ))}
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
