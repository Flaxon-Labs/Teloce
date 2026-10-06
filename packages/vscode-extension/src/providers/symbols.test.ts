import { describe, expect, it } from 'vitest';
import * as vscode from 'vscode';
import { FakeDocument } from '../../__mocks__/fakeDocument';
import { TeloceSymbolProvider } from './symbols.js';

const provider = new TeloceSymbolProvider();
const symbols = (text: string) =>
  provider.provideDocumentSymbols(new FakeDocument(text, 'teloce', '/w/a.vel') as never, {} as never);

describe('TeloceSymbolProvider', () => {
  it('returns nothing for a document with no script', async () => {
    expect(await symbols('<template><p>hi</p></template>')).toEqual([]);
  });

  it('finds the component name', async () => {
    const out = await symbols(`<script>\nexport default { name: 'TodoList' }\n</script>`);
    const cls = out.find((s) => s.kind === vscode.SymbolKind.Class)!;
    expect(cls.name).toBe('TodoList');
    expect(cls.detail).toBe('Component');
  });

  it('finds data properties with ranges on the property name', async () => {
    const text = `<script>\nexport default {\n  data() { return { count: 0, label: 'x' } }\n}\n</script>`;
    const out = await symbols(text);
    const props = out.filter((s) => s.kind === vscode.SymbolKind.Property);
    expect(props.map((p) => p.name)).toEqual(['count', 'label']);
    expect(props.every((p) => p.detail === 'Data property')).toBe(true);
    const doc = new FakeDocument(text, 'teloce', '/w/a.vel');
    expect(doc.getText(props[0].range)).toBe('count');
  });

  it('finds methods', async () => {
    const out = await symbols(`<script>\nexport default {\n  methods: {\n    save() { },\n    reset() { },\n  }\n}\n</script>`);
    const methods = out.filter((s) => s.kind === vscode.SymbolKind.Method).map((s) => s.name);
    expect(methods).toEqual(expect.arrayContaining(['save', 'reset']));
  });

  it('ignores HTML page shells but reads component-style .html files', async () => {
    const script = `<script>\nexport default { name: 'Card' }\n</script>`;
    const shell = new FakeDocument(`<!doctype html><html><body>${script}</body></html>`, 'html', '/w/page.html');
    expect(await provider.provideDocumentSymbols(shell as never, {} as never)).toEqual([]);

    const component = new FakeDocument(`<template><p/></template>\n${script}`, 'html', '/w/Card.html');
    const out = await provider.provideDocumentSymbols(component as never, {} as never);
    expect(out.some((s) => s.name === 'Card')).toBe(true);
  });

  it('handles double-quoted component names', async () => {
    const out = await symbols(`export default { name: "Card" }`);
    expect(out.some((s) => s.name === 'Card')).toBe(true);
  });
});
