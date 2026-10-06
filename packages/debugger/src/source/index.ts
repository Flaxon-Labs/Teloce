/**
 * Source locations - works out *which file* an error came from.
 *
 * Teloce components live in `.vel` files and, equally, in component-style
 * `.html` files. This module treats them the same: it reads locations out of
 * stack traces (Chrome/Node and Firefox/Safari formats) and out of compiler
 * error messages, cleans up dev-server URLs, and reports what kind of file it
 * is so the dashboard can label it.
 */

export type SourceKind = 'vel' | 'html' | 'teloce' | 'ts' | 'js' | 'other';

export interface SourceLocation {
  /** Path or URL, without query string or hash. */
  file: string;
  line?: number;
  column?: number;
  kind: SourceKind;
}

const KIND_BY_EXTENSION: Record<string, SourceKind> = {
  vel: 'vel',
  html: 'html',
  htm: 'html',
  teloce: 'teloce',
  ts: 'ts',
  tsx: 'ts',
  mts: 'ts',
  cts: 'ts',
  js: 'js',
  jsx: 'js',
  mjs: 'js',
  cjs: 'js',
};

/** True for the file kinds that hold Teloce components. */
export function isComponentKind(kind: SourceKind): boolean {
  return kind === 'vel' || kind === 'html' || kind === 'teloce';
}

/**
 * Cleans a raw file reference from a stack frame:
 * - drops `?query` and `#hash` (dev servers add `?t=123`, `?vue&type=script`)
 * - turns `file:///C:/x/App.html` into `C:/x/App.html`
 * - decodes `%20` and friends
 */
export function normalizeSourcePath(raw: string): string {
  let file = raw.trim();
  file = file.replace(/[?#].*$/, '');

  if (/^file:\/\//i.test(file)) {
    file = file.replace(/^file:\/\//i, '');
    // file:///C:/x -> C:/x      file:///home/u -> /home/u
    if (/^\/[A-Za-z]:\//.test(file)) file = file.slice(1);
  }

  try {
    file = decodeURIComponent(file);
  } catch {
    /* leave as is when it is not valid percent-encoding */
  }
  return file;
}

/** What kind of file is this? (`App.html?t=1` and `C:\x\App.VEL` both work.) */
export function getSourceKind(file: string): SourceKind {
  const clean = file.replace(/[?#].*$/, '');
  const ext = /\.([A-Za-z0-9]+)$/.exec(clean)?.[1]?.toLowerCase();
  return (ext && KIND_BY_EXTENSION[ext]) || 'other';
}

/** `file:line:col`, `file:line` or just `file`. */
function toLocation(ref: string): SourceLocation | undefined {
  const m = /^(.*?):(\d+)(?::(\d+))?$/.exec(ref.trim());
  if (!m) return undefined;
  const file = normalizeSourcePath(m[1]);
  if (!file) return undefined;
  return {
    file,
    line: Number(m[2]),
    column: m[3] === undefined ? undefined : Number(m[3]),
    kind: getSourceKind(file),
  };
}

/** Frames that are never the user's code. */
function isInternal(ref: string): boolean {
  return (
    /^(node:|internal\/|native|eval at |<anonymous>)/.test(ref) ||
    ref.includes('<anonymous>') ||
    ref.startsWith('[native code]')
  );
}

/**
 * Every located frame in a stack trace, in order. Understands:
 *   Chrome/Node   `at fn (file:1:2)`, `at async fn (file:1:2)`, `at file:1:2`
 *   Firefox/Safari `fn@file:1:2`, `@file:1:2`
 */
export function parseStackFrames(stack: string): SourceLocation[] {
  const frames: SourceLocation[] = [];

  for (const raw of stack.split('\n')) {
    const line = raw.trim();
    let ref: string | undefined;

    if (line.startsWith('at ')) {
      const rest = line.slice(3);
      const open = rest.lastIndexOf(' (');
      ref = rest.endsWith(')') && open !== -1 ? rest.slice(open + 2, -1) : rest;
    } else {
      const at = line.indexOf('@');
      if (at !== -1 && /:\d+(?::\d+)?$/.test(line)) ref = line.slice(at + 1);
    }

    if (!ref || isInternal(ref)) continue;
    const loc = toLocation(ref);
    if (loc) frames.push(loc);
  }

  return frames;
}

/**
 * Finds a `.vel` / `.html` / `.teloce` file mentioned in an error message,
 * as compilers write them: `Failed to compile src/App.html:12:5: ...` or
 * `[teloce] Failed to compile App.vel: ...`.
 */
export function findLocationInMessage(message: string): SourceLocation | undefined {
  const m = /((?:[A-Za-z]:)?[^\s'"`()<>,;]*?\.(?:vel|html?|teloce))(?::(\d+)(?::(\d+))?)?(?![\w.])/i.exec(message);
  if (!m) return undefined;
  const file = normalizeSourcePath(m[1]);
  return {
    file,
    line: m[2] === undefined ? undefined : Number(m[2]),
    column: m[3] === undefined ? undefined : Number(m[3]),
    kind: getSourceKind(file),
  };
}

/**
 * The best location for an error:
 *  1. the first stack frame in a component file (`.vel` / `.html` / `.teloce`)
 *  2. otherwise the first frame outside `node_modules`
 *  3. otherwise a component file named in the message
 *  4. otherwise the first frame at all
 */
export function findSourceLocation(stack?: string, message?: string): SourceLocation | undefined {
  const frames = stack ? parseStackFrames(stack) : [];

  const component = frames.find((f) => isComponentKind(f.kind));
  if (component) return component;

  const userCode = frames.find((f) => !f.file.includes('node_modules'));
  if (userCode) return userCode;

  const fromMessage = message ? findLocationInMessage(message) : undefined;
  if (fromMessage) return fromMessage;

  return frames[0];
}
