# Instant Mess'nger

Actually instant messaging. Everyone in a room types into one shared line at the same time, and nothing is ever saved.

**Try it:** [kealjones.com/instant-messnger](https://kealjones.com/instant-messnger/)

## The rules

- **One line per room.** Your keystrokes go out in short bursts (on every space, or after a quarter second of pause) and land in the line in the order the relay gets them. Type at the same time as someone else and your words braid together.
- **Shared backspace.** Every letter you send earns you one backspace. A backspace crosses out the newest letter in the line, whoever typed it.
- **5 seconds of quiet locks the line.** The next keystroke wipes it and starts a new one, and everyone's backspaces reset to zero.
- **Nothing is stored.** No history, no logs, no database. If you weren't connected, you missed it.
- **Limits so nobody's phone melts:** 300 characters per burst, 4,000 per line (overflowing it starts a new line), 20 messages per second per person.

## How it's built

```
site/      static TypeScript client, published to GitHub Pages
worker/    Cloudflare Worker + one Durable Object per room (the relay)
```

The relay is a hibernating Durable Object that forwards bursts and backspaces over WebSockets and enforces the rules above in memory. It never calls the storage API. The client only renders what the relay sends, so every screen in a room shows the same line.

## Running it locally

```sh
npm install
npm run dev:worker   # relay on ws://127.0.0.1:8787
npm run dev:site     # page on http://localhost:5173
npm test
```

Open two browser windows on the same `?r=room-name` and type over yourself.

Any page can point at a different relay with `?relay=wss://…`.

## Deploys

- **Worker:** Cloudflare's Git integration deploys `main` to production and builds a Worker Preview (with its own isolated rooms) for every other branch.
- **Site:** pushing to `main` publishes to the `gh-pages` branch. Every PR also gets a page at `/instant-messnger/pr-preview/pr-N/` wired to that branch's Worker Preview, and a comment with the link.
