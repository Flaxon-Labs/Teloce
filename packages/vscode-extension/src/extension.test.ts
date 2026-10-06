import * as os from 'node:os';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import * as vscode from 'vscode';
import { FakeDocument } from '../__mocks__/fakeDocument';
import { createdCollections, registeredCommands } from '../__mocks__/vscode';
import { activate, deactivate } from './extension.js';

vi.mock('@teloce/language-service', () => ({
  getCompletionItems: vi.fn(() => []),
  getDiagnostics: vi.fn(() => []),
  getHoverInfo: vi.fn(),
  formatTemplate: vi.fn(),
}));

const makeContext = (firstTime = true) => {
  const state = new Map<string, unknown>(firstTime ? [] : [['teloce.firstTime', false]]);
  return {
    subscriptions: [] as { dispose(): void }[],
    extensionPath: os.tmpdir(),
    globalState: {
      get: vi.fn((k: string, d?: unknown) => (state.has(k) ? state.get(k) : d)),
      update: vi.fn(async (k: string, v: unknown) => void state.set(k, v)),
    },
  };
};

const SELECTOR = [{ language: 'teloce' }, { language: 'html', scheme: 'file' }];

beforeEach(() => {
  vi.spyOn(console, 'log').mockImplementation(() => {});
  registeredCommands.clear();
  createdCollections.length = 0;
  for (const fn of [
    vscode.languages.registerCompletionItemProvider,
    vscode.languages.registerHoverProvider,
    vscode.languages.registerDefinitionProvider,
    vscode.languages.registerDocumentFormattingEditProvider,
    vscode.languages.registerDocumentSymbolProvider,
    vscode.window.showInformationMessage,
  ]) {
    vi.mocked(fn as never).mockClear();
  }
});

describe('activate', () => {
  it('registers a completion provider for .vel and .html with the template trigger characters', () => {
    activate(makeContext() as never);
    const calls = vi.mocked(vscode.languages.registerCompletionItemProvider).mock.calls;
    const templateCall = calls.find((c) => (c as unknown[]).includes('@'))!;
    expect(templateCall[0]).toEqual(SELECTOR);
    expect((templateCall as unknown[]).slice(2)).toEqual(['@', ':', '|', ' ', '{']);
  });

  it('registers hover, formatting and symbol providers', () => {
    activate(makeContext() as never);
    expect(vscode.languages.registerHoverProvider).toHaveBeenCalledWith(SELECTOR, expect.anything());
    expect(vscode.languages.registerDocumentSymbolProvider).toHaveBeenCalledWith(SELECTOR, expect.anything());
  });

  it('registers the formatter for .vel only, so HTML users are not asked to pick a default formatter', () => {
    activate(makeContext() as never);
    expect(vscode.languages.registerDocumentFormattingEditProvider).toHaveBeenCalledWith(
      { language: 'teloce' },
      expect.anything()
    );
    const selectors = vi.mocked(vscode.languages.registerDocumentFormattingEditProvider).mock.calls.map((c) => c[0]);
    expect(JSON.stringify(selectors)).not.toContain('html');
  });

  it('disposes the template diagnostic provider with the extension', () => {
    const context = makeContext();
    activate(context as never);
    const collection = createdCollections.find((_, i) => i === 0)!;
    context.subscriptions.forEach((s) => s.dispose());
    expect(collection.dispose).toHaveBeenCalled();
  });

  it('wires "Teloce: Validate" to both the template and TypeScript checkers', async () => {
    activate(makeContext() as never);
    (vscode.window as { activeTextEditor: unknown }).activeTextEditor = {
      document: new FakeDocument('<template><p/></template>', 'teloce', '/w/a.vel'),
    };
    vi.mocked(vscode.window.showInformationMessage).mockClear();
    await registeredCommands.get('teloce.validate')!();
    // language-service is mocked to report nothing, so validation passes
    expect(vscode.window.showInformationMessage).toHaveBeenCalledWith('Teloce: no problems found.');
    (vscode.window as { activeTextEditor: unknown }).activeTextEditor = undefined;
  });

  it('registers the TypeScript hover, completion and definition providers too', () => {
    activate(makeContext() as never);
    // Template providers + TypeScript providers: two of each kind for hover/completion.
    expect(vi.mocked(vscode.languages.registerHoverProvider).mock.calls.length).toBeGreaterThanOrEqual(2);
    expect(vi.mocked(vscode.languages.registerCompletionItemProvider).mock.calls.length).toBeGreaterThanOrEqual(2);
    expect(vscode.languages.registerDefinitionProvider).toHaveBeenCalledOnce();
  });

  it('creates both the template and the TypeScript diagnostic collections', () => {
    activate(makeContext() as never);
    const names = vi.mocked(vscode.languages.createDiagnosticCollection).mock.calls.map((c) => c[0]);
    expect(names).toEqual(expect.arrayContaining(['teloce', 'teloce-ts']));
  });

  it('registers every command', () => {
    activate(makeContext() as never);
    expect([...registeredCommands.keys()].sort()).toEqual(['teloce.copyDebuggerScript', 'teloce.format', 'teloce.openDebugger', 'teloce.stopDebugger', 'teloce.validate']);
  });

  it('starts monitoring documents for template diagnostics', () => {
    vi.mocked(vscode.workspace.onDidChangeTextDocument).mockClear();
    activate(makeContext() as never);
    expect(vscode.workspace.onDidChangeTextDocument).toHaveBeenCalled();
  });

  it('shows the welcome message only the first time', () => {
    const context = makeContext(true);
    activate(context as never);
    expect(vscode.window.showInformationMessage).toHaveBeenCalledOnce();
    expect(context.globalState.update).toHaveBeenCalledWith('teloce.firstTime', false);

    vi.mocked(vscode.window.showInformationMessage).mockClear();
    activate({ ...context, subscriptions: [] } as never);
    expect(vscode.window.showInformationMessage).not.toHaveBeenCalled();
  });

  it('does not show the welcome message for returning users', () => {
    activate(makeContext(false) as never);
    expect(vscode.window.showInformationMessage).not.toHaveBeenCalled();
  });

  it('tracks disposables so VS Code can clean up', () => {
    const context = makeContext();
    activate(context as never);
    expect(context.subscriptions.length).toBeGreaterThanOrEqual(8);
    expect(() => context.subscriptions.forEach((s) => s.dispose())).not.toThrow();
  });

  it('falls back when the bundled TypeScript libs are missing (dev mode)', () => {
    const context = { ...makeContext(), extensionPath: '/definitely/not/here' };
    expect(() => activate(context as never)).not.toThrow();
  });
});

describe('deactivate', () => {
  it('does not throw', () => {
    expect(() => deactivate()).not.toThrow();
  });
});
