import * as os from 'node:os';
import * as path from 'node:path';
import * as ts from 'typescript';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import * as vscode from 'vscode';
import { FakeDocument } from '../../__mocks__/fakeDocument';
import { createdCollections } from '../../__mocks__/vscode';
import {
  DOCUMENT_SELECTOR,
  TS_DIAGNOSTIC_SOURCE,
  TeloceTypeScriptFeatures,
  toCompletionKind,
  toVsDiagnostic,
} from './typescript.js';

const root = path.join(os.tmpdir(), 'teloce-provider-tests');
const velPath = path.join(root, 'App.vel');

const component = `<template><p>{{ draft }}</p></template>
<script lang="ts">
export default {
  data() { return { draft: "", count: 0 }; },
  methods: {
    /** Sends it. */
    send() { const n: number = this.draft; return n; },
  },
};
</script>
`;

// Same component with an unfinished `this.dr` for completion to work on.
// (Unfinished code is a genuine error, so keep it out of the diagnostics tests.)
const editing = component.replace(
  '  },\n};\n</script>',
  '    later() { this.dr; },\n  },\n};\n</script>'
);

const config = (values: Record<string, unknown>) =>
  vi.mocked(vscode.workspace.getConfiguration).mockReturnValue({
    get: (key: string, fallback?: unknown) => (key in values ? values[key] : fallback),
    update: vi.fn(),
  } as never);

let features: TeloceTypeScriptFeatures;
let loadTypeScript: ReturnType<typeof vi.fn>;

beforeEach(() => {
  createdCollections.length = 0;
  config({});
  loadTypeScript = vi.fn(async () => ts);
  features = new TeloceTypeScriptFeatures({ loadTypeScript });
});

afterEach(() => {
  features.dispose();
});

const collection = () => createdCollections[createdCollections.length - 1];
const asDoc = (d: FakeDocument) => d as unknown as vscode.TextDocument;

