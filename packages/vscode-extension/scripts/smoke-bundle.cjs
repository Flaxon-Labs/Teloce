// Release smoke test: runs the *built* extension bundle the way an installed
// copy would run, and fails loudly if anything is missing.
//
//   pnpm build && pnpm test:bundle
//
// It copies dist/ into an empty temp directory (so there is no node_modules
// anywhere to fall back on, like a real .vsix installed with
// --no-dependencies), activates the extension against a fake `vscode`, opens
// three documents, and checks the TypeScript diagnostics that come out.
'use strict';
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const Module = require('node:module');

const dist = path.join(__dirname, '..', 'dist');
if (!fs.existsSync(path.join(dist, 'extension.cjs'))) {
  console.error('dist/extension.cjs not found. Run `pnpm build` first.');
  process.exit(2);
}

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'teloce-smoke-'));
const extDir = path.join(tmp, 'ext');
fs.cpSync(dist, path.join(extDir, 'dist'), { recursive: true });
const ws = path.join(tmp, 'ws');
fs.mkdirSync(ws);

const failures = [];
const check = (cond, msg) => { console.log(`${cond ? 'ok  ' : 'FAIL'} ${msg}`); if (!cond) failures.push(msg); };

// ---- fake vscode -----------------------------------------------------------
const noop = () => ({ dispose() {} });
const ev = () => () => noop();
class Position { constructor(l, c) { this.line = l; this.character = c; } }
class Range { constructor(a, b) { this.start = a; this.end = b; } }
class Diagnostic { constructor(range, message, severity) { Object.assign(this, { range, message, severity }); } }
const stub = () => new Proxy(function () {}, { get: (_, k) => (k === 'then' ? undefined : stub()), apply: () => noop(), construct: () => ({}) });

const clipboard = [];
const messages = [];
const errors = [];
const collections = [];
const commandHandlers = new Map();
const opened = [];
const DEBUG_PORT = 9000 + Math.floor(Math.random() * 500) + 100;
function makeDoc(name, languageId, text) {
  const fsPath = path.join(ws, name);
  return {
    uri: { scheme: 'file', fsPath, toString: () => `file://${fsPath}` },
    languageId, getText: () => text,
    positionAt(o) { const b = text.slice(0, o); return new Position(b.split('\n').length - 1, o - (b.lastIndexOf('\n') + 1)); },
    offsetAt() { return 0; },
  };
}

const bad = makeDoc('Bad.vel', 'teloce', `<template><p/></template>
<script lang="ts">
export default {
  data() { return { draft: "" }; },
  methods: { send() { const n: number = this.draft; return n; } },
};
</script>
`);
const good = makeDoc('Good.vel', 'teloce', `<template><p/></template>
<script lang="ts">
interface Item { id: number }
export default {
  props: { user: { type: Object as PropType<{ name: string }>, required: true } },
  data() { return { items: [] as Item[] }; },
  methods: { name(): string { return this.user.name + this.items.length; } },
};
</script>
`);
const shell = makeDoc('shell.html', 'html', `<!doctype html><html><body>
<script lang="ts">const x: number = "never checked";</script></body></html>`);

