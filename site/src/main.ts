import { applyEvent, toSpans, type Letter } from "./braid";

declare const __RELAY__: string;

const LOCK_MS = 5000; // matches the relay: 5s of quiet locks the braid
const FLUSH_MS = 250; // send typed letters after this much of a pause (or on a space)
const BURST_MAX = 300;
const COLORS = 6;
const S = "​"; // sentinel kept in the input so backspace always fires, even on mobile

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
const signon = el("signon");
const chat = el("chat");
const nameInput = el<HTMLInputElement>("name");
const roomInput = el<HTMLInputElement>("room");
const braidEl = el("braid");
const whoEl = el("who");
const typeEl = el<HTMLInputElement>("type");
const buddiesEl = el("buddies");
const countEl = el("count");
const statusEl = el("status");
const titleEl = el("title");

const store = {
  get: (k: string) => {
    try {
      return localStorage.getItem(k);
    } catch {
      return null;
    }
  },
  set: (k: string, v: string) => {
    try {
      localStorage.setItem(k, v);
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
let ws: WebSocket | null = null;
let wantOpen = false;
let retry = 0;
let room = "";
let screenName = "";
let me = "";
const people = new Map<string, { name: string; left: number }>();
let braidId: number | null = null;
let letters: Letter[] = [];
let pending = "";
let flushTimer: number | undefined;
let lockTimer: number | undefined;

// ---- sign on ----
nameInput.value = store.get("im:name") ?? "";
roomInput.value = cleanRoom(params.get("r") ?? "") || randomRoom();

el<HTMLFormElement>("signon-form").addEventListener("submit", (e) => {
  e.preventDefault();
  screenName = nameInput.value.trim().slice(0, 24) || "anon";
  room = cleanRoom(roomInput.value) || randomRoom();
  store.set("im:name", screenName);
  const url = new URL(location.href);
  url.searchParams.set("r", room);
  history.replaceState(null, "", url);
  signon.hidden = true;
  chat.hidden = false;
  titleEl.textContent = `${screenName} in #${room}`;
  document.title = `#${room} – Instant Mess'nger`;
  wantOpen = true;
  connect();
  resetInput();
  typeEl.focus();
});

el("signoff").addEventListener("click", () => {
  wantOpen = false;
  ws?.close();
  ws = null;
  people.clear();
  clearBraid();
  chat.hidden = true;
  signon.hidden = false;
});

el("invite").addEventListener("click", async () => {
  const url = new URL(location.href);
  url.searchParams.set("r", room);
  try {
    await navigator.clipboard.writeText(url.toString());
    setStatus("Invite link copied. Paste it to your buddies.");
  } catch {
    setStatus(url.toString());
  }
});

// ---- connection ----
function connect() {
  setStatus("Dialing in…");
  const sock = new WebSocket(`${RELAY}/room/${room}?name=${encodeURIComponent(screenName)}`);
  ws = sock;
  sock.onopen = () => {
    retry = 0;
    setStatus("Signed on. Nothing you type is saved anywhere.");
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
    people.clear();
    renderBuddies();
    if (!wantOpen) return;
    const wait = Math.min(10_000, 500 * 2 ** retry++);
    setStatus("Lost the string. Reconnecting…");
    setTimeout(() => wantOpen && !ws && connect(), wait);
  };
}

function send(msg: object) {
  if (ws?.readyState === WebSocket.OPEN) ws.send(JSON.stringify(msg));
}

function handle(m: ServerMsg) {
  switch (m.t) {
    case "welcome":
      me = m.you;
      people.clear();
      for (const p of m.people) people.set(p.id, { name: p.name, left: 0 });
      renderBuddies();
      return;
    case "join":
      people.set(m.id, { name: m.name, left: 0 });
      setStatus(`${m.name} walked in.`);
      renderBuddies();
      return;
    case "leave": {
      const p = people.get(m.id);
      people.delete(m.id);
      if (p) setStatus(`${p.name} left. They missed everything.`);
      renderBuddies();
      return;
    }
    case "burst":
    case "del": {
      if (m.braid !== braidId) {
        braidId = m.braid;
        letters = [];
        for (const p of people.values()) p.left = 0;
      }
      applyEvent(letters, m);
      const p = people.get(m.from);
      if (p) p.left = m.left;
      armLock();
      renderBraid();
      renderBuddies();
      return;
    }
  }
}

function armLock() {
  clearTimeout(lockTimer);
  braidEl.classList.remove("locked");
  lockTimer = window.setTimeout(() => {
    braidEl.classList.add("locked");
    for (const p of people.values()) p.left = 0;
    renderBuddies();
  }, LOCK_MS);
}

function clearBraid() {
  braidId = null;
  letters = [];
  pending = "";
  clearTimeout(lockTimer);
  braidEl.classList.remove("locked");
  renderBraid();
}

// ---- typing ----
function resetInput() {
  typeEl.value = S;
  typeEl.setSelectionRange(1, 1);
}

typeEl.addEventListener("keydown", (e) => {
  if (e.key === "Enter") e.preventDefault();
});
typeEl.addEventListener("focus", resetInput);
typeEl.addEventListener("input", () => {
  const v = typeEl.value;
  const added = v.split(S).join("");
  if (!v.includes(S)) backspace();
  const n = Array.from(added).length;
  if (n > 1) {
    // pasted or autocorrected: send it as one burst
    pending += added;
    flush();
  } else if (n === 1) {
    typeChar(added);
  }
  resetInput();
});

function typeChar(c: string) {
  pending += c;
  clearTimeout(flushTimer);
  if (c === " " || Array.from(pending).length >= BURST_MAX) flush();
  else flushTimer = window.setTimeout(flush, FLUSH_MS);
  renderBraid();
}

function backspace() {
  if (pending) {
    // not sent yet: nobody saw it, delete for free
    pending = Array.from(pending).slice(0, -1).join("");
    renderBraid();
    return;
  }
  send({ t: "del" });
}

function flush() {
  clearTimeout(flushTimer);
  if (!pending) return;
  send({ t: "burst", text: pending });
  pending = "";
  renderBraid();
}

// ---- rendering ----
function setStatus(s: string) {
  statusEl.textContent = s;
}

function span(text: string, cls: string, strikeColor?: number) {
  const s = document.createElement("span");
  s.className = cls;
  s.textContent = text;
  if (strikeColor !== undefined) s.style.setProperty("--strike", `var(--c${strikeColor})`);
  return s;
}

function renderBraid() {
  const frag = document.createDocumentFragment();
  for (const s of toSpans(letters)) {
    const struck = s.struckBy !== null;
    frag.append(span(s.text, `c${colorOf(s.from)}${struck ? " struck" : ""}`, struck ? colorOf(s.struckBy!) : undefined));
  }
  if (pending) frag.append(span(pending, `c${colorOf(me)} pending`));
  braidEl.replaceChildren(frag);
  braidEl.classList.toggle("empty", letters.length === 0 && !pending);

  const authors = [...new Set(letters.map((l) => l.from))].map((id) => people.get(id)?.name ?? "someone");
  whoEl.textContent =
    authors.length === 0
      ? "Nobody's talking"
      : authors.length === 1
        ? authors[0]
        : `${authors.join(" + ")} (talking over each other)`;
}

function renderBuddies() {
  const frag = document.createDocumentFragment();
  for (const [id, p] of people) {
    const li = document.createElement("li");
    li.append(span("", `dot c${colorOf(id)}`), span(p.name + (id === me ? " (you)" : ""), `name c${colorOf(id)}`));
    const left = span(`⌫ ${p.left}`, "left");
    left.title = "Backspaces left in this braid";
    li.append(left);
    frag.append(li);
  }
  buddiesEl.replaceChildren(frag);
  countEl.textContent = `(${people.size})`;
}

renderBraid();
