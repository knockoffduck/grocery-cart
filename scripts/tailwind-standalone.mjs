#!/usr/bin/env node
// scripts/tailwind-standalone.mjs
//
// Pre-compiles Tailwind CSS using the standalone API. This bypasses the
// @tailwindcss/postcss plugin for environments where its scanner doesn't
// pick up source files (e.g. Next.js 16 + Docker).
//
// Mirrors what the @tailwindcss/postcss plugin does internally, but called
// directly so it works regardless of which PostCSS pipeline is invoking it.

import { compile } from "@tailwindcss/node";
import { Scanner } from "@tailwindcss/oxide";
import { readFileSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const projectRoot = resolve(__dirname, "..");

const [, , inputPath, outputPath] = process.argv;
if (!inputPath || !outputPath) {
  console.error("usage: tailwind-standalone.mjs <input.css> <output.css>");
  process.exit(1);
}

const absInput = resolve(projectRoot, inputPath);
const absOutput = resolve(projectRoot, outputPath);
const cssDir = dirname(absInput);
const input = readFileSync(absInput, "utf8");

const compiler = await compile(input, {
  base: cssDir,
  from: absInput,
  shouldRewriteUrls: true,
  onDependency: (p) => console.log(`[tailwind] dep: ${p}`),
});

// Build sources the same way @tailwindcss/postcss does:
const sources = [];
if (compiler.root === "none") {
  // auto-detect disabled
} else if (compiler.root === null) {
  // fall back to project root
  sources.push({ base: projectRoot, pattern: "**/*", negated: false });
} else {
  sources.push({ ...compiler.root, negated: false });
}
// append user @source directives
for (const s of compiler.sources ?? []) sources.push(s);

const scanner = new Scanner({ sources });
const candidates = scanner.scan();
console.log(`[tailwind] scanned ${candidates.length} candidate classes`);

const built = compiler.build(candidates);
writeFileSync(absOutput, built, "utf8");
console.log(`[tailwind] wrote ${absOutput} (${built.length} bytes)`);
