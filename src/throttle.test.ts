import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { UpdateThrottle } from "./throttle";

describe("UpdateThrottle", () => {
  let shown: string[];
  const apply = async (value: string) => {
    shown.push(value);
  };

  beforeEach(() => {
    vi.useFakeTimers();
    shown = [];
  });
  afterEach(() => vi.useRealTimers());

  const throttle = () => new UpdateThrottle(100, () => Date.now());

  it("applies the first update immediately", () => {
    throttle().update("key", "a", apply);
    expect(shown).toEqual(["a"]);
  });

  it("skips updates that do not change the image", () => {
    const t = throttle();
    t.update("key", "a", apply);
    vi.advanceTimersByTime(500);
    t.update("key", "a", apply);
    expect(shown).toEqual(["a"]);
  });

  it("allows at most 10 updates per second and shows the latest value", () => {
    const t = throttle();
    for (let i = 0; i < 1000; i++) {
      t.update("key", `v${i}`, apply);
      vi.advanceTimersByTime(1);
    }
    vi.advanceTimersByTime(200);
    expect(shown.length).toBeLessThanOrEqual(11);
    expect(shown.at(-1)).toBe("v999");
  });

  it("coalesces a burst into one delayed update", () => {
    const t = throttle();
    t.update("key", "a", apply);
    t.update("key", "b", apply);
    t.update("key", "c", apply);
    expect(shown).toEqual(["a"]);
    vi.advanceTimersByTime(100);
    expect(shown).toEqual(["a", "c"]);
  });

  it("drops a delayed update that returns to the shown image", () => {
    const t = throttle();
    t.update("key", "a", apply);
    t.update("key", "b", apply);
    t.update("key", "a", apply);
    vi.advanceTimersByTime(100);
    expect(shown).toEqual(["a"]);
  });

  it("throttles keys independently", () => {
    const t = throttle();
    t.update("k1", "a", apply);
    t.update("k2", "b", apply);
    expect(shown).toEqual(["a", "b"]);
  });

  it("redraws a key after forget, even with the same image", () => {
    const t = throttle();
    t.update("key", "a", apply);
    t.update("key", "b", apply);
    t.forget("key");
    vi.advanceTimersByTime(100);
    t.update("key", "a", apply);
    expect(shown).toEqual(["a", "a"]);
  });
});
