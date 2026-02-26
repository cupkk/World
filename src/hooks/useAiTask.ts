/**
 * React hook for submitting AI tasks to the async queue
 * and receiving real-time progress updates via SSE.
 */
import { useCallback, useEffect, useRef, useState } from "react";
import type { AgentRunResponse } from "../ai/agentProtocol";

export type AiTaskStatus = "idle" | "queued" | "processing" | "completed" | "failed";

export interface AiTaskState {
  status: AiTaskStatus;
  taskId: string | null;
  progress: number;
  result: AgentRunResponse | null;
  error: string | null;
}

const INITIAL_STATE: AiTaskState = {
  status: "idle",
  taskId: null,
  progress: 0,
  result: null,
  error: null,
};

/**
 * Submit an AI task to the async queue and stream progress via SSE.
 * Falls back to polling if SSE is unavailable.
 */
export function useAiTask() {
  const [state, setState] = useState<AiTaskState>(INITIAL_STATE);
  const eventSourceRef = useRef<EventSource | null>(null);
  const pollTimerRef = useRef<ReturnType<typeof setInterval> | null>(null);

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      eventSourceRef.current?.close();
      if (pollTimerRef.current) clearInterval(pollTimerRef.current);
    };
  }, []);

  const reset = useCallback(() => {
    setState(INITIAL_STATE);
    eventSourceRef.current?.close();
    if (pollTimerRef.current) clearInterval(pollTimerRef.current);
  }, []);

  const submitTask = useCallback(async (requestBody: unknown) => {
    // Cleanup previous task
    eventSourceRef.current?.close();
    if (pollTimerRef.current) clearInterval(pollTimerRef.current);

    setState({ ...INITIAL_STATE, status: "queued" });

    try {
      // Submit to async queue
      const response = await fetch("/api/ai/agent/async", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${localStorage.getItem("token") || ""}`,
        },
        body: JSON.stringify(requestBody),
      });

      if (!response.ok) {
        const errorData = await response.json().catch(() => null);
        throw new Error(errorData?.error?.message || `HTTP ${response.status}`);
      }

      const { taskId } = (await response.json()) as { taskId: string };
      setState((s) => ({ ...s, taskId }));

      // Try SSE stream first
      const eventSource = new EventSource(`/api/ai/task/${taskId}/stream`);
      eventSourceRef.current = eventSource;

      eventSource.addEventListener("progress", (event) => {
        try {
          const data = JSON.parse(event.data);
          setState((s) => ({
            ...s,
            status: data.status,
            progress: data.progress ?? s.progress,
            result: data.result ?? s.result,
            error: data.error ?? s.error,
          }));

          // Close on completion
          if (data.status === "completed" || data.status === "failed") {
            eventSource.close();
          }
        } catch {
          // ignore parse errors
        }
      });

      eventSource.onerror = () => {
        eventSource.close();
        // Fall back to polling if SSE fails
        startPolling(taskId);
      };
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      setState((s) => ({ ...s, status: "failed", error: message }));
    }
  }, []);

  function startPolling(taskId: string) {
    pollTimerRef.current = setInterval(async () => {
      try {
        const response = await fetch(`/api/ai/task/${taskId}`);
        if (!response.ok) return;

        const data = await response.json();
        setState((s) => ({
          ...s,
          status: data.status,
          progress: data.progress ?? s.progress,
          result: data.result ?? s.result,
          error: data.error ?? s.error,
        }));

        if (data.status === "completed" || data.status === "failed") {
          if (pollTimerRef.current) clearInterval(pollTimerRef.current);
        }
      } catch {
        // ignore polling errors
      }
    }, 2000);
  }

  return { state, submitTask, reset };
}
