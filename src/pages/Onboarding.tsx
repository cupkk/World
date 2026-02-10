import { ArrowRight } from "lucide-react";
import { useCallback, useEffect, useRef } from "react";
import { useNavigate } from "react-router-dom";
import { track } from "../analytics";
import { loadBoardPane } from "../components/boardPaneLoader";
import { markCanvasNavigationStart } from "../utils/perfMarks";
import { loadWorkspaceRoute } from "./workspaceRouteLoader";

const PREFETCH_DELAY_MS = 480;

function makeId() {
  if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") {
    return crypto.randomUUID();
  }
  return `${Date.now().toString(16)}-${Math.random().toString(16).slice(2)}`;
}

function buildCanvasUrl(taskId: string) {
  const q = new URLSearchParams({
    task_id: taskId,
    new: "1"
  });
  return `/canvas?${q.toString()}`;
}

export default function OnboardingPage() {
  const nav = useNavigate();
  const canvasPrefetchedRef = useRef(false);

  const prefetchCanvasAssets = useCallback(() => {
    if (canvasPrefetchedRef.current) return;
    canvasPrefetchedRef.current = true;
    void loadWorkspaceRoute();
    void loadBoardPane();
  }, []);

  const start = () => {
    markCanvasNavigationStart();
    prefetchCanvasAssets();
    const taskId = makeId();
    track("task_created", {
      task_id: taskId,
      source: "onboarding"
    });
    nav(buildCanvasUrl(taskId));
  };

  useEffect(() => {
    track("entry_viewed", { page: "onboarding" });
  }, []);

  useEffect(() => {
    const idleWindow = window as Window & {
      requestIdleCallback?: (callback: () => void, options?: { timeout: number }) => number;
      cancelIdleCallback?: (handle: number) => void;
    };
    let idleHandle: number | null = null;

    const timer = window.setTimeout(() => {
      if (typeof idleWindow.requestIdleCallback === "function") {
        idleHandle = idleWindow.requestIdleCallback(() => prefetchCanvasAssets(), { timeout: 1200 });
      } else {
        prefetchCanvasAssets();
      }
    }, PREFETCH_DELAY_MS);

    return () => {
      window.clearTimeout(timer);
      if (idleHandle !== null && typeof idleWindow.cancelIdleCallback === "function") {
        idleWindow.cancelIdleCallback(idleHandle);
      }
    };
  }, [prefetchCanvasAssets]);

  return (
    <main className="min-h-screen bg-[var(--bg-base)] p-3 sm:p-4">
      <div className="mx-auto flex min-h-[calc(100vh-1.5rem)] max-w-[1320px] flex-col overflow-hidden rounded-[20px] border border-subtle bg-[rgba(255,255,255,0.92)] shadow-card">
        <header className="flex h-16 items-center justify-between border-b border-subtle bg-[var(--bg-surface)] px-5 sm:px-6">
          <div className="font-display text-[18px] font-semibold text-primary">AI-World</div>
          <div className="text-[12px] text-secondary">对话即文档</div>
        </header>

        <div className="flex flex-1 items-center justify-center p-5 sm:p-8">
          <section className="w-full max-w-[900px] rounded-[24px] border border-subtle bg-[var(--bg-surface)] p-7 sm:p-10">
            <h1 className="text-[32px] font-semibold leading-[1.15] text-primary sm:text-[50px]">
              把你的想法说出来，
              <br />
              我们会把它整理成可交付文档。
            </h1>

            <p className="mt-5 max-w-[740px] text-[16px] leading-relaxed text-secondary">
              左侧持续对话澄清目标，右侧实时沉淀结构化内容。你可以边聊边改，最后一键导出图片、PDF 或文本。
            </p>

            <div className="mt-8 rounded-[20px] border border-[var(--border-strong)] bg-[linear-gradient(180deg,#ffffff_0%,#f7f8fa_100%)] p-3 shadow-soft">
              <div className="flex items-center justify-between gap-3 rounded-2xl border border-subtle bg-[var(--bg-surface)] px-4 py-3">
                <div className="text-[15px] text-muted">例如：帮我把这次会议整理成可执行方案</div>
                <button
                  type="button"
                  onClick={start}
                  onMouseEnter={prefetchCanvasAssets}
                  onFocus={prefetchCanvasAssets}
                  className="flex h-10 items-center justify-center gap-2 rounded-full bg-[var(--accent-strong)] px-5 text-white transition hover:bg-[var(--accent-strong-hover)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent-brand)]"
                >
                  <div className="text-[14px] font-semibold">开始</div>
                  <ArrowRight className="h-4 w-4" />
                </button>
              </div>
            </div>
          </section>
        </div>
      </div>
    </main>
  );
}