const vscode = new Proxy({
  Position, Range, Diagnostic,
  Uri: { file: (p) => ({ scheme: 'file', fsPath: p }), parse: (s) => ({ scheme: 'http', fsPath: s }) },
  DiagnosticSeverity: { Error: 0, Warning: 1, Information: 2, Hint: 3 },
  DiagnosticTag: { Unnecessary: 1, Deprecated: 2 },
  CompletionItemKind: {}, SymbolKind: {},
  CompletionItem: class { constructor(l, k) { this.label = l; this.kind = k; } },
  MarkdownString: class { constructor() { this.value = ''; } appendCodeblock(c) { this.value += c; return this; } appendMarkdown(t) { this.value += t; return this; } },
  languages: new Proxy({
    createDiagnosticCollection: (name) => {
      const c = { name, entries: new Map(), set(u, d) { this.entries.set(u.toString(), d); }, delete(u) { this.entries.delete(u.toString()); }, has(u) { return this.entries.has(u.toString()); }, dispose() {} };
      collections.push(c); return c;
    },
  }, { get: (t, k) => (k in t ? t[k] : () => noop()) }),
  workspace: {
    textDocuments: [bad, good, shell],
    getConfiguration: (section) => ({ get: (k, d) => (section === 'teloce.debugger' && k === 'port' ? DEBUG_PORT : d), update() {} }),
    getWorkspaceFolder: () => undefined,
    onDidOpenTextDocument: ev(), onDidChangeTextDocument: ev(), onDidCloseTextDocument: ev(),
    onDidChangeConfiguration: ev(), onDidSaveTextDocument: ev(),
    createFileSystemWatcher: () => ({ onDidChange: ev(), onDidCreate: ev(), onDidDelete: ev(), dispose() {} }),
  },
  window: { activeTextEditor: undefined, showInformationMessage(m) { messages.push(m); }, showErrorMessage(m) { errors.push(m); }, createOutputChannel: () => ({ appendLine() {}, show() {}, dispose() {} }) },
  commands: { registerCommand: (id, fn) => { commandHandlers.set(id, fn); return noop(); } },
  env: { openExternal: (u) => { opened.push(u.fsPath); }, clipboard: { writeText: async (t) => { clipboard.push(t); } } },
  CancellationTokenSource: class { constructor() { this.token = {}; } },
}, { get: (t, k) => (k in t ? t[k] : stub()) });

const load = Module._load;
Module._load = function (request, ...rest) { return request === 'vscode' ? vscode : load.call(this, request, ...rest); };

// ---- run ---------------------------------------------------------------------
let ext;
try { ext = require(path.join(extDir, 'dist', 'extension.cjs')); }
catch (e) { console.error('FAIL loading bundle:', e.message); process.exit(1); }

check(typeof ext.activate === 'function' && typeof ext.deactivate === 'function', 'bundle exports activate and deactivate');
const context = { subscriptions: [], extensionPath: extDir, globalState: { get: () => false, update() {} } };
try { ext.activate(context); check(true, 'activate() ran without throwing'); }
catch (e) { check(false, `activate() threw: ${e.message}`); }

setTimeout(() => {
  const ts = collections.find((c) => c.name === 'teloce-ts');
  check(!!ts, 'TypeScript diagnostic collection was created');
  const got = (d) => ts && ts.entries.get(d.uri.toString());

  const badDiags = got(bad) || [];
  check(badDiags.length === 1 && badDiags[0].code === 2322, 'Bad.vel: one "string not assignable to number" error');
  check(badDiags[0] && badDiags[0].range.start.line === 4 && badDiags[0].range.start.character === 28, 'Bad.vel: error is on the right line and column');

  const goodDiags = got(good);
  check(Array.isArray(goodDiags) && goodDiags.length === 0, `Good.vel: no errors (interfaces, generics, PropType)${goodDiags && goodDiags.length ? ' -> ' + goodDiags.map((d) => d.message).join('; ') : ''}`);
  check(got(shell) === undefined, 'shell.html: page shells are ignored');

  runDebuggerChecks().then(() => finish());
}, 5000);

