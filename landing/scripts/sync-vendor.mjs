import { cpSync, existsSync, mkdirSync, readdirSync, renameSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { bundleHeroShade } from "./bundle-hero-shade.mjs";
import { build } from "esbuild";
import { FIRST_PARTY_RUNTIME } from "../kit/runtime-assets.mjs";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const GSAP_SRC = join(ROOT, "node_modules", "gsap", "dist");
const PRETEXT_SRC = join(ROOT, "node_modules", "@chenglou", "pretext", "dist");
const DEST = join(ROOT, "kit", "vendor");
const PRETEXT_DEST = join(DEST, "pretext");
const PUBLIC = join(ROOT, "public");
const PUBLIC_VENDOR = join(PUBLIC, "vendor");
const GSAP_FILES = ["gsap.min.js", "ScrollToPlugin.min.js", "ScrollTrigger.min.js"];

const FIRST_PARTY = FIRST_PARTY_RUNTIME.map(([from, to]) => [join(ROOT, from), join(ROOT, to)]);

export async function syncVendor() {
  mkdirSync(DEST, { recursive: true });
  await bundleHeroShade();
  console.log("Bundled hero-shade.js (WebGPU first, WebGL fallback)");
  for (const [from, to] of FIRST_PARTY) {
    if (!existsSync(from)) {
      console.error(`[sync-vendor] Missing first-party runtime asset ${from}`);
      process.exit(1);
    }
    cpSync(from, to);
  }

  for (const file of GSAP_FILES) {
    cpSync(join(GSAP_SRC, file), join(DEST, file));
  }
  console.log("Synced GSAP vendor files from node_modules/gsap/dist");

  await build({
    entryPoints: [join(PRETEXT_SRC, "layout.js")],
    outfile: join(PRETEXT_DEST, "layout.js.tmp"),
    bundle: true,
    format: "esm",
    platform: "browser",
    target: "es2022",
    minify: true,
    legalComments: "eof",
  });
  renameSync(join(PRETEXT_DEST, "layout.js.tmp"), join(PRETEXT_DEST, "layout.js"));
  console.log("Bundled Pretext from node_modules/@chenglou/pretext/dist");

  // The Astro engine serves runtime assets from public/ so they are available
  // in `astro dev` and copied verbatim into the static output by `astro build`.
  mkdirSync(PUBLIC_VENDOR, { recursive: true });
  cpSync(join(ROOT, "kit", "js", "app.js"), join(PUBLIC, "app.js"));
  cpSync(join(ROOT, "kit", "noise.svg"), join(PUBLIC, "noise.svg"));
  for (const file of readdirSync(DEST)) {
    cpSync(join(DEST, file), join(PUBLIC_VENDOR, file), { recursive: true });
  }

  console.log("Synced first-party runtime loader and GitHub signal module");
  console.log("Synced public/ runtime assets (app.js + vendor/)");
}

const isCli = process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isCli) await syncVendor();
