import assert from "node:assert/strict";
import test from "node:test";
import type { AgentRunRequest } from "./agentProtocol";
import { buildAgentUserPrompt, preparePromptContext } from "./agentPrompt";

const baseReq: AgentRunRequest = {
  session_id: "session-1",
  messages: [
    { role: "user", content: "m1" },
    { role: "assistant", content: "m2" },
    { role: "user", content: "m3" },
    { role: "assistant", content: "m4" }
  ],
  board_sections: [
    { id: "s1", title: "A", content: "content-A" },
    { id: "s2", title: "B", content: "content-B" },
    { id: "s3", title: "C", content: "content-C" }
  ]
};

test("preparePromptContext keeps only recent messages/sections", () => {
  const ctx = preparePromptContext(baseReq, {
    maxMessages: 2,
    maxMessageChars: 100,
    maxBoardSections: 2,
    maxSectionChars: 100
  });

  assert.equal(ctx.messages.length, 2);
  assert.equal(ctx.messages[0]?.content, "m3");
  assert.equal(ctx.messages[1]?.content, "m4");

  assert.equal(ctx.boardSections.length, 2);
  assert.equal(ctx.boardSections[0]?.title, "B");
  assert.equal(ctx.boardSections[1]?.title, "C");
});

test("buildAgentUserPrompt truncates long values", () => {
  const req: AgentRunRequest = {
    session_id: "session-2",
    messages: [{ role: "user", content: "x".repeat(50) }],
    board_sections: [{ id: "s1", title: "Long", content: "y".repeat(50) }]
  };

  const prompt = buildAgentUserPrompt(req, {
    maxMessages: 1,
    maxMessageChars: 20,
    maxBoardSections: 1,
    maxSectionChars: 20
  });

  assert.match(prompt, /\[truncated\]/);
});
