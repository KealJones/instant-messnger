// All the rules of a room, kept in memory only. Nothing here is ever written to storage.

export const LIMITS = {
  /** Quiet time (ms) after which the braid locks and the next keystroke starts a new one. */
  idleLockMs: 5000,
  /** Max characters in one burst. Anything longer is cut off. */
  burstMax: 300,
  /** Max characters in one braid. Overflowing it kills the braid and starts a new one. */
  braidMax: 4000,
  /** Max messages (bursts + backspaces) per person per second. */
  msgsPerSec: 20,
  /** Max screen name length. */
  nameMax: 24,
} as const;

export type BurstEvent = { t: "burst"; from: string; text: string; braid: number; left: number };
export type DelEvent = { t: "del"; from: string; braid: number; left: number };
export type RoomEvent = BurstEvent | DelEvent;

const segmenter = new Intl.Segmenter(undefined, { granularity: "grapheme" });

/** Split into characters the way people see them (graphemes: 👨‍👩‍👧 and é are one each). */
export const graphemes = (s: string): string[] => Array.from(segmenter.segment(s), (x) => x.segment);
export const charCount = (s: string) => graphemes(s).length;

/** Collapse whitespace/control chars to single spaces and cap length. */
export function cleanText(raw: string, max: number = LIMITS.burstMax): string {
  const flat = raw.replace(/[\u0000-\u001f\u007f\u2028\u2029]+/g, " ");
  return graphemes(flat).slice(0, max).join("");
}

export function cleanName(raw: string | null | undefined): string {
  const name = cleanText((raw ?? "").trim(), LIMITS.nameMax).trim();
  return name || "anon";
}

export class RoomState {
  /** Id of the current braid: the time it started, kept strictly increasing. */
  braid = 0;
  private lastAt = Number.NEGATIVE_INFINITY;
  private chars = 0;
  private budgets = new Map<string, number>();
  private rate = new Map<string, { start: number; count: number }>();

  private allow(from: string, now: number): boolean {
    const r = this.rate.get(from);
    if (!r || now - r.start >= 1000) {
      this.rate.set(from, { start: now, count: 1 });
      return true;
    }
    r.count++;
    return r.count <= LIMITS.msgsPerSec;
  }

  private newBraid(now: number) {
    this.braid = now > this.braid ? now : this.braid + 1;
    this.chars = 0;
    this.budgets.clear();
  }

  private isLocked(now: number) {
    return now - this.lastAt >= LIMITS.idleLockMs;
  }

  burst(from: string, raw: string, now: number): BurstEvent | null {
    if (!this.allow(from, now)) return null;
    const text = cleanText(raw);
    const n = charCount(text);
    if (n === 0) return null;
    if (this.isLocked(now) || this.chars + n > LIMITS.braidMax) this.newBraid(now);
    this.lastAt = now;
    this.chars += n;
    const left = (this.budgets.get(from) ?? 0) + n;
    this.budgets.set(from, left);
    return { t: "burst", from, text, braid: this.braid, left };
  }

  del(from: string, now: number): DelEvent | null {
    if (!this.allow(from, now)) return null;
    if (this.isLocked(now)) return null; // braid is locked: nothing of yours to spend
    const have = this.budgets.get(from) ?? 0;
    if (have <= 0) return null;
    this.lastAt = now;
    this.budgets.set(from, have - 1);
    return { t: "del", from, braid: this.braid, left: have - 1 };
  }

  forget(from: string) {
    this.rate.delete(from);
  }
}
