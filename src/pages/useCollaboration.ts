/**
 * Y.js collaboration hook for real-time multi-device document sync.
 * Uses @hocuspocus/provider for WebSocket-based collaboration.
 */
import { useEffect, useRef, useState } from "react";
import * as Y from "yjs";
import { HocuspocusProvider } from "@hocuspocus/provider";
import type { BoardSection, ChatMessage, BoardTemplateType } from "../types/workspace";

export interface CollaborationState {
  isConnected: boolean;
  isSynced: boolean;
  connectedUsers: number;
}

interface UseCollaborationOptions {
  documentId: string;
  token: string | null;
  enabled: boolean;
  onRemoteUpdate?: (data: {
    chatMessages?: ChatMessage[];
    boardSections?: BoardSection[];
    boardTemplate?: BoardTemplateType;
  }) => void;
}

export function useCollaboration({
  documentId,
  token,
  enabled,
  onRemoteUpdate,
}: UseCollaborationOptions) {
  const ydocRef = useRef<Y.Doc | null>(null);
  const providerRef = useRef<HocuspocusProvider | null>(null);
  const suppressNextUpdate = useRef(false);
  const [collabState, setCollabState] = useState<CollaborationState>({
    isConnected: false,
    isSynced: false,
    connectedUsers: 1,
  });

  useEffect(() => {
    if (!enabled || !documentId || !token) return;

    const wsUrl = import.meta.env.VITE_COLLAB_WS_URL || "ws://localhost:8787/collaboration";
    const ydoc = new Y.Doc();
    ydocRef.current = ydoc;

    const provider = new HocuspocusProvider({
      url: wsUrl,
      name: documentId,
      document: ydoc,
      token,
      onConnect: () => setCollabState((s) => ({ ...s, isConnected: true })),
      onDisconnect: () => setCollabState((s) => ({ ...s, isConnected: false, isSynced: false })),
      onSynced: () => setCollabState((s) => ({ ...s, isSynced: true })),
      onAwarenessUpdate: ({ states }) => {
        setCollabState((s) => ({ ...s, connectedUsers: states.length }));
      },
    });

    providerRef.current = provider;

    // Listen for remote changes to the shared document state
    const yState = ydoc.getMap("workspace");
    const observer = () => {
      if (suppressNextUpdate.current) {
        suppressNextUpdate.current = false;
        return;
      }

      const data: Parameters<NonNullable<UseCollaborationOptions["onRemoteUpdate"]>>[0] = {};

      const chatJson = yState.get("chatMessages");
      if (chatJson && typeof chatJson === "string") {
        try { data.chatMessages = JSON.parse(chatJson); } catch { /* ignore */ }
      }

      const boardJson = yState.get("boardSections");
      if (boardJson && typeof boardJson === "string") {
        try { data.boardSections = JSON.parse(boardJson); } catch { /* ignore */ }
      }

      const template = yState.get("boardTemplate");
      if (template && typeof template === "string") {
        data.boardTemplate = template as BoardTemplateType;
      }

      onRemoteUpdate?.(data);
    };

    yState.observe(observer);

    return () => {
      yState.unobserve(observer);
      provider.destroy();
      ydoc.destroy();
      ydocRef.current = null;
      providerRef.current = null;
      setCollabState({ isConnected: false, isSynced: false, connectedUsers: 1 });
    };
  }, [documentId, token, enabled]);

  /**
   * Broadcast local changes to all connected peers.
   * Call this whenever local state changes that should be synced.
   */
  const broadcastUpdate = (data: {
    chatMessages?: ChatMessage[];
    boardSections?: BoardSection[];
    boardTemplate?: BoardTemplateType;
  }) => {
    const ydoc = ydocRef.current;
    if (!ydoc) return;

    const yState = ydoc.getMap("workspace");
    suppressNextUpdate.current = true;

    ydoc.transact(() => {
      if (data.chatMessages) {
        yState.set("chatMessages", JSON.stringify(data.chatMessages));
      }
      if (data.boardSections) {
        yState.set("boardSections", JSON.stringify(data.boardSections));
      }
      if (data.boardTemplate) {
        yState.set("boardTemplate", data.boardTemplate);
      }
    });
  };

  return { collabState, broadcastUpdate };
}
