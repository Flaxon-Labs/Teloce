import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import * as ts from 'typescript';
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import { TeloceTsService, prettifyMessage, type MappedDiagnostic } from './service.js';

/** Wraps a script body as a `.vel` component using the options API. */
const vel = (script: string) =>
  `<template><div>{{ x }}</div></template>\n<script lang="ts">\n${script}\n</script>\n<style scoped>div{}</style>\n`;

const offsetOf = (text: string, needle: string, delta = 0) => {
  const i = text.indexOf(needle);
  if (i === -1) throw new Error(`"${needle}" not in fixture`);
  return i + delta;
};

const slice = (text: string, d: MappedDiagnostic) => text.slice(d.start, d.end);

// Created at load time: some describe blocks build paths while being collected.
const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'teloce-ts-'));
afterAll(() => {
  fs.rmSync(dir, { recursive: true, force: true });
});

const file = (name: string) => path.join(dir, name);

describe('type-checking the options API', () => {
  let svc: TeloceTsService;
  beforeAll(() => {
    svc = new TeloceTsService({ ts, rootDir: dir });
  });
  afterAll(() => svc.dispose());
  afterEach(() => {
    for (const n of ['A.vel', 'B.vel', 'C.html']) svc.removeDocument(file(n));
  });

  const check = (text: string, name = 'A.vel', languageId = 'teloce') => {
    svc.updateDocument(file(name), text, languageId);
    return svc.getDiagnostics(file(name));
  };

  it('accepts the chat component from the README with no errors', () => {
    const text = vel(`
export default {
  data() { return { draft: "", messages: [] as { id: number; text: string }[] }; },
  async mounted() {
    this.messages = await fetch("/api/messages").then(r => r.json());
  },
  methods: {
    async send() {
      const text = this.draft.trim();
      if (!text) return;
      const message = await fetch("/api/messages", {
        method: "POST", headers: {"Content-Type": "application/json"},
        body: JSON.stringify({text})
      }).then(r => r.json());
      this.messages = [...this.messages, message];
      this.draft = "";
    }
  }
};`);
    expect(check(text)).toEqual([]);
  });

  it('reports a type error at exactly the right place in the original file', () => {
    const text = vel(`
export default {
  data() { return { draft: "" }; },
  methods: { send() { const n: number = this.draft; return n; } },
};`);
    const [d, ...rest] = check(text);
    expect(rest).toEqual([]);
    expect(d.code).toBe(2322);
    expect(d.category).toBe('error');
    expect(d.message).toContain("'string' is not assignable to type 'number'");
    // The range must select the declared variable in the .vel file, not a
    // shifted position in the virtual file.
    expect(slice(text, d)).toBe('n');
    expect(d.start).toBe(offsetOf(text, 'const n') + 'const '.length);
  });

  it('types `this` from data, methods and computed', () => {
    const text = vel(`
export default {
  data() { return { count: 0, label: 'x' }; },
  computed: { double(): number { return this.count * 2; } },
  methods: {
    inc(): void { this.count += 1; },
    run(): string { this.inc(); return this.label + this.double; },
  },
};`);
    expect(check(text)).toEqual([]);
  });

  it('flags unknown members, with a readable message', () => {
    const text = vel(`
export default {
  data() { return { count: 0 }; },
  methods: { go() { this.cont = 1; this.missing(); } },
};`);
    const diags = check(text);
    expect(diags.map((d) => slice(text, d))).toEqual(['cont', 'missing']);
    for (const d of diags) {
      // 2339 = no such property; 2551 = same, with a "did you mean" suggestion.
      expect([2339, 2551]).toContain(d.code);
      expect(d.message).toContain("'component instance'");
      expect(d.message).not.toContain('__Teloce');
    }
  });

  it('flags wrong assignments to data', () => {
    const text = vel(`
export default {
  data() { return { count: 0 }; },
  methods: { go() { this.count = 'nope'; } },
};`);
    const [d] = check(text);
    expect(d.code).toBe(2322);
    expect(slice(text, d)).toBe('this.count');
  });

  it('types constructor-style props and marks optional ones as possibly undefined', () => {
    const text = vel(`
export default {
  props: { title: String, size: Number },
  methods: { go() { const t: string = this.title; const s: number = this.size; return [t, s]; } },
};`);
    const diags = check(text);
    expect(diags.map((d) => slice(text, d))).toEqual(['t', 's']);
    expect(diags[0].message).toContain('string | undefined');
    expect(diags[1].message).toContain('number | undefined');
  });

  it('treats required props and props with defaults as always present', () => {
    const text = vel(`
export default {
  props: {
    title: { type: String, required: true },
    size: { type: Number, default: 3 },
  },
  methods: { go() { const t: string = this.title; const s: number = this.size; return [t, s]; } },
};`);
    expect(check(text)).toEqual([]);
  });

  it('types Boolean props as boolean (never undefined)', () => {
    const text = vel(`
export default {
  props: { open: Boolean },
  methods: { go() { const o: boolean = this.open; return o; } },
};`);
    expect(check(text)).toEqual([]);
  });

  it('accepts array-style props as any-typed members', () => {
    const text = vel(`
export default {
  props: ['value', 'label'],
  methods: { go() { return this.value + this.label; } },
};`);
    expect(check(text)).toEqual([]);
    const bad = vel(`
export default {
  props: ['value'],
  methods: { go(): any { return this.valeu; } },
};`);
    // 2551 = "Property 'valeu' does not exist... Did you mean 'value'?"
    expect(check(bad).map((d) => d.code)).toEqual([2551]);
  });

  it('understands multi-type and array props', () => {
    const text = vel(`
export default {
  props: { id: { type: [String, Number], required: true }, tags: { type: Array, required: true } },
  methods: { go() { const a: string | number = this.id; const b: any[] = this.tags; return [a, b]; } },
};`);
    expect(check(text)).toEqual([]);
  });

  it('allows $-prefixed instance members, including plugin ones', () => {
    const text = vel(`
export default {
  methods: {
    go() {
      this.$emit('changed', 1);
      this.$refs.input;
      this.$nextTick(() => {});
      this.$router.push('/');
      this.$store;
    },
  },
};`);
    expect(check(text)).toEqual([]);
  });

  it('types lifecycle hooks and watchers', () => {
    const text = vel(`
export default {
  data() { return { q: '', results: [] as string[] }; },
  created() { this.q = 'a'; },
  async mounted() { this.results = []; },
  beforeUnmount() { this.q = ''; },
  watch: { q(next: string) { this.results = [next]; } },
};`);
    expect(check(text)).toEqual([]);
    const bad = vel(`
export default {
  data() { return { q: '' }; },
  mounted() { this.nope; },
};`);
    expect(check(bad).map((d) => d.code)).toEqual([2339]);
  });

  it('types values returned from setup()', () => {
    const text = vel(`
export default {
  setup() { return { n: 1 }; },
  methods: { go(): number { return this.n; } },
};`);
    expect(check(text)).toEqual([]);
  });

  it('accepts unknown-to-us but legitimate options without complaint', () => {
    const text = vel(`
export default {
  name: 'Card',
  components: { Other: {} },
  emits: ['close'],
  inheritAttrs: false,
  provide() { return {}; },
};`);
    expect(check(text)).toEqual([]);
  });

  it('checks code outside the exported object too', () => {
    const text = vel(`
const limit: number = 'ten';
export default { data() { return { limit }; } };
function after(): string { return 42; }`);
    const diags = check(text);
    expect(diags).toHaveLength(2);
    expect(slice(text, diags[0])).toBe('limit');
    // TypeScript reports a bad return value on the `return` keyword.
    expect(slice(text, diags[1])).toBe('return');
    expect(diags[1].start).toBe(offsetOf(text, 'return 42'));
  });

  it('reports syntax errors inside the script', () => {
    const text = vel(`
export default {
  data() { return { a: 1 }; },
  methods: { go() { const = 1; } },
};`);
    const diags = check(text);
    expect(diags.length).toBeGreaterThan(0);
    for (const d of diags) {
      expect(d.start).toBeGreaterThanOrEqual(offsetOf(text, '<script lang="ts">'));
      expect(d.end).toBeLessThanOrEqual(offsetOf(text, '</script>'));
    }
  });

  it('never reports a diagnostic outside the <script> block', () => {
    const text = vel(`
export default { data() { return { a: 1 }; }, methods: { go() { const s: string = this.a; } } };`);
    const scriptStart = offsetOf(text, '<script lang="ts">');
    const scriptEnd = offsetOf(text, '</script>');
    for (const d of check(text)) {
      expect(d.start).toBeGreaterThan(scriptStart);
      expect(d.end).toBeLessThanOrEqual(scriptEnd);
    }
  });

  it('keeps top-level declarations of different components from clashing', () => {
    const one = vel(`const shared = 1;\nexport default { data() { return { shared }; } };`);
    const two = vel(`const shared = 'x';\nexport default { data() { return { shared }; } };`);
    svc.updateDocument(file('A.vel'), one, 'teloce');
    svc.updateDocument(file('B.vel'), two, 'teloce');
    expect(svc.getDiagnostics(file('A.vel'))).toEqual([]);
    expect(svc.getDiagnostics(file('B.vel'))).toEqual([]);
  });

  it('allows importing other .vel components', () => {
    const text = vel(`
import Child from './Child.vel';
export default { components: { Child } };`);
    expect(check(text)).toEqual([]);
  });

  it('reports an unresolved import at the import specifier', () => {
    const text = vel(`
import { thing } from './does-not-exist';
export default { data() { return { thing }; } };`);
    const [d] = check(text);
    expect(d.code).toBe(2307);
    expect(slice(text, d)).toBe("'./does-not-exist'");
  });

  it('clears errors after the code is fixed', () => {
    const broken = vel(`export default { data() { return { a: 1 }; }, methods: { go() { this.b; } } };`);
    expect(check(broken)).toHaveLength(1);
    const fixed = vel(`export default { data() { return { a: 1, b: 2 }; }, methods: { go() { this.b; } } };`);
    expect(check(fixed)).toEqual([]);
  });
});

