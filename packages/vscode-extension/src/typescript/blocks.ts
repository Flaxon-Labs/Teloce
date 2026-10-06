/**
 * Offset-preserving block scanner for Teloce single-file components.
 *
 * Why this exists instead of reusing `@teloce/sfc`'s parser: that parser
 * `.trim()`s block content and only returns strings, so the position of the
 * block inside the original file is lost. Type-checking needs exact offsets
 * so an error TypeScript reports in the extracted script can be shown at the
 * right place in the real `.vel` / `.html` file.
 *
 * The scanner only looks at *top-level* blocks (`<script>`, `<template>`,
 * `<style>`). Anything nested inside a `<template>` is ignored, and HTML
 * comments are skipped.
 */

export type BlockTag = 'script' | 'template' | 'style';

export interface Block {
  tag: BlockTag;
  /** Raw attribute text of the opening tag (without the tag name). */
  attrs: string;
  /** Offset of the first character of the block content (just after `>`). */
  contentStart: number;
  /** Offset just past the last character of the block content. */
  contentEnd: number;
}

export interface ScriptBlock extends Block {
  tag: 'script';
  lang: string | undefined;
  src: string | undefined;
  content: string;
}

const BLOCK_OPEN = /^<(script|template|style)(?=[\s>/])/i;

/** Reads an attribute value from raw attribute text. */
export function getAttr(attrs: string, name: string): string | undefined {
  const re = new RegExp(`(?:^|\\s)${name}\\s*=\\s*(?:"([^"]*)"|'([^']*)'|([^\\s"'>]+))`, 'i');
  const m = re.exec(attrs);
  if (!m) return undefined;
  return m[1] ?? m[2] ?? m[3];
}

/** Index of the `>` that closes an opening tag, ignoring `>` inside quotes. */
function findTagEnd(text: string, from: number): number {
  let quote: string | null = null;
  for (let i = from; i < text.length; i++) {
    const ch = text[i];
    if (quote) {
      if (ch === quote) quote = null;
    } else if (ch === '"' || ch === "'") {
      quote = ch;
    } else if (ch === '>') {
      return i;
    }
  }
  return -1;
}

/**
 * Finds the `</script` that ends a script block, skipping string literals and
 * comments so text like `'</script>'` inside JS does not end the block early.
 * This mirrors how `@teloce/sfc` decides where a script block ends.
 * (Regex literals are a known gap, same as there; the caller falls back to a
 * plain search if nothing is found.)
 */
function findScriptEnd(text: string, from: number): number {
  let inString: string | null = null;
  let inLine = false;
  let inBlock = false;
  let escaped = false;

  for (let i = from; i < text.length; i++) {
    const ch = text[i];
    const next = text[i + 1];

    if (inLine) {
      if (ch === '\n') inLine = false;
      continue;
    }
    if (inBlock) {
      if (ch === '*' && next === '/') {
        inBlock = false;
        i++;
      }
      continue;
    }
    if (inString) {
      if (escaped) escaped = false;
      else if (ch === '\\') escaped = true;
      else if (ch === inString) inString = null;
      continue;
    }

    if (ch === '/' && next === '/') {
      inLine = true;
      i++;
    } else if (ch === '/' && next === '*') {
      inBlock = true;
      i++;
    } else if (ch === '"' || ch === "'" || ch === '`') {
      inString = ch;
    } else if (ch === '<' && text.slice(i, i + 8).toLowerCase() === '</script') {
      return i;
    }
  }

  // Unbalanced quote somewhere (e.g. an apostrophe in a regex literal):
  // fall back to the first closing tag rather than swallowing the file.
  return indexOfCI(text, '</script', from);
}

/** Finds the `</template>` matching an already-opened `<template>`. */
function findTemplateEnd(text: string, from: number): number {
  const re = /<(\/?)template(?=[\s>/])/gi;
  re.lastIndex = from;
  let depth = 1;
  let m: RegExpExecArray | null;
  while ((m = re.exec(text))) {
    if (m[1]) {
      depth--;
      if (depth === 0) return m.index;
    } else {
      const tagEnd = findTagEnd(text, m.index + m[0].length);
      const selfClosing = tagEnd !== -1 && text[tagEnd - 1] === '/';
      if (!selfClosing) depth++;
    }
  }
  return -1;
}

