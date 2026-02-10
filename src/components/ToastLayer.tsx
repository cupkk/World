import { AlertTriangle, Copy, Download, Info } from "lucide-react";

export type ToastState =
  | {
      kind: "copy" | "export" | "error" | "info";
      message: string;
    }
  | null;

export default function ToastLayer({ toast }: { toast: ToastState }) {
  if (!toast) return null;

  const Icon =
    toast.kind === "copy" ? Copy : toast.kind === "export" ? Download : toast.kind === "info" ? Info : AlertTriangle;
  const bg = toast.kind === "error" ? "bg-[var(--danger)]" : "bg-[var(--accent-strong)]";

  return (
    <div
      className="fixed left-1/2 top-[84px] z-50 w-[360px] -translate-x-1/2"
      role="status"
      aria-live="polite"
      aria-atomic="true"
    >
      <div
        className={`flex items-center gap-[10px] rounded-xl ${bg} px-4 py-3 text-white shadow-[0_12px_24px_rgba(31,26,20,0.25)]`}
      >
        <div className="flex h-[18px] w-[18px] items-center justify-center">
          <Icon className="h-[18px] w-[18px]" />
        </div>
        <div className="text-[13px] font-medium leading-snug">{toast.message}</div>
      </div>
    </div>
  );
}
