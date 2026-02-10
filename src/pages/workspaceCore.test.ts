// @vitest-environment jsdom
import { describe, expect, it } from "vitest";
import type { BoardContent, BoardSection, ChatMessage, WorkspaceState } from "../types/workspace";
import {
  UNDO_STACK_LIMIT,
  applyBoardActions,
  buildHintCandidate,
  defaultWorkspaceState,
  normalizeAgentError,
  pushUndoSnapshot,
  resolveBoardTemplateTypeFromActions,
  syncDocumentTitle
} from "./workspaceCore";

function buildState(overrides: Partial<WorkspaceState> = {}): WorkspaceState {
  return {
    ...defaultWorkspaceState({ taskId: "session-test" }),
    ...overrides
  };
}

function userMessage(id: string, content: string): ChatMessage {
  return {
    id,
    role: "user",
    content,
    timestamp: Date.now()
  };
}

describe("buildHintCandidate", () => {
  it("returns kickoff hint when no user input yet", () => {
    const hint = buildHintCandidate(buildState());
    expect(hint?.reason).toBe("kickoff");
  });

  it("returns short_answer hint for short user content", () => {
    const hint = buildHintCandidate(
      buildState({
        chatMessages: [userMessage("u1", "好的")]
      })
    );
    expect(hint?.reason).toBe("short_answer");
  });

  it("returns missing_context hint when board content is still sparse", () => {
    const hint = buildHintCandidate(
      buildState({
        chatMessages: [userMessage("u1", "我需要做一个用户留存方案"), userMessage("u2", "目标是下季度提升到40%")],
        boardSections: [
          {
            id: "s1",
            title: "草稿",
            content: "留存方案",
            source: "ai",
            lastUpdated: Date.now()
          }
        ]
      })
    );
    expect(hint?.reason).toBe("missing_context");
  });

  it("returns null when board already has enough accumulated context", () => {
    const hint = buildHintCandidate(
      buildState({
        chatMessages: [userMessage("u1", "我需要做一个用户留存方案"), userMessage("u2", "目标是下季度提升到40%")],
        boardSections: [
          {
            id: "s1",
            title: "草稿",
            content: "x".repeat(120),
            source: "ai",
            lastUpdated: Date.now()
          }
        ]
      })
    );
    expect(hint).toBeNull();
  });
});

describe("pushUndoSnapshot", () => {
  it("deduplicates snapshots by rawMarkdown", () => {
    const snapshot: BoardContent = { sections: [], rawMarkdown: "same" };
    const stack = [snapshot];
    const next = pushUndoSnapshot(stack, { sections: [], rawMarkdown: "same" });
    expect(next).toBe(stack);
  });

  it("caps the undo stack length", () => {
    let stack: BoardContent[] = [];
    const total = UNDO_STACK_LIMIT + 5;
    for (let i = 0; i < total; i += 1) {
      stack = pushUndoSnapshot(stack, { sections: [], rawMarkdown: `snapshot-${i}` });
    }

    expect(stack).toHaveLength(UNDO_STACK_LIMIT);
    expect(stack[0]?.rawMarkdown).toBe(`snapshot-${total - UNDO_STACK_LIMIT}`);
    expect(stack[stack.length - 1]?.rawMarkdown).toBe(`snapshot-${total - 1}`);
  });
});

describe("normalizeAgentError", () => {
  it("maps timeout-like network errors to timeout", () => {
    const result = normalizeAgentError({ kind: "network", message: "Request timed out after 30s" });
    expect(result.type).toBe("timeout");
  });

  it("maps parse errors to parse type", () => {
    const result = normalizeAgentError({ kind: "parse", message: "invalid json" });
    expect(result.type).toBe("parse");
  });

  it("uses explicit server message when provided", () => {
    const result = normalizeAgentError({ kind: "server", status: 500, message: "backend failed" });
    expect(result).toEqual({ type: "api_error", message: "backend failed" });
  });

  it("maps 429 server errors without message to rate-limit message", () => {
    const result = normalizeAgentError({ kind: "server", status: 429, message: "" });
    expect(result).toEqual({ type: "api_error", message: "请求过于频繁，请稍后重试。" });
  });

  it("falls back for unknown errors", () => {
    const result = normalizeAgentError(undefined);
    expect(result.type).toBe("api_error");
    expect(result.message).toContain("AI 服务");
  });
});

