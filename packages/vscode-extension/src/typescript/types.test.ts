/**
 * TypeScript *type* features inside <script lang="ts">: interfaces, aliases,
 * generics, enums, imported types, typed props, narrowing, strictness.
 * Each feature has a passing case and a failing case, so we know both that
 * valid code is accepted and that real type errors are caught.
 */
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import * as ts from 'typescript';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { TeloceTsService, type MappedDiagnostic } from './service.js';

const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'teloce-types-'));
afterAll(() => fs.rmSync(dir, { recursive: true, force: true }));

fs.writeFileSync(
  path.join(dir, 'models.ts'),
  `export interface User { id: number; name: string; email?: string }\nexport type Role = 'admin' | 'member';\nexport enum Level { Low = 1, High = 2 }\nexport function makeUser(name: string): User { return { id: 1, name }; }\n`
);
fs.writeFileSync(path.join(dir, 'ambient.d.ts'), `export interface Settings { theme: 'light' | 'dark' }\n`);

const wrap = (script: string) => `<template><p/></template>\n<script lang="ts">\n${script}\n</script>\n`;
const slice = (text: string, d: MappedDiagnostic) => text.slice(d.start, d.end);

let svc: TeloceTsService;
beforeAll(() => {
  svc = new TeloceTsService({ ts, rootDir: dir });
});
afterAll(() => svc.dispose());

let n = 0;
/** Checks a script and returns diagnostics plus the full file text. */
function check(script: string) {
  const text = wrap(script);
  const file = path.join(dir, `C${n++}.vel`);
  svc.updateDocument(file, text, 'teloce');
  return { text, file, diags: svc.getDiagnostics(file) };
}

describe('interfaces and type aliases', () => {
  it('accepts data typed with an interface', () => {
    const { diags } = check(`
interface Message { id: number; text: string }
export default {
  data() { return { messages: [] as Message[] }; },
  methods: { add(text: string) { this.messages.push({ id: this.messages.length, text }); } },
};`);
    expect(diags).toEqual([]);
  });

  it('rejects a value that does not match the interface', () => {
    const { text, diags } = check(`
interface Message { id: number; text: string }
export default {
  data() { return { messages: [] as Message[] }; },
  methods: { add() { this.messages.push({ id: 1, text: 2 }); } },
};`);
    expect(diags).toHaveLength(1);
    expect(diags[0].code).toBe(2322);
    expect(slice(text, diags[0])).toBe('text');
  });

  it('rejects a missing required interface member', () => {
    const { diags } = check(`
interface Message { id: number; text: string }
export default {
  data() { return { messages: [] as Message[] }; },
  methods: { add() { this.messages.push({ id: 1 }); } },
};`);
    expect(diags.map((d) => d.code)).toEqual([2345]);
  });

  it('checks string-literal union aliases', () => {
    const ok = check(`
type Status = 'idle' | 'loading' | 'done';
export default {
  data() { return { status: 'idle' as Status }; },
  methods: { go() { this.status = 'loading'; } },
};`);
    expect(ok.diags).toEqual([]);

    const bad = check(`
type Status = 'idle' | 'loading' | 'done';
export default {
  data() { return { status: 'idle' as Status }; },
  methods: { go() { this.status = 'bogus'; } },
};`);
    expect(bad.diags).toHaveLength(1);
    expect(bad.diags[0].message).toContain("'\"bogus\"' is not assignable");
  });

  it('supports optional members, readonly and index signatures', () => {
    const { text, diags } = check(`
interface Config { readonly name: string; retries?: number; [extra: string]: unknown }
const cfg: Config = { name: 'a' };
cfg.retries = 3;
cfg.name = 'b';
export default {};`);
    expect(diags).toHaveLength(1);
    expect(diags[0].code).toBe(2540); // cannot assign to read-only property
    expect(slice(text, diags[0])).toBe('name');
  });

  it('supports utility types', () => {
    const { diags } = check(`
interface User { id: number; name: string }
const patch: Partial<User> = { name: 'x' };
const pick: Pick<User, 'id'> = { id: 1 };
const map: Record<string, number> = { a: 1 };
const ro: Readonly<User> = { id: 1, name: 'a' };
export default { data() { return { patch, pick, map, ro }; } };`);
    expect(diags).toEqual([]);
  });

  it('flags a bad key for Pick/Record', () => {
    const { diags } = check(`
interface User { id: number; name: string }
const bad: Pick<User, 'nope'> = { id: 1 };
export default {};`);
    expect(diags.length).toBeGreaterThan(0);
  });

  it('supports as const, keyof typeof and satisfies', () => {
    const { diags } = check(`
const COLORS = { red: '#f00', blue: '#00f' } as const;
type ColorName = keyof typeof COLORS;
const pick: ColorName = 'red';
const conf = { port: 80 } satisfies Record<string, number>;
export default { data() { return { pick, conf }; } };`);
    expect(diags).toEqual([]);

    const bad = check(`
const COLORS = { red: '#f00' } as const;
type ColorName = keyof typeof COLORS;
const pick: ColorName = 'green';
export default {};`);
    expect(bad.diags).toHaveLength(1);
  });
});

