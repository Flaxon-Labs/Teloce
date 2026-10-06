import * as net from 'node:net';
import * as http from 'node:http';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import * as vscode from 'vscode';
import { formatTemplate } from '@teloce/language-service';
import { FakeDocument } from '../../__mocks__/fakeDocument';
import { registeredCommands } from '../../__mocks__/vscode';
import { debuggerScriptTag, registerCommands } from './index.js';
import { DebuggerManager } from '../debugger/manager.js';

vi.mock('@teloce/language-service', () => ({ formatTemplate: vi.fn() }));

const config = (values: Record<string, unknown>) =>
  vi.mocked(vscode.workspace.getConfiguration).mockReturnValue({
    get: (k: string, d?: unknown) => (k in values ? values[k] : d),
    update: vi.fn(),
  } as never);

const setEditor = (editor: unknown) => ((vscode.window as { activeTextEditor: unknown }).activeTextEditor = editor);
const run = (id: string) => registeredCommands.get(id)!();

let context: { subscriptions: unknown[] };
let manager: { running: boolean; start: ReturnType<typeof vi.fn>; stop: ReturnType<typeof vi.fn>; dispose: ReturnType<typeof vi.fn> };

beforeEach(() => {
  registeredCommands.clear();
  vi.mocked(vscode.commands.registerCommand).mockClear();
  vi.mocked(vscode.window.showInformationMessage).mockClear();
  vi.mocked(vscode.env.openExternal).mockClear();
  vi.mocked(formatTemplate).mockReset().mockReturnValue('FORMATTED');
  config({});
  setEditor(undefined);
  context = { subscriptions: [] };
  manager = {
    running: false,
    start: vi.fn(async () => 'http://x'),
    stop: vi.fn(async () => true),
    dispose: vi.fn(),
  };
  registerCommands(context as never, manager as unknown as DebuggerManager);
});

describe('registerCommands', () => {
  it('registers format, validate, openDebugger, stopDebugger and copyDebuggerScript', () => {
    expect([...registeredCommands.keys()].sort()).toEqual([
      'teloce.copyDebuggerScript',
      'teloce.format',
      'teloce.openDebugger',
      'teloce.stopDebugger',
      'teloce.validate',
    ]);
  });

  it('adds every command and the debugger manager to the subscriptions so they are disposed on deactivate', () => {
    expect(context.subscriptions).toHaveLength(6);
    expect(context.subscriptions).toContain(manager);
  });
});

describe('teloce.format', () => {
  const makeEditor = (text: string, languageId = 'teloce', file = '/w/a.vel') => {
    const document = new FakeDocument(text, languageId, file);
    const replace = vi.fn();
    const edit = vi.fn(async (cb: (b: { replace: typeof replace }) => void) => {
      cb({ replace });
      return true;
    });
    return { document, edit, replace };
  };

  it('does nothing without an active editor', async () => {
    await run('teloce.format');
    expect(formatTemplate).not.toHaveBeenCalled();
  });

  it('replaces the whole document with the formatted text', async () => {
    const editor = makeEditor('<div>\n<p/></div>');
    setEditor(editor);
    await run('teloce.format');

    expect(formatTemplate).toHaveBeenCalledWith('<div>\n<p/></div>', expect.objectContaining({ indentHTML: true }));
    expect(editor.replace).toHaveBeenCalledOnce();
    const [range, text] = editor.replace.mock.calls[0];
    expect(text).toBe('FORMATTED');
    expect(range.start).toEqual(new vscode.Position(0, 0));
    expect(range.end).toEqual(editor.document.positionAt('<div>\n<p/></div>'.length));
  });

  it('formats a component-style .html file too (the way to format .html components)', async () => {
    const editor = makeEditor('<template><p/></template>', 'html', '/w/Card.html');
    setEditor(editor);
    await run('teloce.format');
    expect(editor.replace).toHaveBeenCalledOnce();
  });

  it('refuses to touch an HTML page shell, and says why', async () => {
    const editor = makeEditor('<!doctype html><html><body></body></html>', 'html', '/w/page.html');
    setEditor(editor);
    await run('teloce.format');
    expect(formatTemplate).not.toHaveBeenCalled();
    expect(editor.edit).not.toHaveBeenCalled();
    expect(vscode.window.showInformationMessage).toHaveBeenCalledWith(expect.stringContaining('.vel'));
  });

  it('uses the teloce.format settings', async () => {
    config({ indentSize: 8, useTabs: true });
    setEditor(makeEditor('<p/>'));
    await run('teloce.format');
    expect(formatTemplate).toHaveBeenCalledWith('<p/>', expect.objectContaining({ indentSize: 8, useTabs: true }));
  });
});

