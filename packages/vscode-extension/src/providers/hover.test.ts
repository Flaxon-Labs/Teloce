import { beforeEach, describe, expect, it, vi } from 'vitest';
import * as vscode from 'vscode';
import { getHoverInfo } from '@teloce/language-service';
import { FakeDocument } from '../../__mocks__/fakeDocument';
import { TeloceHoverProvider } from './hover.js';

vi.mock('@teloce/language-service', () => ({ getHoverInfo: vi.fn() }));

const provider = new TeloceHoverProvider();
const doc = new FakeDocument('<div v-if="x"></div>', 'teloce', '/w/a.vel');
const pos = new vscode.Position(0, 6);
const call = () => provider.provideHover(doc as never, pos, {} as never);
const text = (h: vscode.Hover | null) => (h!.contents as unknown as vscode.MarkdownString).value;

beforeEach(() => {
  vi.mocked(getHoverInfo).mockReset();
  vi.spyOn(console, 'error').mockImplementation(() => {});
});

describe('TeloceHoverProvider', () => {
  it('asks the language service for the position under the cursor', async () => {
    vi.mocked(getHoverInfo).mockReturnValue(null as never);
    await call();
    expect(getHoverInfo).toHaveBeenCalledWith(doc.getText(), 0, 6);
  });

  it('returns null when there is nothing to show', async () => {
    vi.mocked(getHoverInfo).mockReturnValue(null as never);
    expect(await call()).toBeNull();
  });

  it('shows content with the range the service reports', async () => {
    vi.mocked(getHoverInfo).mockReturnValue({
      content: '**v-if** renders conditionally',
      range: { start: { line: 0, character: 5 }, end: { line: 0, character: 9 } },
    } as never);
    const hover = await call();
    expect(text(hover)).toBe('**v-if** renders conditionally');
    expect(hover!.range!.start.character).toBe(5);
    expect(hover!.range!.end.character).toBe(9);
  });

  it('falls back to an empty range at the cursor', async () => {
    vi.mocked(getHoverInfo).mockReturnValue({ content: 'x' } as never);
    const hover = await call();
    expect(hover!.range!.start).toEqual(pos);
    expect(hover!.range!.end).toEqual(pos);
  });

  it('appends an example and documentation links', async () => {
    vi.mocked(getHoverInfo).mockReturnValue({
      content: 'Info',
      example: '<p v-if="a"/>',
      links: ['https://example.com/a', 'https://example.com/b'],
    } as never);
    const md = text(await call());
    expect(md).toContain('**Example:**');
    expect(md).toContain('```html\n<p v-if="a"/>\n```');
    expect(md).toContain('**Documentation:**');
    expect(md).toContain('[https://example.com/a](https://example.com/a)');
    expect(md).toContain('[https://example.com/b](https://example.com/b)');
  });

  it('omits the documentation section for an empty links list', async () => {
    vi.mocked(getHoverInfo).mockReturnValue({ content: 'Info', links: [] } as never);
    expect(text(await call())).not.toContain('Documentation');
  });

  it('shows nothing in an HTML page shell, but works in a component-style .html file', async () => {
    vi.mocked(getHoverInfo).mockReturnValue({ content: 'x' } as never);
    const shell = new FakeDocument('<!doctype html><html><body><div id="app">{{ x }}</div></body></html>', 'html', '/w/page.html');
    expect(await provider.provideHover(shell as never, pos, {} as never)).toBeNull();
    expect(getHoverInfo).not.toHaveBeenCalled();

    const component = new FakeDocument('<template><p>hi</p></template>', 'html', '/w/Card.html');
    expect(await provider.provideHover(component as never, pos, {} as never)).not.toBeNull();
  });

  it('returns null and logs when the language service throws', async () => {
    vi.mocked(getHoverInfo).mockImplementation(() => {
      throw new Error('boom');
    });
    expect(await call()).toBeNull();
    expect(console.error).toHaveBeenCalled();
  });
});
