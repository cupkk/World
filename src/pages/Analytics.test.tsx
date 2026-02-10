import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { MemoryRouter } from "react-router-dom";
import AnalyticsPage from "./Analytics";
import type { AnalyticsEvent } from "../analytics";

const EVENT_LOG_KEY = "ai-world-event-log-v1";

function event(
  overrides: Partial<AnalyticsEvent> & Pick<AnalyticsEvent, "event" | "session_id">
): AnalyticsEvent {
  const { event: name, session_id, ...rest } = overrides;
  return {
    event: name,
    session_id,
    anonymous_id: "anon-1",
    created_at: overrides.created_at ?? new Date().toISOString(),
    ...rest
  };
}

function seedEvents(events: AnalyticsEvent[]) {
  localStorage.setItem(EVENT_LOG_KEY, JSON.stringify(events));
}

describe("AnalyticsPage", () => {
  function getMetricValue(label: string) {
    const labelNode = screen.getByText(label);
    const card = labelNode.closest("div.rounded-2xl");
    if (!card) return "";
    const valueNode = card.querySelector("div.mt-1");
    return valueNode?.textContent?.trim() ?? "";
  }

  beforeEach(() => {
    localStorage.clear();
    vi.restoreAllMocks();
  });

  afterEach(() => {
    cleanup();
  });

  it("renders KPI cards and session summary", () => {
    seedEvents([
      event({ event: "task_created", session_id: "session-a", task_id: "task-a" }),
      event({ event: "schema_completed", session_id: "session-a", task_id: "task-a" }),
      event({
        event: "draft_generated",
        session_id: "session-a",
        task_id: "task-a",
        board_char_count: 200,
        conversation_turn_count: 4
      }),
      event({ event: "margin_note_accepted", session_id: "session-a", task_id: "task-a" }),
      event({ event: "copy_clicked", session_id: "session-a", task_id: "task-a" }),
      event({ event: "entry_viewed", session_id: "session-b", page: "canvas" })
    ]);

    render(
      <MemoryRouter>
        <AnalyticsPage />
      </MemoryRouter>
    );

    expect(getMetricValue("任务/会话流数")).toBe("2");
    expect(getMetricValue("有效流（task_created）")).toBe("1");
    expect(getMetricValue("Board 内容留存率")).toBe("100%");
    expect(screen.getByText("共 2 个 flow")).toBeTruthy();
  });

  it("refreshes data from localStorage", async () => {
    seedEvents([]);

    render(
      <MemoryRouter>
        <AnalyticsPage />
      </MemoryRouter>
    );

    expect(screen.getByText("暂无数据。请先在主流程里创建任务、生成稿、复制/导出。")).toBeTruthy();

    seedEvents([event({ event: "task_created", session_id: "session-new", task_id: "task-new" })]);
    fireEvent.click(screen.getByLabelText("刷新看板数据"));

    await waitFor(() => {
      expect(screen.getByText("共 1 个 flow")).toBeTruthy();
    });
  });

  it("clears event log after confirmation", async () => {
    seedEvents([event({ event: "entry_viewed", session_id: "session-x", page: "canvas" })]);
    const confirmSpy = vi.spyOn(window, "confirm").mockReturnValue(true);

    render(
      <MemoryRouter>
        <AnalyticsPage />
      </MemoryRouter>
    );

    fireEvent.click(screen.getByLabelText("清空事件日志"));

    await waitFor(() => {
      expect(confirmSpy).toHaveBeenCalledTimes(1);
      expect(screen.getByText("暂无事件。")).toBeTruthy();
    });
  });
});
