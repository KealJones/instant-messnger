import { DurableObject } from "cloudflare:workers";
import { RoomState, cleanName, type RoomEvent } from "./room-state";

export interface Env {
  ROOM: DurableObjectNamespace<Room>;
  /** Comma-separated list of allowed page origins. "*" allows any. */
  ALLOWED_ORIGINS?: string;
}

type Person = { id: string; name: string };
type ServerMsg =
  | { t: "welcome"; you: string; people: Person[] }
  | { t: "join"; id: string; name: string }
  | { t: "leave"; id: string }
  | RoomEvent;

const ROOM_RE = /^\/room\/([a-z0-9][a-z0-9-]{0,39})$/;
const LOCAL_RE = /^http:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/;

function originAllowed(origin: string | null, env: Env): boolean {
  if (!origin) return false;
  if (LOCAL_RE.test(origin)) return true;
  const allowed = (env.ALLOWED_ORIGINS ?? "").split(",").map((s) => s.trim()).filter(Boolean);
  return allowed.includes("*") || allowed.includes(origin);
}

export default {
  async fetch(req: Request, env: Env): Promise<Response> {
    const url = new URL(req.url);
    if (url.pathname === "/") {
      return new Response("Instant Mess'nger relay. Nothing is saved here.\n", {
        headers: { "content-type": "text/plain; charset=utf-8" },
      });
    }
    const match = url.pathname.match(ROOM_RE);
    if (!match) return new Response("not found", { status: 404 });
    if (req.headers.get("Upgrade")?.toLowerCase() !== "websocket") {
      return new Response("expected a websocket", { status: 426 });
    }
    if (!originAllowed(req.headers.get("Origin"), env)) {
      return new Response("origin not allowed", { status: 403 });
    }
    const stub = env.ROOM.get(env.ROOM.idFromName(match[1]));
    return stub.fetch(req);
  },
} satisfies ExportedHandler<Env>;

/**
 * One Durable Object per room. It forwards keystroke bursts and backspaces to everyone
 * in the room and never touches storage. Room rules live in memory in RoomState; when the
 * object hibernates after going quiet, that state is gone, which is fine because by then
 * the braid has locked anyway.
 */
export class Room extends DurableObject<Env> {
  private room = new RoomState();

  async fetch(req: Request): Promise<Response> {
    const name = cleanName(new URL(req.url).searchParams.get("name"));
    const id = crypto.randomUUID().slice(0, 8);
    const { 0: client, 1: server } = new WebSocketPair();
    this.ctx.acceptWebSocket(server);
    server.serializeAttachment({ id, name } satisfies Person);
    this.send(server, { t: "welcome", you: id, people: this.people() });
    this.broadcast({ t: "join", id, name }, server);
    return new Response(null, { status: 101, webSocket: client });
  }

  async webSocketMessage(ws: WebSocket, data: string | ArrayBuffer) {
    if (typeof data !== "string" || data.length > 4096) return;
    let msg: { t?: unknown; text?: unknown };
    try {
      msg = JSON.parse(data);
    } catch {
      return;
    }
    const me = ws.deserializeAttachment() as Person | null;
    if (!me) return;
    const now = Date.now();
    let out: RoomEvent | null = null;
    if (msg.t === "burst" && typeof msg.text === "string") out = this.room.burst(me.id, msg.text, now);
    else if (msg.t === "del") out = this.room.del(me.id, now);
    if (out) this.broadcast(out);
  }

  async webSocketClose(ws: WebSocket, code: number, reason: string) {
    this.gone(ws);
    try {
      ws.close(code, reason);
    } catch {
      /* already closed */
    }
  }

  async webSocketError(ws: WebSocket) {
    this.gone(ws);
  }

  private gone(ws: WebSocket) {
    const me = ws.deserializeAttachment() as Person | null;
    if (!me) return;
    this.room.forget(me.id);
    this.broadcast({ t: "leave", id: me.id }, ws);
  }

  private people(): Person[] {
    return this.ctx
      .getWebSockets()
      .map((ws) => ws.deserializeAttachment() as Person | null)
      .filter((p): p is Person => !!p);
  }

  private send(ws: WebSocket, msg: ServerMsg) {
    try {
      ws.send(JSON.stringify(msg));
    } catch {
      /* socket went away */
    }
  }

  private broadcast(msg: ServerMsg, except?: WebSocket) {
    const s = JSON.stringify(msg);
    for (const ws of this.ctx.getWebSockets()) {
      if (ws === except) continue;
      try {
        ws.send(s);
      } catch {
        /* socket went away */
      }
    }
  }
}
