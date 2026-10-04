import { beforeEach, describe, expect, it, vi } from 'vitest';
import * as vscode from 'vscode';
import { getCompletionItems } from '@teloce/language-service';
import { FakeDocument } from '../../__mocks__/fakeDocument';
import { TeloceCompletionProvider } from './completion.js';

vi.mock('@teloce/language-service', () => ({ getCompletionItems: vi.fn() }));

const provider = new TeloceCompletionProvider();
const doc = new FakeDocument('<div v-if="show" @cl></div>\nsecond line', 'teloce', '/w/a.vel');
const call = (d = doc, pos = new vscode.Position(0, 20)) =>
  provider.provideCompletionItems(d as never, pos, {} as never, {} as never);

beforeEach(() => {
  vi.mocked(vscode.workspace.getConfiguration).mockReturnValue({ get: (_k: string, d?: unknown) => d, update: vi.fn() } as never);
  vi.mocked(getCompletionItems).mockReset().mockReturnValue([]);
  vi.spyOn(console, 'error').mockImplementation(() => {});
});

describe('TeloceCompletionProvider', () => {
  it('passes document content, offset, line, column and the word to the language service', async () => {
    await call(doc, new vscode.Position(0, 20));
    const arg = vi.mocked(getCompletionItems).mock.calls[0][0];
    expect(arg.content).toBe(doc.getText());
    expect(arg.position).toBe(20);
    expect(arg.line).toBe(0);
    expect(arg.column).toBe(20);
    expect(arg.word).toBe('cl');
  });

  it('passes an empty word when the cursor is not on one', async () => {
    const ws = new FakeDocument('a  b', 'teloce', '/w/b.vel');
    await call(ws, new vscode.Position(0, 2));
    expect(vi.mocked(getCompletionItems).mock.calls.at(-1)![0].word).toBe('');
  });

  it('converts labels, detail, documentation and sort order', async () => {
    vi.mocked(getCompletionItems).mockReturnValue([
      { label: 'v-if', kind: 'directive', detail: 'Conditional', documentation: 'Shows when true', sortText: '0a' },
    ] as never);
    const [item] = await call();
    expect(item.label).toBe('v-if');
    expect(item.detail).toBe('Conditional');
    expect((item.documentation as vscode.MarkdownString).value).toBe('Shows when true');
    expect(item.sortText).toBe('0a');
  });

  it.each([
    ['keyword', vscode.CompletionItemKind.Keyword],
    ['directive', vscode.CompletionItemKind.Interface],
    ['attribute', vscode.CompletionItemKind.Property],
    ['event', vscode.CompletionItemKind.Event],
    ['binding', vscode.CompletionItemKind.Variable],
    ['component', vscode.CompletionItemKind.Class],
    ['variable', vscode.CompletionItemKind.Variable],
    ['function', vscode.CompletionItemKind.Function],
    ['snippet', vscode.CompletionItemKind.Snippet],
    ['text', vscode.CompletionItemKind.Text],
    ['brand-new-kind', vscode.CompletionItemKind.Text],
  ])('maps kind %s', async (kind, expected) => {
    vi.mocked(getCompletionItems).mockReturnValue([{ label: 'x', kind }] as never);
    const [item] = await call();
    expect(item.kind).toBe(expected);
  });

  it('inserts snippets as SnippetString', async () => {
    vi.mocked(getCompletionItems).mockReturnValue([
      { label: 'v-for', kind: 'directive', insertText: 'v-for="${1:item} in ${2:items}"' },
    ] as never);
    const [item] = await call();
    expect(item.insertText).toBeInstanceOf(vscode.SnippetString);
    expect((item.insertText as vscode.SnippetString).value).toContain('${1:item}');
  });

  it('does not set insertText when the item has none', async () => {
    vi.mocked(getCompletionItems).mockReturnValue([{ label: 'x', kind: 'text' }] as never);
    const [item] = await call();
    expect(item.insertText).toBeUndefined();
  });

  it('forwards an attached command', async () => {
    vi.mocked(getCompletionItems).mockReturnValue([
      { label: 'x', kind: 'text', command: { command: 'editor.action.triggerSuggest', arguments: [1] } },
      { label: 'y', kind: 'text', command: { command: 'noargs' } },
    ] as never);
    const [a, b] = (await call()) as (vscode.CompletionItem & { command: { command: string; arguments: unknown[] } })[];
    expect(a.command).toEqual({ command: 'editor.action.triggerSuggest', arguments: [1], title: '' });
    expect(b.command.arguments).toEqual([]);
  });

  describe('which documents and settings it respects', () => {
    const shell = new FakeDocument('<!doctype html><html><body><div id="app">{{ x }}</div></body></html>', 'html', '/w/page.html');
    const component = new FakeDocument('<template><p>hi</p></template>', 'html', '/w/Card.html');
    const untouched = (d: FakeDocument) => call(d, new vscode.Position(0, 3));

    it('offers nothing in an HTML page shell (Flask/Django template)', async () => {
      expect(await untouched(shell)).toEqual([]);
      expect(getCompletionItems).not.toHaveBeenCalled();
    });

    it('works in a component-style .html file', async () => {
      vi.mocked(getCompletionItems).mockReturnValue([{ label: 'v-if', kind: 'directive' }] as never);
      const items = await untouched(component);
      expect(items.map((i) => i.label)).toEqual(['v-if']);
    });

    it('offers nothing in other languages', async () => {
      expect(await untouched(new FakeDocument('x', 'python', '/w/a.py'))).toEqual([]);
    });

    it('is switched off by teloce.completion.enable = false', async () => {
      vi.mocked(vscode.workspace.getConfiguration).mockReturnValue({
        get: (k: string, d?: unknown) => (k === 'enable' ? false : d),
        update: vi.fn(),
      } as never);
      expect(await untouched(doc)).toEqual([]);
      expect(vscode.workspace.getConfiguration).toHaveBeenCalledWith('teloce.completion');
      expect(getCompletionItems).not.toHaveBeenCalled();
    });
  });

  it('returns [] and logs when the language service throws', async () => {
    vi.mocked(getCompletionItems).mockImplementation(() => {
      throw new Error('boom');
    });
    expect(await call()).toEqual([]);
    expect(console.error).toHaveBeenCalled();
  });
});