describe('diagnostics', () => {
  it('publishes TypeScript errors mapped to the right range in the document', async () => {
    const doc = new FakeDocument(component, 'teloce', velPath);
    await features.publishDiagnostics(asDoc(doc));

    const diagnostics = collection().get(doc.uri as never)!;
    expect(diagnostics).toHaveLength(1);

    const [d] = diagnostics;
    expect(d.severity).toBe(vscode.DiagnosticSeverity.Error);
    expect(d.code).toBe(2322);
    expect(d.source).toBe(TS_DIAGNOSTIC_SOURCE);
    expect(d.message).toContain("'string' is not assignable to type 'number'");

    // Line/column in the editor must land on `n` in `const n: number`.
    const line = component.split('\n').findIndex((l) => l.includes('const n: number'));
    const col = component.split('\n')[line].indexOf('n: number');
    expect(d.range.start.line).toBe(line);
    expect(d.range.start.character).toBe(col);
    expect(d.range.end.character).toBe(col + 1);
  });

  it('returns how many problems it published', async () => {
    expect(await features.publishDiagnostics(asDoc(new FakeDocument(component, 'teloce', velPath)))).toBe(1);
    expect(await features.publishDiagnostics(asDoc(new FakeDocument('<template><p/></template>', 'teloce', path.join(root, 'N.vel'))))).toBe(0);
  });

  it('works for component-style .html files', async () => {
    const doc = new FakeDocument(component, 'html', path.join(root, 'Widget.html'));
    await features.publishDiagnostics(asDoc(doc));
    expect(collection().get(doc.uri as never)).toHaveLength(1);
  });

  it('leaves full-page html shells alone', async () => {
    const shell = `<!doctype html><html><body><script lang="ts">const x: number = "a";</script></body></html>`;
    const doc = new FakeDocument(shell, 'html', path.join(root, 'shell.html'));
    await features.publishDiagnostics(asDoc(doc));
    expect(collection().get(doc.uri as never)).toBeUndefined();
  });

  it('never loads TypeScript for documents without lang="ts"', async () => {
    const js = `<template><p/></template>\n<script>\nexport default {};\n</script>`;
    const doc = new FakeDocument(js, 'teloce', path.join(root, 'Plain.vel'));
    await features.publishDiagnostics(asDoc(doc));
    expect(loadTypeScript).not.toHaveBeenCalled();
    expect(collection().get(doc.uri as never)).toBeUndefined();
  });

  it('loads TypeScript once, however many documents use it', async () => {
    await features.publishDiagnostics(asDoc(new FakeDocument(component, 'teloce', velPath)));
    await features.publishDiagnostics(asDoc(new FakeDocument(component, 'teloce', path.join(root, 'B.vel'))));
    expect(loadTypeScript).toHaveBeenCalledTimes(1);
  });

  it('ignores documents that are not files (e.g. untitled, git)', async () => {
    const doc = new FakeDocument(component, 'teloce', velPath, 'untitled');
    await features.publishDiagnostics(asDoc(doc));
    expect(loadTypeScript).not.toHaveBeenCalled();
    expect(collection().get(doc.uri as never)).toBeUndefined();
  });

  it('ignores other languages', async () => {
    const doc = new FakeDocument(component, 'python', velPath);
    await features.publishDiagnostics(asDoc(doc));
    expect(loadTypeScript).not.toHaveBeenCalled();
  });

  it('clears diagnostics once the error is fixed', async () => {
    const doc = new FakeDocument(component, 'teloce', velPath);
    await features.publishDiagnostics(asDoc(doc));
    expect(collection().get(doc.uri as never)).toHaveLength(1);

    doc.setText(component.replace('const n: number = this.draft', 'const n: string = this.draft'));
    await features.publishDiagnostics(asDoc(doc));
    expect(collection().get(doc.uri as never)).toEqual([]);
  });

  it('clears diagnostics when lang="ts" is removed', async () => {
    const doc = new FakeDocument(component, 'teloce', velPath);
    await features.publishDiagnostics(asDoc(doc));
    doc.setText(component.replace(' lang="ts"', ''));
    await features.publishDiagnostics(asDoc(doc));
    expect(collection().get(doc.uri as never)).toBeUndefined();
  });

  it('publishes nothing when the setting is disabled', async () => {
    config({ enable: false });
    const doc = new FakeDocument(component, 'teloce', velPath);
    await features.publishDiagnostics(asDoc(doc));
    expect(loadTypeScript).not.toHaveBeenCalled();
    expect(collection().get(doc.uri as never)).toBeUndefined();
  });

  it('removes existing diagnostics when the setting is turned off', async () => {
    const doc = new FakeDocument(component, 'teloce', velPath);
    await features.publishDiagnostics(asDoc(doc));
    expect(collection().get(doc.uri as never)).toHaveLength(1);

    config({ enable: false });
    await features.publishDiagnostics(asDoc(doc));
    expect(collection().get(doc.uri as never)).toBeUndefined();
  });

  it('honours teloce.typescript.strict', async () => {
    const nullable = component.replace(
      'data() { return { draft: "", count: 0 }; },',
      'props: { size: Number },\n  data() { return { draft: "", count: 0 }; },'
    ).replace('const n: number = this.draft', 'const n: number = this.size');

    config({ strict: true });
    const strict = new TeloceTypeScriptFeatures({ loadTypeScript });
    const doc = new FakeDocument(nullable, 'teloce', path.join(root, 'Strict.vel'));
    await strict.publishDiagnostics(asDoc(doc));
    expect(createdCollections[createdCollections.length - 1].get(doc.uri as never)).toHaveLength(1);
    strict.dispose();

    config({ strict: false });
    const loose = new TeloceTypeScriptFeatures({ loadTypeScript });
    await loose.publishDiagnostics(asDoc(doc));
    expect(createdCollections[createdCollections.length - 1].get(doc.uri as never)).toEqual([]);
    loose.dispose();
  });

  it('does not throw when TypeScript fails to load', async () => {
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {});
    const broken = new TeloceTypeScriptFeatures({
      loadTypeScript: async () => {
        throw new Error('cannot load typescript');
      },
    });
    await expect(
      broken.publishDiagnostics(asDoc(new FakeDocument(component, 'teloce', velPath)))
    ).resolves.toBe(0);
    expect(spy).toHaveBeenCalled();
    spy.mockRestore();
    broken.dispose();
  });
});

