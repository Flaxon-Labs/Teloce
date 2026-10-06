/**
 * A TypeScript LanguageService that type-checks the `<script lang="ts">`
 * block of Teloce components (`.vel`, and component-style `.html`).
 *
 * It knows nothing about VS Code: it takes file names, text and offsets, and
 * returns results in *original file* offsets. That keeps it fully testable
 * and reusable (a CLI check or a Volar/LSP wrapper could sit on top of it).
 */

import * as path from 'node:path';
import type * as TS from 'typescript';
import { getTypeScriptBlock, isTeloceComponent } from './blocks.js';
import { ENV_FILE_NAME, TELOCE_ENV_DTS } from './env.js';
import { createVirtualFile, type VirtualFile } from './virtual.js';

export interface TeloceTsServiceOptions {
  /** The `typescript` module. Injected so the host controls which copy is used. */
  ts: typeof TS;
  /** Directory containing `lib.*.d.ts`. Defaults to next to `typescript.js`. */
  libDir?: string;
  /** File system access. Defaults to `ts.sys`. */
  sys?: TS.System;
  /** Root used to find `tsconfig.json` and `node_modules`. Defaults to cwd. */
  rootDir?: string;
  /** Turn on `strict`. Defaults to true. A tsconfig `strict` setting wins. */
  strict?: boolean;
}

export type DiagnosticCategory = 'error' | 'warning' | 'suggestion' | 'message';

export interface MappedDiagnostic {
  /** Range in the original file, as offsets. */
  start: number;
  end: number;
  message: string;
  code: number;
  category: DiagnosticCategory;
  /** Set for diagnostics TypeScript marks as unused code / deprecated. */
  unnecessary?: boolean;
  deprecated?: boolean;
}

export interface MappedHover {
  start: number;
  end: number;
  /** Signature, e.g. `(property) draft: string`. */
  display: string;
  documentation: string;
}

export interface MappedCompletion {
  name: string;
  kind: string;
  sortText: string;
  insertText?: string;
  /** Range to replace, in original offsets. */
  replaceStart?: number;
  replaceEnd?: number;
  source?: string;
}

export interface MappedLocation {
  /** Original file name for locations inside a component, else the real file. */
  fileName: string;
  start: number;
  end: number;
  /** True when start/end are offsets in `fileName` as the editor sees it. */
  inComponent: boolean;
  /** Set when not in a component: position TypeScript computed for us. */
  startLine?: number;
  startCharacter?: number;
  endLine?: number;
  endCharacter?: number;
}

function normalize(p: string): string {
  return p.replace(/\\/g, '/');
}

/**
 * TypeScript spells out our internal helper types in messages, e.g.
 * `type '__TeloceInstance<{ readonly title: ... }, ...>'`. Show something a
 * component author can read instead.
 */
export function prettifyMessage(message: string): string {
  return message
    .replace(/'__TeloceInstance<[\s\S]*?>'/g, "'component instance'")
    .replace(/'__TeloceOptions<[\s\S]*?>'/g, "'component options'");
}

export class TeloceTsService {
  private readonly ts: typeof TS;
  private readonly sys: TS.System;
  private readonly libDir: string;
  private readonly rootDir: string;
  private strict: boolean;

  private readonly files = new Map<string, { file: VirtualFile; version: number }>();
  private readonly byOriginal = new Map<string, string>();
  private readonly envPath: string;
  private options: TS.CompilerOptions;
  /**
   * Source of unique script versions. It only ever increases, so a document
   * that is closed and reopened (or edited back to an earlier text) never
   * reuses a version number TypeScript has already cached a parse for.
   */
  private versionCounter = 0;
  private readonly service: TS.LanguageService;

  constructor(opts: TeloceTsServiceOptions) {
    this.ts = opts.ts;
    this.sys = opts.sys ?? opts.ts.sys;
    this.libDir = normalize(
      opts.libDir ?? path.dirname(normalize(opts.ts.getDefaultLibFilePath({})))
    );
    this.rootDir = normalize(opts.rootDir ?? this.sys.getCurrentDirectory());
    this.strict = opts.strict ?? true;
    this.envPath = normalize(path.posix.join(this.rootDir, ENV_FILE_NAME));
    this.options = this.buildOptions();
    this.service = this.ts.createLanguageService(this.createHost(), this.ts.createDocumentRegistry());
  }

  // -- configuration ------------------------------------------------------

  setStrict(strict: boolean): void {
    if (strict === this.strict) return;
    this.strict = strict;
    this.options = this.buildOptions();
  }

  /** Re-reads tsconfig.json (call when it changes on disk). */
  reloadConfig(): void {
    this.options = this.buildOptions();
  }

