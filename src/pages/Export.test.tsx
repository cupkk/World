import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { MemoryRouter } from "react-router-dom";
import ExportPage from "./Export";

const STORAGE_KEY = "ai-world-workspace-v2";

vi.mock("../analytics", () => ({
  track: vi.fn()
}));

function seedWorkspace(hasContent: boolean) {
  const payload = {
    sessionId: "session-export-1",
    boardSections: hasContent
      ? [
          {
            id: "s-1",
            title: "目标",
            content: "完成导出测试",
            source: "ai",
            lastUpdated: Date.now()
          }
        ]
      : []
  };
  localStorage.setItem(STORAGE_KEY, JSON.stringify(payload));
}

describe("ExportPage", () => {
  function getFirstButtonByLabel(label: string) {
    return screen.getAllByLabelText(label)[0] as HTMLButtonElement;
  }

  beforeEach(() => {
    localStorage.clear();
    const writeText = vi.fn().mockResolvedValue(undefined);
    Object.defineProperty(navigator, "clipboard", {
      value: { writeText },
      configurable: true
    });
  });

  afterEach(() => {
    cleanup();
    vi.clearAllMocks();
  });

  it("shows empty-state export when board has no content", () => {
    seedWorkspace(false);

    render(
      <MemoryRouter>
        <ExportPage />
      </MemoryRouter>
    );

    expect(screen.getAllByText("白板内容为空").length).toBeGreaterThan(0);
    expect(getFirstButtonByLabel("复制文本").disabled).toBe(true);
    expect(getFirstButtonByLabel("导出图片").disabled).toBe(true);
    expect(getFirstButtonByLabel("导出 PDF").disabled).toBe(true);
  });

  it("copies text content with action button", async () => {
    seedWorkspace(true);

    render(
      <MemoryRouter>
        <ExportPage />
      </MemoryRouter>
    );

    fireEvent.click(getFirstButtonByLabel("复制文本"));

    await waitFor(() => {
      const writeText = navigator.clipboard.writeText as ReturnType<typeof vi.fn>;
      expect(writeText).toHaveBeenCalledTimes(1);
      expect(String(writeText.mock.calls[0]?.[0])).toContain("完成导出测试");
    });

    expect(screen.getByText("已复制到剪贴板。")).toBeTruthy();
  });

  it("supports Ctrl+Enter shortcut after selecting text format", async () => {
    seedWorkspace(true);

    render(
      <MemoryRouter>
        <ExportPage />
      </MemoryRouter>
    );

    fireEvent.click(getFirstButtonByLabel("选择格式：文本"));
    fireEvent.keyDown(window, { key: "Enter", ctrlKey: true });

    await waitFor(() => {
      const writeText = navigator.clipboard.writeText as ReturnType<typeof vi.fn>;
      expect(writeText).toHaveBeenCalledTimes(1);
    });
  });
});
