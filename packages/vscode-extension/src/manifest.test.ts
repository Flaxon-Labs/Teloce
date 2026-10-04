/**
 * Publish-readiness checks: package.json must agree with the code and the
 * files on disk. These are the mismatches that only show up after install
 * ("command not found", missing setting, broken icon, empty package).
 */
import * as fs from 'node:fs';
import * as path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it, vi } from 'vitest';
import { registeredCommands } from '../__mocks__/vscode';
import { registerCommands } from './commands/index.js';

vi.mock('@teloce/language-service', () => ({ formatTemplate: vi.fn() }));

const root = fileURLToPath(new URL('..', import.meta.url));
const read = (rel: string) => fs.readFileSync(path.join(root, rel), 'utf8');
const exists = (rel: string) => fs.existsSync(path.join(root, rel));
/** JSON that may contain // or /* comments, as VS Code allows in config files. */
const readJsonc = (rel: string) =>
  JSON.parse(read(rel).replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, ''));

const pkg = JSON.parse(read('package.json'));
const contributes = pkg.contributes;
const settings: Record<string, { type: string; default: unknown; description: string }> =
  contributes.configuration.properties;

function sourceFiles(dir = path.join(root, 'src')): string[] {
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap((e) => {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) return sourceFiles(p);
    return /\.ts$/.test(e.name) && !/\.(test|spec)\.ts$/.test(e.name) ? [p] : [];
  });
}

describe('package.json basics', () => {
  it('has the fields the marketplace requires', () => {
    for (const key of ['name', 'displayName', 'publisher', 'version', 'description', 'engines', 'main']) {
      expect(pkg[key], key).toBeTruthy();
    }
    expect(pkg.version).toMatch(/^\d+\.\d+\.\d+/);
    expect(pkg.engines.vscode).toMatch(/^\^\d+\.\d+\.\d+$/);
  });

  it('points main at the file the build produces', () => {
    expect(pkg.main).toBe('./dist/extension.cjs');
    const tsup = read('tsup.config.ts');
    expect(tsup).toContain("format: ['cjs']");
    expect(tsup).toContain("entry: ['src/extension.ts']");
    expect(tsup).toMatch(/external:\s*\['vscode'/);
  });

  it('bundles typescript and @teloce/* (the .vsix ships without node_modules)', () => {
    const tsup = read('tsup.config.ts');
    expect(tsup).toMatch(/noExternal:\s*\[[^\]]*@teloce[^\]]*'typescript'[^\]]*'ws'/);
    expect(tsup).toContain('copy-ts-libs');
    expect(tsup).toContain('copy-dashboard');
    expect(tsup).toContain('shims: true');
  });

  it('@types/vscode is not newer than engines.vscode (vsce refuses to package otherwise)', () => {
    const types = pkg.devDependencies['@types/vscode'].replace(/^[^\d]*/, '').split('.').map(Number);
    const engine = pkg.engines.vscode.replace(/^[^\d]*/, '').split('.').map(Number);
    expect(types[0] * 1000 + types[1]).toBeLessThanOrEqual(engine[0] * 1000 + engine[1]);
  });

  it('builds before publishing', () => {
    expect(pkg.scripts['vscode:prepublish']).toContain('build');
    expect(pkg.scripts.package).toContain('--no-dependencies');
  });

  it('has an icon that exists', () => {
    expect(exists(pkg.icon)).toBe(true);
  });
});

