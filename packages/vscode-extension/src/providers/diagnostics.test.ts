import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import * as vscode from 'vscode';
import { getDiagnostics } from '@teloce/language-service';
import { FakeDocument } from '../../__mocks__/fakeDocument';
import { createdCollections } from '../../__mocks__/vscode';
import { TeloceDiagnosticProvider } from './diagnostics.js';

vi.mock('@teloce/language-service', () => ({ getDiagnostics: vi.fn() }));

const token = {} as never;
const doc = (text = '<div/>', lang = 'teloce') => new FakeDocument(text, lang, '/w/a.vel');
const diag = (over: Record<string, unknown> = {}) => ({
  message: 'Unclosed tag',
  severity: 'error',
  code: 'T001',
  range: { start: { line: 0, character: 1 }, end: { line: 0, character: 4 } },
  ...over,
});

let provider: TeloceDiagnosticProvider;
const collection = () => createdCollections[createdCollections.length - 1];

beforeEach(() => {
  createdCollections.length = 0;
  vi.mocked(getDiagnostics).mockReset().mockReturnValue([]);
  vi.mocked(vscode.workspace.getConfiguration).mockReturnValue({ get: (_k: string, d?: unknown) => d, update: vi.fn() } as never);
  vi.mocked(vscode.workspace.onDidChangeTextDocument).mockClear();
  vi.mocked(vscode.workspace.onDidOpenTextDocument).mockClear();
  vi.mocked(vscode.workspace.onDidSaveTextDocument).mockClear();
  vi.mocked(vscode.workspace.onDidCloseTextDocument).mockClear();
  vi.mocked(vscode.workspace.onDidChangeConfiguration).mockClear();
  (vscode.window as { activeTextEditor: unknown }).activeTextEditor = undefined;
  vi.spyOn(console, 'error').mockImplementation(() => {});
  provider = new TeloceDiagnosticProvider();
});

afterEach(() => {
  provider.dispose();
  vi.useRealTimers();
});

