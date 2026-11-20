import { describe, expect, it } from "vitest";
import { applyEvent, standingText, toSpans, type BraidEvent, type Letter } from "./braid";

const run = (events: BraidEvent[]) => {
  const letters: Letter[] = [];
  for (const e of events) applyEvent(letters, e);
  return letters;
};

describe("braid", () => {
  it("interleaves bursts in arrival order", () => {
    const letters = run([
      { t: "burst", from: "you", text: "O" },
      { t: "burst", from: "sam", text: "lol no way" },
      { t: "burst", from: "you", text: "MG" },
    ]);
    expect(letters.map((l) => l.c).join("")).toBe("Olol no wayMG");
    expect(toSpans(letters).map((s) => [s.from, s.text])).toEqual([
      ["you", "O"],
      ["sam", "lol no way"],
      ["you", "MG"],
    ]);
  });

  it("backspace strikes the newest standing letter, whoever typed it", () => {
    const letters = run([
      { t: "burst", from: "sam", text: "hi" },
      { t: "burst", from: "you", text: "yo" },
      { t: "del", from: "sam" },
      { t: "del", from: "sam" },
      { t: "del", from: "you" },
    ]);
    expect(toSpans(letters)).toEqual([
      { from: "sam", struckBy: null, text: "h" },
      { from: "sam", struckBy: "you", text: "i" },
      { from: "you", struckBy: "sam", text: "yo" },
    ]);
  });

  it("treats emoji sequences and accented letters as one letter", () => {
    const letters = run([{ t: "burst", from: "a", text: "👨‍👩‍👧e\u0301x" }, { t: "del", from: "a" }]);
    expect(letters.map((l) => l.c)).toEqual(["👨‍👩‍👧", "e\u0301", "x"]);
    expect(standingText(letters)).toBe("👨‍👩‍👧e\u0301");
  });

  it("ignores backspaces when everything is already struck", () => {
    const letters = run([{ t: "burst", from: "a", text: "x" }, { t: "del", from: "a" }, { t: "del", from: "b" }]);
    expect(letters[0].struckBy).toBe("a");
  });
});
