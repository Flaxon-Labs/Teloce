/**
 * Runs the Teloce debugger dashboard inside the extension host, so it works as
 * soon as the extension is installed: no CLI, no terminal, nothing else to set
 * up. (`teloce debug` still works and serves the same dashboard.)
 */

import type * as vscode from 'vscode';

export interface DashboardServer {
  start(): Promise<void>;
  close(): Promise<void>;
}

export type ServeDashboard = (options: { port: number; host: string }) => DashboardServer;

/** Loaded lazily so the server code costs nothing until it is first used. */
async function defaultLoad(): Promise<ServeDashboard> {
  const mod = await import('@teloce/debugger');
  return mod.serveDashboard as ServeDashboard;
}

/** True if something is accepting connections at host:port. */
export async function isPortOpen(host: string, port: number, timeoutMs = 1000): Promise<boolean> {
  const net = await import('node:net');
  return new Promise((resolve) => {
    const socket = net.connect({ host, port });
    const done = (open: boolean) => {
      socket.destroy();
      resolve(open);
    };
    socket.setTimeout(timeoutMs);
    socket.once('connect', () => done(true));
    socket.once('timeout', () => done(false));
    socket.once('error', () => done(false));
  });
}

/** True if the page at `url` is the Teloce dashboard (not some other program). */
export async function isTeloceDashboard(url: string, timeoutMs = 1500): Promise<boolean> {
  try {
    const res = await fetch(url, { signal: AbortSignal.timeout(timeoutMs) });
    return res.ok && /teloce/i.test(await res.text());
  } catch {
    return false;
  }
}

export class DebuggerManager implements vscode.Disposable {
  private server: DashboardServer | undefined;
  private current: { host: string; port: number } | undefined;

  constructor(private readonly load: () => Promise<ServeDashboard> = defaultLoad) {}

  /** True while this extension's own server is running. */
  get running(): boolean {
    return this.server !== undefined;
  }

  get url(): string | undefined {
    return this.current && `http://${this.current.host}:${this.current.port}`;
  }

  /** Starts the server (if not already running there) and returns its URL. */
  async start(host: string, port: number): Promise<string> {
    if (this.server && this.current?.host === host && this.current.port === port) {
      return this.url!;
    }
    // Different address requested: restart there.
    if (this.server) await this.stop();

    const serveDashboard = await this.load();
    const server = serveDashboard({ host, port });
    await server.start(); // rejects if the port is taken; nothing is left running
    this.server = server;
    this.current = { host, port };
    return this.url!;
  }

  /** Stops this extension's server. Returns false if it was not running. */
  async stop(): Promise<boolean> {
    const server = this.server;
    if (!server) return false;
    this.server = undefined;
    this.current = undefined;
    await server.close();
    return true;
  }

  dispose(): void {
    void this.stop().catch(() => {});
  }
}
