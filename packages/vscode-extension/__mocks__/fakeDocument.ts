import { Position, Range, Uri } from './vscode';

/** Just enough of vscode.TextDocument for the providers. */
export class FakeDocument {
  readonly uri: Uri;
  constructor(
    private text: string,
    public readonly languageId: string,
    fsPath: string,
    scheme = 'file'
  ) {
    this.uri = scheme === 'file' ? Uri.file(fsPath) : Object.assign(Uri.file(fsPath), { scheme });
  }

  getText(range?: Range): string {
    if (!range) return this.text;
    return this.text.slice(this.offsetAt(range.start), this.offsetAt(range.end));
  }

  getWordRangeAtPosition(position: Position): Range | undefined {
    const offset = this.offsetAt(position);
    const isWord = (c: string | undefined) => !!c && /[\w$-]/.test(c);
    let start = offset;
    let end = offset;
    while (isWord(this.text[start - 1])) start--;
    while (isWord(this.text[end])) end++;
    return start === end ? undefined : new Range(this.positionAt(start), this.positionAt(end));
  }

  setText(text: string): void {
    this.text = text;
  }

  offsetAt(position: Position): number {
    const lines = this.text.split('\n');
    let offset = 0;
    for (let i = 0; i < position.line; i++) offset += lines[i].length + 1;
    return offset + position.character;
  }

  positionAt(offset: number): Position {
    const before = this.text.slice(0, offset);
    const line = before.split('\n').length - 1;
    return new Position(line, offset - (before.lastIndexOf('\n') + 1));
  }

  /** Position of the first occurrence of `needle` (plus `delta` characters). */
  positionOf(needle: string, delta = 0): Position {
    const i = this.text.indexOf(needle);
    if (i === -1) throw new Error(`"${needle}" not found in document`);
    return this.positionAt(i + delta);
  }
}