describe('which files are checked', () => {
  let svc: TeloceTsService;
  beforeAll(() => {
    svc = new TeloceTsService({ ts, rootDir: dir });
  });
  afterAll(() => svc.dispose());

  it('checks component-style .html files the same as .vel', () => {
    const text = vel(`
export default {
  data() { return { a: 1 }; },
  methods: { go() { const s: string = this.a; } },
};`);
    const vf = svc.updateDocument(file('C.html'), text, 'html');
    expect(vf?.virtualName).toBe(path.join(dir, 'C.html.ts').replace(/\\/g, '/'));
    const [d] = svc.getDiagnostics(file('C.html'));
    expect(d.code).toBe(2322);
    expect(slice(text, d)).toBe('s');
  });

  it('ignores full-page html shells (Jinja/Django/Flask templates)', () => {
    const shell = `<!doctype html><html><head></head><body>
<div id="app"></div>
{% block scripts %}<script lang="ts">const x: number = "not checked";</script>{% endblock %}
</body></html>`;
    expect(svc.updateDocument(file('shell.html'), shell, 'html')).toBeUndefined();
    expect(svc.getDiagnostics(file('shell.html'))).toEqual([]);
  });

  it('does not check plain <script> blocks (JavaScript)', () => {
    const text = `<template><p/></template>\n<script>\nexport default { data() { return {}; } };\nconst a = notDefined;\n</script>`;
    expect(svc.updateDocument(file('js.vel'), text, 'teloce')).toBeUndefined();
    expect(svc.getDiagnostics(file('js.vel'))).toEqual([]);
  });

  it('stops checking when lang="ts" is removed', () => {
    const ts1 = vel(`const a: number = 'x'; export default {};`);
    svc.updateDocument(file('flip.vel'), ts1, 'teloce');
    expect(svc.getDiagnostics(file('flip.vel'))).toHaveLength(1);

    svc.updateDocument(file('flip.vel'), ts1.replace(' lang="ts"', ''), 'teloce');
    expect(svc.getVirtualFile(file('flip.vel'))).toBeUndefined();
    expect(svc.getDiagnostics(file('flip.vel'))).toEqual([]);
  });

  it('forgets a document once removed', () => {
    svc.updateDocument(file('gone.vel'), vel(`const a: number = 'x'; export default {};`), 'teloce');
    expect(svc.getDiagnostics(file('gone.vel'))).toHaveLength(1);
    svc.removeDocument(file('gone.vel'));
    expect(svc.getDiagnostics(file('gone.vel'))).toEqual([]);
  });

  it('does not serve stale results when a document is closed and reopened with different text', () => {
    // Regression: versions used to restart at 1 after removal, so TypeScript
    // reused its cached parse of the *previous* text.
    const f = file('Reopen.vel');
    const bad = vel(`const a: number = 'x'; export default {};`);
    const good = vel(`const a: number = 1; export default {};`);

    svc.updateDocument(f, bad, 'teloce');
    expect(svc.getDiagnostics(f)).toHaveLength(1);
    svc.removeDocument(f);

    svc.updateDocument(f, good, 'teloce');
    expect(svc.getDiagnostics(f)).toEqual([]);
    svc.removeDocument(f);

    svc.updateDocument(f, bad, 'teloce');
    expect(svc.getDiagnostics(f)).toHaveLength(1);
    svc.removeDocument(f);
  });

  it('treats Windows-style paths and forward-slash paths as the same file', () => {
    const text = vel(`export default {};`);
    svc.updateDocument('C:\\proj\\App.vel', text, 'teloce');
    expect(svc.getVirtualFile('C:/proj/App.vel')?.virtualName).toBe('C:/proj/App.vel.ts');
    svc.removeDocument('C:/proj/App.vel');
    expect(svc.getVirtualFile('C:\\proj\\App.vel')).toBeUndefined();
  });
});

