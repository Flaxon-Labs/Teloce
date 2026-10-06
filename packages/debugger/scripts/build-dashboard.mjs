#!/usr/bin/env node
/**
 * Bundles the debugger dashboard's browser-side assets.
 *
 * The dashboard frontend (src/dashboard/app.ts, index.html, layout.css) is
 * plain browser code, not part of the @teloce/debugger library entry point,
 * so it isn't touched by the main `tsup` build. This script compiles
 * app.ts -> dist/dashboard/app.js with esbuild and copies the static
 * html/css alongside it so serveDashboard() has something real to serve.
 */
import { build } from 'esbuild';
import { mkdir, copyFile } from 'fs/promises';
import { fileURLToPath } from 'url';
import path from 'path';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(__dirname, '..');
const srcDir = path.join(root, 'src', 'dashboard');
const outDir = path.join(root, 'dist', 'dashboard');

async function main() {
  await mkdir(outDir, { recursive: true });

  await build({
    entryPoints: [path.join(srcDir, 'app.ts')],
    outfile: path.join(outDir, 'app.js'),
    bundle: true,
    format: 'esm',
    target: 'es2020',
    sourcemap: true,
    minify: false,
  });

  // Drop-in script for pages: <script src="http://localhost:9000/client.js">
  await build({
    entryPoints: [path.join(root, 'src', 'client', 'entry.ts')],
    outfile: path.join(outDir, 'client.js'),
    bundle: true,
    format: 'iife',
    target: 'es2018',
    minify: true,
  });

  await copyFile(path.join(srcDir, 'index.html'), path.join(outDir, 'index.html'));
  await copyFile(path.join(srcDir, 'layout.css'), path.join(outDir, 'layout.css'));

  console.log('Dashboard assets built -> dist/dashboard');
}

main().catch((err) => {
  console.error('Failed to build dashboard assets:', err);
  process.exit(1);
});
