// The braid: one shared stream of letters in the order the relay sent them.

export type BraidEvent = { t: "burst"; from: string; text: string } | { t: "del"; from: string };

export type Letter = { from: string; c: string; struckBy: string | null };

export type Span = { from: string; struckBy: string | null; text: string };

/** Add one relay event to the braid. A backspace strikes the newest letter still standing, whoever typed it. */
export function applyEvent(letters: Letter[], ev: BraidEvent): void {
  if (ev.t === "burst") {
    for (const c of Array.from(ev.text)) letters.push({ from: ev.from, c, struckBy: null });
    return;
  }
  for (let i = letters.length - 1; i >= 0; i--) {
    if (letters[i].struckBy === null) {
      letters[i].struckBy = ev.from;
      return;
    }
  }
}

/** Group neighbouring letters with the same author and strike state, for rendering. */
export function toSpans(letters: Letter[]): Span[] {
  const out: Span[] = [];
  for (const l of letters) {
    const last = out[out.length - 1];
    if (last && last.from === l.from && last.struckBy === l.struckBy) last.text += l.c;
    else out.push({ from: l.from, struckBy: l.struckBy, text: l.c });
  }
  return out;
}