describe('provideDiagnostics', () => {
  it('creates a "teloce" diagnostic collection', () => {
    expect(vscode.languages.createDiagnosticCollection).toHaveBeenCalledWith('teloce');
  });

  it('converts diagnostics and stores them on the collection', async () => {
    vi.mocked(getDiagnostics).mockReturnValue([diag()] as never);
    const d = doc();
    const out = await provider.provideDiagnostics(d as never, token);

    expect(out).toHaveLength(1);
    expect(out[0].message).toBe('Unclosed tag');
    expect(out[0].code).toBe('T001');
    expect(out[0].source).toBe('teloce');
    expect(out[0].range.start).toEqual(new vscode.Position(0, 1));
    expect(out[0].range.end).toEqual(new vscode.Position(0, 4));
    expect(collection().get(d.uri as never)).toBe(out);
  });

  it('passes the document text and uri to the language service', async () => {
    const d = doc('<p/>');
    await provider.provideDiagnostics(d as never, token);
    expect(getDiagnostics).toHaveBeenCalledWith('<p/>', d.uri.toString());
  });

  it('keeps a source supplied by the language service', async () => {
    vi.mocked(getDiagnostics).mockReturnValue([diag({ source: 'teloce-lint' })] as never);
    const [out] = await provider.provideDiagnostics(doc() as never, token);
    expect(out.source).toBe('teloce-lint');
  });

  it.each([
    ['error', vscode.DiagnosticSeverity.Error],
    ['warning', vscode.DiagnosticSeverity.Warning],
    ['info', vscode.DiagnosticSeverity.Information],
    ['hint', vscode.DiagnosticSeverity.Hint],
    ['mystery', vscode.DiagnosticSeverity.Information],
  ])('maps severity %s', async (severity, expected) => {
    vi.mocked(getDiagnostics).mockReturnValue([diag({ severity })] as never);
    const [out] = await provider.provideDiagnostics(doc() as never, token);
    expect(out.severity).toBe(expected);
  });

  it('adds the suggested fix as related information', async () => {
    vi.mocked(getDiagnostics).mockReturnValue([diag({ fix: 'Add </div>' })] as never);
    const [out] = (await provider.provideDiagnostics(doc() as never, token)) as (vscode.Diagnostic & {
      relatedInformation: { message: string }[];
    })[];
    expect(out.relatedInformation[0].message).toBe('💡 Fix: Add </div>');
  });

  it('has no related information when there is no fix', async () => {
    vi.mocked(getDiagnostics).mockReturnValue([diag()] as never);
    const [out] = await provider.provideDiagnostics(doc() as never, token);
    expect(out.relatedInformation).toBeUndefined();
  });

  it('validates .vel files and component-style .html files', async () => {
    vi.mocked(getDiagnostics).mockReturnValue([diag()] as never);
    expect(await provider.provideDiagnostics(doc('<template><p/></template>', 'html') as never, token)).toHaveLength(1);
    expect(await provider.provideDiagnostics(doc('<div/>', 'teloce') as never, token)).toHaveLength(1);
  });

  it('never validates HTML page shells (Flask/Django templates) or other languages', async () => {
    const shell = '<!doctype html><html><body>{% block x %}{% endblock %}</body></html>';
    expect(await provider.provideDiagnostics(doc(shell, 'html') as never, token)).toEqual([]);
    expect(await provider.provideDiagnostics(doc('<p>{{ x }}</p>', 'html') as never, token)).toEqual([]);
    expect(await provider.provideDiagnostics(doc('x', 'python') as never, token)).toEqual([]);
    expect(getDiagnostics).not.toHaveBeenCalled();
  });

  it('removes stale diagnostics when a file stops being a component', async () => {
    vi.mocked(getDiagnostics).mockReturnValue([diag()] as never);
    const d = doc('<template><p/></template>', 'html');
    await provider.provideDiagnostics(d as never, token);
    expect(collection().get(d.uri as never)).toHaveLength(1);

    d.setText('<p>just html now</p>');
    await provider.provideDiagnostics(d as never, token);
    expect(collection().get(d.uri as never)).toBeUndefined();
  });

  describe('teloce.validate.enable', () => {
    const setting = (enable: boolean) =>
      vi.mocked(vscode.workspace.getConfiguration).mockReturnValue({
        get: (_k: string, d?: unknown) => (_k === 'enable' ? enable : d),
        update: vi.fn(),
      } as never);

    it('does nothing and clears results when turned off', async () => {
      const d = doc();
      vi.mocked(getDiagnostics).mockReturnValue([diag()] as never);
      await provider.provideDiagnostics(d as never, token);
      expect(collection().get(d.uri as never)).toHaveLength(1);

      setting(false);
      vi.mocked(getDiagnostics).mockClear();
      expect(await provider.provideDiagnostics(d as never, token)).toEqual([]);
      expect(getDiagnostics).not.toHaveBeenCalled();
      expect(collection().get(d.uri as never)).toBeUndefined();
    });

    it('can be bypassed by the explicit validate command (force)', async () => {
      setting(false);
      vi.mocked(getDiagnostics).mockReturnValue([diag()] as never);
      expect(await provider.provideDiagnostics(doc() as never, token, true)).toHaveLength(1);
    });
  });

  it('returns [] and logs when the language service throws', async () => {
    vi.mocked(getDiagnostics).mockImplementation(() => {
      throw new Error('boom');
    });
    expect(await provider.provideDiagnostics(doc() as never, token)).toEqual([]);
    expect(console.error).toHaveBeenCalled();
  });
});

