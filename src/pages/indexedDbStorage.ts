/**
 * IndexedDB-based persistence layer using idb-keyval.
 * Replaces localStorage to support unlimited offline storage.
 */
import { get, set, del, createStore } from "idb-keyval";
import type { PersistedWorkspaceState } from "./workspacePersistence";

const workspaceStore = createStore("ai-world-db", "workspace-store");

const IDB_KEY = "ai-world-workspace-v2";

/**
 * Save workspace state to IndexedDB.
 * Falls back to localStorage if IndexedDB is unavailable.
 */
export async function saveToIndexedDB(snapshot: PersistedWorkspaceState): Promise<void> {
  try {
    await set(IDB_KEY, snapshot, workspaceStore);
  } catch (err) {
    console.warn("[IDB] Failed to save, falling back to localStorage", err);
    try {
      localStorage.setItem(IDB_KEY, JSON.stringify(snapshot));
    } catch {
      // quota exceeded — silently fail
    }
  }
}

/**
 * Load workspace state from IndexedDB.
 * Falls back to localStorage for migration from older versions.
 */
export async function loadFromIndexedDB(): Promise<PersistedWorkspaceState | null> {
  try {
    const data = await get<PersistedWorkspaceState>(IDB_KEY, workspaceStore);
    if (data) return data;
  } catch (err) {
    console.warn("[IDB] Failed to read", err);
  }

  // Fallback: try to read from localStorage (migration path)
  try {
    const raw = localStorage.getItem(IDB_KEY);
    if (raw) {
      const parsed = JSON.parse(raw) as PersistedWorkspaceState;
      // Migrate to IndexedDB
      await saveToIndexedDB(parsed);
      localStorage.removeItem(IDB_KEY);
      return parsed;
    }
  } catch {
    // ignore
  }

  return null;
}

/**
 * Delete workspace state from IndexedDB.
 */
export async function clearIndexedDB(): Promise<void> {
  try {
    await del(IDB_KEY, workspaceStore);
  } catch {
    // ignore
  }
}