describe('generics', () => {
  it('infers generic function results', () => {
    const { text, diags } = check(`
function first<T>(xs: T[]): T | undefined { return xs[0]; }
const n: number | undefined = first([1, 2]);
const s: string = first([1, 2]);
export default {};`);
    expect(diags).toHaveLength(1);
    expect(slice(text, diags[0])).toBe('s');
  });

  it('checks generic constraints', () => {
    const ok = check(`
function len<T extends { length: number }>(x: T): number { return x.length; }
len('abc'); len([1, 2]);
export default {};`);
    expect(ok.diags).toEqual([]);

    const bad = check(`
function len<T extends { length: number }>(x: T): number { return x.length; }
len(42);
export default {};`);
    expect(bad.diags.map((d) => d.code)).toEqual([2345]);
  });

  it('supports generic interfaces and classes', () => {
    const { diags } = check(`
interface Box<T> { value: T }
class Stack<T> { private items: T[] = []; push(x: T) { this.items.push(x); } peek(): T | undefined { return this.items[0]; } }
const b: Box<string> = { value: 'a' };
const st = new Stack<number>();
st.push(1);
export default { data() { return { b, size: st.peek() }; } };`);
    expect(diags).toEqual([]);

    const bad = check(`
class Stack<T> { push(x: T) {} }
new Stack<number>().push('no');
export default {};`);
    expect(bad.diags.map((d) => d.code)).toEqual([2345]);
  });

  it('supports conditional and mapped types', () => {
    const { diags } = check(`
type Unwrap<T> = T extends Promise<infer U> ? U : T;
type Flags<T> = { [K in keyof T]: boolean };
const a: Unwrap<Promise<string>> = 'x';
const f: Flags<{ a: 1; b: 2 }> = { a: true, b: false };
export default { data() { return { a, f }; } };`);
    expect(diags).toEqual([]);
  });
});

describe('enums, classes, narrowing', () => {
  it('supports enums', () => {
    const ok = check(`
enum Level { Low = 1, High = 2 }
const l: Level = Level.High;
export default { data() { return { l }; } };`);
    expect(ok.diags).toEqual([]);
    const bad = check(`
enum Level { Low = 1, High = 2 }
const l: Level = 'High';
export default {};`);
    expect(bad.diags).toHaveLength(1);
  });

  it('narrows unions with typeof / in / discriminants', () => {
    const { diags } = check(`
type Shape = { kind: 'circle'; r: number } | { kind: 'sq'; s: number };
function area(s: Shape): number { return s.kind === 'circle' ? s.r * 2 : s.s * s.s; }
function show(x: string | number): string { return typeof x === 'string' ? x.toUpperCase() : x.toFixed(); }
export default { data() { return { a: area({ kind: 'sq', s: 2 }), t: show(1) }; } };`);
    expect(diags).toEqual([]);
  });

  it('reports use of a possibly-undefined value under strict', () => {
    const { text, diags } = check(`
function f(x?: string) { return x.length; }
export default {};`);
    expect(diags).toHaveLength(1);
    expect(diags[0].code).toBe(18048);
    expect(slice(text, diags[0])).toBe('x');
  });

  it('flags implicit any parameters and unknown catch variables', () => {
    const { diags } = check(`
export default {
  methods: {
    f(a) { return a; },
    g() { try { return 1; } catch (e) { return e.message; } },
  },
};`);
    const codes = diags.map((d) => d.code).sort();
    expect(codes).toContain(7006); // parameter implicitly any
    expect(codes).toContain(18046); // 'e' is of type 'unknown'
  });
});

