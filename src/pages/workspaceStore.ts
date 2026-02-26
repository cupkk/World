/**
 * Zustand-based workspace state store.
 * Provides selective subscriptions to avoid full-tree re-renders.
 */
import { create } from "zustand";
import { subscribeWithSelector } from "zustand/middleware";
import type {
  WorkspaceState,
  ChatMessage,
  BoardSection,
  BoardContent,
  BoardTemplateType,
  AgentNextQuestion,
} from "../types/workspace";
import { defaultWorkspaceState } from "./workspaceCore";
import { createPersistedSnapshot, persistWorkspaceSnapshot } from "./workspacePersistence";
import { saveToIndexedDB } from "./indexedDbStorage";
import { api } from "../api";

interface WorkspaceStore extends WorkspaceState {
  // Actions
  setState: (updater: Partial<WorkspaceState> | ((prev: WorkspaceState) => Partial<WorkspaceState>)) => void;
  setChatMessages: (messages: ChatMessage[]) => void;
  addChatMessage: (message: ChatMessage) => void;
  setBoardSections: (sections: BoardSection[]) => void;
  setBoardTemplate: (template: BoardTemplateType) => void;
  setIsAiTyping: (isTyping: boolean) => void;
  pushUndo: (entry: BoardContent) => void;
  resetState: (newState: WorkspaceState) => void;

  // Persistence
  persistNow: () => void;
}

let persistTimer: ReturnType<typeof setTimeout> | null = null;
const PERSIST_DEBOUNCE_MS = 650;

export const useWorkspaceStore = create<WorkspaceStore>()(
  subscribeWithSelector((set, get) => ({
    ...defaultWorkspaceState(),

    setState: (updater) => {
      set((state) => {
        const partial = typeof updater === "function" ? updater(state) : updater;
        return partial;
      });
    },

    setChatMessages: (messages) => set({ chatMessages: messages }),

    addChatMessage: (message) =>
      set((state) => ({ chatMessages: [...state.chatMessages, message] })),

    setBoardSections: (sections) => set({ boardSections: sections }),

    setBoardTemplate: (template) => set({ boardTemplate: template }),

    setIsAiTyping: (isTyping) => set({ isAiTyping: isTyping }),

    pushUndo: (entry) =>
      set((state) => ({
        undoStack: [...state.undoStack.slice(-49), entry],
        redoStack: [],
      })),

    resetState: (newState) => set(newState),

    persistNow: () => {
      const state = get();
      const snapshot = createPersistedSnapshot(state);

      // Save to IndexedDB (async, non-blocking)
      saveToIndexedDB(snapshot).catch(() => {
        // Fallback to localStorage
        persistWorkspaceSnapshot(localStorage, "ai-world-workspace-v2", snapshot);
      });

      // Also sync to cloud if logged in
      api.saveDocument(
        snapshot.sessionId,
        snapshot.boardSections[0]?.title || "未命名文档",
        snapshot
      );
    },
  }))
);

// Auto-persist on state changes (debounced)
useWorkspaceStore.subscribe(
  (state) => [state.chatMessages, state.boardSections, state.boardTemplate, state.undoStack] as const,
  () => {
    if (persistTimer) clearTimeout(persistTimer);
    persistTimer = setTimeout(() => {
      useWorkspaceStore.getState().persistNow();
    }, PERSIST_DEBOUNCE_MS);
  }
);
