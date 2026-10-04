import { beforeEach, describe, expect, it, vi } from 'vitest';
import * as vscode from 'vscode';
import { formatTemplate } from '@teloce/language-service';
import { FakeDocument } from '../../__mocks__/fakeDocument';
import { TeloceFormattingProvider } from './formatting.js';

vi.mock('@teloce/language-service', () => ({ formatTemplate: vi.fn() }));

const provider = new TeloceFormattingProvider();
const doc = new FakeDocument('<div>\n<p>hi</p></div>', 'teloce', '/w/a.vel');
const run = () => provider.provideDocumentFormattingEdits(doc as never, {} as never, {} as never);

const config = (values: Record<string, unknown>) =>
  vi.mocked(vscode.workspace.getConfiguration).mockReturnValue({
    get: (k: string, d?: unknown) => (k in values ? values[k] : d),
    update: vi.fn(),
  } as never);

beforeEach(() => {
  vi.mocked(formatTemplate).mockReset().mockReturnValue('FORMATTED');
  config({});
  vi.spyOn(console, 'error').mockImplementation(() => {});
});

describe('TeloceFormattingProvider', () => {
  it('replaces the entire document with the formatted text', async () => {
    const edits = await run();
    expect(edits).toHaveLength(1);
    expect(edits[0].newText).toBe('FORMATTED');
    expect(edits[0].range.start).toEqual(new vscode.Position(0, 0));
    expect(edits[0].range.end).toEqual(doc.positionAt(doc.getText().length));
  });

  it('uses the default formatting options', async () => {
    await run();
    expect(formatTemplate).toHaveBeenCalledWith(
      doc.getText(),
      expect.objectContaining({ indentSize: 2, useTabs: false, indentHTML: true, maxLineLength: 80, preserveNewlines: true })
    );
  });

  it('honours teloce.format settings', async () => {
    config({ indentSize: 4, useTabs: true });
    await run();
    expect(formatTemplate).toHaveBeenCalledWith(
      doc.getText(),
      expect.objectContaining({ indentSize: 4, useTabs: true })
    );
  });

  it('reads settings from the teloce.format section', async () => {
    await run();
    expect(vscode.workspace.getConfiguration).toHaveBeenCalledWith('teloce.format');
  });

  it('never reformats an HTML page shell', async () => {
    const shell = new FakeDocument('<!doctype html><html><body><div id="app">{{ x }}</div></body></html>', 'html', '/w/page.html');
    expect(await provider.provideDocumentFormattingEdits(shell as never, {} as never, {} as never)).toEqual([]);
    expect(formatTemplate).not.toHaveBeenCalled();
  });

  it('returns no edits and logs when formatting throws', async () => {
    vi.mocked(formatTemplate).mockImplementation(() => {
      throw new Error('bad template');
    });
    expect(await run()).toEqual([]);
    expect(console.error).toHaveBeenCalled();
  });
});
