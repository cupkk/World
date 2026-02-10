import assert from "node:assert/strict";
import test from "node:test";
import { extractAssistantMessageFromJsonPrefix } from "./streaming";

test("extractAssistantMessageFromJsonPrefix parses complete JSON message", () => {
  const input = `{"assistant_message":"你好，先澄清目标。","board_actions":[]}`;
  assert.equal(extractAssistantMessageFromJsonPrefix(input), "你好，先澄清目标。");
});

test("extractAssistantMessageFromJsonPrefix parses partial JSON prefix", () => {
  const input = `{"assistant_message":"你好，先`;
  assert.equal(extractAssistantMessageFromJsonPrefix(input), "你好，先");
});

test("extractAssistantMessageFromJsonPrefix decodes escaped sequences", () => {
  const input = `{"assistant_message":"Line1\\nLine2\\u4f60\\u597d","board_actions":[]}`;
  assert.equal(extractAssistantMessageFromJsonPrefix(input), "Line1\nLine2你好");
});

test("extractAssistantMessageFromJsonPrefix returns empty when field missing", () => {
  const input = `{"board_actions":[]}`;
  assert.equal(extractAssistantMessageFromJsonPrefix(input), "");
});
