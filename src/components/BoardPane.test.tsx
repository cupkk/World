import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import BoardPane from "./BoardPane";

afterEach(() => {
  cleanup();
});

describe("BoardPane", () => {
  it("renders document editor and disabled export actions on empty board", () => {
    render(
      <BoardPane
        sections={[]}
        onSectionsChange={vi.fn()}
        onUndo={vi.fn()}
        onRedo={vi.fn()}
        canUndo={false}
        canRedo={false}
      />
    );

    expect(screen.getByLabelText("白板文档编辑器")).toBeTruthy();
    expect((screen.getByLabelText("复制全部") as HTMLButtonElement).disabled).toBe(true);
    expect((screen.getByLabelText("下载 markdown") as HTMLButtonElement).disabled).toBe(true);
  });

  it("triggers undo/redo callbacks when enabled", () => {
    const onUndo = vi.fn();
    const onRedo = vi.fn();

    render(
      <BoardPane
        sections={[]}
        onSectionsChange={vi.fn()}
        onUndo={onUndo}
        onRedo={onRedo}
        canUndo
        canRedo
      />
    );

    fireEvent.click(screen.getByLabelText("撤销"));
    fireEvent.click(screen.getByLabelText("重做"));

    expect(onUndo).toHaveBeenCalledTimes(1);
    expect(onRedo).toHaveBeenCalledTimes(1);
  });

  it("switches template mode and shows structured table editor", () => {
    const onTemplateTypeChange = vi.fn();
    render(
      <BoardPane
        sections={[
          {
            id: "s1",
            title: "目标",
            content: "初稿",
            source: "ai",
            lastUpdated: Date.now()
          }
        ]}
        templateType="table"
        onTemplateTypeChange={onTemplateTypeChange}
        onSectionsChange={vi.fn()}
        onUndo={vi.fn()}
        onRedo={vi.fn()}
        canUndo={false}
        canRedo={false}
      />
    );

    expect(screen.getByTestId("board-table-editor")).toBeTruthy();

    fireEvent.click(screen.getByLabelText("切换到代码模板"));
    expect(onTemplateTypeChange).toHaveBeenCalledWith("code");
  });

  it("highlights anchor cell within requested section in table mode", async () => {
    render(
      <BoardPane
        sections={[
          {
            id: "s1",
            title: "背景",
            content: "目标用户是学生",
            source: "ai",
            lastUpdated: Date.now()
          },
          {
            id: "s2",
            title: "策略",
            content: "目标用户是白领",
            source: "ai",
            lastUpdated: Date.now()
          }
        ]}
        templateType="table"
        highlightRequest={{ key: "highlight-1", sectionId: "s2", anchorText: "目标用户" }}
        onSectionsChange={vi.fn()}
        onUndo={vi.fn()}
        onRedo={vi.fn()}
        canUndo={false}
        canRedo={false}
      />
    );

    const targetInput = screen.getByLabelText("策略 第 1 行第 1 列") as HTMLInputElement;

    await waitFor(() => {
      expect(document.activeElement).toBe(targetInput);
      expect(targetInput.selectionStart).toBe(0);
      expect(targetInput.selectionEnd).toBe(targetInput.value.length);
    });
  });

  it("parses key-value plain text into populated table columns", () => {
    render(
      <BoardPane
        sections={[
          {
            id: "s1",
            title: "目标澄清",
            content: "维度：用户转化\n现状：注册转化率 12%\n目标：提升到 20%\n动作：优化落地页并增加引导",
            source: "ai",
            lastUpdated: Date.now()
          }
        ]}
        templateType="table"
        onSectionsChange={vi.fn()}
        onUndo={vi.fn()}
        onRedo={vi.fn()}
        canUndo={false}
        canRedo={false}
      />
    );

    expect((screen.getByLabelText("目标澄清 第 1 行第 1 列") as HTMLInputElement).value).toBe("用户转化");
    expect((screen.getByLabelText("目标澄清 第 1 行第 2 列") as HTMLInputElement).value).toBe("注册转化率 12%");
    expect((screen.getByLabelText("目标澄清 第 1 行第 3 列") as HTMLInputElement).value).toBe("提升到 20%");
    expect((screen.getByLabelText("目标澄清 第 1 行第 4 列") as HTMLInputElement).value).toBe("优化落地页并增加引导");
  });

  it("splits generic key-value lines into multiple table rows", () => {
    render(
      <BoardPane
        sections={[
          {
            id: "s1",
            title: "代码方案草案",
            content: "用户需求已澄清：具体任务\n工具名称：DataProcessor",
            source: "ai",
            lastUpdated: Date.now()
          }
        ]}
        templateType="table"
        onSectionsChange={vi.fn()}
        onUndo={vi.fn()}
        onRedo={vi.fn()}
        canUndo={false}
        canRedo={false}
      />
    );

    expect((screen.getByLabelText("代码方案草案 第 1 行第 1 列") as HTMLInputElement).value).toBe("用户需求已澄清");
    expect((screen.getByLabelText("代码方案草案 第 1 行第 2 列") as HTMLInputElement).value).toBe("具体任务");
    expect((screen.getByLabelText("代码方案草案 第 2 行第 1 列") as HTMLInputElement).value).toBe("工具名称");
    expect((screen.getByLabelText("代码方案草案 第 2 行第 2 列") as HTMLInputElement).value).toBe("DataProcessor");
  });
});
