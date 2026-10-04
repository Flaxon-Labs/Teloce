import { describe, expect, it } from 'vitest';
import {
  findScriptBlocks,
  getAttr,
  getTypeScriptBlock,
  isTeloceComponent,
  scanBlocks,
} from './blocks.js';

const component = `<template>
  <p>{{ msg }}</p>
</template>

<script lang="ts">
export default {
  data() { return { msg: 'hi' }; },
};
</script>

<style scoped>
p { color: red; }
</style>
`;

describe('getAttr', () => {
  it('reads double, single and unquoted values', () => {
    expect(getAttr(' lang="ts"', 'lang')).toBe('ts');
    expect(getAttr(" lang='tsx'", 'lang')).toBe('tsx');
    expect(getAttr(' lang=ts', 'lang')).toBe('ts');
  });

  it('returns undefined when absent and does not match longer names', () => {
    expect(getAttr(' type="module"', 'lang')).toBeUndefined();
    expect(getAttr(' data-lang="ts"', 'lang')).toBeUndefined();
  });
});

describe('scanBlocks', () => {
  it('finds top-level blocks with exact content offsets', () => {
    const blocks = scanBlocks(component);
    expect(blocks.map((b) => b.tag)).toEqual(['template', 'script', 'style']);

    for (const b of blocks) {
      const content = component.slice(b.contentStart, b.contentEnd);
      // The content must start right after the opening tag and stop before the closing tag.
      expect(component[b.contentStart - 1]).toBe('>');
      expect(component.slice(b.contentEnd, b.contentEnd + 2)).toBe('</');
      expect(content.length).toBe(b.contentEnd - b.contentStart);
    }
  });

  it('does not trim: content is byte-for-byte what is in the file', () => {
    const [script] = findScriptBlocks(component);
    expect(script.content.startsWith('\nexport default')).toBe(true);
    expect(script.content.endsWith('};\n')).toBe(true);
  });

  it('keeps offsets correct with CRLF line endings', () => {
    const crlf = component.replace(/\n/g, '\r\n');
    const [script] = findScriptBlocks(crlf);
    expect(crlf.slice(script.contentStart, script.contentEnd)).toBe(script.content);
    expect(script.content).toContain('\r\n');
  });

  it('handles nested <template> elements inside the template block', () => {
    const text = `<template>
  <template v-if="a"><i>x</i></template>
  <template v-else>y</template>
</template>
<script lang="ts">export default {}</script>`;
    const blocks = scanBlocks(text);
    expect(blocks.map((b) => b.tag)).toEqual(['template', 'script']);
    const tpl = blocks[0];
    expect(text.slice(tpl.contentStart, tpl.contentEnd)).toContain('v-else');
  });

  it('ignores <script> that lives inside a <template>', () => {
    const text = `<template><script lang="ts">bad()</script></template>`;
    expect(findScriptBlocks(text)).toHaveLength(0);
  });

  it('ignores blocks inside HTML comments', () => {
    const text = `<!-- <script lang="ts">nope()</script> -->\n<script lang="ts">real()</script>`;
    const scripts = findScriptBlocks(text);
    expect(scripts).toHaveLength(1);
    expect(scripts[0].content).toBe('real()');
  });

  it('does not end a script at </script> that appears inside a string', () => {
    const text = `<script lang="ts">
const note = 'closing tag: </script>';
export default { data() { return { note }; } };
</script>`;
    const [script] = findScriptBlocks(text);
    expect(script.content).toContain('export default');
  });

  it('does not end a script at </script> inside a comment', () => {
    const text = `<script lang="ts">
// never write </script> here
const a = 1; /* or </script> here */
export default {};
</script>`;
    const [script] = findScriptBlocks(text);
    expect(script.content).toContain('export default');
  });

  it('falls back to the first closing tag when a quote is unbalanced', () => {
    // An apostrophe inside a regex literal confuses string tracking.
    const text = `<script lang="ts">const re = /'/;\nexport default {};</script>\n<p>after</p>`;
    const [script] = findScriptBlocks(text);
    expect(script.content).toContain('export default');
  });

  it('is not fooled by > inside quoted attributes', () => {
    const text = `<script lang="ts" data-x="a>b">export default {}</script>`;
    const [script] = findScriptBlocks(text);
    expect(script.content).toBe('export default {}');
  });

  it('treats an unterminated script as running to the end of the file', () => {
    const text = `<script lang="ts">\nexport default {`;
    const [script] = findScriptBlocks(text);
    expect(script.content).toBe('\nexport default {');
  });

  it('handles self-closing blocks', () => {
    const text = `<script lang="ts" src="./x.ts" /><template><p/></template>`;
    const blocks = scanBlocks(text);
    expect(blocks.map((b) => b.tag)).toEqual(['script', 'template']);
    expect(blocks[0].contentStart).toBe(blocks[0].contentEnd);
  });

  it('matches tags case-insensitively', () => {
    const [script] = findScriptBlocks(`<SCRIPT LANG="ts">x</SCRIPT>`);
    expect(script.content).toBe('x');
    expect(script.lang).toBe('ts');
  });

  it('does not treat <scripting> or <style-guide> as blocks', () => {
    expect(scanBlocks('<scripting>x</scripting><style-guide>y</style-guide>')).toHaveLength(0);
  });
});

