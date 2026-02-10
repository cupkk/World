import type { AgentBoardSection, AgentMessage, AgentRunRequest } from "./agentProtocol";

export type PromptBuildOptions = {
  maxMessages: number;
  maxMessageChars: number;
  maxBoardSections: number;
  maxSectionChars: number;
};

export const DEFAULT_PROMPT_BUILD_OPTIONS: PromptBuildOptions = {
  maxMessages: 30,
  maxMessageChars: 4000,
  maxBoardSections: 30,
  maxSectionChars: 8000
};

function truncateText(value: string, maxChars: number) {
  if (value.length <= maxChars) return value;
  return `${value.slice(0, Math.max(0, maxChars - 15))} …[truncated]`;
}

function pickRecentMessages(messages: AgentMessage[], maxMessages: number) {
  return messages.slice(-maxMessages);
}

function pickRecentSections(sections: AgentBoardSection[], maxSections: number) {
  return sections.slice(-maxSections);
}

export function preparePromptContext(req: AgentRunRequest, options: PromptBuildOptions) {
  const messages = pickRecentMessages(req.messages, options.maxMessages).map((m) => ({
    role: m.role,
    content: truncateText(m.content, options.maxMessageChars)
  }));

  const boardSections = pickRecentSections(req.board_sections, options.maxBoardSections).map((s) => ({
    id: s.id,
    title: s.title,
    content: truncateText(s.content, options.maxSectionChars),
    source: s.source
  }));

  return {
    sessionId: req.session_id,
    messages,
    boardSections
  };
}

export function buildAgentSystemPrompt() {
  return [
    "You are an AI coach embedded in a dual-pane workspace (left chat, right board).",
    "Respond conversationally, but always return a single valid JSON object and nothing else.",
    "Return ONLY JSON. No markdown. No code fences. No comments.",
    "",
    "Primary goals:",
    "1) In chat, move quickly toward draft quality output with minimal questioning.",
    "2) On board, maintain a structured artifact that evolves with each turn.",
    "",
    "Behavior rules:",
    "- Ask follow-up questions only when absolutely necessary.",
    "- At most ONE question in a single reply.",
    "- If you ask a question, include 2-4 quick options in the same message using this format:",
    "  A. ...",
    "  B. ...",
    "  C. ...",
    "  D. 其他（请补充）",
    "- Prefer giving a concrete draft + assumptions, then ask for correction.",
    "- Keep each reply practical and progress-oriented.",
    "- Keep board actions minimal and useful (0-3 actions per reply).",
    "- Prefer updating existing sections over creating noisy duplicates.",
    "- Treat sections with source=user or source=pinned as user-authored context you should consider carefully.",
    "- Prefer coherent rewriting with update_section when needed; avoid repeated sentences or duplicated bullets.",
    "- If board is empty, infer a lightweight structure and create 3-5 sections.",
    "",
    "Board action rules:",
    "- create_structure: create a new section if missing (use section_title).",
    "- update_section: replace section content (use section_id or section_title).",
    "- append_section: append to existing section (use section_id or section_title).",
    "- clear_section: clear content of a section.",
    "",
    "Output JSON shape:",
    "{",
    '  "assistant_message": "...",',
    '  "board_actions": [',
    '    {"action":"create_structure|update_section|append_section|clear_section","section_id":"...","section_title":"...","content":"..."}',
    "  ],",
    '  "next_questions": [{"question":"...", "options":["...","..."]}],',
    '  "rubric": {"total": 0-100, "dimensions": {"clarity":{"score":0-100,"reason":"..."}}},',
    '  "margin_notes": [{"anchor":"section_id or text span", "comment":"...", "suggestion":"..."}]',
    "}",
    "(next_questions/rubric/margin_notes are optional, but useful when confidence is low or quality gaps are obvious.)",
    "",
    "assistant_message must be natural Chinese, concise, and must push the conversation forward."
  ].join("\n");
}

export function buildAgentUserPrompt(req: AgentRunRequest, options: PromptBuildOptions = DEFAULT_PROMPT_BUILD_OPTIONS) {
  const context = preparePromptContext(req, options);

  const history = context.messages
    .map((m) => `${m.role === "user" ? "User" : "Assistant"}: ${m.content}`)
    .join("\n");

  const boardSummary = context.boardSections
    .map((s) => `- [source=${s.source ?? "ai"}] ${s.title}: ${s.content}`)
    .join("\n");

  return [
    `Session: ${context.sessionId}`,
    "",
    "Conversation so far:",
    history || "(empty)",
    "",
    "Current board sections:",
    boardSummary || "(empty)",
    "",
    "Respond with a helpful next step and update the board if needed."
  ].join("\n");
}
