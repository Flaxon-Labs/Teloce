import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createDebugWebSocket } from './index';

const broadcast = vi.fn();
const send = vi.fn();
const clients = new Set<{ id: string }>();
let onMessage: (event: unknown) => void = () => {};
vi.mock('@teloce/server', () => ({
  createWebSocketServer: vi.fn(() => ({
    broadcast,
    send,
    clients,
    close: vi.fn(),
    on: (event: string, handler: (e: unknown) => void) => {
      if (event === 'message') onMessage = handler;
    },
  })),
}));

const sent = () => broadcast.mock.calls.at(-1)![0] as {
  type: string;
  payload: Record<string, any>;
  source?: string;
  line?: number;
  column?: number;
};
const withStack = (message: string, stack: string) => Object.assign(new Error(message), { stack });

let ws: ReturnType<typeof createDebugWebSocket>;
beforeEach(() => {
  broadcast.mockClear();
  send.mockClear();
  clients.clear();
  ws = createDebugWebSocket({});
});

describe('sendError', () => {
  it('works out the file, line and kind of a .html component error by itself', () => {
    ws.sendError(withStack('x is not defined', 'ReferenceError\n    at render (/app/src/Card.html:12:5)'));
    const m = sent();
    expect(m.type).toBe('error');
    expect(m.payload).toMatchObject({ source: '/app/src/Card.html', sourceKind: 'html', line: 12, column: 5 });
    // also on the envelope, for older dashboards
    expect(m).toMatchObject({ source: '/app/src/Card.html', line: 12, column: 5 });
  });

  it('does the same for .vel components', () => {
    ws.sendError(withStack('boom', 'Error\n    at render (/app/Card.vel:3:1)'));
    expect(sent().payload).toMatchObject({ source: '/app/Card.vel', sourceKind: 'vel', line: 3 });
  });

  it('uses the location in a compile-error message when there is no stack', () => {
    ws.sendError('Failed to compile pages/Home.html:4:2: Unclosed tag');
    expect(sent().payload).toMatchObject({ source: 'pages/Home.html', sourceKind: 'html', line: 4, column: 2 });
  });

  it('prefers an explicitly passed source over what it infers', () => {
    ws.sendError(withStack('boom', 'Error\n    at f (/inferred/Card.html:1:1)'), '/explicit/Other.vel', 9, 8);
    const m = sent();
    expect(m.payload).toMatchObject({ source: '/explicit/Other.vel', sourceKind: 'vel', line: 9, column: 8 });
    expect(m).toMatchObject({ source: '/explicit/Other.vel', line: 9, column: 8 });
  });

  it('includes message, stack, a readable title and a category', () => {
    ws.sendError(withStack('foo is not defined', 'ReferenceError: foo is not defined\n    at f (/a/Card.html:1:1)'));
    const p = sent().payload;
    expect(p.message).toBe('foo is not defined');
    expect(p.stack).toContain('ReferenceError');
    expect(p.title).toBeTruthy();
    expect(p.category).toBeTruthy();
  });

  it('sends no location for an error that has none', () => {
    ws.sendError('something broke');
    const p = sent().payload;
    expect(p.source).toBeUndefined();
    expect(p.sourceKind).toBeUndefined();
  });

  it('accepts a plain string error', () => {
    ws.sendError('plain');
    expect(sent().payload.message).toBe('plain');
    expect(sent().payload.stack).toBeUndefined();
  });
});

describe('relaying messages from pages to the dashboard', () => {
  const page = { id: 'page' };
  const dashboard = { id: 'dash' };
  const fromPage = (message: unknown) => onMessage({ client: page, message });
  const delivered = () => send.mock.calls.map(([client, msg]) => ({ to: client.id, msg }));

  beforeEach(() => {
    clients.add(page).add(dashboard);
  });

  it('forwards a page error to the dashboard but not back to the page that sent it', () => {
    fromPage({ type: 'error', payload: { message: 'boom', stack: 'Error\n    at f (/app/Card.html:3:4)' } });
    const out = delivered();
    expect(out).toHaveLength(1);
    expect(out[0].to).toBe('dash');
    expect(out[0].msg.type).toBe('error');
  });

  it('derives the .html location, title and fix for a relayed error', () => {
    fromPage({ type: 'error', payload: { message: 'user is not defined', stack: 'ReferenceError\n    at render (http://localhost:5000/static/Card.html?t=9:12:5)' } });
    expect(delivered()[0].msg.payload).toMatchObject({
      source: 'http://localhost:5000/static/Card.html',
      sourceKind: 'html',
      line: 12,
      column: 5,
      title: 'Undefined Variable',
      category: 'reference_error',
    });
  });

  it('uses the file, line and column the browser reported when there is no stack', () => {
    fromPage({ type: 'error', payload: { message: 'Unexpected token', source: 'http://localhost:5000/page.html', line: 40, column: 7 } });
    expect(delivered()[0].msg.payload).toMatchObject({ source: 'http://localhost:5000/page.html', sourceKind: 'html', line: 40, column: 7 });
  });

  it("does not leak this server's own stack into a relayed error", () => {
    fromPage({ type: 'error', payload: { message: 'no stack from page' } });
    const payload = delivered()[0].msg.payload;
    expect(payload.stack).toBeUndefined();
    expect(payload.source).toBeUndefined();
  });

  it.each(['log', 'state', 'performance', 'component', 'render', 'event', 'compile'])('forwards %s messages unchanged', (type) => {
    fromPage({ type, payload: { value: 1 } });
    expect(delivered()[0].msg).toMatchObject({ type, payload: { value: 1 } });
  });

  it('ignores message types it does not relay (e.g. connected, reload, unknown)', () => {
    for (const type of ['connected', 'reload', 'ping', 'whatever']) fromPage({ type, payload: {} });
    expect(send).not.toHaveBeenCalled();
  });

  it('ignores malformed messages without throwing', () => {
    for (const bad of [null, undefined, 'text', 42, {}, { type: 5 }]) expect(() => fromPage(bad)).not.toThrow();
    expect(() => onMessage(undefined)).not.toThrow();
    expect(send).not.toHaveBeenCalled();
  });

  it('copes with a non-object payload', () => {
    expect(() => fromPage({ type: 'log', payload: 'just text' })).not.toThrow();
    expect(() => fromPage({ type: 'error', payload: null })).not.toThrow();
  });

  it('sends to every other client when several dashboards are open', () => {
    clients.add({ id: 'dash2' });
    fromPage({ type: 'log', payload: { level: 'info', message: 'x' } });
    expect(delivered().map((d) => d.to).sort()).toEqual(['dash', 'dash2']);
  });
});
