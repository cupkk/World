import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import ExportPage from "./Export";
import DualPaneWorkspace from "./Workspace";

const runAgentStreamMock = vi.fn();
const runAgentMock = vi.fn();
const trackMock = vi.fn();

vi.mock("../ai/agentClient", () => ({
  runAgentStream: (...args: unknown[]) => runAgentStreamMock(...args),
  runAgent: (...args: unknown[]) => runAgentMock(...args)
}));

vi.mock("../analytics", () => ({
  track: (...args: unknown[]) => trackMock(...args)
}));

vi.mock("../components/boardPaneLoader", () => ({
  loadBoardPane: () =>
    Promise.resolve({
      default: ({
        sections,
        onUndo
      }: {
        sections: Array<{ id: string; title: string; content: string }>;
        onUndo: () => void;
      }) => (
        <div>
          <div data-testid="mock-board-count">{sections.length}</div>
          <div data-testid="mock-board-content">{sections.map((section) => section.content).join("\n")}</div>
          <button type="button" onClick={onUndo} aria-label="mock-board-undo">
            undo
          </button>
        </div>
      )
    })
}));

function renderWorkspace(url = "/canvas?task_id=task-e2e&new=1") {
  return render(
    <MemoryRouter initialEntries={[url]}>
      <Routes>
        <Route path="/canvas" element={<DualPaneWorkspace />} />
      </Routes>
    </MemoryRouter>
  );
}

describe("Workspace key path e2e", () => {
  beforeEach(() => {
    localStorage.clear();
    runAgentStreamMock.mockReset();
    runAgentMock.mockReset();
    trackMock.mockReset();
    Object.defineProperty(window, "innerWidth", { configurable: true, value: 1280 });
    window.dispatchEvent(new Event("resize"));
    Object.defineProperty(window.HTMLElement.prototype, "scrollIntoView", {
      value: vi.fn(),
      writable: true
    });
    Object.defineProperty(navigator, "clipboard", {
      value: { writeText: vi.fn().mockResolvedValue(undefined) },
      configurable: true
    });
  });

  afterEach(() => {
    cleanup();
    vi.clearAllMocks();
  });

  it("supports send -> stream -> board write -> margin note accept/undo -> export", async () => {
    runAgentStreamMock.mockImplementation(async (_request, callbacks) => {
      callbacks?.onAssistantDelta?.("这是");
      callbacks?.onAssistantDelta?.("流式回复");
      return {
        assistant_message: "这是流式回复",
        board_actions: [
          {
            action: "create_structure",
            section_id: "sec-1",
            section_title: "目标",
            content: "初稿内容"
          }
        ],
        margin_notes: [
          {
            anchor: "sec-1",
            comment: "建议补充数据依据",
            suggestion: "补充数据依据",
            dimension: "logic"
          }
        ]
      };
    });

    renderWorkspace();

    const input = await screen.findByLabelText("输入消息");
    fireEvent.change(input, { target: { value: "请帮我起草方案" } });
    fireEvent.keyDown(input, { key: "Enter" });

    await waitFor(() => {
      expect(screen.getByText("这是流式回复")).toBeTruthy();
      expect(screen.getByTestId("mock-board-content").textContent).toContain("初稿内容");
    });

    fireEvent.click(screen.getByRole("button", { name: "采纳批注 1" }));

    await waitFor(() => {
      expect(screen.getByTestId("mock-board-content").textContent).toContain("补充数据依据");
    });

    expect(trackMock).toHaveBeenCalledWith(
      "margin_note_accepted",
      expect.objectContaining({
        task_id: "task-e2e",
        source: "margin_note_button",
        note_dimension: "logic"
      })
    );

    fireEvent.click(screen.getByRole("button", { name: "撤销采纳批注 1" }));

    await waitFor(() => {
      expect(screen.getByTestId("mock-board-content").textContent).not.toContain("补充数据依据");
    });

    await waitFor(
      () => {
        const snapshot = localStorage.getItem("ai-world-workspace-v2") ?? "";
        expect(snapshot).toContain("初稿内容");
      },
      { timeout: 2500 }
    );

    cleanup();

    render(
      <MemoryRouter initialEntries={["/export"]}>
        <Routes>
          <Route path="/export" element={<ExportPage />} />
        </Routes>
      </MemoryRouter>
    );

    fireEvent.click(screen.getAllByLabelText("复制文本")[0] as HTMLButtonElement);

    await waitFor(() => {
      const writeText = navigator.clipboard.writeText as ReturnType<typeof vi.fn>;
      expect(writeText).toHaveBeenCalledTimes(1);
      expect(String(writeText.mock.calls[0]?.[0])).toContain("初稿内容");
    });
  });

  it("supports keyboard panel focus shortcuts", async () => {
    runAgentStreamMock.mockResolvedValue({
      assistant_message: "ok",
      board_actions: []
    });

    renderWorkspace("/canvas?task_id=task-focus&new=1");

    const chatHeading = await screen.findByText("对话区");
    const boardHeading = await screen.findByText("白板文档");

    fireEvent.keyDown(window, { key: "1", altKey: true });
    await waitFor(() => expect(document.activeElement).toBe(chatHeading));

    fireEvent.keyDown(window, { key: "2", altKey: true });
    await waitFor(() => expect(document.activeElement).toBe(boardHeading));
  });
});
