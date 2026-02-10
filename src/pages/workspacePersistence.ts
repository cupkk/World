import type { BoardContent, BoardSection, ChatMessage, WorkspaceState } from "../types/workspace";

export type PersistedWorkspaceState = Pick<
  WorkspaceState,
  "sessionId" | "chatMessages" | "boardSections" | "undoStack" | "redoStack" | "errorState"
>;

type CompactProfile = "normal" | "aggressive" | "minimal";

type SnapshotLimits = {
  chatMessages: number;
  boardSections: number;
  undoStack: number;
  redoStack: number;
  chatMessageChars: number;
  boardSectionChars: number;
  sectionTitleChars: number;
};

type StorageLike = Pick<Storage, "setItem">;

const PROFILE_LIMITS: Record<CompactProfile, SnapshotLimits> = {
  normal: {
    chatMessages: 140,
    boardSections: 40,
    undoStack: 50,
    redoStack: 25,
    chatMessageChars: 2800,
    boardSectionChars: 9000,
    sectionTitleChars: 140
  },
  aggressive: {
    chatMessages: 80,
    boardSections: 24,
    undoStack: 24,
    redoStack: 12,
    chatMessageChars: 1600,
    boardSectionChars: 5500,
    sectionTitleChars: 110
  },
  minimal: {
    chatMessages: 36,
    boardSections: 12,
    undoStack: 0,
    redoStack: 0,
    chatMessageChars: 900,
    boardSectionChars: 2800,
    sectionTitleChars: 80
  }
};

function clampText(value: string, limit: number) {
  if (value.length <= limit) return value;
  return `${value.slice(0, Math.max(0, limit - 16))}…[truncated]`;
}

function compactSections(sections: BoardSection[], limits: SnapshotLimits) {
  return sections.slice(-limits.boardSections).map((section) => ({
    ...section,
    title: clampText(section.title, limits.sectionTitleChars),
    content: clampText(section.content, limits.boardSectionChars)
  }));
}

function compactBoardContent(stack: BoardContent[], limits: SnapshotLimits) {
  if (limits.undoStack === 0) return [] as BoardContent[];
  const maxRawChars = limits.boardSections * limits.boardSectionChars;
  return stack.slice(-limits.undoStack).map((entry) => ({
    rawMarkdown: clampText(entry.rawMarkdown, maxRawChars),
    sections: compactSections(entry.sections, limits)
  }));
}

function compactChatMessages(messages: ChatMessage[], limits: SnapshotLimits) {
  return messages.slice(-limits.chatMessages).map((message) => ({
    ...message,
    content: clampText(message.content, limits.chatMessageChars),
    boardActions: message.boardActions?.slice(-4).map((action) => ({
      ...action,
      section_title: action.section_title
        ? clampText(action.section_title, limits.sectionTitleChars)
        : action.section_title,
      content: action.content ? clampText(action.content, limits.boardSectionChars) : action.content
    })),
    nextQuestions: message.nextQuestions?.slice(0, 4).map((item) => ({
      ...item,
      question: clampText(item.question, 300),
      options: item.options?.slice(0, 4).map((option) => clampText(option, 120))
    })),
    rubric: message.rubric ?? null,
    marginNotes: message.marginNotes?.slice(0, 6).map((note) => ({
      ...note,
      anchor: note.anchor ? clampText(note.anchor, 120) : note.anchor,
      comment: clampText(note.comment, 300),
      suggestion: note.suggestion ? clampText(note.suggestion, 280) : note.suggestion,
      dimension: note.dimension ? clampText(note.dimension, 80) : note.dimension
    }))
  }));
}

export function createPersistedSnapshot(state: WorkspaceState): PersistedWorkspaceState {
  return {
    sessionId: state.sessionId,
    chatMessages: state.chatMessages,
    boardSections: state.boardSections,
    undoStack: state.undoStack,
    redoStack: state.redoStack,
    errorState: state.errorState
  };
}

export function compactPersistedSnapshot(
  snapshot: PersistedWorkspaceState,
  profile: CompactProfile = "normal"
): PersistedWorkspaceState {
  const limits = PROFILE_LIMITS[profile];
  const boardSections = compactSections(snapshot.boardSections, limits);

  return {
    sessionId: snapshot.sessionId,
    chatMessages: compactChatMessages(snapshot.chatMessages, limits),
    boardSections,
    undoStack: compactBoardContent(snapshot.undoStack, limits),
    redoStack: compactBoardContent(snapshot.redoStack.slice(-limits.redoStack), {
      ...limits,
      undoStack: limits.redoStack
    }),
    errorState: snapshot.errorState
  };
}

export function persistWorkspaceSnapshot(
  storage: StorageLike,
  key: string,
  snapshot: PersistedWorkspaceState
): CompactProfile | "failed" {
  const profiles: CompactProfile[] = ["normal", "aggressive", "minimal"];
  for (const profile of profiles) {
    try {
      const payload = compactPersistedSnapshot(snapshot, profile);
      storage.setItem(key, JSON.stringify(payload));
      return profile;
    } catch {
      // try the next smaller profile
    }
  }
  return "failed";
}
