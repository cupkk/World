import { describe, expect, it } from "vitest";
import type { PersistedWorkspaceState } from "./workspacePersistence";
import { compactPersistedSnapshot, persistWorkspaceSnapshot } from "./workspacePersistence";

function createLargeSnapshot(): PersistedWorkspaceState {
  const now = Date.now();
  return {
    sessionId: "session-1",
    chatMessages: new Array(180).fill(0).map((_, index) => ({
      id: `m-${index}`,
      role: index % 2 === 0 ? "user" : "assistant",
      content: `message-${index}-${"x".repeat(2200)}`,
      timestamp: now + index
    })),
    boardSections: new Array(48).fill(0).map((_, index) => ({
      id: `s-${index}`,
      title: `标题-${index}-${"y".repeat(90)}`,
      content: `<p>content-${index}-${"z".repeat(7000)}</p>`,
      source: "ai",
      lastUpdated: now + index
    })),
    undoStack: new Array(60).fill(0).map((_, index) => ({
      rawMarkdown: `snapshot-${index}-${"n".repeat(12000)}`,
      sections: [
        {
          id: `u-${index}`,
          title: `undo-${index}`,
          content: `<p>${"u".repeat(6000)}</p>`,
          source: "user",
          lastUpdated: now + index
        }
      ]
    })),
    redoStack: new Array(30).fill(0).map((_, index) => ({
      rawMarkdown: `redo-${index}-${"r".repeat(8000)}`,
      sections: [
        {
          id: `r-${index}`,
          title: `redo-${index}`,
          content: `<p>${"r".repeat(5000)}</p>`,
          source: "ai",
          lastUpdated: now + index
        }
      ]
    })),
    errorState: {
      hasError: false,
      errorType: null,
      message: "",
      retryCount: 0,
      lastErrorTime: 0,
      isOfflineMode: false
    }
  };
}

describe("workspacePersistence", () => {
  it("caps persisted snapshot size in normal profile", () => {
    const compacted = compactPersistedSnapshot(createLargeSnapshot(), "normal");
    expect(compacted.chatMessages.length).toBeLessThanOrEqual(140);
    expect(compacted.boardSections.length).toBeLessThanOrEqual(40);
    expect(compacted.undoStack.length).toBeLessThanOrEqual(50);
    expect(compacted.redoStack.length).toBeLessThanOrEqual(25);
    expect(compacted.chatMessages[0]?.content.length ?? 0).toBeLessThanOrEqual(2800);
    expect(compacted.boardSections[0]?.content.length ?? 0).toBeLessThanOrEqual(9000);
  });

  it("falls back to aggressive profile when normal write fails", () => {
    let persistedPayload: string | null = null;
    const storage = {
      setItem: (_key: string, value: string) => {
        const parsed = JSON.parse(value) as PersistedWorkspaceState;
        if (parsed.chatMessages.length > 80) {
          throw new Error("quota");
        }
        persistedPayload = value;
      }
    };

    const profile = persistWorkspaceSnapshot(storage, "workspace", createLargeSnapshot());
    expect(profile).toBe("aggressive");
    if (!persistedPayload) {
      throw new Error("expected persisted payload");
    }
    const persisted = JSON.parse(persistedPayload) as PersistedWorkspaceState;
    expect(persisted.chatMessages.length).toBeLessThanOrEqual(80);
  });

  it("returns failed when all fallback writes fail", () => {
    const storage = {
      setItem: () => {
        throw new Error("quota");
      }
    };

    const profile = persistWorkspaceSnapshot(storage, "workspace", createLargeSnapshot());
    expect(profile).toBe("failed");
  });
});