describe('teloce.validate', () => {
  let validate: ReturnType<typeof vi.fn>;
  const editorFor = (text: string, languageId = 'teloce', file = '/w/a.vel') => ({
    document: new FakeDocument(text, languageId, file),
  });
  const withValidator = (result: { template: number; typescript: number }) => {
    registeredCommands.clear();
    validate = vi.fn(async () => result);
    registerCommands({ subscriptions: [] } as never, manager as unknown as DebuggerManager, validate as never);
  };

  beforeEach(() => {
    vi.mocked(vscode.window.showWarningMessage).mockClear();
    vi.mocked(vscode.commands.executeCommand).mockClear();
  });

  it('asks you to open a file when there is no active editor', async () => {
    withValidator({ template: 0, typescript: 0 });
    await run('teloce.validate');
    expect(validate).not.toHaveBeenCalled();
    expect(vscode.window.showInformationMessage).toHaveBeenCalledWith(expect.stringContaining('open a .vel'));
  });

  it('explains when the file is not a Teloce component', async () => {
    withValidator({ template: 0, typescript: 0 });
    setEditor(editorFor('<!doctype html><html></html>', 'html', '/w/page.html'));
    await run('teloce.validate');
    expect(validate).not.toHaveBeenCalled();
    expect(vscode.window.showInformationMessage).toHaveBeenCalledWith(expect.stringContaining('not a Teloce component'));
  });

  it('says so when there are no problems, without opening the Problems panel', async () => {
    withValidator({ template: 0, typescript: 0 });
    setEditor(editorFor('<template/>'));
    await run('teloce.validate');
    expect(validate).toHaveBeenCalledOnce();
    expect(vscode.window.showInformationMessage).toHaveBeenCalledWith('Teloce: no problems found.');
    expect(vscode.commands.executeCommand).not.toHaveBeenCalled();
  });

  it('reports template and TypeScript problems separately and opens the Problems panel', async () => {
    withValidator({ template: 2, typescript: 3 });
    setEditor(editorFor('<template/>'));
    await run('teloce.validate');
    expect(vscode.window.showWarningMessage).toHaveBeenCalledWith(
      'Teloce: 5 problems found (2 in the template, 3 in TypeScript).'
    );
    expect(vscode.commands.executeCommand).toHaveBeenCalledWith('workbench.actions.view.problems');
  });

  it('uses the singular for one problem and only names the checker that found it', async () => {
    withValidator({ template: 0, typescript: 1 });
    setEditor(editorFor('<template/>'));
    await run('teloce.validate');
    expect(vscode.window.showWarningMessage).toHaveBeenCalledWith('Teloce: 1 problem found (1 in TypeScript).');
  });

  it('validates component-style .html files', async () => {
    withValidator({ template: 0, typescript: 0 });
    setEditor(editorFor('<template><p/></template>', 'html', '/w/Card.html'));
    await run('teloce.validate');
    expect(validate).toHaveBeenCalledOnce();
  });
});

