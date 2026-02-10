// Types for Dual-Pane Workspace

export interface ChatMessage {
  id: string;
  role: "user" | "assistant";
  content: string;
  timestamp: number;
  boardActions?: BoardAction[];
  nextQuestions?: AgentNextQuestion[];
  rubric?: AgentRubric | null;
  marginNotes?: AgentMarginNote[];
}

export interface BoardAction {
  action: "create_structure" | "update_section" | "append_section" | "clear_section";
  section_id?: string;
  section_title?: string;
  content?: string;
}

export interface AgentNextQuestion {
  id?: string;
  target?: string;
  type?: string;
  question: string;
  options?: string[];
}

export interface AgentRubricDimension {
  score?: number;
  reason?: string;
}

export interface AgentRubric {
  total?: number;
  dimensions?: Record<string, AgentRubricDimension>;
}

export interface AgentMarginNote {
  anchor?: string;
  comment: string;
  suggestion?: string;
  dimension?: string;
  accepted?: boolean;
  acceptedAt?: number;
}

export interface BoardSection {
  id: string;
  title: string;
  content: string;
  source: "ai" | "user" | "pinned";
  isTyping?: boolean;
  lastUpdated: number;
}

export interface BoardContent {
  sections: BoardSection[];
  rawMarkdown: string;
}

export interface BoardHighlightRequest {
  key: string;
  sectionId: string;
  anchorText?: string;
}

export interface TextSelection {
  start: number;
  end: number;
  text: string;
}

export interface WorkspaceState {
  sessionId: string;
  chatMessages: ChatMessage[];
  boardSections: BoardSection[];
  undoStack: BoardContent[];
  redoStack: BoardContent[];
  isAiTyping: boolean;
  errorState: ErrorState;
}

export interface ErrorState {
  hasError: boolean;
  errorType: "timeout" | "network" | "api_error" | "parse" | null;
  message: string;
  retryCount: number;
  lastErrorTime: number;
  isOfflineMode: boolean;
}

export interface SessionState {
  sessionId: string;
  createdAt: number;
  updatedAt: number;
  chatMessages: ChatMessage[];
  boardSections: BoardSection[];
  metadata: {
    messageCount: number;
    boardWordCount: number;
    lastAiResponseTime: number;
  };
}
