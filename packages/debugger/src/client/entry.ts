/**
 * Entry point for the <script src=".../client.js"> tag. Bundled to a single
 * browser file by scripts/build-dashboard.mjs.
 */
import { createDebugClient, type ClientSocket } from './client';

declare const window: any;
declare const document: any;
declare const location: { href: string; protocol: string; host: string };

(function start() {
  if (typeof window === 'undefined' || window.__TELOCE_DEBUG_CLIENT__) return;

  // The dashboard is wherever this script was loaded from; data-url overrides.
  const script = document.currentScript as { src?: string; getAttribute(n: string): string | null } | null;
  let wsUrl = script?.getAttribute('data-url') || '';
  if (!wsUrl && script?.src) {
    try {
      const u = new URL(script.src);
      wsUrl = `${u.protocol === 'https:' ? 'wss:' : 'ws:'}//${u.host}/__teloce_debug`;
    } catch {
      /* fall through to the default below */
    }
  }
  if (!wsUrl) wsUrl = 'ws://localhost:9000/__teloce_debug';

  window.__TELOCE_DEBUG_CLIENT__ = createDebugClient({
    url: wsUrl,
    WebSocketCtor: window.WebSocket as new (url: string) => ClientSocket,
    target: window,
    console: window.console,
    pageUrl: location.href,
  });
})();
