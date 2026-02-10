import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
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

  it("fills input when text quick option is selected", () => {
    const onSendMessage = vi.fn();
    render(
      <ChatPane
        messages={[assistantMessage("Choose one:\nA. Start with outline\nB. Start with summary\nC. Start with risks")]}
        isAiTyping={false}
        onSendMessage={onSendMessage}
        onPinToBoard={vi.fn()}
      />
    );

    fireEvent.click(screen.getByText("A. Start with outline"));

    expect((screen.getByRole("textbox") as HTMLTextAreaElement).value).toContain("Start with outline");
    expect(onSendMessage).not.toHaveBeenCalled();
  });

  it("supports grouped structured answers and batch send", () => {
    const onSendMessage = vi.fn();
    render(
      <ChatPane
        messages={[
          assistantMessage("Let's clarify in groups.", {
            nextQuestions: [
              {
                question: "What is your primary goal?",
                options: ["Improve conversion", "Reduce support workload", "Validate a new idea"]
              },
              {
                question: "What deliverable do you need first?",
                options: ["Plan document", "Prototype draft", "Milestone checklist"]
              }
            ]
          })
        ]}
        isAiTyping={false}
        onSendMessage={onSendMessage}
        onPinToBoard={vi.fn()}
      />
    );

    fireEvent.click(screen.getByText("A. Improve conversion"));
    fireEvent.click(screen.getByText("A. Plan document"));
    fireEvent.click(screen.getByRole("button", { name: "一键发送回答" }));

    expect(onSendMessage).toHaveBeenCalledTimes(1);
    const payload = String(onSendMessage.mock.calls[0]?.[0] ?? "");
    expect(payload).toContain("What is your primary goal?");
    expect(payload).toContain("Improve conversion");
    expect(payload).toContain("What deliverable do you need first?");
    expect(payload).toContain("Plan document");
  });

  it("removes duplicated option prefixes in structured options", () => {
    render(
      <ChatPane
        messages={[
          assistantMessage("continue", {
            nextQuestions: [
              {
                question: "Please complete this:",
                options: ["A. Who is the target audience?", "B. What is the timeline?"]
              }
            ]
          })
        ]}
        isAiTyping={false}
        onSendMessage={vi.fn()}
        onPinToBoard={vi.fn()}
      />
    );

    expect(screen.getByText("A. Who is the target audience?")).toBeTruthy();
    expect(screen.queryByText(/A\.\s*A\./)).toBeNull();
  });

  it("restarts option labels per question group", () => {
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
    expect(screen.getByText("A. timeline")).toBeTruthy();
    expect(screen.getByText("B. risk")).toBeTruthy();
  });

  it("falls back to parsing assistant text when structured options are placeholder letters only", () => {
    render(
      <ChatPane
        messages={[
          assistantMessage(
            "1. What is the expected output?\nA. Plan document\nB. Decision memo\nC. Concept draft\nD. Other",
            {
              nextQuestions: [
                {
                  question: "What is the expected output?",
                  options: ["A", "B", "C", "D"]
                }
              ]
            }
          )
        ]}
        isAiTyping={false}
        onSendMessage={vi.fn()}
        onPinToBoard={vi.fn()}
      />
    );

    expect(screen.getByText("A. Plan document")).toBeTruthy();
    expect(screen.getByText("B. Decision memo")).toBeTruthy();
    expect(screen.queryByText("A. A")).toBeNull();
  });

  it("uses message parsed question groups when structured data only contains first question", () => {
    render(
      <ChatPane
        messages={[
          assistantMessage(
            "1. What should be the focus?\nA. Keep current scope\nB. Add one advanced module\n2. What deliverable do you prefer?\nA. Weekly checklist\nB. Learning roadmap",
            {
              nextQuestions: [
                {
                  question: "What should be the focus?",
                  options: ["A. Keep current scope"]
                }
              ]
            }
          )
        ]}
        isAiTyping={false}
        onSendMessage={vi.fn()}
        onPinToBoard={vi.fn()}
      />
    );

    expect(screen.getByText(/已选择 0\/2/)).toBeTruthy();
    expect(screen.getByText("A. Keep current scope")).toBeTruthy();
    expect(screen.getByText("B. Add one advanced module")).toBeTruthy();
    expect(screen.getByText("A. Weekly checklist")).toBeTruthy();
    expect(screen.getByText("B. Learning roadmap")).toBeTruthy();
  });

  it("builds options for each numbered question when message includes a summary option block", () => {
    render(
      <ChatPane
        messages={[
          assistantMessage(
            "好的，我先问三个关键问题来帮你澄清目标。\n1. 你希望解决什么问题或达成什么目标？\n2. 这个项目或任务的主要受众是谁？\n3. 你期望的输出形式是什么（例如文档、计划、代码等）？\n你可参考以下选项回答：\n1. 请回答以上问题，以便我更好地协助你。\nA. 解决一个具体业务问题\nB. 制定个人学习计划\nC. 设计一个产品原型\nD. 其他（请补充）",
            {
              nextQuestions: [
                {
                  question: "请回答以上问题，以便我更好地协助你。",
                  options: ["A. 解决一个具体业务问题"]
                }
              ]
            }
          )
        ]}
        isAiTyping={false}
        onSendMessage={vi.fn()}
        onPinToBoard={vi.fn()}
      />
    );

    const panel = screen.getByLabelText("分问题回答面板");
    const panelScope = within(panel);
    expect(panelScope.getByText(/已选择 0\/3/)).toBeTruthy();
    expect(panelScope.getByText(/1\. 你希望解决什么问题或达成什么目标/)).toBeTruthy();
    expect(panelScope.getByText(/2\. 这个项目或任务的主要受众是谁/)).toBeTruthy();
    expect(panelScope.getByText(/3\. 你期望的输出形式是什么/)).toBeTruthy();
    expect(panelScope.getByText("A. 提升业务指标")).toBeTruthy();
    expect(panelScope.getByText("A. B端企业角色")).toBeTruthy();
    expect(panelScope.getByText("A. 文档方案")).toBeTruthy();
  });

  it("renders margin notes for assistant message", () => {
    render(
      <ChatPane
        messages={[
          assistantMessage("Suggestions", {
            marginNotes: [
              {
                comment: "Make the opening paragraph more specific",
                suggestion: "Add one measurable target"
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
    expect(screen.getByText("Make the opening paragraph more specific")).toBeTruthy();
  });

  it("triggers margin note accept and undo callbacks", () => {
    const onAcceptMarginNote = vi.fn();
    const onUndoMarginNoteAccept = vi.fn();

    render(
      <ChatPane
        messages={[
          assistantMessage("Suggestions", {
            marginNotes: [
              {
                comment: "Clarify target",
                suggestion: "Add measurable KPI"
              },
              {
                comment: "Already applied",
                suggestion: "Keep current version",
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
      results: [{ 0: { transcript: "voice draft" } }]
    });

    await waitFor(() => {
      expect((screen.getByRole("textbox") as HTMLTextAreaElement).value).toContain("voice draft");
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