  private buildOptions(): TS.CompilerOptions {
    const ts = this.ts;
    const defaults: TS.CompilerOptions = {
      target: ts.ScriptTarget.ES2020,
      module: ts.ModuleKind.ESNext,
      moduleResolution: ts.ModuleResolutionKind.Bundler ?? ts.ModuleResolutionKind.Node10,
      lib: ['lib.es2020.d.ts', 'lib.dom.d.ts', 'lib.dom.iterable.d.ts'],
      strict: this.strict,
      esModuleInterop: true,
      resolveJsonModule: true,
      skipLibCheck: true,
      allowNonTsExtensions: true,
    };

    let fromConfig: TS.CompilerOptions = {};
    const configPath = ts.findConfigFile(this.rootDir, (f) => this.sys.fileExists(f));
    if (configPath) {
      const read = ts.readConfigFile(configPath, (f) => this.sys.readFile(f));
      if (!read.error) {
        const parsed = ts.parseJsonConfigFileContent(
          read.config,
          this.sys,
          path.posix.dirname(normalize(configPath))
        );
        fromConfig = parsed.options;
      }
    }

    // Force what the virtual setup depends on; never emit.
    return {
      ...defaults,
      ...fromConfig,
      noEmit: true,
      allowNonTsExtensions: true,
      composite: false,
      incremental: false,
      declaration: false,
      // Component scripts are not part of any tsconfig `include`; do not let
      // `rootDir`/`outDir` complain about them.
      rootDir: undefined,
      outDir: undefined,
    };
  }

  // -- documents ----------------------------------------------------------

  /**
   * Registers or refreshes a document. Returns the virtual file when the
   * document has a type-checkable script, otherwise removes any earlier
   * registration and returns undefined.
   */
  updateDocument(fileName: string, text: string, languageId: string): VirtualFile | undefined {
    const original = normalize(fileName);

    if (!isTeloceComponent(text, languageId)) {
      this.removeDocument(original);
      return undefined;
    }
    const block = getTypeScriptBlock(text);
    if (!block) {
      this.removeDocument(original);
      return undefined;
    }

    const file = createVirtualFile(this.ts, original, block);
    const previous = this.files.get(file.virtualName);
    const oldName = this.byOriginal.get(original);
    if (oldName && oldName !== file.virtualName) this.files.delete(oldName);

    // Only bump the version when the code TypeScript sees changed, so hover /
    // completion requests that re-sync unchanged text don't force a re-check.
    const unchanged = previous !== undefined && previous.file.code === file.code;
    this.files.set(file.virtualName, {
      file,
      version: unchanged ? previous.version : ++this.versionCounter,
    });
    this.byOriginal.set(original, file.virtualName);
    return file;
  }

  removeDocument(fileName: string): void {
    const original = normalize(fileName);
    const virtualName = this.byOriginal.get(original);
    if (virtualName) {
      this.files.delete(virtualName);
      this.byOriginal.delete(original);
    }
  }

  getVirtualFile(fileName: string): VirtualFile | undefined {
    const name = this.byOriginal.get(normalize(fileName));
    return name ? this.files.get(name)?.file : undefined;
  }

  // -- features -----------------------------------------------------------

  getDiagnostics(fileName: string): MappedDiagnostic[] {
    const vf = this.getVirtualFile(fileName);
    if (!vf) return [];
    const ts = this.ts;

    const raw = [
      ...this.service.getSyntacticDiagnostics(vf.virtualName),
      ...this.service.getSemanticDiagnostics(vf.virtualName),
    ];

    const out: MappedDiagnostic[] = [];
    for (const d of raw) {
      if (d.start === undefined || d.length === undefined) continue;
      const range = vf.map.toOriginalRange(d.start, d.start + d.length);
      if (!range) continue;

      out.push({
        start: range[0],
        end: range[1],
        message: prettifyMessage(ts.flattenDiagnosticMessageText(d.messageText, '\n')),
        code: d.code,
        category: this.categoryOf(d.category),
        unnecessary: d.reportsUnnecessary ? true : undefined,
        deprecated: d.reportsDeprecated ? true : undefined,
      });
    }
    return out;
  }

  getHover(fileName: string, offset: number): MappedHover | undefined {
    const vf = this.getVirtualFile(fileName);
    const v = vf?.map.toVirtual(offset);
    if (!vf || v === undefined) return undefined;

    const info = this.service.getQuickInfoAtPosition(vf.virtualName, v);
    if (!info) return undefined;

    const range = vf.map.toOriginalRange(info.textSpan.start, info.textSpan.start + info.textSpan.length);
    if (!range) return undefined;

    return {
      start: range[0],
      end: range[1],
      display: this.ts.displayPartsToString(info.displayParts),
      documentation: this.ts.displayPartsToString(info.documentation),
    };
  }

