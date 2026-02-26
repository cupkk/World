/**
 * React hook for uploading images/files.
 * Handles drag-and-drop, paste, and click-to-upload.
 * Returns URL to insert into the document.
 */
import { useCallback, useState } from "react";

export interface UploadResult {
  url: string;
  key: string;
  size: number;
}

export interface UseUploadOptions {
  maxSizeMB?: number;
  allowedTypes?: string[];
  onSuccess?: (result: UploadResult) => void;
  onError?: (error: string) => void;
}

const DEFAULT_ALLOWED = [
  "image/jpeg",
  "image/png",
  "image/gif",
  "image/webp",
  "image/svg+xml",
  "application/pdf",
];

export function useUpload(options: UseUploadOptions = {}) {
  const {
    maxSizeMB = 10,
    allowedTypes = DEFAULT_ALLOWED,
    onSuccess,
    onError,
  } = options;

  const [isUploading, setIsUploading] = useState(false);
  const [progress, setProgress] = useState(0);

  const upload = useCallback(
    async (file: File): Promise<UploadResult | null> => {
      // Validate
      if (!allowedTypes.includes(file.type)) {
        const msg = `不支持的文件类型: ${file.type}`;
        onError?.(msg);
        return null;
      }

      if (file.size > maxSizeMB * 1024 * 1024) {
        const msg = `文件大小超过 ${maxSizeMB}MB 限制`;
        onError?.(msg);
        return null;
      }

      setIsUploading(true);
      setProgress(0);

      try {
        const formData = new FormData();
        formData.append("file", file);

        const token = localStorage.getItem("token") || "";

        const xhr = new XMLHttpRequest();
        const result = await new Promise<UploadResult>((resolve, reject) => {
          xhr.upload.addEventListener("progress", (event) => {
            if (event.lengthComputable) {
              setProgress(Math.round((event.loaded / event.total) * 100));
            }
          });

          xhr.addEventListener("load", () => {
            if (xhr.status >= 200 && xhr.status < 300) {
              try {
                resolve(JSON.parse(xhr.responseText));
              } catch {
                reject(new Error("服务器返回了无效的响应"));
              }
            } else {
              try {
                const err = JSON.parse(xhr.responseText);
                reject(new Error(err.error?.message || `上传失败 (HTTP ${xhr.status})`));
              } catch {
                reject(new Error(`上传失败 (HTTP ${xhr.status})`));
              }
            }
          });

          xhr.addEventListener("error", () => reject(new Error("网络错误，上传失败")));
          xhr.addEventListener("abort", () => reject(new Error("上传已取消")));

          xhr.open("POST", "/api/upload/upload");
          xhr.setRequestHeader("Authorization", `Bearer ${token}`);
          xhr.send(formData);
        });

        setProgress(100);
        onSuccess?.(result);
        return result;
      } catch (err) {
        const message = err instanceof Error ? err.message : "上传失败";
        onError?.(message);
        return null;
      } finally {
        setIsUploading(false);
      }
    },
    [maxSizeMB, allowedTypes, onSuccess, onError]
  );

  /**
   * Handle paste events — extracts image files from clipboard.
   */
  const handlePaste = useCallback(
    async (event: ClipboardEvent): Promise<UploadResult | null> => {
      const items = event.clipboardData?.items;
      if (!items) return null;

      for (const item of Array.from(items)) {
        if (item.kind === "file" && item.type.startsWith("image/")) {
          const file = item.getAsFile();
          if (file) {
            event.preventDefault();
            return upload(file);
          }
        }
      }
      return null;
    },
    [upload]
  );

  /**
   * Handle drop events — extracts files from drag-and-drop.
   */
  const handleDrop = useCallback(
    async (event: DragEvent): Promise<UploadResult[]> => {
      const files = event.dataTransfer?.files;
      if (!files || files.length === 0) return [];

      event.preventDefault();
      const results: UploadResult[] = [];
      for (const file of Array.from(files)) {
        const result = await upload(file);
        if (result) results.push(result);
      }
      return results;
    },
    [upload]
  );

  return { upload, handlePaste, handleDrop, isUploading, progress };
}
