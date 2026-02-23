import { Router } from "express";
import { prisma } from "./db";
import { authenticateToken, type AuthenticatedRequest } from "./auth";

export const documentsRouter = Router();

// Get a specific document by session ID
documentsRouter.get("/:id", authenticateToken, async (req: AuthenticatedRequest, res) => {
  try {
    const documentId = req.params["id"];
    
    if (!documentId) {
      res.status(400).json({ error: { code: "INVALID_REQUEST", message: "Missing document ID" } });
      return;
    }

    const document = await prisma.workspaceDocument.findUnique({
      where: { id: documentId },
    });

    if (!document) {
      res.status(404).json({ error: { code: "NOT_FOUND", message: "Document not found" } });
      return;
    }

    // Ensure the document belongs to the requesting user
    if (document.userId !== req.user!.userId) {
      res.status(403).json({ error: { code: "FORBIDDEN", message: "Access denied" } });
      return;
    }

    res.json({ document });
  } catch (error) {
    res.status(500).json({ error: { code: "INTERNAL_ERROR", message: "Failed to fetch document" } });
  }
});

// Update or create a document by session ID
documentsRouter.put("/:id", authenticateToken, async (req: AuthenticatedRequest, res) => {
  try {
    const documentId = req.params["id"];
    const { title, content } = req.body;
    
    if (!documentId) {
      res.status(400).json({ error: { code: "INVALID_REQUEST", message: "Missing document ID" } });
      return;
    }

    if (typeof content !== "string") {
      res.status(400).json({ error: { code: "INVALID_REQUEST", message: "Content must be a stringified JSON" } });
      return;
    }

    // Check if document exists to verify ownership before updating
    const existing = await prisma.workspaceDocument.findUnique({ where: { id: documentId } });
    if (existing && existing.userId !== req.user!.userId) {
      res.status(403).json({ error: { code: "FORBIDDEN", message: "Access denied" } });
      return;
    }

    // Upsert the document
    const document = await prisma.workspaceDocument.upsert({
      where: { id: documentId },
      update: {
        title: title || "未命名文档",
        content,
      },
      create: {
        id: documentId,
        userId: req.user!.userId,
        title: title || "未命名文档",
        content,
      },
    });

    res.json({ document });
  } catch (error) {
    res.status(500).json({ error: { code: "INTERNAL_ERROR", message: "Failed to save document" } });
  }
});
