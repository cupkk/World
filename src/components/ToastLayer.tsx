import { Check } from "lucide-react";

export type ToastState =
  | {
      kind: "copy" | "export" | "error";
      message: string;
    }
  | null;

export default function ToastLayer({ toast }: { toast: ToastState }) {
  if (!toast) return null;

  return (
    <div className="fixed left-1/2 top-[84px] z-50 w-[360px] -translate-x-1/2">
      <div className="flex items-center gap-[10px] rounded-xl bg-[#111827] px-4 py-3 text-white shadow-[0_8px_16px_rgba(0,0,0,0.10)]">
        <div className="flex h-[18px] w-[18px] items-center justify-center">
          <Check className="h-[18px] w-[18px]" />
        </div>
        <div className="text-[13px] font-medium leading-snug">{toast.message}</div>
      </div>
    </div>
  );
}