describe('configuration', () => {
  const nullable = vel(`
export default {
  props: { size: Number },
  methods: { go() { const s: number = this.size; return s; } },
};`);

  it('honours the strict option, and can toggle it live', () => {
    const svc = new TeloceTsService({ ts, rootDir: dir, strict: true });
    svc.updateDocument(file('S.vel'), nullable, 'teloce');
    expect(svc.getDiagnostics(file('S.vel'))).toHaveLength(1);

    svc.setStrict(false);
    expect(svc.getDiagnostics(file('S.vel'))).toEqual([]);

    svc.setStrict(true);
    expect(svc.getDiagnostics(file('S.vel'))).toHaveLength(1);
    svc.dispose();
  });

  it('reads compilerOptions from the nearest tsconfig.json', () => {
    const proj = fs.mkdtempSync(path.join(dir, 'proj-'));
    fs.writeFileSync(path.join(proj, 'tsconfig.json'), JSON.stringify({ compilerOptions: { strict: false } }));

    const svc = new TeloceTsService({ ts, rootDir: proj, strict: true });
    svc.updateDocument(path.join(proj, 'T.vel'), nullable, 'teloce');
    // tsconfig says strict: false, and wins over the extension's default.
    expect(svc.getDiagnostics(path.join(proj, 'T.vel'))).toEqual([]);
    svc.dispose();
  });

  it('picks up tsconfig changes after reloadConfig()', () => {
    const proj = fs.mkdtempSync(path.join(dir, 'proj-'));
    const svc = new TeloceTsService({ ts, rootDir: proj, strict: true });
    const f = path.join(proj, 'R.vel');
    svc.updateDocument(f, nullable, 'teloce');
    expect(svc.getDiagnostics(f)).toHaveLength(1);

    fs.writeFileSync(path.join(proj, 'tsconfig.json'), JSON.stringify({ compilerOptions: { strict: false } }));
    svc.reloadConfig();
    expect(svc.getDiagnostics(f)).toEqual([]);
    svc.dispose();
  });

  it('survives a malformed tsconfig.json by falling back to defaults', () => {
    const proj = fs.mkdtempSync(path.join(dir, 'proj-'));
    fs.writeFileSync(path.join(proj, 'tsconfig.json'), '{ this is not json');
    const svc = new TeloceTsService({ ts, rootDir: proj, strict: true });
    svc.updateDocument(path.join(proj, 'M.vel'), nullable, 'teloce');
    expect(svc.getDiagnostics(path.join(proj, 'M.vel'))).toHaveLength(1);
    svc.dispose();
  });
});

