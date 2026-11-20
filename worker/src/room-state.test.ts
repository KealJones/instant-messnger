import { describe, expect, it } from "vitest";
import { LIMITS, RoomState, cleanName, cleanText } from "./room-state";

describe("RoomState", () => {
  it("keeps one braid while people keep typing, then locks after 5s of quiet", () => {
    const r = new RoomState();
    const a = r.burst("a", "hi", 1000)!;
    const b = r.burst("b", "yo", 5900)!;
    expect(b.braid).toBe(a.braid);
    const c = r.burst("a", "new", 5900 + LIMITS.idleLockMs)!;
    expect(c.braid).not.toBe(a.braid);
  });

  it("earns one backspace per letter sent and resets them when the braid locks", () => {
    const r = new RoomState();
    expect(r.burst("a", "abc", 0)!.left).toBe(3);
    expect(r.del("a", 10)!.left).toBe(2);
    expect(r.del("b", 20)).toBeNull(); // b has typed nothing
    r.burst("a", "x", 10_000); // new braid
    expect(r.del("a", 10_010)!.left).toBe(0);
    expect(r.del("a", 10_020)).toBeNull();
  });

  it("drops backspaces into a locked braid", () => {
    const r = new RoomState();
    r.burst("a", "abc", 0);
    expect(r.del("a", LIMITS.idleLockMs)).toBeNull();
  });

  it("starts a new braid when one would overflow, wiping everyone's backspaces", () => {
    const r = new RoomState();
    const wall = "A".repeat(LIMITS.burstMax);
    let t = 0;
    const first = r.burst("hoarder", wall, (t += 100))!;
    r.burst("b", "hi", (t += 100));
    for (let i = 0; i < 12; i++) r.burst("b", wall, (t += 100));
    const after = r.burst("b", wall, (t += 100))!;
    expect(after.braid).not.toBe(first.braid);
    expect(r.del("hoarder", (t += 100))).toBeNull();
  });

  it("cuts bursts at the burst cap and flattens newlines", () => {
    const r = new RoomState();
    const e = r.burst("a", "x".repeat(LIMITS.burstMax + 50), 0)!;
    expect(e.text).toHaveLength(LIMITS.burstMax);
    expect(cleanText("a\n\r\tb")).toBe("a b");
  });

  it("rate limits each person separately", () => {
    const r = new RoomState();
    let sent = 0;
    for (let i = 0; i < LIMITS.msgsPerSec + 5; i++) if (r.burst("a", "x", 500)) sent++;
    expect(sent).toBe(LIMITS.msgsPerSec);
    expect(r.burst("b", "x", 500)).not.toBeNull();
    expect(r.burst("a", "x", 1500)).not.toBeNull();
  });

  it("keeps braid ids increasing even if the clock repeats", () => {
    const r = new RoomState();
    const a = r.burst("a", "x", 100)!;
    const b = r.burst("a", "x".repeat(LIMITS.burstMax), 100);
    expect(b).not.toBeNull();
    for (let i = 0; i < 14; i++) r.burst(`p${i}`, "x".repeat(LIMITS.burstMax), 100);
    expect(r.braid).toBeGreaterThan(a.braid);
  });

  it("cleans screen names", () => {
    expect(cleanName("  ")).toBe("anon");
    expect(cleanName("x".repeat(40))).toHaveLength(LIMITS.nameMax);
  });
});