describe('hover', () => {
  it('shows the type of a member, with markdown and a range', async () => {
    const doc = new FakeDocument(component, 'teloce', velPath);
    const hover = await features.provideHover(asDoc(doc), doc.positionOf('this.draft;', 'this.'.length + 1));

    expect(hover).toBeDefined();
    const md = hover!.contents as unknown as { value: string };
    expect(md.value).toContain('```typescript');
    expect(md.value).toContain('draft: string');
    expect(hover!.range!.start.character).toBeLessThan(hover!.range!.end.character);
  });

  it('includes documentation', async () => {
    const doc = new FakeDocument(component, 'teloce', velPath);
    const hover = await features.provideHover(asDoc(doc), doc.positionOf('send() {', 1));
    expect((hover!.contents as unknown as { value: string }).value).toContain('Sends it.');
  });

  it('returns nothing in the template', async () => {
    const doc = new FakeDocument(component, 'teloce', velPath);
    expect(await features.provideHover(asDoc(doc), doc.positionOf('{{ draft }}', 4))).toBeUndefined();
  });

  it('returns nothing for a document that is not a ts component', async () => {
    const doc = new FakeDocument('<template><p/></template>', 'teloce', path.join(root, 'T.vel'));
    expect(await features.provideHover(asDoc(doc), doc.positionOf('<p/>'))).toBeUndefined();
  });
});

describe('completion', () => {
  it('offers members of `this` as VS Code completion items', async () => {
    const doc = new FakeDocument(editing, 'teloce', velPath);
    const items = await features.provideCompletionItems(asDoc(doc), doc.positionOf('this.dr;', 'this.'.length));

    const byLabel = new Map(items!.map((i) => [i.label as string, i]));
    expect(byLabel.get('draft')?.kind).toBe(vscode.CompletionItemKind.Property);
    expect(byLabel.get('send')?.kind).toBe(vscode.CompletionItemKind.Method);
    expect(byLabel.has('count')).toBe(true);
    expect(byLabel.has('$emit')).toBe(true);
  });

  it('resolves documentation lazily', async () => {
    const doc = new FakeDocument(editing, 'teloce', velPath);
    const items = await features.provideCompletionItems(asDoc(doc), doc.positionOf('this.dr;', 'this.'.length));
    const draft = items!.find((i) => i.label === 'draft')!;

    expect(draft.detail).toBeUndefined();
    const resolved = features.resolveCompletionItem(draft);
    expect(resolved.detail).toContain('string');
  });

  it('offers nothing in the template', async () => {
    const doc = new FakeDocument(editing, 'teloce', velPath);
    const items = await features.provideCompletionItems(asDoc(doc), doc.positionOf('{{ draft }}', 4));
    expect(items).toEqual([]);
  });

  it('leaves an unknown completion item untouched when resolving', () => {
    const item = new vscode.CompletionItem('x');
    expect(features.resolveCompletionItem(item)).toBe(item);
    expect(item.detail).toBeUndefined();
  });
});

