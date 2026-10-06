/**
 * Browser-side debug client. Reports a page's errors to the Teloce debugger
 * dashboard, so it works the same for any HTML: component-style `.html`
 * files, Flask/Django pages, or pages built from `.vel` components.
 *
 * Add one tag to a page:
 *   <script src="http://localhost:9000/client.js"></script>
 *
 * Everything the browser provides is passed in (window, WebSocket, console),
 * so this can be tested in Node without a DOM.
 */

export interface DebugClientOptions {
  /** WebSocket URL of the dashboard, e.g. ws://localhost:9000/__teloce_debug */
  url: string;
  WebSocketCtor: new (url: string) => ClientSocket;
  /** Where `error` / `unhandledrejection` events are listened for (window). */
  target: { addEventListener(type: string, listener: (event: any) => void): void; removeEventListener?(type: string, listener: (event: any) => void): void };
  /** The console to forward `error` / `warn` calls from. */
  console?: Pick<Console, 'error' | 'warn'>;
  /** The page's address, shown in the "connected" log line. */
  pageUrl?: string;
  reconnectDelayMs?: number;
  maxReconnects?: number;
  /** Messages kept while the socket is still connecting. */
  maxQueue?: number;
}

export interface ClientSocket {
  readyState: number;
  send(data: string): void;
  close(): void;
  onopen: ((event?: any) => void) | null;
  onclose: ((event?: any) => void) | null;
  onerror: ((event?: any) => void) | null;
}

const OPEN = 1;

/** Turns any console argument into text, safely and with a size limit. */
export function formatArg(value: unknown): string {
  if (typeof value === 'string') return value;
  if (value instanceof Error) return value.stack || `${value.name}: ${value.message}`;
  try {
    const json = JSON.stringify(value);
    if (json !== undefined) return json.length > 2000 ? `${json.slice(0, 2000)}…` : json;
  } catch {
    /* circular or otherwise unserialisable: fall through */
  }
  return String(value);
}

export function createDebugClient(options: DebugClientOptions) {
  const {
    url,
    WebSocketCtor,
    target,
    pageUrl,
    reconnectDelayMs = 2000,
    maxReconnects = 10,
    maxQueue = 50,
  } = options;

  let socket: ClientSocket | undefined;
  let reconnects = 0;
  let closed = false;
  let timer: ReturnType<typeof setTimeout> | undefined;
  const queue: string[] = [];
  let forwarding = false; // guards against console -> send -> console loops

  function send(type: string, payload: Record<string, unknown>): void {
    const data = JSON.stringify({ type, payload, timestamp: Date.now() });
    if (socket && socket.readyState === OPEN) {
      socket.send(data);
      return;
    }
    queue.push(data);
    if (queue.length > maxQueue) queue.shift();
  }

  function connect(): void {
    if (closed) return;
    let ws: ClientSocket;
    try {
      ws = new WebSocketCtor(url);
    } catch {
      scheduleReconnect();
      return;
    }
    socket = ws;
    ws.onopen = () => {
      reconnects = 0;
      for (const data of queue.splice(0)) ws.send(data);
    };
    ws.onclose = () => {
      if (socket === ws) socket = undefined;
      scheduleReconnect();
    };
    ws.onerror = () => {
      /* onclose follows; nothing useful to report from here */
    };
  }

  function scheduleReconnect(): void {
    if (closed || reconnects >= maxReconnects) return;
    reconnects++;
    timer = setTimeout(connect, reconnectDelayMs);
  }

  // Uncaught errors, including the ones thrown by inline <script> in .html files.
  const onError = (event: any) => {
    // Resource-load failures (a missing image) are plain Events with no message.
    if (!event || (!event.message && !event.error)) return;
    send('error', {
      message: event.message || String(event.error),
      stack: event.error && event.error.stack,
      source: event.filename || undefined,
      line: event.lineno || undefined,
      column: event.colno || undefined,
    });
  };

  const onRejection = (event: any) => {
    const reason = event && event.reason;
    send('error', {
      message: reason instanceof Error ? reason.message : `Unhandled promise rejection: ${formatArg(reason)}`,
      stack: reason instanceof Error ? reason.stack : undefined,
    });
  };

  target.addEventListener('error', onError);
  target.addEventListener('unhandledrejection', onRejection);

  // console.error / console.warn show up in the dashboard log as well.
  const originals: Partial<Record<'error' | 'warn', (...args: unknown[]) => void>> = {};
  const con = options.console;
  if (con) {
    for (const level of ['error', 'warn'] as const) {
      const original = con[level].bind(con) as (...args: unknown[]) => void;
      originals[level] = con[level] as (...args: unknown[]) => void;
      con[level] = (...args: unknown[]) => {
        original(...args);
        if (forwarding) return;
        forwarding = true;
        try {
          send('log', { level, message: args.map(formatArg).join(' '), timestamp: Date.now() });
        } finally {
          forwarding = false;
        }
      };
    }
  }

  connect();
  send('log', { level: 'info', message: `Page connected${pageUrl ? `: ${pageUrl}` : ''}`, timestamp: Date.now() });

  return {
    send,
    /** True once the socket is open. */
    isConnected: () => socket !== undefined && socket.readyState === OPEN,
    /** Stops reporting and restores `console`. */
    close(): void {
      closed = true;
      if (timer) clearTimeout(timer);
      target.removeEventListener?.('error', onError);
      target.removeEventListener?.('unhandledrejection', onRejection);
      if (con) {
        for (const level of ['error', 'warn'] as const) {
          if (originals[level]) con[level] = originals[level] as never;
        }
      }
      socket?.close();
    },
  };
}