describe('startMonitoring', () => {
  const listener = (fn: unknown) => vi.mocked(fn as never).mock.calls[0][0] as (arg: unknown) => void;
  const openDocs = (...docs: unknown[]) => ((vscode.workspace as { textDocuments: unknown[] }).textDocuments = docs);

  afterEach(() => openDocs());

  it('validates every open component straight away, not just the active editor', () => {
    vi.useFakeTimers();
    openDocs(new FakeDocument('<a/>', 'teloce', '/w/a.vel'), new FakeDocument('<template><b/></template>', 'html', '/w/b.html'));
    provider.startMonitoring();
    vi.advanceTimersByTime(0);
    expect(getDiagnostics).toHaveBeenCalledTimes(2);
  });

  it('skips open documents that are not components', () => {
    vi.useFakeTimers();
    openDocs(doc('<!doctype html><html></html>', 'html'), doc('x', 'python'));
    provider.startMonitoring();
    vi.advanceTimersByTime(0);
    expect(getDiagnostics).not.toHaveBeenCalled();
  });

  it('subscribes to change, open, save, close and configuration events', () => {
    provider.startMonitoring();
    expect(vscode.workspace.onDidChangeTextDocument).toHaveBeenCalledOnce();
    expect(vscode.workspace.onDidOpenTextDocument).toHaveBeenCalledOnce();
    expect(vscode.workspace.onDidSaveTextDocument).toHaveBeenCalledOnce();
    expect(vscode.workspace.onDidCloseTextDocument).toHaveBeenCalledOnce();
    expect(vscode.workspace.onDidChangeConfiguration).toHaveBeenCalledOnce();
  });

  it('debounces bursts of edits into a single validation after 500ms', () => {
    vi.useFakeTimers();
    provider.startMonitoring();
    const onChange = listener(vscode.workspace.onDidChangeTextDocument);
    const d = doc();

    onChange({ document: d });
    vi.advanceTimersByTime(300);
    onChange({ document: d });
    vi.advanceTimersByTime(300);
    expect(getDiagnostics).not.toHaveBeenCalled();

    vi.advanceTimersByTime(250);
    expect(getDiagnostics).toHaveBeenCalledTimes(1);
  });

  it('validates both files when two are edited within the debounce window', () => {
    // Regression: one shared timer meant editing B cancelled A's validation.
    vi.useFakeTimers();
    provider.startMonitoring();
    const onChange = listener(vscode.workspace.onDidChangeTextDocument);
    const a = new FakeDocument('<a/>', 'teloce', '/w/a.vel');
    const b = new FakeDocument('<b/>', 'teloce', '/w/b.vel');

    onChange({ document: a });
    vi.advanceTimersByTime(100);
    onChange({ document: b });
    vi.advanceTimersByTime(600);

    const validated = vi.mocked(getDiagnostics).mock.calls.map((c) => c[0]);
    expect(validated).toEqual(expect.arrayContaining(['<a/>', '<b/>']));
  });

  it.each([
    ['open', () => vscode.workspace.onDidOpenTextDocument],
    ['save', () => vscode.workspace.onDidSaveTextDocument],
  ])('validates on %s', (_name, event) => {
    vi.useFakeTimers();
    provider.startMonitoring();
    listener(event())(doc());
    vi.advanceTimersByTime(500);
    expect(getDiagnostics).toHaveBeenCalledTimes(1);
  });

  it('validates component-style .html on edit', () => {
    vi.useFakeTimers();
    provider.startMonitoring();
    listener(vscode.workspace.onDidChangeTextDocument)({ document: doc('<template><p/></template>', 'html') });
    vi.advanceTimersByTime(500);
    expect(getDiagnostics).toHaveBeenCalledTimes(1);
  });

  it('ignores edits to HTML page shells and other languages', () => {
    vi.useFakeTimers();
    provider.startMonitoring();
    const onChange = listener(vscode.workspace.onDidChangeTextDocument);
    onChange({ document: doc('<!doctype html><html><body></body></html>', 'html') });
    onChange({ document: doc('x', 'python') });
    vi.advanceTimersByTime(1000);
    expect(getDiagnostics).not.toHaveBeenCalled();
  });

  it('clears diagnostics and cancels pending work when a document is closed', async () => {
    vi.useFakeTimers();
    vi.mocked(getDiagnostics).mockReturnValue([diag()] as never);
    provider.startMonitoring();
    const d = doc();
    await provider.provideDiagnostics(d as never, token);
    expect(collection().get(d.uri as never)).toHaveLength(1);

    listener(vscode.workspace.onDidChangeTextDocument)({ document: d });
    listener(vscode.workspace.onDidCloseTextDocument)(d);
    vi.advanceTimersByTime(1000);
    expect(collection().get(d.uri as never)).toBeUndefined();
    expect(getDiagnostics).toHaveBeenCalledTimes(1); // only the explicit one above
  });

  it('revalidates open documents when teloce.validate settings change', () => {
    vi.useFakeTimers();
    openDocs(doc('<a/>'));
    provider.startMonitoring();
    vi.advanceTimersByTime(0);
    vi.mocked(getDiagnostics).mockClear();

    const onConfig = listener(vscode.workspace.onDidChangeConfiguration);
    onConfig({ affectsConfiguration: (s: string) => s === 'teloce.formatting' });
    vi.advanceTimersByTime(10);
    expect(getDiagnostics).not.toHaveBeenCalled();

    onConfig({ affectsConfiguration: (s: string) => s === 'teloce.validate' });
    vi.advanceTimersByTime(10);
    expect(getDiagnostics).toHaveBeenCalledTimes(1);
  });
});

describe('dispose', () => {
  it('cancels pending validations, disposes listeners and the collection', () => {
    vi.useFakeTimers();
    const subscription = { dispose: vi.fn() };
    vi.mocked(vscode.workspace.onDidChangeTextDocument).mockReturnValueOnce(subscription as never);
    provider.startMonitoring();
    vi.mocked(vscode.workspace.onDidChangeTextDocument).mock.calls[0][0]({ document: doc() } as never);
    const c = collection();

    provider.dispose();
    vi.advanceTimersByTime(1000);
    expect(getDiagnostics).not.toHaveBeenCalled();
    expect(subscription.dispose).toHaveBeenCalled();
    expect(c.dispose).toHaveBeenCalled();
  });
});