async function runDebuggerChecks() {
  const url = `http://localhost:${DEBUG_PORT}`;
  const probe = async (p) => { try { const r = await fetch(url + p); return { status: r.status, type: r.headers.get('content-type') || '', body: await r.text() }; } catch (e) { return { error: e.code || e.message }; } };

  check((await probe('/')).error !== undefined, 'debugger: nothing is listening before the command runs');
  check(commandHandlers.has('teloce.openDebugger') && commandHandlers.has('teloce.stopDebugger'), 'debugger: open/stop commands are registered');

  await commandHandlers.get('teloce.openDebugger')();
  check(errors.length === 0, `debugger: no error starting${errors.length ? ' -> ' + errors.join('; ') : ''}`);
  check(opened.length === 1 && opened[0] === url, 'debugger: browser was opened at the dashboard URL');

  const page = await probe('/');
  check(page.status === 200 && /teloce/i.test(page.body || ''), 'debugger: dashboard page is served by the extension itself');
  const js = await probe('/app.js');
  check(js.status === 200 && /javascript/.test(js.type) && (js.body || '').length > 1000, 'debugger: dashboard script is served');
  const css = await probe('/layout.css');
  check(css.status === 200, 'debugger: dashboard stylesheet is served');

  const wsOk = await new Promise((resolve) => {
    const ws = new WebSocket(`ws://localhost:${DEBUG_PORT}/__teloce_debug`);
    const t = setTimeout(() => resolve(false), 3000);
    ws.onopen = () => { clearTimeout(t); ws.close(); resolve(true); };
    ws.onerror = () => { clearTimeout(t); resolve(false); };
  });
  check(wsOk, 'debugger: WebSocket channel accepts connections');

  const client = await probe('/client.js');
  check(client.status === 200 && /javascript/.test(client.type) && /__teloce_debug/.test(client.body || ''), 'debugger: drop-in client.js is served');

  // A page (here: an error from a component-style .html file) reports to the
  // debugger, and the dashboard receives it with file kind, location and fix.
  const connect = () => {
    const ws = new WebSocket(`ws://localhost:${DEBUG_PORT}/__teloce_debug`);
    const received = [];
    ws.onmessage = (e) => received.push(JSON.parse(String(e.data)));
    return { ws, received, ready: new Promise((res) => { ws.onopen = () => res(true); ws.onerror = () => res(false); }) };
  };
  const dashboard = connect();
  const pageConn = connect();
  check((await dashboard.ready) && (await pageConn.ready), 'debugger: dashboard and page both connect');
  pageConn.ws.send(JSON.stringify({ type: 'error', payload: { message: 'user is not defined', stack: 'ReferenceError: user is not defined\n    at render (http://localhost:5000/components/Card.html?t=1:12:5)' } }));
  pageConn.ws.send(JSON.stringify({ type: 'error', payload: { message: "Cannot read properties of undefined (reading 'name')", stack: 'TypeError\n    at f (/src/Card.vel:3:7)' } }));
  await new Promise((r) => setTimeout(r, 600));
  const errs = dashboard.received.filter((m) => m.type === 'error').map((m) => m.payload);
  const htmlErr = errs.find((e) => e.sourceKind === 'html');
  const velErr = errs.find((e) => e.sourceKind === 'vel');
  check(!!htmlErr && htmlErr.line === 12 && htmlErr.column === 5 && /Card\.html$/.test(htmlErr.source) && htmlErr.title === 'Undefined Variable', 'debugger: .html component error arrives with kind, location and title');
  check(!!velErr && velErr.line === 3 && velErr.category === 'property_error', 'debugger: .vel component error arrives with kind, location and category');
  check(!pageConn.received.some((m) => m.type === 'error'), 'debugger: the page is not sent its own error back');
  pageConn.ws.close(); dashboard.ws.close();

  await commandHandlers.get('teloce.copyDebuggerScript')();
  check(clipboard.at(-1) === `<script src="http://localhost:${DEBUG_PORT}/client.js"></script>`, 'debugger: script tag is copied to the clipboard');

  await commandHandlers.get('teloce.openDebugger')();
  check(opened.length === 2 && errors.length === 0, 'debugger: running it again just reopens (no second server, no error)');

  await commandHandlers.get('teloce.stopDebugger')();
  check(messages.some((m) => /stopped/i.test(m)), 'debugger: stop command reports it stopped');
  check((await probe('/')).error !== undefined, 'debugger: server is really gone after stop');
}

function finish() {
  context.subscriptions.forEach((s) => { try { s.dispose(); } catch { /* ignore */ } });
  fs.rmSync(tmp, { recursive: true, force: true });
  console.log(failures.length ? `\nSMOKE FAILED (${failures.length})` : '\nSMOKE OK');
  process.exit(failures.length ? 1 : 0);
}
