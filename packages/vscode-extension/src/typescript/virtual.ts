/**
 * Builds the virtual TypeScript file for a component's `<script lang="ts">`
 * block, plus an offset map to translate positions back to the real file.
 *
 * The virtual file is the script content, unchanged, with two small edits:
 *
 *   export default { ... }   ->   export default __teloceComponent({ ... })
 *   (appended)                    export {};
 *
 * The wrapper gives `this` its type (see env.ts); `export {}` makes the file
 * a module even when the script has no imports/exports, so declarations in
 * one component never collide with another's. Everything else is byte-for-byte
 * the user's code, so the map is just a few contiguous segments.
 */

import type * as TS from 'typescript';
import type { ScriptBlock } from './blocks.js';
import { COMPONENT_WRAPPER } from './env.js';

export interface Segment {
  virtualStart: number;
  originalStart: number;
  length: number;
}

export class OffsetMap {
  constructor(readonly segments: readonly Segment[]) {}

  /** Original offset for a virtual offset, or undefined if it is synthetic. */
  toOriginal(virtualOffset: number): number | undefined {
    for (const s of this.segments) {
      if (virtualOffset >= s.virtualStart && virtualOffset <= s.virtualStart + s.length) {
        return s.originalStart + (virtualOffset - s.virtualStart);
      }
    }
    return undefined;
  }

  /** Virtual offset for an original offset, or undefined if outside the script. */
  toVirtual(originalOffset: number): number | undefined {
    for (const s of this.segments) {
      if (originalOffset >= s.originalStart && originalOffset <= s.originalStart + s.length) {
        return s.virtualStart + (originalOffset - s.originalStart);
      }
    }
    return undefined;
  }

  /**
   * Maps a virtual range to an original range. If the range partly covers
   * synthetic text, a start in it snaps forward to the next real code and an
   * end snaps back to the previous real code. Returns undefined if the range
   * covers no real code at all.
   */
  toOriginalRange(virtualStart: number, virtualEnd: number): [number, number] | undefined {
    const segs = this.segments;
    if (segs.length === 0) return undefined;

    // A zero-width range (e.g. "';' expected") must sit on real code.
    if (virtualStart === virtualEnd) {
      const at = this.toOriginal(virtualStart);
      return at === undefined ? undefined : [at, at];
    }

    // Anything that never touches real code is synthetic: drop it rather than
    // snapping to unrelated code nearby and showing a misleading error.
    const overlapsRealCode = segs.some(
      (s) => virtualStart < s.virtualStart + s.length && virtualEnd > s.virtualStart
    );
    if (!overlapsRealCode) return undefined;

    let start: number | undefined;
    for (const s of segs) {
      if (virtualStart <= s.virtualStart + s.length) {
        start = s.originalStart + Math.max(0, virtualStart - s.virtualStart);
        break;
      }
    }

    let end: number | undefined;
    for (let i = segs.length - 1; i >= 0; i--) {
      const s = segs[i];
      if (virtualEnd >= s.virtualStart) {
        end = s.originalStart + Math.min(s.length, virtualEnd - s.virtualStart);
        break;
      }
    }

    if (start === undefined || end === undefined || end < start) return undefined;
    return [start, end];
  }
}

export interface VirtualFile {
  /** Name TypeScript sees, e.g. `/proj/App.vel.ts`. */
  virtualName: string;
  /** The real file this was built from. */
  originalName: string;
  code: string;
  map: OffsetMap;
  /** Whether `export default {...}` was wrapped for a typed `this`. */
  wrapped: boolean;
  /** The block it came from (offsets are into the original file). */
  block: ScriptBlock;
}

export function virtualNameFor(originalName: string, lang: string | undefined): string {
  return `${originalName}.${lang === 'tsx' ? 'tsx' : 'ts'}`;
}

/** Finds the object literal in `export default { ... }`, if there is one. */
function findDefaultExportObject(
  ts: typeof TS,
  content: string,
  isTsx: boolean
): { start: number; end: number } | undefined {
  const sf = ts.createSourceFile(
    isTsx ? 'component.tsx' : 'component.ts',
    content,
    ts.ScriptTarget.Latest,
    false,
    isTsx ? ts.ScriptKind.TSX : ts.ScriptKind.TS
  );

  for (const stmt of sf.statements) {
    if (ts.isExportAssignment(stmt) && !stmt.isExportEquals) {
      const expr = stmt.expression;
      if (ts.isObjectLiteralExpression(expr)) {
        return { start: expr.getStart(sf), end: expr.end };
      }
    }
  }
  return undefined;
}

export function createVirtualFile(
  ts: typeof TS,
  originalName: string,
  block: ScriptBlock
): VirtualFile {
  const content = block.content;
  const isTsx = block.lang === 'tsx';
  const target = findDefaultExportObject(ts, content, isTsx);
  const segments: Segment[] = [];
  const base = block.contentStart;
  const SUFFIX = '\nexport {};\n';

  let code: string;
  if (target) {
    const prefix = `${COMPONENT_WRAPPER}(`;
    const before = content.slice(0, target.start);
    const object = content.slice(target.start, target.end);
    const after = content.slice(target.end);

    code = before + prefix + object + ')' + after + SUFFIX;

    segments.push({ virtualStart: 0, originalStart: base, length: before.length });
    segments.push({
      virtualStart: before.length + prefix.length,
      originalStart: base + target.start,
      length: object.length,
    });
    segments.push({
      virtualStart: before.length + prefix.length + object.length + 1,
      originalStart: base + target.end,
      length: after.length,
    });
  } else {
    code = content + SUFFIX;
    segments.push({ virtualStart: 0, originalStart: base, length: content.length });
  }

  return {
    virtualName: virtualNameFor(originalName, block.lang),
    originalName,
    code,
    map: new OffsetMap(segments.filter((s) => s.length > 0)),
    wrapped: target !== undefined,
    block,
  };
}