describe("applyBoardActions", () => {
  function section(overrides: Partial<BoardSection> = {}): BoardSection {
    return {
      id: "sec-1",
      title: "目标",
      content: "初始内容",
      source: "ai",
      lastUpdated: Date.now(),
      ...overrides
    };
  }

  it("returns unchanged when no actions provided", () => {
    const initial = [section()];
    const result = applyBoardActions(initial, []);
    expect(result.didChange).toBe(false);
    expect(result.sections).toBe(initial);
  });

  it("creates missing section for create_structure action", () => {
    const result = applyBoardActions([], [
      { action: "create_structure", section_id: "sec-a", section_title: "行动", content: "待补充" }
    ]);

    expect(result.didChange).toBe(true);
    expect(result.sections).toHaveLength(1);
    expect(result.sections[0]).toMatchObject({ id: "sec-a", title: "行动", content: "待补充", source: "ai" });
  });

  it("updates existing section by id", () => {
    const result = applyBoardActions([section({ id: "sec-1" })], [
      { action: "update_section", section_id: "sec-1", content: "已更新" }
    ]);

    expect(result.didChange).toBe(true);
    expect(result.sections[0]?.content).toBe("已更新");
    expect(result.sections[0]?.source).toBe("ai");
  });

  it("updates existing section by title with extra spaces", () => {
    const result = applyBoardActions([section({ id: "sec-1", title: "目标读者" })], [
      { action: "update_section", section_title: "  目标读者  ", content: "技术管理者" }
    ]);

    expect(result.sections).toHaveLength(1);
    expect(result.sections[0]?.content).toBe("技术管理者");
  });

  it("appends plain text to existing section", () => {
    const result = applyBoardActions([section({ content: "第一行" })], [
      { action: "append_section", section_id: "sec-1", content: "第二行" }
    ]);

    expect(result.didChange).toBe(true);
    expect(result.sections[0]?.content).toBe("第一行\n第二行");
  });

  it("clears target section content", () => {
    const result = applyBoardActions([section({ content: "需要清空" })], [{ action: "clear_section", section_id: "sec-1" }]);
    expect(result.didChange).toBe(true);
    expect(result.sections[0]?.content).toBe("");
  });

  it("allows update_section to overwrite user-authored content", () => {
    const result = applyBoardActions(
      [section({ content: "user baseline", source: "user" })],
      [{ action: "update_section", section_id: "sec-1", content: "ai suggestion" }]
    );

    expect(result.didChange).toBe(true);
    expect(result.sections[0]?.source).toBe("ai");
    expect(result.sections[0]?.content).toBe("ai suggestion");
  });

  it("allows clear_section for user-authored section", () => {
    const result = applyBoardActions(
      [section({ content: "cannot clear me", source: "user" })],
      [{ action: "clear_section", section_id: "sec-1" }]
    );

    expect(result.didChange).toBe(true);
    expect(result.sections[0]?.content).toBe("");
    expect(result.sections[0]?.source).toBe("ai");
  });

  it("deduplicates repeated append content", () => {
    const result = applyBoardActions(
      [section({ content: "line one\nline two" })],
      [{ action: "append_section", section_id: "sec-1", content: "line two" }]
    );

    expect(result.didChange).toBe(false);
    expect(result.sections[0]?.content).toBe("line one\nline two");
  });

  it("deduplicates append content by plain text when existing content is html", () => {
    const result = applyBoardActions(
      [section({ content: "<p>目标读者是技术爱好者。</p>" })],
      [{ action: "append_section", section_id: "sec-1", content: "目标读者是技术爱好者。" }]
    );

    expect(result.didChange).toBe(false);
    expect(result.sections[0]?.content).toBe("<p>目标读者是技术爱好者。</p>");
  });

  it("sanitizes unsafe html in actions", () => {
    const unsafe = `<p>hello</p><script>alert("x")</script><a href="javascript:alert(1)" onclick="evil()">x</a>`;
    const result = applyBoardActions([], [
      { action: "create_structure", section_id: "sec-1", section_title: "结构", content: unsafe }
    ]);

    const content = result.sections[0]?.content ?? "";
    expect(content).not.toContain("<script");
    expect(content).not.toContain("javascript:");
    expect(content).not.toContain("onclick");
    expect(content).toContain("hello");
  });

  it("ignores set_template action when mutating sections", () => {
    const result = applyBoardActions([section()], [{ action: "set_template", template_type: "code" }]);
    expect(result.didChange).toBe(false);
    expect(result.sections[0]?.content).toBe("初始内容");
  });
});

describe("resolveBoardTemplateTypeFromActions", () => {
  it("keeps current template when no switch action exists", () => {
    const next = resolveBoardTemplateTypeFromActions("document", [
      { action: "append_section", section_title: "A", content: "B" }
    ]);
    expect(next).toBe("document");
  });

  it("applies last set_template action in a batch", () => {
    const next = resolveBoardTemplateTypeFromActions("document", [
      { action: "set_template", template_type: "table" },
      { action: "set_template", template_type: "code" }
    ]);
    expect(next).toBe("code");
  });
});

describe("syncDocumentTitle", () => {
  it("promotes first meaningful section title when document title is placeholder", () => {
    const now = Date.now();
    const result = syncDocumentTitle([
      { id: "s1", title: "未命名标题", content: "<p>intro</p>", source: "user", lastUpdated: now },
      { id: "s2", title: "论文主题", content: "<p>内容</p>", source: "ai", lastUpdated: now }
    ]);

    expect(result[0]?.title).toBe("论文主题");
  });
});

