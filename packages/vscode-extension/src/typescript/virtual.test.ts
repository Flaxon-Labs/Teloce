import * as ts from 'typescript';
import { describe, expect, it } from 'vitest';
import { getTypeScriptBlock } from './blocks.js';
import { COMPONENT_WRAPPER } from './env.js';
import { OffsetMap, createVirtualFile, virtualNameFor } from './virtual.js';

function build(text: string, name = '/p/App.vel') {
  const block = getTypeScriptBlock(text);
  if (!block) throw new Error('test fixture has no ts block');
  return createVirtualFile(ts, name, block);
}

const text = `<template><p>{{ msg }}</p></template>
<script lang="ts">
import { helper } from './helper';
const greeting: string = 'hi';
export default {
  data() { return { msg: greeting }; },
  methods: { go() { helper(); } },
};
// trailing comment
</script>`;

describe('virtualNameFor', () => {
  it('appends .ts or .tsx to the real file name', () => {
    expect(virtualNameFor('/p/App.vel', 'ts')).toBe('/p/App.vel.ts');
    expect(virtualNameFor('/p/App.html', 'tsx')).toBe('/p/App.html.tsx');
    expect(virtualNameFor('/p/App.vel', undefined)).toBe('/p/App.vel.ts');
  });
});

describe('createVirtualFile', () => {
  it('wraps `export default {…}` in the typing helper', () => {
    const vf = build(text);
    expect(vf.wrapped).toBe(true);
    expect(vf.code).toContain(`export default ${COMPONENT_WRAPPER}({`);
    expect(vf.code).toContain('});\n// trailing comment');
  });

  it('appends `export {}` so the file is always a module', () => {
    expect(build(text).code.trimEnd().endsWith('export {};')).toBe(true);
  });

  it('leaves everything except the wrapper untouched', () => {
    const vf = build(text);
    const expected =
      vf.block.content
        .replace('export default {', `export default ${COMPONENT_WRAPPER}({`)
        .replace('\n};\n// trailing', '\n});\n// trailing') + '\nexport {};\n';
    expect(vf.code).toBe(expected);
  });

  it('round-trips positions in code before, inside and after the object', () => {
    const vf = build(text);
    const script = vf.block;
    const probes = ['import { helper }', "'hi'", 'msg: greeting', 'helper();', '// trailing'];

    for (const needle of probes) {
      const original = text.indexOf(needle);
      expect(original, needle).toBeGreaterThan(-1);
      const v = vf.map.toVirtual(original);
      expect(v, needle).toBeDefined();
      // The characters at the mapped virtual offset are the same as in the file.
      expect(vf.code.slice(v!, v! + needle.length), needle).toBe(needle);
      expect(vf.map.toOriginal(v!)).toBe(original);
      expect(original).toBeGreaterThanOrEqual(script.contentStart);
    }
  });

  it('reports synthetic text as unmapped', () => {
    const vf = build(text);
    const wrapperAt = vf.code.indexOf(COMPONENT_WRAPPER);
    // Strictly inside the wrapper name, nothing in the original file corresponds.
    expect(vf.map.toOriginal(wrapperAt + 3)).toBeUndefined();
    const exportAt = vf.code.lastIndexOf('export {}');
    expect(vf.map.toOriginal(exportAt + 3)).toBeUndefined();
  });

  it('does not map positions outside the script block', () => {
    const vf = build(text);
    expect(vf.map.toVirtual(text.indexOf('{{ msg }}'))).toBeUndefined();
    expect(vf.map.toVirtual(0)).toBeUndefined();
  });

  it('does not wrap when there is no default export', () => {
    const vf = build('<script lang="ts">const a: number = 1;</script>');
    expect(vf.wrapped).toBe(false);
    expect(vf.code).not.toContain(COMPONENT_WRAPPER);
    expect(vf.map.toOriginal(vf.code.indexOf('const a'))).toBe(
      '<script lang="ts">'.length
    );
  });

  it('does not wrap a default export that is already a call', () => {
    const vf = build(`<script lang="ts">
import { defineComponent } from '@teloce/core';
export default defineComponent({ name: 'X' });
</script>`);
    expect(vf.wrapped).toBe(false);
  });

  it('does not wrap `export =` or a named export', () => {
    expect(build('<script lang="ts">export const a = {};</script>').wrapped).toBe(false);
  });

  it('ignores `export default {` inside comments and strings', () => {
    const vf = build(`<script lang="ts">
// export default { fake: true }
const s = "export default { fake: true }";
export default { real: true };
</script>`);
    expect(vf.wrapped).toBe(true);
    expect(vf.code.match(new RegExp(COMPONENT_WRAPPER, 'g'))).toHaveLength(1);
    expect(vf.code).toContain(`${COMPONENT_WRAPPER}({ real: true })`);
  });

  it('wraps an object that starts several lines after `export default`', () => {
    const vf = build(`<script lang="ts">
export default

  {
    a: 1,
  };
</script>`);
    expect(vf.wrapped).toBe(true);
    const at = vf.map.toOriginal(vf.code.indexOf('a: 1'));
    expect(at).toBe(vf.block.content.indexOf('a: 1') + vf.block.contentStart);
  });

  it('handles an empty script block', () => {
    const vf = build('<script lang="ts"></script>');
    expect(vf.wrapped).toBe(false);
    expect(vf.code).toBe('\nexport {};\n');
  });

  it('records the original and virtual names', () => {
    const vf = build(text, '/p/App.html');
    expect(vf.originalName).toBe('/p/App.html');
    expect(vf.virtualName).toBe('/p/App.html.ts');
  });
});

describe('OffsetMap.toOriginalRange', () => {
  const map = new OffsetMap([
    { virtualStart: 0, originalStart: 100, length: 10 }, // v 0-10   -> o 100-110
    { virtualStart: 15, originalStart: 110, length: 20 }, // v 15-35  -> o 110-130 (5 synthetic chars before)
  ]);

  it('maps a range fully inside one segment', () => {
    expect(map.toOriginalRange(2, 8)).toEqual([102, 108]);
  });

  it('maps a range that spans a synthetic gap', () => {
    expect(map.toOriginalRange(5, 20)).toEqual([105, 115]);
  });

  it('snaps a start inside synthetic text forward to real code', () => {
    // 12 is in the gap; the next real code begins at virtual 15 -> original 110.
    expect(map.toOriginalRange(12, 20)).toEqual([110, 115]);
  });

  it('snaps an end inside synthetic text back to real code', () => {
    expect(map.toOriginalRange(5, 12)).toEqual([105, 110]);
  });

  it('returns undefined for an empty map', () => {
    expect(new OffsetMap([]).toOriginalRange(0, 1)).toBeUndefined();
  });

  it('returns undefined when the range lies entirely in synthetic text', () => {
    expect(map.toOriginalRange(11, 13)).toBeUndefined();
  });

  it('keeps zero-width ranges that sit on real code', () => {
    expect(map.toOriginalRange(4, 4)).toEqual([104, 104]);
    expect(map.toOriginalRange(10, 10)).toEqual([110, 110]); // end of segment 1
  });

  it('drops zero-width ranges inside synthetic text', () => {
    expect(map.toOriginalRange(12, 12)).toBeUndefined();
  });
});
