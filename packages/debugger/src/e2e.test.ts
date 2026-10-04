/**
 * End to end, against the built package: a "page" sends an error from a .html
 * component over the WebSocket, a "dashboard" connection receives it with the
 * file kind, location and a suggested fix.
 */
import { existsSync } from 'node:fs';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { afterEach, describe, expect, it } from 'vitest';

const dist = fileURLToPath(new URL('../dist/index.js', import.meta.url));
const ready =
  existsSync(dist) &&
  existsSync(fileURLToPath(new URL('../dist/dashboard/client.js', import.meta.url))) &&
  typeof (globalThis as any).WebSocket === 'function';
const { serveDashboard } = ready ? createRequire(import.meta.url)(dist) : ({} as any);

let server: { start(): Promise<void>; close(): Promise<void> } | undefined;
const sockets: any[] = [];
afterEach(async () => {
  sockets.splice(0).forEach((s) => s.close());
  await server?.close();
  server = undefined;
});

async function start() {
  const port = 20000 + Math.floor(Math.random() * 20000);
  server = serveDashboard({ port, host: '127.0.0.1' });
  await server!.start();
  return port;
}

function connect(port: number) {
  const ws: any = new (globalThis as any).WebSocket(`ws://127.0.0.1:${port}/__teloce_debug`);
  sockets.push(ws);
  const received: any[] = [];
  ws.onmessage = (e: any) => received.push(JSON.parse(String(e.data)));
  const opened = new Promise<void>((resolve, reject) => {
    ws.onopen = () => resolve();
    ws.onerror = () => reject(new Error('websocket error'));
  });
  return { ws, received, opened };
}

const until = async (cond: () => boolean, ms = 3000) => {
  const t = Date.now();
  while (!cond()) {
    if (Date.now() - t > ms) throw new Error('timed out waiting');
    await new Promise((r) => setTimeout(r, 20));
  }
};

describe.skipIf(!ready)('page -> debugger -> dashboard (built package)', () => {
  it('shows an error from a .html component with its file kind, location and fix', async () => {
    const port = await start();
    const dashboard = connect(port);
    const page = connect(port);
    await Promise.all([dashboard.opened, page.opened]);

    page.ws.send(
      JSON.stringify({
        type: 'error',
        payload: {
          message: 'user is not defined',
          stack: `ReferenceError: user is not defined\n    at render (http://localhost:5000/components/Card.html?t=1:12:5)`,
        },
      })
    );
    await until(() => dashboard.received.some((m) => m.type === 'error'));

    const error = dashboard.received.find((m) => m.type === 'error').payload;
    expect(error).toMatchObject({
      message: 'user is not defined',
      source: 'http://localhost:5000/components/Card.html',
      sourceKind: 'html',
      line: 12,
      column: 5,
      title: 'Undefined Variable',
    });
    expect(error.fix).toContain('user');
    // the page that reported it is not sent its own error back
    await new Promise((r) => setTimeout(r, 100));
    expect(page.received.some((m) => m.type === 'error')).toBe(false);
  });

  it('does the same for a .vel component', async () => {
    const port = await start();
    const dashboard = connect(port);
    const page = connect(port);
    await Promise.all([dashboard.opened, page.opened]);
    page.ws.send(JSON.stringify({ type: 'error', payload: { message: "Cannot read properties of undefined (reading 'name')", stack: 'TypeError\n    at f (/src/Card.vel:3:7)' } }));
    await until(() => dashboard.received.some((m) => m.type === 'error'));
    expect(dashboard.received.find((m) => m.type === 'error').payload).toMatchObject({ sourceKind: 'vel', line: 3, category: 'property_error' });
  });

  it('serves a client.js that a page can include with one script tag', async () => {
    const port = await start();
    const res = await fetch(`http://127.0.0.1:${port}/client.js`);
    expect(res.status).toBe(200);
    expect(res.headers.get('content-type')).toMatch(/javascript/);
    const code = await res.text();
    expect(code).toContain('__teloce_debug');
    expect(code).toContain('unhandledrejection');
  });

  it('relays logs too', async () => {
    const port = await start();
    const dashboard = connect(port);
    const page = connect(port);
    await Promise.all([dashboard.opened, page.opened]);
    page.ws.send(JSON.stringify({ type: 'log', payload: { level: 'warn', message: 'slow render' } }));
    await until(() => dashboard.received.some((m) => m.type === 'log' && m.payload.message === 'slow render'));
  });
});