function indexOfCI(text: string, needle: string, from: number): number {
  return text.toLowerCase().indexOf(needle, from);
}

/** Scans the top-level `<script>`, `<template>` and `<style>` blocks. */
export function scanBlocks(text: string): Block[] {
  const blocks: Block[] = [];
  let i = 0;

  while (i < text.length) {
    const lt = text.indexOf('<', i);
    if (lt === -1) break;

    if (text.startsWith('<!--', lt)) {
      const end = text.indexOf('-->', lt + 4);
      i = end === -1 ? text.length : end + 3;
      continue;
    }

    const open = BLOCK_OPEN.exec(text.slice(lt, lt + 12));
    if (!open) {
      i = lt + 1;
      continue;
    }

    const tag = open[1].toLowerCase() as BlockTag;
    const attrStart = lt + open[0].length;
    const openEnd = findTagEnd(text, attrStart);
    if (openEnd === -1) break;

    const attrs = text.slice(attrStart, openEnd);
    const contentStart = openEnd + 1;

    if (attrs.trimEnd().endsWith('/')) {
      blocks.push({ tag, attrs, contentStart, contentEnd: contentStart });
      i = contentStart;
      continue;
    }

    const closeIdx =
      tag === 'script'
        ? findScriptEnd(text, contentStart)
        : tag === 'template'
          ? findTemplateEnd(text, contentStart)
          : indexOfCI(text, '</style', contentStart);

    if (closeIdx === -1) {
      // Unterminated block: treat everything to EOF as its content.
      blocks.push({ tag, attrs, contentStart, contentEnd: text.length });
      break;
    }

    blocks.push({ tag, attrs, contentStart, contentEnd: closeIdx });
    const closeEnd = text.indexOf('>', closeIdx);
    i = closeEnd === -1 ? text.length : closeEnd + 1;
  }

  return blocks;
}

export function findScriptBlocks(text: string): ScriptBlock[] {
  return scanBlocks(text)
    .filter((b) => b.tag === 'script')
    .map((b) => ({
      ...b,
      tag: 'script' as const,
      lang: getAttr(b.attrs, 'lang')?.toLowerCase(),
      src: getAttr(b.attrs, 'src'),
      content: text.slice(b.contentStart, b.contentEnd),
    }));
}

/**
 * The `<script lang="ts">` (or `tsx`) block to type-check, if any.
 * Blocks that load an external file with `src` are ignored.
 */
export function getTypeScriptBlock(text: string): ScriptBlock | undefined {
  return findScriptBlocks(text).find(
    (b) => (b.lang === 'ts' || b.lang === 'tsx') && !b.src
  );
}

/**
 * Decides whether a document is a Teloce component.
 *
 * - Language id `teloce` (`.vel` / `.teloce`) is always a component.
 * - An `.html` file is a component only if it has a top-level `<template>`
 *   block or a `<script lang="ts">`. Full-page shells (doctype / html / head /
 *   body, e.g. Flask or Django templates full of `{% ... %}`) are left alone
 *   so they never get false type errors.
 */
export function isTeloceComponent(text: string, languageId: string): boolean {
  if (languageId === 'teloce') return true;

  const blocks = scanBlocks(text);

  // Look for page-shell markers only *outside* the blocks, so a string like
  // "<body>" inside a script does not disqualify a component.
  let outside = '';
  let cursor = 0;
  for (const b of blocks) {
    outside += text.slice(cursor, b.contentStart);
    cursor = b.contentEnd;
  }
  outside += text.slice(cursor);
  if (/<!doctype|<html[\s>]|<head[\s>]|<body[\s>]/i.test(outside)) return false;

  return (
    blocks.some((b) => b.tag === 'template') ||
    getTypeScriptBlock(text) !== undefined
  );
}
