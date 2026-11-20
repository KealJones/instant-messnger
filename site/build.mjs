// Builds the static site into site/dist. `--serve` runs a local dev server on :5173.
// RELAY_URL picks which relay the page talks to (defaults to production).
import * as esbuild from "esbuild";
import { cp, mkdir, rm } from "node:fs/promises";
import { fileURLToPath } from "node:url";

const here = (p) => fileURLToPath(new URL(p, import.meta.url));
const serve = process.argv.includes("--serve");
const relay =
  process.env.RELAY_URL || (serve ? "ws://127.0.0.1:8787" : "wss://instant-messnger.kealjones.workers.dev");
const out = here("./dist/");

await rm(out, { recursive: true, force: true });
await mkdir(out, { recursive: true });
await cp(here("./public/"), out, { recursive: true });

const options = {
  entryPoints: [here("./src/main.ts")],
  bundle: true,
  format: "esm",
  target: "es2020",
  minify: !serve,
  sourcemap: serve,
  outfile: `${out}app.js`,
  define: { __RELAY__: JSON.stringify(relay) },
};

if (serve) {
  const ctx = await esbuild.context(options);
  await ctx.watch();
  await ctx.serve({ servedir: out, port: 5173, host: "127.0.0.1" });
  console.log(`http://localhost:5173  (relay: ${relay})`);
} else {
  await esbuild.build(options);
  console.log(`built site/dist (relay: ${relay})`);
}
