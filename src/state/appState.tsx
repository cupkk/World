import React, { createContext, useCallback, useContext, useEffect, useMemo, useState } from "react";

export type Tone = "柔和" | "坚定" | "强硬";
export type Opponent = "配合" | "中立" | "强硬";

export const TONE_OPTIONS: Tone[] = ["柔和", "坚定", "强硬"];
export const OPPONENT_OPTIONS: Opponent[] = ["配合", "中立", "强硬"];

export type DeliverableInclude = {
  opening: boolean;
  keyPoints: boolean;
  objections: boolean;
  rubric: boolean;
};

export type Deliverable = {
  title: string;
  tone: Tone;
  opponent: Opponent;
  opening: string;
  keyPoints: string[];
  objections: string;
  rubricTotal: number;
  rubric: {
    empathy: number;
    logic: number;
    tone: number;
    defense: number;
  };
  coachNote: string;
};

export type AppState = {
  scenario: string;
  tone: Tone;
  opponent: Opponent;
  opponentProfile: string;
  deliverable: Deliverable;
};

type AppStateContextValue = {
  state: AppState;
  setScenario: (scenario: string) => void;
  cycleTone: () => void;
  cycleOpponent: () => void;
  setTone: (tone: Tone) => void;
  setOpponent: (opponent: Opponent) => void;
  setOpponentProfile: (v: string) => void;
  updateDeliverable: (partial: Partial<Deliverable>) => void;
  updateKeyPoint: (index: number, v: string) => void;
  quickDraft: () => void;
  reset: () => void;
};

const STORAGE_KEY = "ai-world-ui-state-v1";

function makeTitle(scenario: string) {
  const s = scenario.trim() ? scenario.trim() : "未命名任务";
  return `${s} · 执行版`;
}

function templateDeliverable(scenario: string, tone: Tone, opponent: Opponent): Deliverable {
  const opening = "老板您好，我想约 10 分钟和您对齐我本阶段的结果与下一阶段目标。";
  const keyPoints = [
    "1) 结果：我把 A 项目从 X 提升到 Y（数据/证据）",
    "2) 价值：这些结果如何支撑团队 KPI / 当前压力点",
    "3) 诉求：我希望薪资调整到 Z，并给出可衡量的下一步承诺"
  ];
  const objections =
    "- 如果预算紧：我可以把目标拆成两阶段，本季度先对齐目标与范围，下季度再做调整\n- 如果质疑贡献：我带来了可核验的数据与对比，说明我的产出对 KPI 的直接影响\n- 如果要暂缓：我希望明确一个复盘节点（例如 4 周后）与达成标准";

  return {
    title: makeTitle(scenario),
    tone,
    opponent,
    opening,
    keyPoints,
    objections,
    rubricTotal: 78,
    rubric: {
      empathy: 20,
      logic: 18,
      tone: 22,
      defense: 18
    },
    coachNote: "优先提升：逻辑清晰度。补充 1-2 条可验证的数据/事实，将诉求从“感觉”变成“证据”。"
  };
}

function defaultState(): AppState {
  const scenario = "向老板提加薪";
  const tone: Tone = "坚定";
  const opponent: Opponent = "强硬";

  return {
    scenario,
    tone,
    opponent,
    opponentProfile: "",
    deliverable: templateDeliverable(scenario, tone, opponent)
  };
}

function safeParseState(raw: string | null): AppState | null {
  if (!raw) return null;

  try {
    const parsed = JSON.parse(raw) as AppState;
    if (!parsed || typeof parsed !== "object") return null;
    if (!parsed.deliverable || typeof parsed.deliverable !== "object") return null;
    return parsed;
  } catch {
    return null;
  }
}

const AppStateContext = createContext<AppStateContextValue | null>(null);

export function AppStateProvider({ children }: { children: React.ReactNode }) {
  const [state, setState] = useState<AppState>(() => {
    const stored = safeParseState(localStorage.getItem(STORAGE_KEY));
    return stored ?? defaultState();
  });

  useEffect(() => {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
  }, [state]);

  const setScenario = useCallback((scenario: string) => {
    setState((s) => ({
      ...s,
      scenario,
      deliverable: {
        ...s.deliverable,
        title: makeTitle(scenario)
      }
    }));
  }, []);

  const setTone = useCallback((tone: Tone) => {
    setState((s) => ({
      ...s,
      tone,
      deliverable: {
        ...s.deliverable,
        tone
      }
    }));
  }, []);

  const setOpponent = useCallback((opponent: Opponent) => {
    setState((s) => ({
      ...s,
      opponent,
      deliverable: {
        ...s.deliverable,
        opponent
      }
    }));
  }, []);

  const cycleTone = useCallback(() => {
    setState((s) => {
      const idx = TONE_OPTIONS.indexOf(s.tone);
      const next = TONE_OPTIONS[(idx + 1) % TONE_OPTIONS.length];
      return {
        ...s,
        tone: next,
        deliverable: {
          ...s.deliverable,
          tone: next
        }
      };
    });
  }, []);

  const cycleOpponent = useCallback(() => {
    setState((s) => {
      const idx = OPPONENT_OPTIONS.indexOf(s.opponent);
      const next = OPPONENT_OPTIONS[(idx + 1) % OPPONENT_OPTIONS.length];
      return {
        ...s,
        opponent: next,
        deliverable: {
          ...s.deliverable,
          opponent: next
        }
      };
    });
  }, []);

  const setOpponentProfile = useCallback((v: string) => {
    setState((s) => ({ ...s, opponentProfile: v }));
  }, []);

  const updateDeliverable = useCallback((partial: Partial<Deliverable>) => {
    setState((s) => ({
      ...s,
      deliverable: {
        ...s.deliverable,
        ...partial
      }
    }));
  }, []);

  const updateKeyPoint = useCallback((index: number, v: string) => {
    setState((s) => {
      const next = [...s.deliverable.keyPoints];
      next[index] = v;
      return {
        ...s,
        deliverable: {
          ...s.deliverable,
          keyPoints: next
        }
      };
    });
  }, []);

  const quickDraft = useCallback(() => {
    setState((s) => ({
      ...s,
      deliverable: templateDeliverable(s.scenario, s.tone, s.opponent)
    }));
  }, []);

  const reset = useCallback(() => {
    setState(defaultState());
  }, []);

  const value = useMemo<AppStateContextValue>(
    () => ({
      state,
      setScenario,
      cycleTone,
      cycleOpponent,
      setTone,
      setOpponent,
      setOpponentProfile,
      updateDeliverable,
      updateKeyPoint,
      quickDraft,
      reset
    }),
    [
      state,
      setScenario,
      cycleTone,
      cycleOpponent,
      setTone,
      setOpponent,
      setOpponentProfile,
      updateDeliverable,
      updateKeyPoint,
      quickDraft,
      reset
    ]
  );

  return <AppStateContext.Provider value={value}>{children}</AppStateContext.Provider>;
}

export function useAppState() {
  const ctx = useContext(AppStateContext);
  if (!ctx) {
    throw new Error("useAppState must be used within AppStateProvider");
  }
  return ctx;
}