describe('languages and grammar', () => {
  const language = contributes.languages[0];

  it('declares the teloce language for .vel and .teloce', () => {
    expect(language.id).toBe('teloce');
    expect(language.extensions).toEqual(expect.arrayContaining(['.vel', '.teloce']));
    for (const ext of language.extensions) expect(ext.startsWith('.')).toBe(true);
  });

  it('ships its language configuration and file icons', () => {
    expect(() => readJsonc(language.configuration)).not.toThrow();
    expect(exists(language.icon.light)).toBe(true);
    expect(exists(language.icon.dark)).toBe(true);
  });

  it('has a grammar for the declared language, with a matching scope name', () => {
    const grammar = contributes.grammars[0];
    expect(grammar.language).toBe(language.id);
    const json = JSON.parse(read(grammar.path));
    expect(json.scopeName).toBe(grammar.scopeName);
    expect(Array.isArray(json.patterns)).toBe(true);
  });

  it('has grammar regexes that are valid', () => {
    const json = JSON.parse(read(contributes.grammars[0].path));
    const bad: string[] = [];
    const walk = (node: unknown) => {
      if (Array.isArray(node)) return node.forEach(walk);
      if (node && typeof node === 'object') {
        for (const [k, v] of Object.entries(node)) {
          if (['match', 'begin', 'end'].includes(k) && typeof v === 'string') {
            try {
              new RegExp(v.replace(/\(\?<([a-z_]+)>/gi, '(?<$1>'));
            } catch {
              bad.push(`${k}: ${v}`);
            }
          } else walk(v);
        }
      }
    };
    walk(json);
    expect(bad).toEqual([]);
  });

  it('references only repository rules that exist', () => {
    const json = JSON.parse(read(contributes.grammars[0].path));
    const defined = new Set(Object.keys(json.repository ?? {}));
    const missing: string[] = [];
    const walk = (node: unknown) => {
      if (Array.isArray(node)) return node.forEach(walk);
      if (node && typeof node === 'object') {
        for (const [k, v] of Object.entries(node)) {
          if (k === 'include' && typeof v === 'string' && v.startsWith('#') && !defined.has(v.slice(1))) missing.push(v);
          else walk(v);
        }
      }
    };
    walk(json);
    expect(missing).toEqual([]);
  });
});

describe('activation', () => {
  it('activates for the languages the extension serves', () => {
    expect(pkg.activationEvents).toEqual(expect.arrayContaining(['onLanguage:teloce', 'onLanguage:html']));
  });
});

describe('commands', () => {
  it('declares exactly the commands the code registers', () => {
    registeredCommands.clear();
    registerCommands({ subscriptions: [] } as never);
    const declared = contributes.commands.map((c: { command: string }) => c.command).sort();
    expect(declared).toEqual([...registeredCommands.keys()].sort());
  });

  it('gives every command a title and category', () => {
    for (const c of contributes.commands) {
      expect(c.title, c.command).toBeTruthy();
      expect(c.category, c.command).toBeTruthy();
    }
  });

  it('only binds keys to declared commands', () => {
    const declared = new Set(contributes.commands.map((c: { command: string }) => c.command));
    for (const k of contributes.keybindings) expect(declared.has(k.command), k.command).toBe(true);
  });
});

describe('settings', () => {
  it('uses only settings that are declared in package.json', () => {
    const missing: string[] = [];
    for (const file of sourceFiles()) {
      const src = fs.readFileSync(file, 'utf8');
      const sections = [...src.matchAll(/getConfiguration\(\s*'([^']+)'\s*\)/g)].map((m) => m[1]);
      if (!sections.length) continue;
      const keys = [...src.matchAll(/\.get(?:<[^>]*>)?\(\s*'([^']+)'/g)].map((m) => m[1]);
      for (const key of keys) {
        if (!sections.some((s) => `${s}.${key}` in settings)) {
          missing.push(`${path.relative(root, file)}: ${key} (sections: ${sections.join(', ')})`);
        }
      }
    }
    expect(missing).toEqual([]);
  });

  it('gives every setting a type, default and description', () => {
    for (const [key, def] of Object.entries(settings)) {
      expect(def.type, key).toBeTruthy();
      expect(def.default, key).not.toBeUndefined();
      expect(def.description, key).toBeTruthy();
      expect(key.startsWith('teloce.'), key).toBe(true);
    }
  });

  it('defaults match their declared type', () => {
    for (const [key, def] of Object.entries(settings)) {
      expect(typeof def.default, key).toBe(def.type);
    }
  });

  it('turns TypeScript support on by default', () => {
    expect(settings['teloce.typescript.enable'].default).toBe(true);
    expect(settings['teloce.typescript.strict'].default).toBe(true);
  });
});

describe('packaging rules', () => {
  const ignore = read('.vscodeignore');

  it('ships the bundle, TypeScript lib files and the debugger dashboard', () => {
    expect(ignore).toContain('!dist/extension.cjs');
    expect(ignore).toContain('!dist/ts-lib/**');
    expect(ignore).toContain('!dist/dashboard/**');
  });

  it('does not ship source maps or build scripts', () => {
    expect(ignore).toMatch(/^\*\*\/\*\.map$/m);
    expect(ignore).toMatch(/^scripts\/\*\*$/m);
  });

  it('does not re-include all of dist (would bring back the 14 MB map)', () => {
    expect(ignore).not.toMatch(/^!dist\/\*\*$/m);
  });
});
