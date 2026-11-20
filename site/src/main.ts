import { applyEvent, graphemes, standingText, toSpans, type Letter } from "./braid";
import { joinNames, lang, pluralOf, t } from "./i18n";

declare const __RELAY__: string;

const LOCK_MS = 5000; // matches the relay: 5s of quiet locks the bubble
const FLUSH_MS = 250; // send typed letters after this much of a pause (or on a space)
const BURST_MAX = 300;
const COLORS = 6;
const S = "​"; // sentinel kept in the hidden input so backspace always fires, even on phones

type Person = { id: string; name: string };
type ServerMsg =
  | { t: "welcome"; you: string; people: Person[] }
  | { t: "join"; id: string; name: string }
  | { t: "leave"; id: string }
  | { t: "burst"; from: string; text: string; braid: number; left: number }
  | { t: "del"; from: string; braid: number; left: number };

const params = new URLSearchParams(location.search);
const RELAY = (params.get("relay") || __RELAY__).replace(/\/+$/, "");

const el = <T extends HTMLElement = HTMLElement>(id: string) => document.getElementById(id) as T;
const joinView = el("join");
const joinForm = el<HTMLFormElement>("join-form");
const nameInput = el<HTMLInputElement>("name");
const app = el("app");
const roomBtn = el("room");
const connDot = el("conn");
const themeBtn = el("theme");
const bubble = el("bubble");
const textEl = el("text");
const peopleEl = el("people");
const typeEl = el<HTMLInputElement>("type");
const announceEl = el("announce");

// ---- localized static text ----
document.documentElement.lang = lang;
el("name-label").textContent = t.yourName;
nameInput.placeholder = t.yourName;
el("join-btn").ariaLabel = t.join;
roomBtn.title = t.copyInvite;
peopleEl.ariaLabel = t.people;
typeEl.ariaLabel = t.typeLabel;
el("rules").textContent = t.rules;
bubble.style.setProperty("--placeholder", JSON.stringify(t.typeAnything));

const store = {
  get: (k: string) => {
    try {
      return localStorage.getItem(k);
    } catch {
      return null;
    }
  },
  set: (k: string, v: string | null) => {
    try {
      if (v === null) localStorage.removeItem(k);
      else localStorage.setItem(k, v);
    } catch {
      /* private mode etc. */
    }
  },
};

const A = ["soggy", "spicy", "grumpy", "sneaky", "crunchy", "haunted", "sweaty", "feral", "dusty", "turbo", "wobbly", "salty"];
const B = ["burrito", "modem", "gremlin", "noodle", "toaster", "pigeon", "floppy", "raccoon", "waffle", "dialup", "goblin", "pickle"];
const pick = <T,>(xs: T[]) => xs[Math.floor(Math.random() * xs.length)];
const randomRoom = () => `${pick(A)}-${pick(B)}-${Math.floor(Math.random() * 90 + 10)}`;
const cleanRoom = (s: string) =>
  s.toLowerCase().replace(/[^a-z0-9-]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 40);

function colorOf(id: string): number {
  let h = 0;
  for (const ch of id) h = (h * 31 + ch.charCodeAt(0)) >>> 0;
  return h % COLORS;
}

// ---- state ----
const room = cleanRoom(params.get("r") ?? "") || randomRoom();
let screenName = store.get("im:name") ?? "";
let ws: WebSocket | null = null;
let retry = 0;
let me = "";
const people = new Map<string, { name: string; left: number }>();
let braidId: number | null = null;
let letters: Letter[] = [];
let pending = ""; // typed, not sent yet
let inflight: { text: string; at: number }[] = []; // sent, waiting for the relay's copy
let composing = false;
let flushTimer: number | undefined;
let lockTimer: number | undefined;

{
  const url = new URL(location.href);
  url.searchParams.set("r", room);
  history.replaceState(null, "", url);
  roomBtn.textContent = `#${room}`;
  document.title = `#${room}`;
}

function announce(msg: string) {
  announceEl.textContent = "";
  // a fresh text node makes screen readers read it even if it repeats
  requestAnimationFrame(() => (announceEl.textContent = msg));
}

// ---- theme: auto (follows the system) → light → dark ----
const THEMES = ["auto", "light", "dark"] as const;
type Theme = (typeof THEMES)[number];
const ICON = (inner: string) =>
  `<svg viewBox="0 0 16 16" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="1.5">${inner}</svg>`;
