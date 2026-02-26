/**
 * Alibaba Cloud OSS upload service.
 * Supports both server-side upload (via multer) and presigned URL generation.
 *
 * For development without OSS credentials, falls back to saving files
 * to a local /uploads directory and serving them statically.
 */
import { Router } from "express";
import multer from "multer";
import path from "node:path";
import fs from "node:fs";
import crypto from "node:crypto";
import { authenticateToken } from "./auth";

export const uploadRouter = Router();

// ── OSS client (lazy init) ──────────────────────────────────────────────────
let ossClient: any = null;

function getOssClient() {
  if (ossClient) return ossClient;

  const region = process.env.OSS_REGION;
  const accessKeyId = process.env.OSS_ACCESS_KEY_ID;
  const accessKeySecret = process.env.OSS_ACCESS_KEY_SECRET;
  const bucket = process.env.OSS_BUCKET;

  if (!region || !accessKeyId || !accessKeySecret || !bucket) {
    return null; // Dev mode — no OSS
  }

  // Dynamic import to avoid requiring ali-oss when not configured
  try {
    const OSS = require("ali-oss");
    ossClient = new OSS({ region, accessKeyId, accessKeySecret, bucket });
    return ossClient;
  } catch {
    return null;
  }
}

// ── File naming ─────────────────────────────────────────────────────────────
const ALLOWED_MIME_TYPES = new Set([
  "image/jpeg",
  "image/png",
  "image/gif",
  "image/webp",
  "image/svg+xml",
  "application/pdf",
]);

const MAX_FILE_SIZE = 10 * 1024 * 1024; // 10MB

function generateFileName(originalName: string): string {
  const ext = path.extname(originalName) || ".bin";
  const hash = crypto.randomBytes(16).toString("hex");
  const date = new Date().toISOString().slice(0, 10).replace(/-/g, "/");
  return `uploads/${date}/${hash}${ext}`;
}

// ── Multer config ───────────────────────────────────────────────────────────
const memoryStorage = multer.memoryStorage();
const upload = multer({
  storage: memoryStorage,
  limits: { fileSize: MAX_FILE_SIZE },
  fileFilter: (_req, file, cb) => {
    if (ALLOWED_MIME_TYPES.has(file.mimetype)) {
      cb(null, true);
    } else {
      cb(new Error(`不支持的文件类型: ${file.mimetype}`));
    }
  },
});

// ── Local fallback for dev ──────────────────────────────────────────────────
const LOCAL_UPLOAD_DIR = path.join(process.cwd(), "public", "uploads");

function ensureLocalDir(filePath: string) {
  const dir = path.dirname(filePath);
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }
}

// ── Upload endpoint ─────────────────────────────────────────────────────────
uploadRouter.post(
  "/upload",
  authenticateToken as any,
  upload.single("file"),
  async (req: any, res: any) => {
    try {
      const file = req.file;
      if (!file) {
        res.status(400).json({ error: { code: "NO_FILE", message: "未提供上传文件" } });
        return;
      }

      const ossKey = generateFileName(file.originalname);
      const oss = getOssClient();

      if (oss) {
        // ── Production: Upload to Alibaba Cloud OSS ──
        const result = await oss.put(ossKey, file.buffer, {
          mime: file.mimetype,
          headers: {
            "Cache-Control": "public, max-age=31536000",
            "Content-Disposition": "inline",
          },
        });

        const cdnDomain = process.env.OSS_CDN_DOMAIN;
        const url = cdnDomain
          ? `https://${cdnDomain}/${ossKey}`
          : result.url;

        res.json({ url, key: ossKey, size: file.size });
      } else {
        // ── Dev fallback: Save locally ──
        const localPath = path.join(LOCAL_UPLOAD_DIR, ossKey.replace("uploads/", ""));
        ensureLocalDir(localPath);
        fs.writeFileSync(localPath, file.buffer);

        const url = `/uploads/${ossKey.replace("uploads/", "")}`;
        res.json({ url, key: ossKey, size: file.size });
      }
    } catch (err) {
      console.error("[Upload] Failed:", err);
      const message = err instanceof Error ? err.message : "上传失败";
      res.status(500).json({ error: { code: "UPLOAD_FAILED", message } });
    }
  }
);

// ── Presigned URL endpoint (for large files / direct browser upload) ────────
uploadRouter.post(
  "/presign",
  authenticateToken as any,
  async (req: any, res: any) => {
    try {
      const { filename, contentType } = req.body;

      if (!filename || !contentType) {
        res.status(400).json({ error: { code: "INVALID_REQUEST", message: "缺少 filename 或 contentType" } });
        return;
      }

      if (!ALLOWED_MIME_TYPES.has(contentType)) {
        res.status(400).json({ error: { code: "INVALID_TYPE", message: `不支持的文件类型: ${contentType}` } });
        return;
      }

      const oss = getOssClient();
      if (!oss) {
        res.status(503).json({
          error: {
            code: "OSS_NOT_CONFIGURED",
            message: "OSS 未配置，请使用 /upload 端点（开发模式下直接上传）",
          },
        });
        return;
      }

      const ossKey = generateFileName(filename);
      const signedUrl = oss.signatureUrl(ossKey, {
        method: "PUT",
        "Content-Type": contentType,
        expires: 600, // 10 minutes
      });

      const cdnDomain = process.env.OSS_CDN_DOMAIN;
      const bucket = process.env.OSS_BUCKET;
      const region = process.env.OSS_REGION;
      const accessUrl = cdnDomain
        ? `https://${cdnDomain}/${ossKey}`
        : `https://${bucket}.${region}.aliyuncs.com/${ossKey}`;

      res.json({ signedUrl, accessUrl, key: ossKey });
    } catch (err) {
      console.error("[Presign] Failed:", err);
      res.status(500).json({ error: { code: "PRESIGN_FAILED", message: "生成预签名 URL 失败" } });
    }
  }
);
