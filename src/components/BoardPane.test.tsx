import { cleanup, fireEvent, render, screen } from "@testing-library/react";
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
});
