import { existsSync } from 'node:fs';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { afterEach, describe, expect, it } from 'vitest';

// The server finds its html/js/css next to the *built* bundle, so exercise the
// built package (turbo runs build before test; skipped if it has not been built).
const dist = fileURLToPath(new URL('../../dist/index.js', import.meta.url));
const built = existsSync(dist) && existsSync(fileURLToPath(new URL('../../dist/dashboard/app.js', import.meta.url)));
const { serveDashboard } = built ? createRequire(import.meta.url)(dist) : ({} as any);

let server: { start(): Promise<void>; close(): Promise<void> } | undefined;
afterEach(async () => {
  await server?.close();
  server = undefined;
});

async function start() {
  const port = 20000 + Math.floor(Math.random() * 20000);
  server = serveDashboard({ port, host: '127.0.0.1' });
  await server.start();
  return `http://127.0.0.1:${port}`;
}

describe.skipIf(!built)('serveDashboard (built package)', () => {
  it('serves the dashboard page, script and styles from the built assets', async () => {
    const url = await start();
    const page = await fetch(url + '/');
    expect(page.status).toBe(200);
    expect(page.headers.get('content-type')).toContain('text/html');
    expect(await page.text()).toMatch(/teloce/i);

    const js = await fetch(url + '/app.js');
    expect(js.status).toBe(200);
    expect(js.headers.get('content-type')).toMatch(/javascript/);
    // the bundled dashboard knows how to label .html / .vel sources
    const code = await js.text();
    expect(code).toContain('HTML');
    expect(code).toContain('source-badge');

    expect((await fetch(url + '/layout.css')).status).toBe(200);
  });

  it('serves the dashboard for deep links', async () => {
    const url = await start();
    const res = await fetch(url + '/errors');
    expect(res.status).toBe(200);
    expect(await res.text()).toMatch(/teloce/i);
  });
});