describe('definition', () => {
  it('jumps to the declaration inside the same component', async () => {
    const doc = new FakeDocument(component, 'teloce', velPath);
    const locations = await features.provideDefinition(asDoc(doc), doc.positionOf('this.draft;', 'this.'.length + 1));

    expect(locations).toHaveLength(1);
    const [loc] = locations!;
    expect(loc.uri).toBe(doc.uri);
    // Points at `draft` in `data() { return { draft: ...`.
    const expected = doc.positionOf('draft: ""');
    expect(loc.range.start.line).toBe(expected.line);
    expect(loc.range.start.character).toBe(expected.character);
  });

  it('returns nothing in the template', async () => {
    const doc = new FakeDocument(component, 'teloce', velPath);
    expect(await features.provideDefinition(asDoc(doc), doc.positionOf('{{ draft }}', 4))).toEqual([]);
  });
});

describe('registration and lifecycle', () => {
  it('registers hover, completion and definition for .vel and .html', () => {
    features.register();
    for (const register of [
      vscode.languages.registerHoverProvider,
      vscode.languages.registerCompletionItemProvider,
      vscode.languages.registerDefinitionProvider,
    ]) {
      expect(register).toHaveBeenCalled();
      const selector = vi.mocked(register).mock.calls.at(-1)![0];
      expect(selector).toEqual(DOCUMENT_SELECTOR);
    }
    expect(DOCUMENT_SELECTOR).toEqual([
      { language: 'teloce' },
      { language: 'html', scheme: 'file' },
    ]);
  });

  it('disposes its diagnostic collection', () => {
    features.register();
    const c = collection();
    features.dispose();
    expect(c.dispose).toHaveBeenCalled();
  });
});

describe('toCompletionKind', () => {
  it.each([
    ['method', vscode.CompletionItemKind.Method],
    ['function', vscode.CompletionItemKind.Function],
    ['property', vscode.CompletionItemKind.Property],
    ['getter', vscode.CompletionItemKind.Property],
    ['var', vscode.CompletionItemKind.Variable],
    ['parameter', vscode.CompletionItemKind.Variable],
    ['const', vscode.CompletionItemKind.Constant],
    ['class', vscode.CompletionItemKind.Class],
    ['interface', vscode.CompletionItemKind.Interface],
    ['enum', vscode.CompletionItemKind.Enum],
    ['enum member', vscode.CompletionItemKind.EnumMember],
    ['keyword', vscode.CompletionItemKind.Keyword],
    ['module', vscode.CompletionItemKind.Module],
    ['type', vscode.CompletionItemKind.TypeParameter],
    ['something-new', vscode.CompletionItemKind.Text],
  ])('maps %s', (kind, expected) => {
    expect(toCompletionKind(kind)).toBe(expected);
  });
});

describe('toVsDiagnostic', () => {
  const doc = new FakeDocument('0123456789', 'teloce', velPath);
  const base = { start: 2, end: 5, message: 'msg', code: 1234 };

  it.each([
    ['error', vscode.DiagnosticSeverity.Error],
    ['warning', vscode.DiagnosticSeverity.Warning],
    ['suggestion', vscode.DiagnosticSeverity.Hint],
    ['message', vscode.DiagnosticSeverity.Information],
  ] as const)('maps %s severity', (category, expected) => {
    expect(toVsDiagnostic({ ...base, category }, asDoc(doc)).severity).toBe(expected);
  });

  it('sets range, code and source', () => {
    const d = toVsDiagnostic({ ...base, category: 'error' }, asDoc(doc));
    expect(d.range.start.character).toBe(2);
    expect(d.range.end.character).toBe(5);
    expect(d.code).toBe(1234);
    expect(d.source).toBe(TS_DIAGNOSTIC_SOURCE);
  });

  it('adds tags for unnecessary and deprecated code', () => {
    const d = toVsDiagnostic({ ...base, category: 'suggestion', unnecessary: true, deprecated: true }, asDoc(doc));
    expect(d.tags).toEqual([vscode.DiagnosticTag.Unnecessary, vscode.DiagnosticTag.Deprecated]);
    expect(toVsDiagnostic({ ...base, category: 'error' }, asDoc(doc)).tags).toBeUndefined();
  });
});
