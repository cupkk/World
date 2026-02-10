import { afterEach, describe, expect, it } from "vitest";
import {
  CANVAS_NAV_START_KEY,
  consumeCanvasNavigationLatency,
  markCanvasNavigationStart
} from "./perfMarks";

afterEach(() => {
  window.sessionStorage.removeItem(CANVAS_NAV_START_KEY);
});

describe("perfMarks", () => {
  it("stores and consumes canvas navigation latency", () => {
    markCanvasNavigationStart(1000);
    const latency = consumeCanvasNavigationLatency(1120);

    expect(latency).toBe(120);
    expect(window.sessionStorage.getItem(CANVAS_NAV_START_KEY)).toBeNull();
  });

  it("returns null when mark is stale", () => {
    markCanvasNavigationStart(1000);
    const latency = consumeCanvasNavigationLatency(200000);

    expect(latency).toBeNull();
  });

  it("returns null when mark is missing", () => {
    const latency = consumeCanvasNavigationLatency();
    expect(latency).toBeNull();
  });
});