describe('getTypeScriptBlock', () => {
  it('returns ts and tsx blocks', () => {
    expect(getTypeScriptBlock('<script lang="ts">a</script>')?.content).toBe('a');
    expect(getTypeScriptBlock('<script lang="tsx">a</script>')?.lang).toBe('tsx');
  });

  it('skips plain JavaScript scripts', () => {
    expect(getTypeScriptBlock('<script>a</script>')).toBeUndefined();
    expect(getTypeScriptBlock('<script lang="js">a</script>')).toBeUndefined();
    expect(getTypeScriptBlock('<script type="module">a</script>')).toBeUndefined();
  });

  it('skips scripts that load an external file with src', () => {
    expect(getTypeScriptBlock('<script lang="ts" src="./a.ts"></script>')).toBeUndefined();
  });

  it('picks the ts block when a js block comes first', () => {
    const text = '<script>one()</script><script lang="ts">two()</script>';
    expect(getTypeScriptBlock(text)?.content).toBe('two()');
  });
});

describe('isTeloceComponent', () => {
  it('always accepts the teloce language id (.vel)', () => {
    expect(isTeloceComponent('', 'teloce')).toBe(true);
    expect(isTeloceComponent('anything at all', 'teloce')).toBe(true);
  });

  it('accepts component-style html with a template block', () => {
    expect(isTeloceComponent(component, 'html')).toBe(true);
  });

  it('accepts html that only has a <script lang="ts">', () => {
    expect(isTeloceComponent('<script lang="ts">export default {}</script>', 'html')).toBe(true);
  });

  it('rejects a full-page shell', () => {
    const shell = `<!doctype html><html><head><meta charset="utf-8"></head>
<body><div id="app"></div>
<script type="module">import { mount } from "{{ url_for('static', filename='js/App.js') }}"; mount("#app");</script>
</body></html>`;
    expect(isTeloceComponent(shell, 'html')).toBe(false);
  });

  it('rejects a shell even if it contains a <script lang="ts">', () => {
    const shell = `<!doctype html><html><body><script lang="ts">const x: number = 1;</script></body></html>`;
    expect(isTeloceComponent(shell, 'html')).toBe(false);
  });

  it('rejects Jinja/Django partials with no template or ts script', () => {
    const partial = `{% extends "base.html" %}{% block content %}<p>{{ user.name }}</p>{% endblock %}`;
    expect(isTeloceComponent(partial, 'html')).toBe(false);
  });

  it('rejects plain html with only a JS script', () => {
    expect(isTeloceComponent('<div></div><script>run()</script>', 'html')).toBe(false);
  });

  it('is not disqualified by shell-like text inside a script string', () => {
    const text = `<template><p/></template>
<script lang="ts">
const wrapper = '<html><body></body></html>';
export default {};
</script>`;
    expect(isTeloceComponent(text, 'html')).toBe(true);
  });
});
