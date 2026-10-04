/**
 * TypeScript support for `<script lang="ts">` in `.vel` and component-style
 * `.html` files: diagnostics, hover, completion and go-to-definition.
 *
 * All the real work happens in `../typescript/service.ts`; this file only
 * translates between VS Code documents/positions and that service's offsets.
 *
 * TypeScript itself is loaded lazily, the first time a document with a
 * `lang="ts"` script is seen, so opening ordinary files costs nothing.
 */

import * as path from 'node:path';
import * as vscode from 'vscode';
import type * as TS from 'typescript';
import {
  TeloceTsService,
  type MappedCompletion,
  type MappedDiagnostic,
} from '../typescript/index.js';

export const TS_DIAGNOSTIC_SOURCE = 'teloce-ts';

const LANGUAGES = new Set(['teloce', 'html']);
const TS_LANG_HINT = /lang\s*=\s*["']?tsx?\b/i;
const DEBOUNCE_MS = 300;

export const DOCUMENT_SELECTOR: vscode.DocumentSelector = [
  { language: 'teloce' },
  { language: 'html', scheme: 'file' },
];

export interface TypeScriptFeaturesOptions {
  /** Directory holding `lib.*.d.ts` (shipped in the extension's `dist`). */
  libDir?: string;
  /** Loads the `typescript` module. Overridable for tests. */
  loadTypeScript?: () => Promise<typeof TS>;
}

async function defaultLoadTypeScript(): Promise<typeof TS> {
  const mod = (await import('typescript')) as unknown as { default?: typeof TS } & typeof TS;
  return mod.default ?? mod;
}

/** TypeScript completion kind -> VS Code completion kind. */
export function toCompletionKind(kind: string): vscode.CompletionItemKind {
  const K = vscode.CompletionItemKind;
  switch (kind) {
    case 'method':
    case 'construct':
      return K.Method;
    case 'function':
    case 'local function':
      return K.Function;
    case 'property':
    case 'getter':
    case 'setter':
      return K.Property;
    case 'var':
    case 'let':
    case 'local var':
    case 'parameter':
      return K.Variable;
    case 'const':
      return K.Constant;
    case 'class':
      return K.Class;
    case 'interface':
      return K.Interface;
    case 'enum':
      return K.Enum;
    case 'enum member':
      return K.EnumMember;
    case 'module':
    case 'external module name':
      return K.Module;
    case 'keyword':
      return K.Keyword;
    case 'type':
    case 'type parameter':
    case 'primitive type':
      return K.TypeParameter;
    default:
      return K.Text;
  }
}

export function toVsDiagnostic(
  d: MappedDiagnostic,
  document: Pick<vscode.TextDocument, 'positionAt'>
): vscode.Diagnostic {
  const S = vscode.DiagnosticSeverity;
  const severity =
    d.category === 'error'
      ? S.Error
      : d.category === 'warning'
        ? S.Warning
        : d.category === 'suggestion'
          ? S.Hint
          : S.Information;

  const range = new vscode.Range(document.positionAt(d.start), document.positionAt(d.end));
  const diagnostic = new vscode.Diagnostic(range, d.message, severity);
  diagnostic.code = d.code;
  diagnostic.source = TS_DIAGNOSTIC_SOURCE;

  const tags: vscode.DiagnosticTag[] = [];
  if (d.unnecessary) tags.push(vscode.DiagnosticTag.Unnecessary);
  if (d.deprecated) tags.push(vscode.DiagnosticTag.Deprecated);
  if (tags.length) diagnostic.tags = tags;

  return diagnostic;
}

export class TeloceTypeScriptFeatures
  implements
    vscode.Disposable,
    vscode.HoverProvider,
    vscode.CompletionItemProvider,
    vscode.DefinitionProvider
{
  private readonly collection = vscode.languages.createDiagnosticCollection(TS_DIAGNOSTIC_SOURCE);
  private readonly disposables: vscode.Disposable[] = [];
  private readonly services = new Map<string, TeloceTsService>();
  private readonly timers = new Map<string, ReturnType<typeof setTimeout>>();
  private tsModule: Promise<typeof TS> | undefined;

  constructor(private readonly options: TypeScriptFeaturesOptions = {}) {}

  /** Registers every provider and listener. */
  register(): void {
    const d = this.disposables;
    d.push(
      this.collection,
      vscode.languages.registerHoverProvider(DOCUMENT_SELECTOR, this),
      vscode.languages.registerCompletionItemProvider(DOCUMENT_SELECTOR, this, '.', '"', "'", '/'),
      vscode.languages.registerDefinitionProvider(DOCUMENT_SELECTOR, this),
      vscode.workspace.onDidOpenTextDocument((doc) => this.schedule(doc, 0)),
      vscode.workspace.onDidChangeTextDocument((e) => this.schedule(e.document, DEBOUNCE_MS)),
      vscode.workspace.onDidCloseTextDocument((doc) => this.close(doc)),
      vscode.workspace.onDidChangeConfiguration((e) => {
        if (e.affectsConfiguration('teloce.typescript')) void this.onConfigChanged();
      })
    );

    const watcher = vscode.workspace.createFileSystemWatcher('**/tsconfig.json');
    const reload = () => void this.onTsconfigChanged();
    d.push(watcher, watcher.onDidChange(reload), watcher.onDidCreate(reload), watcher.onDidDelete(reload));

    for (const doc of vscode.workspace.textDocuments) this.schedule(doc, 0);
  }

  dispose(): void {
    for (const t of this.timers.values()) clearTimeout(t);
    this.timers.clear();
    for (const s of this.services.values()) s.dispose();
    this.services.clear();
    for (const d of this.disposables.splice(0)) d.dispose();
  }

  // -- settings -----------------------------------------------------------

  private get config(): vscode.WorkspaceConfiguration {
    return vscode.workspace.getConfiguration('teloce.typescript');
  }

  private get enabled(): boolean {
    return this.config.get<boolean>('enable', true) ?? true;
  }

  private get strict(): boolean {
    return this.config.get<boolean>('strict', true) ?? true;
  }

  // -- document plumbing --------------------------------------------------

  private isCandidate(doc: vscode.TextDocument): boolean {
    return doc.uri.scheme === 'file' && LANGUAGES.has(doc.languageId);
  }

  private loadTypeScript(): Promise<typeof TS> {
    this.tsModule ??= (this.options.loadTypeScript ?? defaultLoadTypeScript)();
    return this.tsModule;
  }

  private rootFor(doc: vscode.TextDocument): string {
    return (
      vscode.workspace.getWorkspaceFolder(doc.uri)?.uri.fsPath ?? path.dirname(doc.uri.fsPath)
    );
  }

  /**
   * The service for a document's workspace folder. Returns undefined when the
   * feature is off, or when nothing has needed TypeScript yet and this
   * document does not use `lang="ts"` (so TypeScript is never loaded needlessly).
   */
  private async serviceFor(doc: vscode.TextDocument): Promise<TeloceTsService | undefined> {
    if (!this.enabled || !this.isCandidate(doc)) return undefined;

    const root = this.rootFor(doc);
    const existing = this.services.get(root);
    if (existing) return existing;
    if (!TS_LANG_HINT.test(doc.getText())) return undefined;

    const ts = await this.loadTypeScript();
    const again = this.services.get(root);
    if (again) return again;

    const service = new TeloceTsService({
      ts,
      libDir: this.options.libDir,
      rootDir: root,
      strict: this.strict,
    });
    this.services.set(root, service);
    return service;
  }

  /** Brings the service up to date with the editor's current text. */
  private async sync(doc: vscode.TextDocument): Promise<TeloceTsService | undefined> {
    const service = await this.serviceFor(doc);
    if (!service) return undefined;
    const file = service.updateDocument(doc.uri.fsPath, doc.getText(), doc.languageId);
    return file ? service : undefined;
  }

  private schedule(doc: vscode.TextDocument, delay: number): void {
    if (!this.isCandidate(doc)) return;
    const key = doc.uri.toString();
    const pending = this.timers.get(key);
    if (pending) clearTimeout(pending);

    this.timers.set(
      key,
      setTimeout(() => {
        this.timers.delete(key);
        void this.publishDiagnostics(doc);
      }, delay)
    );
  }

  /**
   * Runs diagnostics now (used by `schedule`, the validate command and tests).
   * Returns how many TypeScript problems were published.
   */
  async publishDiagnostics(doc: vscode.TextDocument): Promise<number> {
    try {
      if (!this.enabled) {
        this.collection.delete(doc.uri);
        return 0;
      }
      const service = await this.sync(doc);
      if (!service) {
        this.collection.delete(doc.uri);
        return 0;
      }
      const diagnostics = service
        .getDiagnostics(doc.uri.fsPath)
        .map((d) => toVsDiagnostic(d, doc));
      this.collection.set(doc.uri, diagnostics);
      return diagnostics.length;
    } catch (error) {
      console.error('[teloce] TypeScript diagnostics failed:', error);
      return 0;
    }
  }

  private close(doc: vscode.TextDocument): void {
    const key = doc.uri.toString();
    const pending = this.timers.get(key);
    if (pending) clearTimeout(pending);
    this.timers.delete(key);
    this.collection.delete(doc.uri);
    this.services.get(this.rootFor(doc))?.removeDocument(doc.uri.fsPath);
  }

  private async onConfigChanged(): Promise<void> {
    for (const service of this.services.values()) service.setStrict(this.strict);
    await this.refreshAll();
  }

  private async onTsconfigChanged(): Promise<void> {
    for (const service of this.services.values()) service.reloadConfig();
    await this.refreshAll();
  }

  private async refreshAll(): Promise<void> {
    await Promise.all(vscode.workspace.textDocuments.map((doc) => this.publishDiagnostics(doc)));
  }

  // -- language features --------------------------------------------------

  async provideHover(
    document: vscode.TextDocument,
    position: vscode.Position
  ): Promise<vscode.Hover | undefined> {
    const service = await this.sync(document);
    if (!service) return undefined;

    const info = service.getHover(document.uri.fsPath, document.offsetAt(position));
    if (!info) return undefined;

    const md = new vscode.MarkdownString();
    md.appendCodeblock(info.display, 'typescript');
    if (info.documentation) md.appendMarkdown(`\n\n${info.documentation}`);

    return new vscode.Hover(
      md,
      new vscode.Range(document.positionAt(info.start), document.positionAt(info.end))
    );
  }

  async provideCompletionItems(
    document: vscode.TextDocument,
    position: vscode.Position
  ): Promise<vscode.CompletionItem[] | undefined> {
    const service = await this.sync(document);
    if (!service) return undefined;

    const offset = document.offsetAt(position);
    const entries = service.getCompletions(document.uri.fsPath, offset);

    return entries.map((entry) => this.toCompletionItem(entry, document, offset));
  }

  private toCompletionItem(
    entry: MappedCompletion,
    document: vscode.TextDocument,
    offset: number
  ): vscode.CompletionItem {
    const item = new vscode.CompletionItem(entry.name, toCompletionKind(entry.kind));
    item.sortText = entry.sortText;
    if (entry.insertText) item.insertText = entry.insertText;
    if (entry.replaceStart !== undefined && entry.replaceEnd !== undefined) {
      item.range = new vscode.Range(
        document.positionAt(entry.replaceStart),
        document.positionAt(entry.replaceEnd)
      );
    }
    // Carried to resolveCompletionItem so documentation loads lazily.
    (item as vscode.CompletionItem & { data?: unknown }).data = {
      fsPath: document.uri.fsPath,
      offset,
      name: entry.name,
      source: entry.source,
    };
    return item;
  }

  resolveCompletionItem(item: vscode.CompletionItem): vscode.CompletionItem {
    const data = (item as vscode.CompletionItem & { data?: { fsPath: string; offset: number; name: string; source?: string } }).data;
    if (!data) return item;

    const service = this.serviceForPath(data.fsPath);
    const details = service?.getCompletionDetails(data.fsPath, data.offset, data.name, data.source);
    if (details) {
      item.detail = details.display;
      if (details.documentation) item.documentation = new vscode.MarkdownString(details.documentation);
    }
    return item;
  }

  private serviceForPath(fsPath: string): TeloceTsService | undefined {
    for (const service of this.services.values()) {
      if (service.getVirtualFile(fsPath)) return service;
    }
    return undefined;
  }

  async provideDefinition(
    document: vscode.TextDocument,
    position: vscode.Position
  ): Promise<vscode.Location[] | undefined> {
    const service = await this.sync(document);
    if (!service) return undefined;

    const locations: vscode.Location[] = [];
    for (const loc of service.getDefinitions(document.uri.fsPath, document.offsetAt(position))) {
      if (loc.inComponent) {
        // Definitions inside a component can only be in this same document.
        if (loc.fileName !== document.uri.fsPath.replace(/\\/g, '/')) continue;
        locations.push(
          new vscode.Location(
            document.uri,
            new vscode.Range(document.positionAt(loc.start), document.positionAt(loc.end))
          )
        );
      } else {
        locations.push(
          new vscode.Location(
            vscode.Uri.file(loc.fileName),
            new vscode.Range(
              new vscode.Position(loc.startLine ?? 0, loc.startCharacter ?? 0),
              new vscode.Position(loc.endLine ?? 0, loc.endCharacter ?? 0)
            )
          )
        );
      }
    }
    return locations;
  }
}