const THEME_ICON: Record<Theme, string> = {
  auto: ICON('<circle cx="8" cy="8" r="6"/><path d="M8 2a6 6 0 0 1 0 12z" fill="currentColor" stroke="none"/>'),
  light: ICON('<circle cx="8" cy="8" r="3"/><path d="M8 1v2M8 13v2M1 8h2M13 8h2M3 3l1.4 1.4M11.6 11.6 13 13M3 13l1.4-1.4M11.6 4.4 13 3"/>'),
  dark: ICON('<path d="M13 9.5A5.5 5.5 0 1 1 6.5 3 4.5 4.5 0 0 0 13 9.5z" fill="currentColor" stroke="none"/>'),
};
function applyTheme(th: Theme) {
  if (th === "auto") delete document.documentElement.dataset.theme;
  else document.documentElement.dataset.theme = th;
  themeBtn.innerHTML = THEME_ICON[th];
  themeBtn.title = themeBtn.ariaLabel = t.theme[th];
}
let theme: Theme = (THEMES as readonly string[]).includes(store.get("im:theme") ?? "") ? (store.get("im:theme") as Theme) : "auto";
applyTheme(theme);
themeBtn.addEventListener("click", () => {
  theme = THEMES[(THEMES.indexOf(theme) + 1) % THEMES.length];
  store.set("im:theme", theme === "auto" ? null : theme);
  applyTheme(theme);
});

// ---- joining ----
function showJoin() {
  ws?.close();
  ws = null;
  app.hidden = true;
  joinView.hidden = false;
  nameInput.value = screenName;
  nameInput.focus();
}

function enter() {
  joinView.hidden = true;
  app.hidden = false;
  connect();
  if (hasKeyboard) focusTyping();
}

joinForm.addEventListener("submit", (e) => {
  e.preventDefault();
  screenName = graphemes(nameInput.value.trim()).slice(0, 24).join("");
  if (!screenName) return;
  store.set("im:name", screenName);
  enter();
});

roomBtn.addEventListener("click", async () => {
  try {
    await navigator.clipboard.writeText(location.href);
    roomBtn.textContent = t.linkCopied;
    announce(t.linkCopied);
  } catch {
    roomBtn.textContent = location.href;
  }
  setTimeout(() => (roomBtn.textContent = `#${room}`), 1400);
});

// ---- connection ----
function setConnected(on: boolean) {
  connDot.classList.toggle("on", on);
  connDot.ariaLabel = on ? t.connected : t.reconnecting;
}

function connect() {
  const sock = new WebSocket(`${RELAY}/room/${room}?name=${encodeURIComponent(screenName)}`);
  ws = sock;
  setConnected(false);
  sock.onopen = () => {
    retry = 0;
    setConnected(true);
  };
  sock.onmessage = (e) => {
    try {
      handle(JSON.parse(e.data) as ServerMsg);
    } catch {
      /* ignore junk */
    }
  };
  sock.onclose = () => {
    if (ws !== sock) return;
    ws = null;
    setConnected(false);
    inflight = [];
    people.clear();
    renderPeople();
    const wait = Math.min(10_000, 500 * 2 ** retry++);
    setTimeout(() => !ws && !app.hidden && connect(), wait);
  };
}

function send(msg: object) {
  if (ws?.readyState === WebSocket.OPEN) ws.send(JSON.stringify(msg));
}

function handle(m: ServerMsg) {
  switch (m.t) {
    case "welcome":
      me = m.you;
      app.style.setProperty("--me", `var(--c${colorOf(me)})`);
      people.clear();
      for (const p of m.people) people.set(p.id, { name: p.name, left: 0 });
      renderPeople();
      return;
    case "join":
      people.set(m.id, { name: m.name, left: 0 });
      announce(t.joined(m.name));
      renderPeople();
      return;
    case "leave": {
      const p = people.get(m.id);
      people.delete(m.id);
      if (p) announce(t.left(p.name));
      renderPeople();
      return;
    }
    case "burst":
    case "del": {
      if (m.t === "burst" && m.from === me) inflight.shift();
      if (m.braid !== braidId) {
        braidId = m.braid;
        letters = [];
        for (const p of people.values()) p.left = 0;
        bubble.classList.remove("pop");
        void bubble.offsetWidth; // restart the pop animation
        bubble.classList.add("pop");
      }
      applyEvent(letters, m);
      const p = people.get(m.from);
      if (p) p.left = m.left;
      armLock();
      renderText();
      renderPeople();
      return;
    }
  }
}

function armLock() {
  clearTimeout(lockTimer);
  bubble.classList.remove("locked");
  lockTimer = window.setTimeout(() => {
    bubble.classList.add("locked");
    for (const p of people.values()) p.left = 0;
    renderPeople();
    // screen readers get the finished bubble once, not every keystroke
    const text = standingText(letters);
    if (text) {
      const names = [...new Set(letters.filter((l) => !l.struckBy).map((l) => l.from))].map(
        (id) => people.get(id)?.name ?? t.someone,
      );
      announce(t.said(joinNames(names), text));
    }
  }, LOCK_MS);
}

