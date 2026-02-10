import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import ChatPane from "./ChatPane";
import type { ChatMessage } from "../types/workspace";

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
  Reflect.deleteProperty(window as Window & { SpeechRecognition?: unknown }, "SpeechRecognition");
  Reflect.deleteProperty(window as Window & { webkitSpeechRecognition?: unknown }, "webkitSpeechRecognition");
});

beforeAll(() => {
  Object.defineProperty(window.HTMLElement.prototype, "scrollIntoView", {
    value: vi.fn(),
    writable: true
  });
});

function assistantMessage(content = "assistant message", overrides: Partial<ChatMessage> = {}): ChatMessage {
  return {
    id: "assistant-1",
    role: "assistant",
    content,
    timestamp: Date.now(),
    ...overrides
  };
}

describe("ChatPane", () => {
  it("renders basic chat UI in empty state", () => {
    render(<ChatPane messages={[]} isAiTyping={false} onSendMessage={vi.fn()} onPinToBoard={vi.fn()} />);

    expect(screen.getByRole("log")).toBeTruthy();
    expect(screen.getByRole("textbox")).toBeTruthy();
  });

  it("sends trimmed message by Enter key", () => {
    const onSendMessage = vi.fn();
    render(<ChatPane messages={[]} isAiTyping={false} onSendMessage={onSendMessage} onPinToBoard={vi.fn()} />);

    const input = screen.getByRole("textbox");
    fireEvent.change(input, { target: { value: "  need a plan  " } });
    fireEvent.keyDown(input, { key: "Enter" });

    expect(onSendMessage).toHaveBeenCalledTimes(1);
    expect(onSendMessage).toHaveBeenCalledWith("need a plan");
  });

  it("does not send on Shift+Enter", () => {
    const onSendMessage = vi.fn();
    render(<ChatPane messages={[]} isAiTyping={false} onSendMessage={onSendMessage} onPinToBoard={vi.fn()} />);

    const input = screen.getByRole("textbox");
    fireEvent.change(input, { target: { value: "line 1" } });
    fireEvent.keyDown(input, { key: "Enter", shiftKey: true });

    expect(onSendMessage).not.toHaveBeenCalled();
  });

  it("does not send while IME composition is active", () => {
    const onSendMessage = vi.fn();
    render(<ChatPane messages={[]} isAiTyping={false} onSendMessage={onSendMessage} onPinToBoard={vi.fn()} />);

    const input = screen.getByRole("textbox");
    fireEvent.change(input, { target: { value: "typing" } });
    fireEvent.compositionStart(input);
    fireEvent.keyDown(input, { key: "Enter" });
    fireEvent.compositionEnd(input);

    expect(onSendMessage).not.toHaveBeenCalled();
  });

  it("supports hint accept and dismiss actions", () => {
    const onHintAccept = vi.fn();
    const onHintDismiss = vi.fn();

    render(
      <ChatPane
        messages={[]}
        isAiTyping={false}
        hint={{
          key: "kickoff",
          reason: "kickoff",
          text: "Ask 3 clarifying questions.",
          actionLabel: "Ask now",
          prompt: "Please ask me"
        }}
        onHintAccept={onHintAccept}
        onHintDismiss={onHintDismiss}
        onSendMessage={vi.fn()}
        onPinToBoard={vi.fn()}
      />
    );

    fireEvent.click(screen.getByText("Ask now"));
    fireEvent.click(screen.getByTestId("hint-dismiss-button"));

    expect(onHintAccept).toHaveBeenCalledTimes(1);
    expect(onHintDismiss).toHaveBeenCalledTimes(1);
  });

  it("pins assistant message to board", () => {
    const onPinToBoard = vi.fn();
    render(
      <ChatPane
        messages={[assistantMessage("Please clarify goals and timeline.")]}
        isAiTyping={false}
        onSendMessage={vi.fn()}
        onPinToBoard={onPinToBoard}
      />
    );

    fireEvent.click(screen.getByTestId("pin-assistant-1"));
    expect(onPinToBoard).toHaveBeenCalledWith("assistant-1");
  });

  it("sends quick option when assistant provides choices", () => {
    const onSendMessage = vi.fn();
    render(
      <ChatPane
        messages={[
          assistantMessage("你更希望哪种方向？\nA. 先给提纲\nB. 先写摘要\nC. 先列风险")
        ]}
        isAiTyping={false}
        onSendMessage={onSendMessage}
        onPinToBoard={vi.fn()}
      />
    );

    fireEvent.click(screen.getByText("A. 先给提纲"));
    expect(onSendMessage).toHaveBeenCalledWith("先给提纲");
  });

  it("prefers structured next_questions options", () => {
    const onSendMessage = vi.fn();
    render(
      <ChatPane
        messages={[
          assistantMessage("下面我给你几个方向。", {
            nextQuestions: [
              {
                question: "你希望先补哪一部分？",
                options: ["目标用户", "关键约束", "交付截止时间"]
              }
            ]
          })
        ]}
        isAiTyping={false}
        onSendMessage={onSendMessage}
        onPinToBoard={vi.fn()}
      />
    );

    fireEvent.click(screen.getByText("A. 目标用户"));
    expect(onSendMessage).toHaveBeenCalledWith("目标用户");
  });

  it("removes duplicated option prefixes in structured options", () => {
    render(
      <ChatPane
        messages={[
          assistantMessage("继续澄清：", {
            nextQuestions: [
              {
                question: "请补充信息",
                options: ["A. 你的目标受众是谁？", "B. 你希望何时完成？"]
              }
            ]
          })
        ]}
        isAiTyping={false}
        onSendMessage={vi.fn()}
        onPinToBoard={vi.fn()}
      />
    );

    expect(screen.getByText("A. 你的目标受众是谁？")).toBeTruthy();
    expect(screen.queryByText(/A\.\s*A\./)).toBeNull();
  });

  it("uses globally increasing labels across multiple structured questions", () => {
    render(
      <ChatPane
        messages={[
          assistantMessage("continue", {
            nextQuestions: [
              {
                question: "first group",
                options: ["A. goal", "B. audience"]
              },
              {
                question: "second group",
                options: ["A. timeline", "B. risk"]
              }
            ]
          })
        ]}
        isAiTyping={false}
        onSendMessage={vi.fn()}
        onPinToBoard={vi.fn()}
      />
    );

    expect(screen.getByText("A. goal")).toBeTruthy();
    expect(screen.getByText("B. audience")).toBeTruthy();
    expect(screen.getByText("C. timeline")).toBeTruthy();
    expect(screen.getByText("D. risk")).toBeTruthy();
  });

  it("renders margin notes for assistant message", () => {
    render(
      <ChatPane
        messages={[
          assistantMessage("这是本轮建议。", {
            marginNotes: [
              {
                comment: "开场白还可以更具体",
                suggestion: "补一句可量化目标"
              }
            ]
          })
        ]}
        isAiTyping={false}
        onSendMessage={vi.fn()}
        onPinToBoard={vi.fn()}
      />
    );

    expect(screen.getByText("批注建议")).toBeTruthy();
    expect(screen.getByText("开场白还可以更具体")).toBeTruthy();
  });

  it("triggers margin note accept and undo callbacks", () => {
    const onAcceptMarginNote = vi.fn();
    const onUndoMarginNoteAccept = vi.fn();

    render(
      <ChatPane
        messages={[
          assistantMessage("建议如下：", {
            marginNotes: [
              {
                comment: "把目标写得更清晰",
                suggestion: "补充量化目标"
              },
              {
                comment: "已处理建议",
                suggestion: "保留结果段",
                accepted: true
              }
            ]
          })
        ]}
        isAiTyping={false}
        onSendMessage={vi.fn()}
        onPinToBoard={vi.fn()}
        onAcceptMarginNote={onAcceptMarginNote}
        onUndoMarginNoteAccept={onUndoMarginNoteAccept}
      />
    );

    fireEvent.click(screen.getByTestId("margin-note-accept-assistant-1-0"));
    fireEvent.click(screen.getByTestId("margin-note-undo-assistant-1-1"));

    expect(onAcceptMarginNote).toHaveBeenCalledWith("assistant-1", 0);
    expect(onUndoMarginNoteAccept).toHaveBeenCalledWith("assistant-1", 1);
  });

  it("supports voice input when SpeechRecognition is available", async () => {
    const startMock = vi.fn();

    class FakeSpeechRecognition {
      static latest: FakeSpeechRecognition | null = null;
      lang = "";
      continuous = false;
      interimResults = false;
      onresult: ((event: { results: ArrayLike<{ 0?: { transcript: string } }> }) => void) | null = null;
      onerror: (() => void) | null = null;
      onend: (() => void) | null = null;
      start = () => {
        startMock();
      };
      stop = vi.fn();
      abort = vi.fn();

      constructor() {
        FakeSpeechRecognition.latest = this;
      }
    }

    Object.defineProperty(window, "SpeechRecognition", {
      value: FakeSpeechRecognition,
      configurable: true,
      writable: true
    });

    render(<ChatPane messages={[]} isAiTyping={false} onSendMessage={vi.fn()} onPinToBoard={vi.fn()} />);
    fireEvent.click(screen.getByLabelText("语音输入"));

    expect(startMock).toHaveBeenCalledTimes(1);

    FakeSpeechRecognition.latest?.onresult?.({
      results: [{ 0: { transcript: "语音内容" } }]
    });

    await waitFor(() => {
      expect((screen.getByRole("textbox") as HTMLTextAreaElement).value).toContain("语音内容");
    });
  });

  it("does not auto-scroll on content-only rerender when not typing", () => {
    const scrollMock = window.HTMLElement.prototype.scrollIntoView as unknown as ReturnType<typeof vi.fn>;
    const baseProps = {
      isAiTyping: false,
      onSendMessage: vi.fn(),
      onPinToBoard: vi.fn()
    };

    const { rerender } = render(<ChatPane {...baseProps} messages={[assistantMessage("initial")]} />);
    expect(scrollMock).toHaveBeenCalledTimes(1);

    rerender(<ChatPane {...baseProps} messages={[assistantMessage("initial + delta")]} />);
    expect(scrollMock).toHaveBeenCalledTimes(1);
  });
});
