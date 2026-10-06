// Copies TypeScript's lib.*.d.ts files next to the bundled extension.
//
// The extension bundles the `typescript` package into dist/extension.cjs, but
// the compiler reads lib.es2020.d.ts, lib.dom.d.ts, ... from disk at runtime.
// Because the .vsix is packaged with `--no-dependencies` (no node_modules),
// those files must be shipped explicitly.
import { cpSync, mkdirSync, readdirSync, rmSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const require = createRequire(import.meta.url);
const tsLib = dirname(require.resolve('typescript/lib/typescript.js'));
const out = join(here, '..', 'dist', 'ts-lib');

rmSync(out, { recursive: true, force: true });
mkdirSync(out, { recursive: true });

const wanted = /^lib\.d\.ts$|^lib\.(decorators.*|dom.*|es.*)\.d\.ts$/;
let count = 0;
for (const file of readdirSync(tsLib)) {
  if (wanted.test(file)) {
    cpSync(join(tsLib, file), join(out, file));
    count++;
  }
}
console.log(`[teloce] copied ${count} TypeScript lib files to dist/ts-lib`);