// ---- typing (straight into the bubble via a hidden input) ----
function resetCapture() {
  typeEl.value = S;
  typeEl.setSelectionRange(1, 1);
}
function focusTyping() {
  if (document.activeElement !== typeEl) typeEl.focus({ preventScroll: true });
  if (!composing) resetCapture();
}
// Only grab focus on load where there's a real keyboard. On phones, focusing from code
// "focuses" without showing the keyboard, so we wait for an actual tap instead.
const hasKeyboard = matchMedia("(hover: hover) and (pointer: fine)").matches;

// Keep the caret after the sentinel so backspace always has something to delete.
for (const ev of ["focus", "pointerup"]) typeEl.addEventListener(ev, () => !composing && resetCapture());

document.addEventListener("keydown", (e) => {
  if (app.hidden || document.activeElement === typeEl || e.metaKey || e.ctrlKey || e.altKey) return;
  if (document.activeElement?.closest("button") && (e.key === "Enter" || e.key === " ")) return;
  if (e.key.length === 1 || e.key === "Backspace") focusTyping();
});
typeEl.addEventListener("focus", () => app.classList.add("focused"));
typeEl.addEventListener("blur", () => app.classList.remove("focused"));
typeEl.addEventListener("keydown", (e) => {
  if (e.key === "Enter") e.preventDefault();
});

// IME (Japanese, Chinese, Korean, dead keys for accents): wait for the finished text
typeEl.addEventListener("compositionstart", () => (composing = true));
typeEl.addEventListener("compositionend", () => {
  composing = false;
  setTimeout(readCapture, 0);
});
typeEl.addEventListener("input", (e) => {
  if (composing || (e as InputEvent).isComposing) return;
  readCapture();
});

function readCapture() {
  const v = typeEl.value;
  const added = v.split(S).join("");
  // Missing sentinel with nothing typed = backspace. (Android keyboards sometimes swallow the
  // sentinel while committing a word; that's not a backspace.)
  if (!v.includes(S) && added === "") backspace();
  const n = graphemes(added).length;
  if (n > 1) {
    // pasted, autocorrected or composed: send it as one burst
    pending += added;
    flush();
  } else if (n === 1) {
    typeChar(added);
  }
  resetCapture();
}

function typeChar(c: string) {
  pending += c;
  clearTimeout(flushTimer);
  if (/\s/.test(c) || graphemes(pending).length >= BURST_MAX) flush();
  else flushTimer = window.setTimeout(flush, FLUSH_MS);
  renderText();
}

function backspace() {
  if (pending) {
    // not sent yet: nobody saw it, delete for free
    pending = graphemes(pending).slice(0, -1).join("");
    renderText();
    return;
  }
  send({ t: "del" });
}

function flush() {
  clearTimeout(flushTimer);
  if (!pending) return;
  if (ws?.readyState === WebSocket.OPEN) inflight.push({ text: pending, at: Date.now() });
  send({ t: "burst", text: pending });
  pending = "";
  renderText();
}

// ---- rendering ----
function node(tag: string, text: string, cls: string) {
  const n = document.createElement(tag);
  n.className = cls;
  n.textContent = text;
  return n;
}

function renderText() {
  const frag = document.createDocumentFragment();
  for (const s of toSpans(letters)) {
    if (s.struckBy === null) {
      frag.append(node("span", s.text, `c${colorOf(s.from)}`));
    } else {
      const d = node("del", s.text, `c${colorOf(s.from)}`);
      d.style.setProperty("--strike", `var(--c${colorOf(s.struckBy)})`);
      frag.append(d);
    }
  }
  // what you typed stays put, full color, until the relay's copy takes its place (no flicker)
  inflight = inflight.filter((b) => Date.now() - b.at < 3000);
  const mine = inflight.map((b) => b.text).join("") + pending;
  if (mine) frag.append(node("span", mine, `c${colorOf(me)}`));
  textEl.replaceChildren(frag);
  bubble.classList.toggle("empty", letters.length === 0 && !mine);
  bubble.scrollTop = bubble.scrollHeight;
}

function renderPeople() {
  const frag = document.createDocumentFragment();
  for (const [id, p] of people) {
    const li = document.createElement("li");
    const color = `c${colorOf(id)}`;
    let name: HTMLElement;
    if (id === me) {
      name = node("button", p.name, `${color} name me`);
      (name as HTMLButtonElement).type = "button";
      name.ariaLabel = t.changeName(p.name);
      name.addEventListener("click", showJoin);
    } else {
      name = node("span", p.name, `${color} name`);
    }
    li.append(name);
    if (p.left > 0) {
      const left = node("span", String(p.left), "left");
      left.ariaLabel = left.title = t.backspaces(p.left, pluralOf(p.left));
      li.append(left);
    }
    frag.append(li);
  }
  peopleEl.replaceChildren(frag);
}

renderText();
if (screenName) enter();
else showJoin();
