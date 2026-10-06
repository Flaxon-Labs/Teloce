import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createDebugClient, formatArg, type ClientSocket } from './client';

class FakeSocket implements ClientSocket {
  static instances: FakeSocket[] = [];
  readyState = 0;
  sent: any[] = [];
  closed = false;
  onopen: ClientSocket['onopen'] = null;
  onclose: ClientSocket['onclose'] = null;
  onerror: ClientSocket['onerror'] = null;
  constructor(public url: string) {
    FakeSocket.instances.push(this);
  }
  send(data: string) {
    this.sent.push(JSON.parse(data));
  }
  close() {
    this.closed = true;
  }
  open() {
    this.readyState = 1;
    this.onopen?.();
  }
  drop() {
    this.readyState = 3;
    this.onclose?.();
  }
}

function fakeWindow() {
  const listeners = new Map<string, (e: any) => void>();
  return {
    addEventListener: (t: string, l: (e: any) => void) => void listeners.set(t, l),
    removeEventListener: (t: string) => void listeners.delete(t),
    fire: (t: string, e: unknown) => listeners.get(t)?.(e),
    has: (t: string) => listeners.has(t),
  };
}

const URL_ = 'ws://localhost:9000/__teloce_debug';
let win: ReturnType<typeof fakeWindow>;
let con: { error: ReturnType<typeof vi.fn>; warn: ReturnType<typeof vi.fn> };
let originalError: ReturnType<typeof vi.fn>;

const make = (extra: Record<string, unknown> = {}) =>
  createDebugClient({ url: URL_, WebSocketCtor: FakeSocket, target: win, console: con as never, pageUrl: 'http://localhost:5000/card.html', ...extra });
const sock = () => FakeSocket.instances.at(-1)!;
const ofType = (t: string) => sock().sent.filter((m) => m.type === t);

beforeEach(() => {
  vi.useFakeTimers();
  FakeSocket.instances = [];
  win = fakeWindow();
  originalError = vi.fn();
  con = { error: originalError, warn: vi.fn() };
});
afterEach(() => vi.useRealTimers());

describe('formatArg', () => {
  it('formats strings, errors, objects and awkward values', () => {
    expect(formatArg('hi')).toBe('hi');
    expect(formatArg(new Error('bad'))).toContain('bad');
    expect(formatArg({ a: 1 })).toBe('{"a":1}');
    expect(formatArg(undefined)).toBe('undefined');
    const circular: any = {};
    circular.self = circular;
    expect(formatArg(circular)).toBe('[object Object]');
    expect(formatArg('x'.repeat(5000).split('').map(() => 1))).toHaveLength(2001);
  });
});

describe('connecting', () => {
  it('connects to the given url and says the page connected', () => {
    make();
    expect(sock().url).toBe(URL_);
    sock().open();
    expect(ofType('log')[0].payload).toMatchObject({ level: 'info', message: 'Page connected: http://localhost:5000/card.html' });
  });

  it('holds messages until the socket opens, then sends them in order', () => {
    const c = make();
    c.send('log', { n: 1 });
    c.send('log', { n: 2 });
    expect(sock().sent).toEqual([]);
    sock().open();
    expect(sock().sent.map((m) => m.payload.n ?? 'hello')).toEqual(['hello', 1, 2]);
  });

  it('keeps only the most recent messages while disconnected', () => {
    const c = make({ maxQueue: 3 });
    for (let i = 0; i < 10; i++) c.send('log', { n: i });
    sock().open();
    expect(sock().sent.map((m) => m.payload.n)).toEqual([7, 8, 9]);
  });

  it('reconnects after the connection drops, then gives up after maxReconnects', () => {
    make({ reconnectDelayMs: 100, maxReconnects: 2 });
    sock().open();
    sock().drop();
    vi.advanceTimersByTime(100);
    expect(FakeSocket.instances).toHaveLength(2);
    sock().drop();
    vi.advanceTimersByTime(100);
    expect(FakeSocket.instances).toHaveLength(3);
    sock().drop();
    vi.advanceTimersByTime(10000);
    expect(FakeSocket.instances).toHaveLength(3);
  });

  it('a successful connection resets the retry budget', () => {
    make({ reconnectDelayMs: 100, maxReconnects: 1 });
    sock().drop();
    vi.advanceTimersByTime(100);
    sock().open();
    sock().drop();
    vi.advanceTimersByTime(100);
    expect(FakeSocket.instances).toHaveLength(3);
  });

  it('survives a WebSocket constructor that throws', () => {
    const Throwing = class {
      constructor() {
        throw new Error('blocked');
      }
    } as never;
    expect(() => createDebugClient({ url: URL_, WebSocketCtor: Throwing, target: win })).not.toThrow();
  });

  it('reports isConnected correctly', () => {
    const c = make();
    expect(c.isConnected()).toBe(false);
    sock().open();
    expect(c.isConnected()).toBe(true);
  });
});

describe('reporting errors', () => {
  it('reports an uncaught error from an inline script in a .html file, with file, line and column', () => {
    make();
    sock().open();
    win.fire('error', {
      message: 'Uncaught ReferenceError: user is not defined',
      filename: 'http://localhost:5000/card.html',
      lineno: 14,
      colno: 9,
      error: new Error('user is not defined'),
    });
    expect(ofType('error')[0].payload).toMatchObject({
      message: 'Uncaught ReferenceError: user is not defined',
      source: 'http://localhost:5000/card.html',
      line: 14,
      column: 9,
    });
    expect(ofType('error')[0].payload.stack).toContain('user is not defined');
  });

  it('ignores resource-load failures (a missing image is not a script error)', () => {
    make();
    sock().open();
    win.fire('error', { type: 'error' });
    expect(ofType('error')).toEqual([]);
  });

  it('reports unhandled promise rejections, with the stack when it is an Error', () => {
    make();
    sock().open();
    win.fire('unhandledrejection', { reason: new Error('fetch failed') });
    win.fire('unhandledrejection', { reason: 'plain reason' });
    const [a, b] = ofType('error');
    expect(a.payload.message).toBe('fetch failed');
    expect(a.payload.stack).toBeTruthy();
    expect(b.payload.message).toBe('Unhandled promise rejection: plain reason');
  });

  it('forwards console.error and console.warn, and still calls the real console', () => {
    make();
    sock().open();
    con.error('Request failed', { status: 500 });
    con.warn('slow');
    expect(originalError).toHaveBeenCalledWith('Request failed', { status: 500 });
    expect(con.warn).not.toBe(undefined);
    const logs = ofType('log').filter((m) => m.payload.level !== 'info');
    expect(logs.map((m) => [m.payload.level, m.payload.message])).toEqual([
      ['error', 'Request failed {"status":500}'],
      ['warn', 'slow'],
    ]);
  });

  it('does not loop if sending itself logs to the console', () => {
    const c = make();
    sock().open();
    sock().send = () => {
      con.error('inside send');
    };
    expect(() => c.send('log', {})).not.toThrow();
    con.error('outer');
  });
});

describe('close', () => {
  it('stops listening, restores console, closes the socket and stops reconnecting', () => {
    const wrapped = { error: originalError, warn: con.warn };
    const c = make({ reconnectDelayMs: 100 });
    expect(con.error).not.toBe(wrapped.error);
    sock().open();
    c.close();

    expect(con.error).toBe(wrapped.error);
    expect(win.has('error')).toBe(false);
    expect(win.has('unhandledrejection')).toBe(false);
    expect(sock().closed).toBe(true);
    sock().drop();
    vi.advanceTimersByTime(5000);
    expect(FakeSocket.instances).toHaveLength(1);
  });
});