  getCompletions(fileName: string, offset: number): MappedCompletion[] {
    const vf = this.getVirtualFile(fileName);
    const v = vf?.map.toVirtual(offset);
    if (!vf || v === undefined) return [];

    const result = this.service.getCompletionsAtPosition(vf.virtualName, v, {
      includeCompletionsForModuleExports: false,
      includeCompletionsWithInsertText: true,
    });
    if (!result) return [];

    return result.entries.map((e) => {
      const span = e.replacementSpan ? vf.map.toOriginalRange(e.replacementSpan.start, e.replacementSpan.start + e.replacementSpan.length) : undefined;
      return {
        name: e.name,
        kind: e.kind,
        sortText: e.sortText,
        insertText: e.insertText,
        replaceStart: span?.[0],
        replaceEnd: span?.[1],
        source: e.source,
      };
    });
  }

  /** Documentation for one completion entry (fetched lazily by the editor). */
  getCompletionDetails(
    fileName: string,
    offset: number,
    name: string,
    source?: string
  ): { display: string; documentation: string } | undefined {
    const vf = this.getVirtualFile(fileName);
    const v = vf?.map.toVirtual(offset);
    if (!vf || v === undefined) return undefined;

    const d = this.service.getCompletionEntryDetails(vf.virtualName, v, name, undefined, source, undefined, undefined);
    if (!d) return undefined;
    return {
      display: this.ts.displayPartsToString(d.displayParts),
      documentation: this.ts.displayPartsToString(d.documentation),
    };
  }

  getDefinitions(fileName: string, offset: number): MappedLocation[] {
    const vf = this.getVirtualFile(fileName);
    const v = vf?.map.toVirtual(offset);
    if (!vf || v === undefined) return [];

    const defs = this.service.getDefinitionAtPosition(vf.virtualName, v) ?? [];
    const out: MappedLocation[] = [];

    for (const def of defs) {
      const owner = this.files.get(def.fileName)?.file;
      if (owner) {
        const range = owner.map.toOriginalRange(def.textSpan.start, def.textSpan.start + def.textSpan.length);
        if (range) {
          out.push({ fileName: owner.originalName, start: range[0], end: range[1], inComponent: true });
        }
        continue;
      }

      const sf = this.service.getProgram()?.getSourceFile(def.fileName);
      if (!sf) continue;
      const start = def.textSpan.start;
      const end = start + def.textSpan.length;
      const a = sf.getLineAndCharacterOfPosition(start);
      const b = sf.getLineAndCharacterOfPosition(end);
      out.push({
        fileName: def.fileName,
        start,
        end,
        inComponent: false,
        startLine: a.line,
        startCharacter: a.character,
        endLine: b.line,
        endCharacter: b.character,
      });
    }
    return out;
  }

  dispose(): void {
    this.service.dispose();
    this.files.clear();
    this.byOriginal.clear();
  }

  // -- host ---------------------------------------------------------------

  private categoryOf(c: TS.DiagnosticCategory): DiagnosticCategory {
    const cat = this.ts.DiagnosticCategory;
    switch (c) {
      case cat.Error:
        return 'error';
      case cat.Warning:
        return 'warning';
      case cat.Suggestion:
        return 'suggestion';
      default:
        return 'message';
    }
  }

  private createHost(): TS.LanguageServiceHost {
    const ts = this.ts;
    const sys = this.sys;
    const self = this;

    return {
      getCompilationSettings: () => self.options,
      // Deliberately no getProjectVersion(): without it TypeScript re-checks
      // every file's version on each request, so edits to *imported files on
      // disk* are noticed too (a project version we compute could not see them).
      getScriptFileNames: () => [self.envPath, ...self.files.keys()],
      getScriptVersion: (fileName) => {
        const f = self.files.get(fileName);
        if (f) return String(f.version);
        if (fileName === self.envPath) return '1';
        try {
          return String(sys.getModifiedTime?.(fileName)?.getTime() ?? 0);
        } catch {
          return '0';
        }
      },
      getScriptSnapshot: (fileName) => {
        const f = self.files.get(fileName);
        if (f) return ts.ScriptSnapshot.fromString(f.file.code);
        if (fileName === self.envPath) return ts.ScriptSnapshot.fromString(TELOCE_ENV_DTS);
        const text = sys.readFile(fileName);
        return text === undefined ? undefined : ts.ScriptSnapshot.fromString(text);
      },
      getCurrentDirectory: () => self.rootDir,
      getDefaultLibFileName: (o) => path.posix.join(self.libDir, ts.getDefaultLibFileName(o)),
      fileExists: (f) => self.files.has(f) || f === self.envPath || sys.fileExists(f),
      readFile: (f) => self.files.get(f)?.file.code ?? (f === self.envPath ? TELOCE_ENV_DTS : sys.readFile(f)),
      readDirectory: (p, ext, exclude, include, depth) => sys.readDirectory(p, ext, exclude, include, depth),
      directoryExists: sys.directoryExists ? (d) => sys.directoryExists(d) : undefined,
      getDirectories: sys.getDirectories ? (d) => sys.getDirectories(d) : undefined,
      realpath: sys.realpath ? (p) => sys.realpath!(p) : undefined,
      useCaseSensitiveFileNames: () => sys.useCaseSensitiveFileNames,
    };
  }
}
