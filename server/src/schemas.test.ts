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
    board_sections: [{ id: "s1", title: "T1", content: "C1" }],
    board_template: "document"
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
    board_actions: [
      { action: "set_template", template_type: "table" },
      { action: "append_section", section_title: "S", content: "value" }
    ],
    next_questions: [{ question: "Need more target audience details?", options: ["yes", "no"] }],
    margin_notes: [{ comment: "Add supporting data", suggestion: "Add one data source paragraph" }]
  });
  assert.equal(valid.success, true);

  const invalidTemplateSwitch = AgentRunResponseSchema.safeParse({
    assistant_message: "ok",
    board_actions: [{ action: "set_template" }]
  });
  assert.equal(invalidTemplateSwitch.success, false);
});

