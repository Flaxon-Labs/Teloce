/**
 * WebSocket - streams live errors/state to the dashboard page
 */

import { createWebSocketServer, type WebSocketServer } from '@teloce/server';
import { parseError, translateError } from '../error-parser';
import { getSourceKind } from '../source';

export type DebugMessageType =
  | 'error'
  | 'state'
  | 'performance'
  | 'compile'
  | 'render'
  | 'component'
  | 'event'
  | 'log'
  | 'connected'
  | 'disconnected';

/** Message types a page may send for the dashboard to display. */
const RELAYED_TYPES = new Set<DebugMessageType>([
  'error',
  'state',
  'performance',
  'compile',
  'render',
  'component',
  'event',
  'log',
]);

export interface DebugMessage<T = any> {
  /**
   * Message type
   */
  type: DebugMessageType;

  /**
   * Message payload
   */
  payload: T;

  /**
   * Timestamp
   */
  timestamp: number;

  /**
   * Source file
   */
  source?: string;

  /**
   * Line number
   */
  line?: number;

  /**
   * Column number
   */
  column?: number;
}

export interface DebugWebSocket {
  /**
   * WebSocket server
   */
  server: WebSocketServer;

  /**
   * Send an error message
   */
  sendError: (error: Error | string, source?: string, line?: number, column?: number) => void;

  /**
   * Send state update
   */
  sendState: (state: Record<string, any>, component?: string) => void;

  /**
   * Send performance data
   */
  sendPerformance: (data: any) => void;

  /**
   * Send compile result
   */
  sendCompile: (result: any) => void;

  /**
   * Send render event
   */
  sendRender: (component: string, time: number) => void;

  /**
   * Send log message
   */
  sendLog: (level: 'info' | 'warn' | 'error' | 'debug', message: string, data?: any) => void;

  /**
   * Broadcast to all clients
   */
  broadcast: (message: DebugMessage) => void;

  /**
   * Close the server
   */
  close: () => Promise<void>;
}

/**
 * Create a debug WebSocket server
 */
export function createDebugWebSocket(
  server: any,
  options: { path?: string } = {}
): DebugWebSocket {
  const wsServer = createWebSocketServer(server, {
    path: options.path || '/__teloce_debug',
  });

  function createMessage<T>(
    type: DebugMessageType,
    payload: T,
    source?: string,
    line?: number,
    column?: number
  ): DebugMessage<T> {
    return {
      type,
      payload,
      timestamp: Date.now(),
      source,
      line,
      column,
    };
  }

  /**
   * Builds the message the dashboard shows for an error: works out where it
   * happened (a .vel or .html component, say) unless the caller already said,
   * and attaches a readable title and fix. Explicit arguments win over
   * anything inferred.
   */
  function buildErrorMessage(
    error: Error | string,
    source?: string,
    line?: number,
    column?: number
  ): DebugMessage {
    const message = typeof error === 'string' ? error : error.message;
    const stack = typeof error === 'object' ? error.stack : undefined;

    const parsed = parseError(error);
    const translation = translateError(error);
    const file = source ?? parsed.file;
    const where = {
      source: file,
      line: source !== undefined ? line : (line ?? parsed.line),
      column: source !== undefined ? column : (column ?? parsed.column),
    };

    return createMessage(
      'error',
      {
        message,
        stack,
        title: translation.title,
        description: translation.description,
        fix: translation.fix,
        category: parsed.category,
        source: where.source,
        sourceKind: file ? getSourceKind(file) : undefined,
        line: where.line,
        column: where.column,
      },
      where.source,
      where.line,
      where.column
    );
  }

  /** Sends to every connected client except `except` (the page that sent it). */
  function relay(message: DebugMessage, except?: { id: string }): void {
    for (const client of wsServer.clients) {
      if (client.id !== except?.id) wsServer.send(client, message);
    }
  }

  // Pages (and anything else) can report to the dashboard by sending debug
  // messages over this same WebSocket; see the drop-in client.js script.
  wsServer.on('message', (event: { client: { id: string }; message: any }) => {
    const message = event?.message;
    if (!message || typeof message.type !== 'string') return;
    if (!RELAYED_TYPES.has(message.type as DebugMessageType)) return;
    const payload = message.payload && typeof message.payload === 'object' ? message.payload : {};

    if (message.type === 'error') {
      const error = Object.assign(new Error(String(payload.message ?? 'Unknown error')), {
        // An error from a page has the page's stack, not this server's.
        stack: typeof payload.stack === 'string' ? payload.stack : undefined,
      });
      relay(
        buildErrorMessage(
          error,
          typeof payload.source === 'string' ? payload.source : undefined,
          typeof payload.line === 'number' ? payload.line : undefined,
          typeof payload.column === 'number' ? payload.column : undefined
        ),
        event.client
      );
      return;
    }

    relay(createMessage(message.type as DebugMessageType, payload), event.client);
  });

  function broadcast(message: DebugMessage): void {
    wsServer.broadcast(message);
  }

  return {
    server: wsServer,

    sendError(error: Error | string, source?: string, line?: number, column?: number): void {
      broadcast(buildErrorMessage(error, source, line, column));
    },

    sendState(state: Record<string, any>, component?: string): void {
      broadcast(createMessage('state', { state, component }));
    },

    sendPerformance(data: any): void {
      broadcast(createMessage('performance', data));
    },

    sendCompile(result: any): void {
      broadcast(createMessage('compile', result));
    },

    sendRender(component: string, time: number): void {
      broadcast(createMessage('render', { component, time }));
    },

    sendLog(level: 'info' | 'warn' | 'error' | 'debug', message: string, data?: any): void {
      broadcast(createMessage('log', { level, message, data }));
    },

    broadcast,

    async close(): Promise<void> {
      await wsServer.close();
    },
  };
}

/**
 * Send an error message
 */
export function sendError(
  ws: DebugWebSocket,
  error: Error | string,
  source?: string,
  line?: number,
  column?: number
): void {
  ws.sendError(error, source, line, column);
}

/**
 * Send state update
 */
export function sendState(
  ws: DebugWebSocket,
  state: Record<string, any>,
  component?: string
): void {
  ws.sendState(state, component);
}

/**
 * Send performance data
 */
export function sendPerformance(
  ws: DebugWebSocket,
  data: any
): void {
  ws.sendPerformance(data);
}