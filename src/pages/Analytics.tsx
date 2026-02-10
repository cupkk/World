import { ArrowLeft, Download, RefreshCw, Trash2 } from "lucide-react";
import { useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { clearEventLog, getEventLog, type AnalyticsEvent } from "../analytics";

type FlowEvent = AnalyticsEvent & { task_id?: string };

function getTaskId(event: AnalyticsEvent) {
  const value = (event as unknown as Record<string, unknown>).task_id;
  if (typeof value !== "string") return null;
  const normalized = value.trim();
  return normalized || null;
}

function getFlowId(event: AnalyticsEvent) {
  const taskId = getTaskId(event);
  return taskId ? `task:${taskId}` : `session:${event.session_id}`;
}

function groupByFlow(events: AnalyticsEvent[]) {
  const map: Record<string, FlowEvent[]> = {};
  for (const e of events) {
    const key = getFlowId(e);
    map[key] ??= [];
    map[key].push(e as FlowEvent);
  }
  return map;
}

function safeNumber(v: unknown) {
  return typeof v === "number" && Number.isFinite(v) ? v : null;
}

function shortId(id: string) {
  if (id.length <= 10) return id;
  return `${id.slice(0, 6)}…${id.slice(-4)}`;
}

function average(values: number[]) {
  if (!values.length) return 0;
  return values.reduce((sum, value) => sum + value, 0) / values.length;
}

export default function AnalyticsPage() {
  const nav = useNavigate();
  const [events, setEvents] = useState<AnalyticsEvent[]>(() => getEventLog());

  const flows = useMemo(() => {
    const byFlow = groupByFlow(events);
    const rows = Object.entries(byFlow).map(([flowId, flowEvents]) => {
      const flowTaskId = flowEvents.map(getTaskId).find((value): value is string => Boolean(value)) ?? null;
      const has = (name: string) => flowEvents.some((e) => e.event === name);
      const delivered = flowEvents.some((e) => e.event === "copy_clicked" || e.event === "export_clicked");
      const draftEvents = flowEvents.filter((e) => e.event === "draft_generated");
      const userEditCount = flowEvents.filter((e) => e.event === "margin_note_accepted").length;
      const aiWriteCount = draftEvents.length;

      let maxBoardChars = 0;
      let turnsForMaxChars = 0;
      draftEvents.forEach((e) => {
        const record = e as unknown as Record<string, unknown>;
        const chars = safeNumber(record.board_char_count) ?? 0;
        const turns = safeNumber(record.conversation_turn_count) ?? 0;
        if (chars >= maxBoardChars) {
          maxBoardChars = chars;
          turnsForMaxChars = turns;
        }
      });

      const turnsPer100Chars =
        maxBoardChars > 0 && turnsForMaxChars > 0 ? turnsForMaxChars / (maxBoardChars / 100) : null;

      const userEditRate =
        aiWriteCount + userEditCount > 0 ? userEditCount / (aiWriteCount + userEditCount) : null;

      return {
        flowId,
        taskId: flowTaskId,
        sessionId: flowEvents[0]?.session_id ?? "",
        createdAt: flowEvents[0]?.created_at ?? "",
        effective: has("task_created"),
        schemaCompleted: has("schema_completed"),
        draftGenerated: has("draft_generated"),
        delivered,
        turnsPer100Chars,
        userEditRate,
        boardChars: maxBoardChars
      };
    });

    rows.sort((a, b) => (a.createdAt < b.createdAt ? 1 : -1));
    return rows;
  }, [events]);

  const metrics = useMemo(() => {
    const entry = flows.length;
    const effective = flows.filter((s) => s.effective).length;
    const schemaCompleted = flows.filter((s) => s.schemaCompleted).length;
    const draftGenerated = flows.filter((s) => s.draftGenerated).length;
    const delivered = flows.filter((s) => s.delivered).length;

    const turnsPer100Values = flows
      .map((s) => s.turnsPer100Chars)
      .filter((v): v is number => typeof v === "number" && Number.isFinite(v));

    const userEditRateValues = flows
      .map((s) => s.userEditRate)
      .filter((v): v is number => typeof v === "number" && Number.isFinite(v));

    const avgTurnsPer100 = average(turnsPer100Values);
    const avgUserEditRate = average(userEditRateValues);
    const boardRetentionRate = effective ? delivered / effective : 0;

    return {
      entry,
      effective,
      schemaCompleted,
      draftGenerated,
      delivered,
      boardRetentionRate,
      avgTurnsPer100,
      avgUserEditRate
    };
  }, [flows]);

  return (
    <main className="min-h-screen bg-[var(--bg-base)] px-3 py-3 lg:px-4 lg:py-4" aria-label="Analytics 看板页面">
      <div className="mx-auto flex min-h-[calc(100vh-1.5rem)] max-w-[1440px] flex-col rounded-[24px] border border-subtle bg-[rgba(255,255,255,0.82)] shadow-card backdrop-blur">
        <header className="flex h-16 items-center justify-between border-b border-subtle bg-white/86 px-6">
          <div className="flex items-center gap-3">
            <button
              type="button"
              onClick={() => nav("/")}
              aria-label="返回"
              className="flex h-8 w-8 items-center justify-center rounded-[10px] border border-subtle bg-white/80 shadow-soft focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent-strong)] focus-visible:ring-offset-2 focus-visible:ring-offset-[var(--bg-base)]"
            >
              <ArrowLeft className="h-4 w-4 text-secondary" />
            </button>
            <div className="flex flex-col gap-0.5">
              <div className="text-[14px] font-semibold text-primary">Analytics 看板（本地）</div>
              <div className="text-[12px] font-normal text-secondary">用于验证 PRD 指标口径。</div>
            </div>
          </div>

          <div className="flex items-center gap-2.5">
            <button
              type="button"
              onClick={() => setEvents(getEventLog())}
              aria-label="刷新看板数据"
              className="flex items-center gap-2 rounded-[10px] border border-subtle bg-white/80 px-3.5 py-2.5 text-primary shadow-soft transition hover:-translate-y-0.5 hover:bg-[var(--bg-muted)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent-strong)] focus-visible:ring-offset-2 focus-visible:ring-offset-[var(--bg-base)]"
            >
              <RefreshCw className="h-4 w-4 text-secondary" />
              <div className="text-[13px] font-medium">刷新</div>
            </button>
            <button
              type="button"
              onClick={() => {
                const blob = new Blob([JSON.stringify(events, null, 2)], { type: "application/json" });
                const url = URL.createObjectURL(blob);
                const a = document.createElement("a");
                a.href = url;
                a.download = "ai-world-event-log.json";
                a.click();
                URL.revokeObjectURL(url);
              }}
              aria-label="导出事件 JSON"
              className="flex items-center gap-2 rounded-[10px] border border-subtle bg-white/80 px-3.5 py-2.5 text-primary shadow-soft transition hover:-translate-y-0.5 hover:bg-[var(--bg-muted)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent-strong)] focus-visible:ring-offset-2 focus-visible:ring-offset-[var(--bg-base)]"
            >
              <Download className="h-4 w-4 text-secondary" />
              <div className="text-[13px] font-medium">导出 JSON</div>
            </button>
            <button
              type="button"
              onClick={() => {
                if (!window.confirm("确认清空本地 Analytics 事件日志吗？")) return;
                clearEventLog();
                setEvents(getEventLog());
              }}
              aria-label="清空事件日志"
              className="flex items-center gap-2 rounded-[10px] bg-[var(--accent-strong)] px-3.5 py-2.5 text-white shadow-card transition hover:-translate-y-0.5 hover:bg-[var(--accent-strong-hover)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent-strong)] focus-visible:ring-offset-2 focus-visible:ring-offset-[var(--bg-base)]"
            >
              <Trash2 className="h-4 w-4" />
              <div className="text-[13px] font-semibold">清空</div>
            </button>
          </div>
        </header>

        <div className="flex flex-1 flex-col gap-6 p-6">
          <section className="grid grid-cols-2 gap-4 lg:grid-cols-4 2xl:grid-cols-8" aria-label="关键指标">
            {[
              ["任务/会话流数", metrics.entry],
              ["有效流（task_created）", metrics.effective],
              ["完成追问（schema_completed）", metrics.schemaCompleted],
              ["生成稿（draft_generated）", metrics.draftGenerated],
              ["交付（copy/export）", metrics.delivered],
              ["Board 内容留存率", `${Math.round(metrics.boardRetentionRate * 100)}%`],
              ["对话产出比（轮/100字）", metrics.avgTurnsPer100 ? metrics.avgTurnsPer100.toFixed(1) : "-"],
              ["用户编辑率", `${Math.round(metrics.avgUserEditRate * 100)}%`]
            ].map(([label, value]) => (
              <div key={label} className="rounded-2xl border border-subtle bg-white/90 p-4 shadow-soft">
                <div className="text-[12px] font-semibold text-secondary">{label}</div>
                <div className="mt-1 text-[22px] font-bold text-primary">{value as string}</div>
              </div>
            ))}
          </section>

          <section className="rounded-2xl border border-subtle bg-white/90 p-4 shadow-soft" aria-label="漏斗指标">
            <div className="text-[14px] font-semibold text-primary">漏斗（按 flow 去重）</div>
            <div className="mt-3 grid grid-cols-5 gap-3">
              {[
                ["进入", metrics.entry],
                ["创建任务", metrics.effective],
                ["完成追问", metrics.schemaCompleted],
                ["生成稿", metrics.draftGenerated],
                ["交付", metrics.delivered]
              ].map(([label, value]) => (
                <div key={label} className="rounded-xl border border-subtle bg-[var(--bg-muted)] p-3">
                  <div className="text-[12px] font-semibold text-secondary">{label}</div>
                  <div className="mt-1 text-[18px] font-bold text-primary">{value as number}</div>
                </div>
              ))}
            </div>
          </section>

          <section className="rounded-2xl border border-subtle bg-white/90 p-4 shadow-soft" aria-labelledby="recent-sessions-title">
            <div className="flex items-center justify-between">
              <div id="recent-sessions-title" className="text-[14px] font-semibold text-primary">
                最近任务流
              </div>
              <div className="text-[12px] text-muted">共 {flows.length} 个 flow</div>
            </div>

            <div className="mt-3 overflow-hidden rounded-xl border border-subtle">
              <table className="w-full table-fixed text-[12px] text-primary">
                <thead className="bg-[var(--bg-muted)] text-secondary">
                  <tr>
                    <th className="px-3 py-2 text-left font-semibold">时间</th>
                    <th className="px-3 py-2 text-left font-semibold">flow</th>
                    <th className="px-3 py-2 text-left font-semibold">session</th>
                    <th className="px-3 py-2 text-left font-semibold">状态</th>
                    <th className="px-3 py-2 text-left font-semibold">轮/100字</th>
                    <th className="px-3 py-2 text-left font-semibold">用户编辑率</th>
                    <th className="px-3 py-2 text-left font-semibold">白板字数</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-[var(--border-subtle)]">
                  {flows.slice(0, 10).map((s) => (
                    <tr key={s.flowId}>
                      <td className="px-3 py-2 text-secondary">{s.createdAt.slice(0, 19).replace("T", " ")}</td>
                      <td className="px-3 py-2 font-semibold">{shortId(s.taskId ?? s.flowId)}</td>
                      <td className="px-3 py-2 text-secondary">{shortId(s.sessionId)}</td>
                      <td className="px-3 py-2 text-secondary">
                        {s.delivered ? "已交付" : s.draftGenerated ? "已生成" : s.effective ? "已创建" : "—"}
                      </td>
                      <td className="px-3 py-2 font-semibold">
                        {typeof s.turnsPer100Chars === "number" ? s.turnsPer100Chars.toFixed(1) : "—"}
                      </td>
                      <td className="px-3 py-2 font-semibold">
                        {typeof s.userEditRate === "number" ? `${Math.round(s.userEditRate * 100)}%` : "—"}
                      </td>
                      <td className="px-3 py-2 font-semibold">{s.boardChars}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
              {!flows.length ? (
                <div className="px-3 py-6 text-center text-[13px] text-secondary">
                  暂无数据。请先在主流程里创建任务、生成稿、复制/导出。
                </div>
              ) : null}
            </div>
          </section>

          <section className="rounded-2xl border border-subtle bg-white/90 p-4 shadow-soft" aria-labelledby="recent-events-title">
            <div className="flex items-center justify-between">
              <div id="recent-events-title" className="text-[14px] font-semibold text-primary">
                最近事件
              </div>
              <div className="text-[12px] text-muted">最多保留 200 条</div>
            </div>

            <div className="mt-3 overflow-hidden rounded-xl border border-subtle">
              <table className="w-full table-fixed text-[12px] text-primary">
                <thead className="bg-[var(--bg-muted)] text-secondary">
                  <tr>
                    <th className="px-3 py-2 text-left font-semibold">时间</th>
                    <th className="px-3 py-2 text-left font-semibold">事件</th>
                    <th className="px-3 py-2 text-left font-semibold">session</th>
                    <th className="px-3 py-2 text-left font-semibold">task</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-[var(--border-subtle)]">
                  {events
                    .slice()
                    .reverse()
                    .slice(0, 20)
                    .map((e, idx) => (
                      <tr key={`${e.created_at}-${idx}`}>
                        <td className="px-3 py-2 text-secondary">{e.created_at.slice(0, 19).replace("T", " ")}</td>
                        <td className="px-3 py-2 font-semibold">{e.event}</td>
                        <td className="px-3 py-2 text-secondary">{shortId(e.session_id)}</td>
                        <td className="px-3 py-2 text-secondary">
                          {typeof (e as unknown as Record<string, unknown>).task_id === "string"
                            ? shortId((e as unknown as Record<string, unknown>).task_id as string)
                            : "—"}
                        </td>
                      </tr>
                    ))}
                </tbody>
              </table>
              {!events.length ? (
                <div className="px-3 py-6 text-center text-[13px] text-secondary">暂无事件。</div>
              ) : null}
            </div>
          </section>

          <div className="text-[12px] text-muted">
            注意：该看板基于浏览器 localStorage 的事件日志，仅用于 MVP 口径验证。
          </div>
        </div>
      </div>
    </main>
  );
}
