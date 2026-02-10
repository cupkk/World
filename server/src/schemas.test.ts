import assert from "node:assert/strict";
import test from "node:test";
import { createAgentRequestSchema } from "./requestSchemas";
import { AgentRunResponseSchema } from "./schemas";

const requestSchema = createAgentRequestSchema({
  maxMessages: 5,
  maxMessageChars: 50,
  maxBoardSections: 5,
  maxSectionTitleChars: 20,
  maxSectionContentChars: 100
});

test("request schema validates normal payload", () => {
  const result = requestSchema.safeParse({
    session_id: "session-a",
    messages: [{ role: "user", content: "hello" }],
    board_sections: [{ id: "s1", title: "T1", content: "C1" }]
  });
  assert.equal(result.success, true);
});

test("request schema rejects too many messages", () => {
  const messages = new Array(6).fill(0).map(() => ({ role: "user", content: "x" }));
  const result = requestSchema.safeParse({
    session_id: "session-b",
    messages,
    board_sections: []
  });
  assert.equal(result.success, false);
});

test("response schema enforces board action invariants", () => {
  const invalid = AgentRunResponseSchema.safeParse({
    assistant_message: "ok",
    board_actions: [{ action: "append_section", section_title: "S", content: "   " }]
  });
  assert.equal(invalid.success, false);

  const valid = AgentRunResponseSchema.safeParse({
    assistant_message: "ok",
    board_actions: [{ action: "append_section", section_title: "S", content: "value" }],
    next_questions: [{ question: "需要补充目标用户吗？", options: ["是", "否"] }],
    rubric: {
      total: 76,
      dimensions: {
        clarity: { score: 78, reason: "结构清晰" }
      }
    },
    margin_notes: [{ comment: "建议补充数据依据", suggestion: "增加一段数据来源说明" }]
  });
  assert.equal(valid.success, true);

  const invalidRubric = AgentRunResponseSchema.safeParse({
    assistant_message: "ok",
    board_actions: [],
    rubric: {
      total: 120
    }
  });
  assert.equal(invalidRubric.success, false);
});
