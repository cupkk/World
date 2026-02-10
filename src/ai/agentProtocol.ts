import type { AgentMarginNote, AgentNextQuestion, BoardAction, BoardTemplateType } from "../types/workspace";

export type AgentMessage = {
  role: "user" | "assistant";
  content: string;
};

export type AgentBoardSection = {
  id: string;
  title: string;
  content: string;
  source?: "ai" | "user" | "pinned";
};

export type AgentRunRequest = {
  session_id: string;
  messages: AgentMessage[];
  board_sections: AgentBoardSection[];
  board_template?: BoardTemplateType;
};

export type AgentRunResponse = {
  assistant_message: string;
  board_actions: BoardAction[];
  next_questions?: AgentNextQuestion[];
  margin_notes?: AgentMarginNote[];
};
