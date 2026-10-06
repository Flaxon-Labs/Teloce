import { describe, expect, it } from 'vitest';
import { escapeHtml, formatSource } from './format';

describe('escapeHtml', () => {
  it('escapes markup so file names and messages cannot inject HTML', () => {
    expect(escapeHtml(`<img src=x onerror="a('b')">&`)).toBe('&lt;img src=x onerror=&quot;a(&#39;b&#39;)&quot;&gt;&amp;');
  });
});

describe('formatSource', () => {
  it('shows nothing without a source', () => {
    expect(formatSource({}, true)).toBe('');
  });

  it('labels .html components with an HTML badge', () => {
    const out = formatSource({ source: 'src/Card.html', sourceKind: 'html', line: 12, column: 5 }, true);
    expect(out).toContain('>HTML<');
    expect(out).toContain('source-badge-html');
    expect(out).toContain('src/Card.html:12:5');
  });

  it('labels .vel components with a VEL badge', () => {
    const out = formatSource({ source: 'Card.vel', sourceKind: 'vel', line: 3 }, true);
    expect(out).toContain('>VEL<');
    expect(out).toContain('Card.vel:3');
  });

  it('labels .teloce files', () => {
    expect(formatSource({ source: 'a.teloce', sourceKind: 'teloce' }, false)).toContain('>TELOCE<');
  });

  it('has no badge for ordinary scripts', () => {
    const out = formatSource({ source: 'main.js', sourceKind: 'js', line: 1 }, false);
    expect(out).not.toContain('<span');
    expect(out).toBe('main.js:1');
  });

  it('omits the column unless asked', () => {
    const info = { source: 'a.html', sourceKind: 'html', line: 2, column: 9 };
    expect(formatSource(info, false)).toContain('a.html:2');
    expect(formatSource(info, false)).not.toContain(':9');
    expect(formatSource(info, true)).toContain('a.html:2:9');
  });

  it('escapes the file name', () => {
    expect(formatSource({ source: '<b>.html', sourceKind: 'html' }, false)).toContain('&lt;b&gt;.html');
  });
});