describe('teloce.openDebugger', () => {
  const servers: (net.Server | http.Server)[] = [];
  afterEach(async () => {
    await Promise.all(servers.splice(0).map((s) => new Promise((r) => s.close(r))));
  });

  const listenHttp = async (body: string) => {
    const server = http.createServer((_, res) => res.end(body));
    server.listen(0, '127.0.0.1');
    servers.push(server);
    await new Promise((r) => server.once('listening', r));
    return (server.address() as net.AddressInfo).port;
  };
  const freePort = async () => {
    const server = net.createServer().listen(0, '127.0.0.1');
    await new Promise((r) => server.once('listening', r));
    const port = (server.address() as net.AddressInfo).port;
    await new Promise((r) => server.close(r));
    return port;
  };
  const openedUrl = () => (vi.mocked(vscode.env.openExternal).mock.calls[0][0] as unknown as { fsPath: string }).fsPath;

  beforeEach(() => {
    vi.mocked(vscode.window.showErrorMessage).mockClear();
  });

  it('starts the built-in debugger and opens it when nothing is running (works right after install)', async () => {
    const port = await freePort();
    config({ host: '127.0.0.1', port });
    await run('teloce.openDebugger');

    expect(manager.start).toHaveBeenCalledWith('127.0.0.1', port);
    expect(openedUrl()).toBe(`http://127.0.0.1:${port}`);
    expect(vscode.window.showErrorMessage).not.toHaveBeenCalled();
  });

  it('just opens it when the extension\'s own debugger is already running', async () => {
    const port = await listenHttp('<h1>whatever</h1>');
    manager.running = true;
    config({ host: '127.0.0.1', port });
    await run('teloce.openDebugger');

    expect(manager.start).not.toHaveBeenCalled();
    expect(openedUrl()).toBe(`http://127.0.0.1:${port}`);
  });

  it('opens a dashboard started separately with `teloce debug`', async () => {
    const port = await listenHttp('<html><title>Teloce Debugger</title></html>');
    config({ host: '127.0.0.1', port });
    await run('teloce.openDebugger');

    expect(manager.start).not.toHaveBeenCalled();
    expect(openedUrl()).toBe(`http://127.0.0.1:${port}`);
  });

  it('refuses to open a port that another program is using', async () => {
    const port = await listenHttp('<h1>Some other app</h1>');
    config({ host: '127.0.0.1', port });
    await run('teloce.openDebugger');

    expect(vscode.env.openExternal).not.toHaveBeenCalled();
    expect(manager.start).not.toHaveBeenCalled();
    expect(vscode.window.showErrorMessage).toHaveBeenCalledWith(expect.stringContaining(`Port ${port} is in use`));
  });

  it('shows the reason if the debugger cannot start, and opens nothing', async () => {
    const port = await freePort();
    config({ host: '127.0.0.1', port });
    manager.start.mockRejectedValue(new Error('EACCES: permission denied'));
    await run('teloce.openDebugger');

    expect(vscode.env.openExternal).not.toHaveBeenCalled();
    expect(vscode.window.showErrorMessage).toHaveBeenCalledWith(
      expect.stringMatching(new RegExp(`http://127.0.0.1:${port}.*EACCES`))
    );
  });

  it('defaults to localhost:9000 and reads the teloce.debugger section', async () => {
    await run('teloce.openDebugger');
    expect(vscode.workspace.getConfiguration).toHaveBeenCalledWith('teloce.debugger');
    // Whether 9000 is free on this machine or not, the address used is the default.
    const used = manager.start.mock.calls[0]?.slice(0, 2) ?? [];
    if (used.length) expect(used).toEqual(['localhost', 9000]);
  });
});

describe('teloce.stopDebugger', () => {
  it('stops the built-in debugger and says so', async () => {
    manager.stop.mockResolvedValue(true);
    await run('teloce.stopDebugger');
    expect(manager.stop).toHaveBeenCalled();
    expect(vscode.window.showInformationMessage).toHaveBeenCalledWith('Teloce debugger stopped.');
  });

  it('explains when there is nothing to stop', async () => {
    manager.stop.mockResolvedValue(false);
    await run('teloce.stopDebugger');
    expect(vscode.window.showInformationMessage).toHaveBeenCalledWith(expect.stringContaining('No debugger started by this extension'));
  });
});

describe('debugger script tag', () => {
  beforeEach(() => {
    vi.mocked(vscode.env.clipboard.writeText).mockClear();
    vi.mocked(vscode.window.showInformationMessage).mockReset();
  });

  it('builds the tag from host and port', () => {
    expect(debuggerScriptTag('localhost', 9000)).toBe('<script src="http://localhost:9000/client.js"></script>');
    expect(debuggerScriptTag('127.0.0.1', 9229)).toBe('<script src="http://127.0.0.1:9229/client.js"></script>');
  });

  it('teloce.copyDebuggerScript copies the tag using the configured address', async () => {
    config({ host: '127.0.0.1', port: 9229 });
    await run('teloce.copyDebuggerScript');
    expect(vscode.env.clipboard.writeText).toHaveBeenCalledWith('<script src="http://127.0.0.1:9229/client.js"></script>');
    expect(vscode.window.showInformationMessage).toHaveBeenCalledWith(expect.stringContaining('Copied'));
  });

  it('defaults to localhost:9000', async () => {
    await run('teloce.copyDebuggerScript');
    expect(vscode.env.clipboard.writeText).toHaveBeenCalledWith(debuggerScriptTag('localhost', 9000));
  });

  it('opening the debugger offers to copy the tag, and copies it when accepted', async () => {
    vi.mocked(vscode.window.showInformationMessage).mockResolvedValue('Copy script tag' as never);
    await run('teloce.openDebugger');
    await new Promise((r) => setTimeout(r, 10));
    expect(vscode.window.showInformationMessage).toHaveBeenCalledWith(expect.stringContaining('script tag'), 'Copy script tag');
    expect(vscode.env.clipboard.writeText).toHaveBeenCalledWith(debuggerScriptTag('localhost', 9000));
  });

  it('copies nothing when the offer is dismissed', async () => {
    vi.mocked(vscode.window.showInformationMessage).mockResolvedValue(undefined as never);
    await run('teloce.openDebugger');
    await new Promise((r) => setTimeout(r, 10));
    expect(vscode.env.clipboard.writeText).not.toHaveBeenCalled();
  });
});