describe('imports from real files on disk', () => {
  let svc: TeloceTsService;
  let proj: string;
  beforeAll(() => {
    proj = fs.mkdtempSync(path.join(dir, 'imports-'));
    fs.writeFileSync(
      path.join(proj, 'util.ts'),
      `/** Adds two numbers. */\nexport function add(a: number, b: number): number {\n  return a + b;\n}\n`
    );
    svc = new TeloceTsService({ ts, rootDir: proj });
  });
  afterAll(() => svc.dispose());

  it('resolves relative imports and type-checks calls against them', () => {
    const ok = vel(`import { add } from './util';\nexport default { data() { return { n: add(1, 2) }; } };`);
    svc.updateDocument(path.join(proj, 'Ok.vel'), ok, 'teloce');
    expect(svc.getDiagnostics(path.join(proj, 'Ok.vel'))).toEqual([]);

    const bad = vel(`import { add } from './util';\nexport default { data() { return { n: add('1', 2) }; } };`);
    svc.updateDocument(path.join(proj, 'Bad.vel'), bad, 'teloce');
    const [d] = svc.getDiagnostics(path.join(proj, 'Bad.vel'));
    expect(d.code).toBe(2345);
    expect(slice(bad, d)).toBe("'1'");
  });

  it('notices edits to an imported file on disk', () => {
    const util = path.join(proj, 'changing.ts');
    fs.writeFileSync(util, 'export const value: number = 1;\n');
    const text = vel(`import { value } from './changing';\nconst s: string = value;\nexport default { data() { return { s }; } };`);
    const f = path.join(proj, 'Watch.vel');

    svc.updateDocument(f, text, 'teloce');
    expect(svc.getDiagnostics(f)).toHaveLength(1); // number is not a string

    fs.writeFileSync(util, "export const value: string = 'ok';\n");
    const later = new Date(Date.now() + 5000);
    fs.utimesSync(util, later, later); // make the mtime change unmistakable
    expect(svc.getDiagnostics(f)).toEqual([]);
  });

  it('go-to-definition on an import points at the real file with a line/column', () => {
    const text = vel(`import { add } from './util';\nexport default { data() { return { n: add(1, 2) }; } };`);
    const f = path.join(proj, 'Def.vel');
    svc.updateDocument(f, text, 'teloce');

    const [loc] = svc.getDefinitions(f, offsetOf(text, 'add(1'));
    expect(loc.inComponent).toBe(false);
    expect(loc.fileName.replace(/\\/g, '/')).toBe(path.join(proj, 'util.ts').replace(/\\/g, '/'));
    expect(loc.startLine).toBe(1); // `export function add` is on line 2 of util.ts
    expect(loc.startCharacter).toBe('export function '.length);
  });
});

