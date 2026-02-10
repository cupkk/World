import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { MemoryRouter, Route, Routes } from "react-router-dom";
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

function renderWorkspace(url = "/canvas?task_id=task-table-e2e&new=1") {
  return render(
    <MemoryRouter initialEntries={[url]}>
      <Routes>
        <Route path="/canvas" element={<DualPaneWorkspace />} />
      </Routes>
    </MemoryRouter>
  );
}

describe("Workspace adaptive table e2e", () => {
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
  });

  afterEach(() => {
    cleanup();
    vi.clearAllMocks();
  });

  it("renders structured table mode from stream preview and persists manual cell edits", async () => {
    runAgentStreamMock.mockImplementation(async (_request, callbacks) => {
      callbacks?.onBoardActionsPreview?.([
        { action: "set_template", template_type: "table" },
        {
          action: "create_structure",
          section_id: "sec-1",
          section_title: "SWOT",
          content: "| 角色 | 目标 |\n| --- | --- |\n| 学生 | 提升留存 |"
        }
      ]);
      await new Promise((resolve) => setTimeout(resolve, 20));
      callbacks?.onAssistantDelta?.("先给你");
      callbacks?.onAssistantDelta?.("一个表格草稿");
      return {
        assistant_message: "先给你一个表格草稿",
        board_actions: [
          { action: "set_template", template_type: "table" },
          {
            action: "update_section",
            section_id: "sec-1",
            section_title: "SWOT",
            content: "| 角色 | 目标 |\n| --- | --- |\n| 白领 | 提升留存 |"
          }
        ]
      };
    });

    renderWorkspace();

    const input = await screen.findByLabelText("输入消息");
    fireEvent.change(input, { target: { value: "帮我做一个swot" } });
    fireEvent.keyDown(input, { key: "Enter" });

    await waitFor(() => {
      expect(screen.getByTestId("board-table-editor")).toBeTruthy();
      const previewCell = screen.getByLabelText("SWOT 第 1 行第 1 列") as HTMLInputElement;
      expect(["学生", "白领"]).toContain(previewCell.value);
    });

    await waitFor(() => {
      const finalCell = screen.getByLabelText("SWOT 第 1 行第 1 列") as HTMLInputElement;
      expect(finalCell.value).toBe("白领");
    });

    const editableCell = screen.getByLabelText("SWOT 第 1 行第 1 列") as HTMLInputElement;
    fireEvent.change(editableCell, { target: { value: "企业客户" } });

    await waitFor(
      () => {
        const snapshot = localStorage.getItem("ai-world-workspace-v2") ?? "";
        expect(snapshot).toContain("企业客户");
      },
      { timeout: 2500 }
    );
  });
});
