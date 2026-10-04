// Copies the debugger dashboard (html/js/css) next to the bundled extension.
//
// The extension runs the debugger server in-process, so users need nothing but
// the extension itself. The server serves these static files from disk; the
// bundled @teloce/debugger looks for them in `dist/dashboard` (next to
// extension.cjs). Source maps are skipped to keep the package small.
import { cpSync, existsSync, mkdirSync, readdirSync, rmSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const from = join(here, '..', '..', 'debugger', 'dist', 'dashboard');
const to = join(here, '..', 'dist', 'dashboard');

if (!existsSync(join(from, 'index.html'))) {
  console.error(
    `[teloce] debugger dashboard not found at ${from}.\n` +
      `         Build it first: pnpm --filter @teloce/debugger build`
  );
  process.exit(1);
}

rmSync(to, { recursive: true, force: true });
mkdirSync(to, { recursive: true });
let count = 0;
for (const file of readdirSync(from)) {
  if (file.endsWith('.map')) continue;
  cpSync(join(from, file), join(to, file));
  count++;
}
console.log(`[teloce] copied ${count} debugger dashboard files to dist/dashboard`);