describe('editor features', () => {
  let svc: TeloceTsService;
  const f = file('Feat.vel');
  const text = vel(`
export default {
  data() { return { draft: "", count: 0 }; },
  methods: {
    /** Sends the draft. */
    send() { return this.draft; },
    reset() { this.dr; },
  },
};`);

  beforeAll(() => {
    svc = new TeloceTsService({ ts, rootDir: dir });
    svc.updateDocument(f, text, 'teloce');
  });
  afterAll(() => svc.dispose());

  it('hover shows the type, with a range in the original file', () => {
    const at = offsetOf(text, 'this.draft;', 'this.'.length + 2);
    const hover = svc.getHover(f, at);
    expect(hover).toBeDefined();
    expect(hover!.display).toContain('draft');
    expect(hover!.display).toContain('string');
    expect(text.slice(hover!.start, hover!.end)).toBe('draft');
  });

  it('hover includes JSDoc for methods', () => {
    const at = offsetOf(text, 'send() {') + 1;
    expect(svc.getHover(f, at)?.documentation).toContain('Sends the draft.');
  });

  it('hover returns nothing outside the script (template, style)', () => {
    expect(svc.getHover(f, offsetOf(text, '{{ x }}') + 3)).toBeUndefined();
    expect(svc.getHover(f, offsetOf(text, 'div{}') + 1)).toBeUndefined();
  });

  it('completes members of `this`', () => {
    const at = offsetOf(text, 'this.dr;', 'this.'.length);
    const names = svc.getCompletions(f, at).map((c) => c.name);
    expect(names).toContain('draft');
    expect(names).toContain('count');
    expect(names).toContain('send');
    expect(names).toContain('$emit');
  });

  it('completion replacement spans are in original offsets', () => {
    const at = offsetOf(text, 'this.dr;', 'this.dr'.length);
    for (const c of svc.getCompletions(f, at)) {
      if (c.replaceStart !== undefined && c.replaceEnd !== undefined) {
        expect(c.replaceStart).toBeGreaterThan(offsetOf(text, '<script'));
        expect(c.replaceEnd).toBeLessThan(offsetOf(text, '</script>'));
      }
    }
  });

  it('gives no completions outside the script', () => {
    expect(svc.getCompletions(f, offsetOf(text, '{{ x }}') + 3)).toEqual([]);
  });

  it('resolves completion details lazily', () => {
    const at = offsetOf(text, 'this.dr;', 'this.'.length);
    const details = svc.getCompletionDetails(f, at, 'draft');
    expect(details?.display).toContain('string');
  });

  it('go-to-definition inside the component maps back to the original file', () => {
    const at = offsetOf(text, 'this.draft;', 'this.'.length + 1);
    const locs = svc.getDefinitions(f, at);
    expect(locs).toHaveLength(1);
    expect(locs[0].inComponent).toBe(true);
    expect(locs[0].fileName).toBe(f.replace(/\\/g, '/'));
    // Lands on `draft` in `data() { return { draft: "" ...`.
    expect(text.slice(locs[0].start, locs[0].end)).toBe('draft');
    expect(locs[0].start).toBe(offsetOf(text, 'draft: ""'));
  });

  it('returns nothing for definitions outside the script', () => {
    expect(svc.getDefinitions(f, offsetOf(text, '{{ x }}') + 3)).toEqual([]);
  });

  it('returns empty results for files it does not know', () => {
    expect(svc.getDiagnostics(file('unknown.vel'))).toEqual([]);
    expect(svc.getHover(file('unknown.vel'), 0)).toBeUndefined();
    expect(svc.getCompletions(file('unknown.vel'), 0)).toEqual([]);
    expect(svc.getDefinitions(file('unknown.vel'), 0)).toEqual([]);
  });
});

describe('prettifyMessage', () => {
  it('replaces the internal instance type', () => {
    const raw =
      "Property 'nope' does not exist on type '__TeloceInstance<{ readonly a: string; }, { b: number; }, {}, {}, {}>'.";
    expect(prettifyMessage(raw)).toBe("Property 'nope' does not exist on type 'component instance'.");
  });

  it('replaces the internal options type', () => {
    const raw = "Type 'number' is not assignable to type '__TeloceOptions<{}, {}, {}, {}, {}>'.";
    expect(prettifyMessage(raw)).toBe("Type 'number' is not assignable to type 'component options'.");
  });

  it('handles nested generics and multiple occurrences', () => {
    const raw = "'__TeloceInstance<Array<Foo<'x'>>>' vs '__TeloceInstance<{ a: 1 }>'";
    expect(prettifyMessage(raw)).toBe("'component instance' vs 'component instance'");
  });

  it('leaves ordinary messages alone', () => {
    const raw = "Type 'string' is not assignable to type 'number'.";
    expect(prettifyMessage(raw)).toBe(raw);
  });
});
