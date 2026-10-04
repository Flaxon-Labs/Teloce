import { vi } from 'vitest';

export const window: {
  activeTextEditor: unknown;
  showInformationMessage: ReturnType<typeof vi.fn>;
  showErrorMessage: ReturnType<typeof vi.fn>;
  showWarningMessage: ReturnType<typeof vi.fn>;
  createTerminal: ReturnType<typeof vi.fn>;
  createOutputChannel: ReturnType<typeof vi.fn>;
} = {
  showWarningMessage: vi.fn(),
  createTerminal: vi.fn(() => ({ show: vi.fn(), sendText: vi.fn(), dispose: vi.fn() })),
  activeTextEditor: undefined,
  showInformationMessage: vi.fn(),
  showErrorMessage: vi.fn(),
  createOutputChannel: vi.fn(() => ({
    appendLine: vi.fn(),
    show: vi.fn(),
    dispose: vi.fn(),
  })),
};

const noopDisposable = () => ({ dispose: vi.fn() });
const noopEvent = () => vi.fn(() => noopDisposable());

export const workspace = {
  getConfiguration: vi.fn(() => ({
    get: vi.fn(),
    update: vi.fn(),
  })),
  onDidChangeConfiguration: noopEvent(),
  getWorkspaceFolder: vi.fn((): { uri: Uri } | undefined => undefined),
  textDocuments: [] as unknown[],
  onDidOpenTextDocument: noopEvent(),
  onDidChangeTextDocument: noopEvent(),
  onDidCloseTextDocument: noopEvent(),
  onDidSaveTextDocument: noopEvent(),
  createFileSystemWatcher: vi.fn(() => ({
    onDidChange: noopEvent(),
    onDidCreate: noopEvent(),
    onDidDelete: noopEvent(),
    dispose: vi.fn(),
  })),
};

export const ExtensionContext = vi.fn();

// -- value types used by the providers --------------------------------------

export class Position {
  constructor(
    public readonly line: number,
    public readonly character: number
  ) {}
}

export class Range {
  public readonly start: Position;
  public readonly end: Position;
  constructor(start: Position, end: Position);
  constructor(startLine: number, startChar: number, endLine: number, endChar: number);
  constructor(a: Position | number, b: Position | number, c?: number, d?: number) {
    if (typeof a === 'number') {
      this.start = new Position(a, b as number);
      this.end = new Position(c as number, d as number);
    } else {
      this.start = a;
      this.end = b as Position;
    }
  }
}

export class Uri {
  private constructor(
    public readonly scheme: string,
    public readonly fsPath: string
  ) {}
  static file(fsPath: string): Uri {
    return new Uri('file', fsPath);
  }
  static parse(value: string): Uri {
    return new Uri(value.split(':')[0], value);
  }
  toString(): string {
    return `${this.scheme}://${this.fsPath}`;
  }
}

export class Location {
  constructor(
    public readonly uri: Uri,
    public readonly range: Range
  ) {}
}

export enum DiagnosticSeverity {
  Error = 0,
  Warning = 1,
  Information = 2,
  Hint = 3,
}

export enum DiagnosticTag {
  Unnecessary = 1,
  Deprecated = 2,
}

export class Diagnostic {
  code?: string | number;
  source?: string;
  tags?: DiagnosticTag[];
  constructor(
    public range: Range,
    public message: string,
    public severity: DiagnosticSeverity = DiagnosticSeverity.Error
  ) {}
}

export class MarkdownString {
  value = '';
  appendCodeblock(code: string, language = ''): this {
    this.value += `\n\`\`\`${language}\n${code}\n\`\`\`\n`;
    return this;
  }
  appendMarkdown(text: string): this {
    this.value += text;
    return this;
  }
  constructor(value = '') {
    this.value = value;
  }
}

export class Hover {
  constructor(
    public contents: MarkdownString | MarkdownString[],
    public range?: Range
  ) {}
}

export enum CompletionItemKind {
  Text = 0,
  Method = 1,
  Function = 2,
  Constructor = 3,
  Field = 4,
  Variable = 5,
  Class = 6,
  Interface = 7,
  Module = 8,
  Property = 9,
  Enum = 12,
  Keyword = 13,
  Event = 22,
  Snippet = 14,
  EnumMember = 19,
  Constant = 20,
  TypeParameter = 24,
}

export class CompletionItem {
  sortText?: string;
  insertText?: string;
  range?: Range;
  detail?: string;
  documentation?: MarkdownString | string;
  constructor(
    public label: string,
    public kind?: CompletionItemKind
  ) {}
}

// -- languages --------------------------------------------------------------

export class FakeDiagnosticCollection {
  readonly entries = new Map<string, Diagnostic[]>();
  set = vi.fn((uri: Uri, diagnostics: Diagnostic[]) => {
    this.entries.set(uri.toString(), diagnostics);
  });
  delete = vi.fn((uri: Uri) => {
    this.entries.delete(uri.toString());
  });
  dispose = vi.fn();
  get(uri: Uri): Diagnostic[] | undefined {
    return this.entries.get(uri.toString());
  }
  has(uri: Uri): boolean {
    return this.entries.has(uri.toString());
  }
}

/** Every collection created via `languages.createDiagnosticCollection`. */
export const createdCollections: FakeDiagnosticCollection[] = [];

export const languages: Record<string, ReturnType<typeof vi.fn>> = {
  createDiagnosticCollection: vi.fn((_name?: string) => {
    const c = new FakeDiagnosticCollection();
    createdCollections.push(c);
    return c;
  }) as never,
  registerHoverProvider: vi.fn(() => noopDisposable()),
  registerCompletionItemProvider: vi.fn(() => noopDisposable()),
  registerDefinitionProvider: vi.fn(() => noopDisposable()),
};

export class DiagnosticRelatedInformation {
  constructor(
    public location: Location,
    public message: string
  ) {}
}

export class SnippetString {
  constructor(public value = '') {}
}

export class TextEdit {
  constructor(
    public range: Range,
    public newText: string
  ) {}
  static replace(range: Range, newText: string): TextEdit {
    return new TextEdit(range, newText);
  }
}

export enum SymbolKind {
  Class = 4,
  Method = 5,
  Property = 6,
}

export class DocumentSymbol {
  constructor(
    public name: string,
    public detail: string,
    public kind: SymbolKind,
    public range: Range,
    public selectionRange: Range
  ) {}
}

export class CancellationTokenSource {
  token = { isCancellationRequested: false };
}

export const env = { openExternal: vi.fn(), clipboard: { writeText: vi.fn(async () => {}) } };

/** Handlers passed to `commands.registerCommand`, by command id. */
export const registeredCommands = new Map<string, (...args: unknown[]) => unknown>();

export const commands = {
  executeCommand: vi.fn(async () => undefined),
  registerCommand: vi.fn((id: string, handler: (...args: unknown[]) => unknown) => {
    registeredCommands.set(id, handler);
    return noopDisposable();
  }),
};

languages.registerDocumentFormattingEditProvider = vi.fn(() => noopDisposable());
languages.registerDocumentSymbolProvider = vi.fn(() => noopDisposable());
