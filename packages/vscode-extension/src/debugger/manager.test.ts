import * as http from 'node:http';
import * as net from 'node:net';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { DebuggerManager, isPortOpen, isTeloceDashboard, type DashboardServer } from './manager.js';

const listeners: net.Server[] = [];
afterEach(async () => {
  await Promise.all(listeners.splice(0).map((s) => new Promise((r) => s.close(r))));
});

async function listenTcp(): Promise<number> {
  const server = net.createServer().listen(0, '127.0.0.1');
  listeners.push(server);
  await new Promise((r) => server.once('listening', r));
  return (server.address() as net.AddressInfo).port;
}

async function listenHttp(body: string, status = 200): Promise<{ url: string }> {
  const server = http.createServer((_, res) => {
    res.writeHead(status, { 'Content-Type': 'text/html' });
    res.end(body);
  });
  server.listen(0, '127.0.0.1');
  listeners.push(server as unknown as net.Server);
  await new Promise((r) => server.once('listening', r));
  return { url: `http://127.0.0.1:${(server.address() as net.AddressInfo).port}` };
}

describe('isPortOpen', () => {
  it('is true for a listening port and false once it closes', async () => {
    const port = await listenTcp();
    expect(await isPortOpen('127.0.0.1', port)).toBe(true);
    await new Promise((r) => listeners.pop()!.close(r));
    expect(await isPortOpen('127.0.0.1', port)).toBe(false);
  });
});

describe('isTeloceDashboard', () => {
  it('recognises the Teloce dashboard page', async () => {
    const { url } = await listenHttp('<html><h1>Teloce Debugger</h1></html>');
    expect(await isTeloceDashboard(url)).toBe(true);
  });

  it('rejects other programs and error pages', async () => {
    expect(await isTeloceDashboard((await listenHttp('<h1>Some other app</h1>')).url)).toBe(false);
    expect(await isTeloceDashboard((await listenHttp('Teloce', 500)).url)).toBe(false);
  });

  it('is false when nothing is listening', async () => {
    const port = await listenTcp();
    await new Promise((r) => listeners.pop()!.close(r));
    expect(await isTeloceDashboard(`http://127.0.0.1:${port}`)).toBe(false);
  });
});

function fakeServe() {
  const servers: (DashboardServer & { start: ReturnType<typeof vi.fn>; close: ReturnType<typeof vi.fn> })[] = [];
  const serve = vi.fn(() => {
    const s = { start: vi.fn(async () => {}), close: vi.fn(async () => {}) };
    servers.push(s);
    return s;
  });
  return { serve, servers, load: async () => serve };
}

describe('DebuggerManager', () => {
  it('is not running until started', () => {
    const m = new DebuggerManager(fakeServe().load);
    expect(m.running).toBe(false);
    expect(m.url).toBeUndefined();
  });

  it('starts a server on the requested host and port', async () => {
    const f = fakeServe();
    const m = new DebuggerManager(f.load);
    expect(await m.start('localhost', 9000)).toBe('http://localhost:9000');
    expect(f.serve).toHaveBeenCalledWith({ host: 'localhost', port: 9000 });
    expect(f.servers[0].start).toHaveBeenCalledOnce();
    expect(m.running).toBe(true);
    expect(m.url).toBe('http://localhost:9000');
  });

  it('does not start a second server for the same address', async () => {
    const f = fakeServe();
    const m = new DebuggerManager(f.load);
    await m.start('localhost', 9000);
    await m.start('localhost', 9000);
    expect(f.serve).toHaveBeenCalledOnce();
  });

  it('restarts when asked for a different port', async () => {
    const f = fakeServe();
    const m = new DebuggerManager(f.load);
    await m.start('localhost', 9000);
    await m.start('localhost', 9001);
    expect(f.servers[0].close).toHaveBeenCalledOnce();
    expect(f.servers).toHaveLength(2);
    expect(m.url).toBe('http://localhost:9001');
  });

  it('loads the server code lazily, once', async () => {
    const f = fakeServe();
    const load = vi.fn(f.load);
    const m = new DebuggerManager(load);
    expect(load).not.toHaveBeenCalled();
    await m.start('localhost', 9000);
    await m.stop();
    await m.start('localhost', 9000);
    expect(load).toHaveBeenCalledTimes(2); // cheap: module is cached by the runtime
  });

  it('is left not running if the server fails to start', async () => {
    const m = new DebuggerManager(async () => () => ({
      start: async () => {
        throw new Error('EADDRINUSE');
      },
      close: async () => {},
    }));
    await expect(m.start('localhost', 9000)).rejects.toThrow('EADDRINUSE');
    expect(m.running).toBe(false);
    expect(m.url).toBeUndefined();
  });

  it('stops the server and reports whether it was running', async () => {
    const f = fakeServe();
    const m = new DebuggerManager(f.load);
    expect(await m.stop()).toBe(false);
    await m.start('localhost', 9000);
    expect(await m.stop()).toBe(true);
    expect(f.servers[0].close).toHaveBeenCalledOnce();
    expect(m.running).toBe(false);
    expect(await m.stop()).toBe(false);
  });

  it('stops the server on dispose (extension deactivated)', async () => {
    const f = fakeServe();
    const m = new DebuggerManager(f.load);
    await m.start('localhost', 9000);
    m.dispose();
    await Promise.resolve();
    expect(f.servers[0].close).toHaveBeenCalled();
  });

  it('dispose never throws, even if closing fails', async () => {
    const m = new DebuggerManager(async () => () => ({
      start: async () => {},
      close: async () => {
        throw new Error('already closed');
      },
    }));
    await m.start('localhost', 9000);
    expect(() => m.dispose()).not.toThrow();
  });
});
