export type BoardTemplateType = "document" | "table" | "code";

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

export type AgentBoardAction = {
  action: "create_structure" | "update_section" | "append_section" | "clear_section" | "set_template";
  section_id?: string;
  section_title?: string;
  content?: string;
  template_type?: BoardTemplateType;
};

export type AgentRunRequest = {
  session_id: string;
  messages: AgentMessage[];
  board_sections: AgentBoardSection[];
  board_template?: BoardTemplateType;
};

export type AgentRunResponse = {
  assistant_message: string;
  board_actions: AgentBoardAction[];
  next_questions?: Array<{
    id?: string;
    target?: string;
    type?: string;
    question: string;
    options?: string[];
  }>;
  margin_notes?: Array<{
    anchor?: string;
    comment: string;
    suggestion?: string;
    dimension?: string;
  }>;
};