describe('typed methods, async and computed', () => {
  it('checks arguments of this.method() calls', () => {
    const { text, diags } = check(`
export default {
  methods: {
    add(a: number, b: number): number { return a + b; },
    run() { this.add(1, 2); this.add('1', 2); this.add(1); },
  },
};`);
    expect(diags.map((d) => d.code)).toEqual([2345, 2554]);
    expect(slice(text, diags[0])).toBe("'1'");
  });

  it('types async methods and awaited values', () => {
    const ok = check(`
interface Item { id: number }
export default {
  data() { return { items: [] as Item[] }; },
  methods: {
    async load(): Promise<Item[]> { return [{ id: 1 }]; },
    async run() { this.items = await this.load(); },
  },
};`);
    expect(ok.diags).toEqual([]);

    const bad = check(`
interface Item { id: number }
export default {
  data() { return { items: [] as Item[] }; },
  methods: {
    async load(): Promise<string[]> { return ['a']; },
    async run() { this.items = await this.load(); },
  },
};`);
    expect(bad.diags.map((d) => d.code)).toEqual([2322]);
  });

  it('checks computed return annotations and uses computed values', () => {
    const ok = check(`
export default {
  data() { return { items: [1, 2, 3] }; },
  computed: { total(): number { return this.items.reduce((a, b) => a + b, 0); } },
  methods: { show(): string { return this.total.toFixed(2); } },
};`);
    expect(ok.diags).toEqual([]);

    const bad = check(`
export default {
  computed: { label(): number { return 'text'; } },
};`);
    expect(bad.diags.map((d) => d.code)).toEqual([2322]);
  });

  it('types event handlers and DOM APIs', () => {
    const { diags } = check(`
export default {
  methods: {
    onInput(e: Event) { const v = (e.target as HTMLInputElement).value; return v.trim(); },
    focus() { document.querySelector<HTMLInputElement>('input')?.focus(); },
  },
};`);
    expect(diags).toEqual([]);
  });

  it('flags a DOM misuse', () => {
    const { diags } = check(`
export default { methods: { f() { document.getElementById('a').focus(); } } };`);
    expect(diags.map((d) => d.code)).toEqual([2531]);
  });
});

describe('typed props', () => {
  it('types object props with PropType<T>', () => {
    const ok = check(`
import type { User } from './models';
export default {
  props: { user: { type: Object as PropType<User>, required: true } },
  methods: { label(): string { return this.user.name + this.user.id; } },
};`);
    expect(ok.diags).toEqual([]);

    const bad = check(`
import type { User } from './models';
export default {
  props: { user: { type: Object as PropType<User>, required: true } },
  methods: { label() { return this.user.nme; } },
};`);
    expect(bad.diags.length).toBeGreaterThan(0);
    expect(bad.diags[0].message).toContain("Property 'nme' does not exist");
  });

  it('types array props with PropType<T[]>', () => {
    const ok = check(`
export default {
  props: { tags: { type: Array as PropType<string[]>, default: () => [] } },
  methods: { first(): string | undefined { return this.tags[0]; } },
};`);
    expect(ok.diags).toEqual([]);
  });

  it('types union props and function props', () => {
    const { diags } = check(`
export default {
  props: {
    role: { type: String as PropType<'admin' | 'member'>, required: true },
    onPick: { type: Function as PropType<(id: number) => void>, required: true },
  },
  methods: { go() { const r: 'admin' | 'member' = this.role; this.onPick(1); return r; } },
};`);
    expect(diags).toEqual([]);

    const bad = check(`
export default {
  props: { onPick: { type: Function as PropType<(id: number) => void>, required: true } },
  methods: { go() { this.onPick('x'); } },
};`);
    expect(bad.diags.map((d) => d.code)).toEqual([2345]);
  });

  it('accepts the `() => T` constructor cast too', () => {
    const { diags } = check(`
interface Opt { a: number }
export default {
  props: { opt: { type: Object as () => Opt, required: true } },
  methods: { f(): number { return this.opt.a; } },
};`);
    expect(diags).toEqual([]);
  });
});

