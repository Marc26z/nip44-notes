import { build } from "esbuild";
import { cp, mkdir, readFile, rm, stat, writeFile } from "node:fs/promises";
import { watch } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const dist = path.join(root, "dist");
const pkg = JSON.parse(await readFile(path.join(root, "package.json"), "utf8"));
const watchMode = process.argv.includes("--watch");
const BUILD_ID = `${pkg.version}-${Date.now().toString(36)}`;

const STATIC_FILES = ["index.html", "styles.css", "manifest.webmanifest"];
const STATIC_DIRS = ["icons"];

async function copyStatic() {
  await mkdir(dist, { recursive: true });
  await Promise.all(
    STATIC_FILES.map((name) => cp(path.join(root, name), path.join(dist, name))),
  );
  await Promise.all(
    STATIC_DIRS.map((name) =>
      cp(path.join(root, name), path.join(dist, name), { recursive: true }),
    ),
  );
  const sw = await readFile(path.join(root, "sw.js"), "utf8");
  await writeFile(path.join(dist, "sw.js"), sw.replaceAll("__BUILD_ID__", BUILD_ID));
}

async function buildAll() {
  await rm(dist, { recursive: true, force: true });
  await mkdir(dist, { recursive: true });
  await build({
    entryPoints: [path.join(root, "src/main.js")],
    bundle: true,
    outfile: path.join(dist, "app.js"),
    format: "iife",
    target: ["es2022"],
    minify: true,
    sourcemap: false,
    legalComments: "none",
    define: { __APP_VERSION__: JSON.stringify(pkg.version) },
    logLevel: "warning",
  });
  await copyStatic();
  const size = (await stat(path.join(dist, "app.js"))).size;
  console.log(
    `Built dist/app.js (${(size / 1024).toFixed(1)} KB), build ${BUILD_ID}`,
  );
}

if (!watchMode) {
  try {
    await buildAll();
  } catch (error) {
    console.error(error?.message || error);
    process.exit(1);
  }
} else {
  let running = false;
  let pending = false;
  const rebuild = async () => {
    if (running) {
      pending = true;
      return;
    }
    running = true;
    try {
      await buildAll();
    } catch (error) {
      console.error(error?.message || error);
    } finally {
      running = false;
      if (pending) {
        pending = false;
        setTimeout(() => void rebuild(), 80);
      }
    }
  };

  for (const name of [...STATIC_FILES, ...STATIC_DIRS, "sw.js", "src"]) {
    watch(path.join(root, name), () => {
      void rebuild();
    });
  }
  await rebuild();
  console.log("Watching src, styles, HTML, manifest, icons, and sw.js…");
}
