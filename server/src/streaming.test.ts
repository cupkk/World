import assert from "node:assert/strict";
import test from "node:test";
import { extractAssistantMessageFromJsonPrefix, extractBoardActionsFromJsonPrefix } from "./streaming";

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

test("extractBoardActionsFromJsonPrefix parses complete actions", () => {
  const input = `{"assistant_message":"ok","board_actions":[{"action":"set_template","template_type":"table"},{"action":"create_structure","section_title":"SWOT","content":"|S|W|"}]}`;
  const actions = extractBoardActionsFromJsonPrefix(input);
  assert.equal(actions.length, 2);
  assert.equal(actions[0]?.action, "set_template");
  assert.equal(actions[1]?.action, "create_structure");
});

test("extractBoardActionsFromJsonPrefix parses completed objects from partial array", () => {
  const input =
    `{"assistant_message":"ok","board_actions":[{"action":"set_template","template_type":"code"},{"action":"create_structure","section_title":"Code","content":"line1\\nline2"},{"action":"append_section","section_title":"Code","content":"pending"`;
  const actions = extractBoardActionsFromJsonPrefix(input);
  assert.equal(actions.length, 3);
  assert.equal(actions[0]?.template_type, "code");
  assert.equal(actions[1]?.section_title, "Code");
  assert.equal(actions[2]?.action, "append_section");
  assert.equal(actions[2]?.content, "pending");
});

test("extractBoardActionsFromJsonPrefix parses in-progress action object for early preview", () => {
  const input =
    `{"assistant_message":"ok","board_actions":[{"action":"update_section","section_title":"目标","content":"第一段内容还在流式中`;
  const actions = extractBoardActionsFromJsonPrefix(input);
  assert.equal(actions.length, 1);
  assert.equal(actions[0]?.action, "update_section");
  assert.equal(actions[0]?.section_title, "目标");
  assert.equal(actions[0]?.content, "第一段内容还在流式中");
});
