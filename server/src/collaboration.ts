/**
 * Hocuspocus WebSocket collaboration server.
 * Runs alongside the Express HTTP server for real-time Y.js document sync.
 */
import { Hocuspocus } from "@hocuspocus/server";
import jwt from "jsonwebtoken";
import { prisma } from "./db";

const JWT_SECRET = process.env.JWT_SECRET || "fallback-secret-for-dev-only";

export function createCollaborationServer() {
  const server = new Hocuspocus({
    quiet: true,

    async onAuthenticate(data: { token: string; documentName: string }) {
      const { token, documentName } = data;
      if (!token) throw new Error("Missing auth token");

      try {
        const decoded = jwt.verify(token, JWT_SECRET) as { userId: number; username: string };

        // Verify the user has access to this document (or it's a new document)
        const doc = await prisma.workspaceDocument.findUnique({
          where: { id: documentName },
        });

        if (doc && doc.userId !== decoded.userId) {
          throw new Error("Access denied");
        }

        return { user: decoded };
      } catch {
        throw new Error("Invalid token");
      }
    },

    async onStoreDocument(data: { documentName: string; document: any; context: any }) {
      const { documentName, document, context } = data;
      const user = context?.user;
      if (!user) return;

      try {
        const yState = document.getMap("workspace");
        const chatMessagesJson = yState.get("chatMessages");
        const boardSectionsJson = yState.get("boardSections");

        if (!boardSectionsJson) return;

        let sections: any[] = [];
        try {
          sections = JSON.parse(boardSectionsJson as string);
        } catch {
          return;
        }

        const content = JSON.stringify({
          sessionId: documentName,
          chatMessages: chatMessagesJson ? JSON.parse(chatMessagesJson as string) : [],
          boardSections: sections,
          boardTemplate: yState.get("boardTemplate") || "document",
          undoStack: [],
          redoStack: [],
          errorState: {},
        });

        await prisma.workspaceDocument.upsert({
          where: { id: documentName },
          update: {
            content,
            title: sections[0]?.title || "未命名文档",
          },
          create: {
            id: documentName,
            userId: user.userId,
            content,
            title: sections[0]?.title || "未命名文档",
          },
        });
      } catch (err) {
        console.error("[Hocuspocus] Failed to store document:", err);
      }
    },
  });

  return server;
}