describe('imported types', () => {
  it('uses `import type` from a .ts file', () => {
    const ok = check(`
import type { User, Role } from './models';
const u: User = { id: 1, name: 'a' };
const r: Role = 'admin';
export default { data() { return { u, r }; } };`);
    expect(ok.diags).toEqual([]);

    const bad = check(`
import type { User } from './models';
const u: User = { id: 'x', name: 'a' };
export default {};`);
    expect(bad.diags).toHaveLength(1);
    expect(bad.diags[0].code).toBe(2322);
  });

  it('uses values, enums and functions exported alongside types', () => {
    const { diags } = check(`
import { makeUser, Level, type User } from './models';
const u: User = makeUser('a');
const l: Level = Level.Low;
export default { data() { return { u, l }; } };`);
    expect(diags).toEqual([]);
  });

  it('flags importing a name that does not exist', () => {
    const { text, diags } = check(`
import type { Nope } from './models';
export default {};`);
    expect(diags).toHaveLength(1);
    expect(diags[0].code).toBe(2305);
    expect(slice(text, diags[0])).toBe('Nope');
  });

  it('resolves types from a .d.ts file', () => {
    const { diags } = check(`
import type { Settings } from './ambient';
const s: Settings = { theme: 'dark' };
export default { data() { return { s }; } };`);
    expect(diags).toEqual([]);
  });

  it('allows `declare` for globals the page provides', () => {
    const { diags } = check(`
declare const __APP_VERSION__: string;
declare global { interface Window { app: { version: string } } }
export default { data() { return { v: __APP_VERSION__ + window.app.version }; } };`);
    expect(diags).toEqual([]);
  });

  it('accepts exporting types next to the default export', () => {
    const { diags } = check(`
export interface Props { a: number }
export type Id = string;
export default { data() { return { a: 1 as Props['a'] }; } };`);
    expect(diags).toEqual([]);
  });
});

describe('editor features on types', () => {
  it('hover shows the resolved type of an interface-typed member', () => {
    const { text, file } = check(`
interface Message { id: number; text: string }
export default {
  data() { return { messages: [] as Message[] }; },
  methods: { n() { return this.messages.length; } },
};`);
    const at = text.indexOf('this.messages.length') + 'this.'.length + 2;
    const hover = svc.getHover(file, at);
    expect(hover?.display).toContain('Message[]');
  });

  it('completes members of an interface-typed value', () => {
    const { text, file } = check(`
interface Message { id: number; text: string }
const m: Message = { id: 1, text: 'a' };
m.
export default {};`);
    const at = text.indexOf('m.\n') + 2;
    const names = svc.getCompletions(file, at).map((c) => c.name);
    expect(names).toEqual(expect.arrayContaining(['id', 'text']));
  });

  it('go-to-definition on a type name jumps to its declaration', () => {
    const { text, file } = check(`
interface Message { id: number }
const m: Message = { id: 1 };
export default {};`);
    const at = text.indexOf(': Message') + 3;
    const [loc] = svc.getDefinitions(file, at);
    expect(loc.inComponent).toBe(true);
    expect(text.slice(loc.start, loc.end)).toBe('Message');
    expect(loc.start).toBe(text.indexOf('interface Message') + 'interface '.length);
  });

  it('go-to-definition on an imported type opens the real file', () => {
    const { text, file } = check(`
import type { User } from './models';
const u: User = { id: 1, name: 'a' };
export default {};`);
    const [loc] = svc.getDefinitions(file, text.indexOf(': User') + 3);
    expect(loc.inComponent).toBe(false);
    expect(loc.fileName).toMatch(/models\.ts$/);
    expect(loc.startLine).toBe(0);
  });
});
