import type { PersistedWorkspaceState } from "./pages/workspacePersistence";

const API_BASE = "/api";

function getToken() {
  return localStorage.getItem("ai-world-token");
}

function setToken(token: string) {
  localStorage.setItem("ai-world-token", token);
}

function clearToken() {
  localStorage.removeItem("ai-world-token");
}

export const api = {
  isLoggedIn() {
    return !!getToken();
  },

  async req(endpoint: string, options: RequestInit = {}) {
    const token = getToken();
    const headers: Record<string, string> = {
      "Content-Type": "application/json",
      ...(options.headers as any),
    };
    if (token) {
      headers["Authorization"] = `Bearer ${token}`;
    }

    const res = await fetch(`${API_BASE}${endpoint}`, {
      ...options,
      headers,
    });

    if (!res.ok) {
      const err = await res.json().catch(() => ({}));
      throw new Error(err?.error?.message || `API Error: ${res.statusText}`);
    }

    return res.json();
  },

  async login(username: string, passwordHash: string) {
    const data = await this.req("/auth/login", {
      method: "POST",
      body: JSON.stringify({ username, password: passwordHash }),
    });
    setToken(data.token);
    return data.user;
  },

  async register(username: string, passwordHash: string) {
    const data = await this.req("/auth/register", {
      method: "POST",
      body: JSON.stringify({ username, password: passwordHash }),
    });
    setToken(data.token);
    return data.user;
  },

  logout() {
    clearToken();
  },

  async getMe() {
    if (!this.isLoggedIn()) return null;
    try {
      const data = await this.req("/auth/me");
      return data.user;
    } catch {
      clearToken();
      return null;
    }
  },

  async getDocument(id: string): Promise<PersistedWorkspaceState | null> {
    try {
      const data = await this.req(`/documents/${id}`);
      if (data.document && data.document.content) {
        return JSON.parse(data.document.content);
      }
      return null;
    } catch (err: any) {
      console.error("Failed to fetch cloud document:", err);
      return null;
    }
  },

  async saveDocument(id: string, title: string, snapshot: PersistedWorkspaceState) {
    if (!this.isLoggedIn()) return;
    try {
      await this.req(`/documents/${id}`, {
        method: "PUT",
        body: JSON.stringify({ title, content: JSON.stringify(snapshot) }),
      });
    } catch (err) {
      console.error("Failed to sync document to cloud:", err);
    }
  },
};
