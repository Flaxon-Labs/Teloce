import { describe, expect, it } from 'vitest';
import {
  findLocationInMessage,
  findSourceLocation,
  getSourceKind,
  isComponentKind,
  normalizeSourcePath,
  parseStackFrames,
} from './index';

describe('getSourceKind', () => {
  it.each([
    ['src/App.vel', 'vel'],
    ['src/App.html', 'html'],
    ['src/App.htm', 'html'],
    ['src/App.teloce', 'teloce'],
    ['src/a.ts', 'ts'],
    ['src/a.tsx', 'ts'],
    ['src/a.js', 'js'],
    ['src/a.mjs', 'js'],
    ['README', 'other'],
    ['style.css', 'other'],
    ['C:\\proj\\App.HTML', 'html'],
    ['http://localhost:5173/src/App.html?t=1700&vue', 'html'],
    ['App.vel#hash', 'vel'],
  ])('%s is %s', (file, kind) => {
    expect(getSourceKind(file)).toBe(kind);
  });

  it('knows which kinds are components', () => {
    expect(isComponentKind('vel')).toBe(true);
    expect(isComponentKind('html')).toBe(true);
    expect(isComponentKind('teloce')).toBe(true);
    expect(isComponentKind('js')).toBe(false);
    expect(isComponentKind('other')).toBe(false);
  });
});

describe('normalizeSourcePath', () => {
  it('removes dev-server query strings and hashes', () => {
    expect(normalizeSourcePath('http://localhost:5173/src/App.html?t=17&vue&type=script#x')).toBe(
      'http://localhost:5173/src/App.html'
    );
  });
  it('turns file URLs into paths', () => {
    expect(normalizeSourcePath('file:///home/me/App.html')).toBe('/home/me/App.html');
    expect(normalizeSourcePath('file:///C:/proj/App.vel')).toBe('C:/proj/App.vel');
  });
  it('decodes percent-encoding, and tolerates bad encoding', () => {
    expect(normalizeSourcePath('/my%20app/App.html')).toBe('/my app/App.html');
    expect(normalizeSourcePath('/100%/App.html')).toBe('/100%/App.html');
  });
  it('leaves plain paths alone', () => {
    expect(normalizeSourcePath('C:\\proj\\App.html')).toBe('C:\\proj\\App.html');
  });
});

describe('parseStackFrames', () => {
  it('reads Chrome/Node frames with and without a function name', () => {
    const stack = [
      'Error: boom',
      '    at render (/app/src/Card.html:12:5)',
      '    at async load (http://localhost:5173/src/App.vel?t=1:3:9)',
      '    at /app/src/main.js:7:1',
    ].join('\n');
    expect(parseStackFrames(stack)).toEqual([
      { file: '/app/src/Card.html', line: 12, column: 5, kind: 'html' },
      { file: 'http://localhost:5173/src/App.vel', line: 3, column: 9, kind: 'vel' },
      { file: '/app/src/main.js', line: 7, column: 1, kind: 'js' },
    ]);
  });

  it('reads Windows paths and file:// URLs', () => {
    const stack = 'Error\n    at f (C:\\proj\\src\\Card.html:4:2)\n    at g (file:///C:/proj/App.vel:8:1)';
    const frames = parseStackFrames(stack);
    expect(frames[0]).toMatchObject({ file: 'C:\\proj\\src\\Card.html', line: 4, column: 2, kind: 'html' });
    expect(frames[1]).toMatchObject({ file: 'C:/proj/App.vel', line: 8, kind: 'vel' });
  });

  it('reads Firefox/Safari frames', () => {
    const stack = 'render@http://localhost:5173/src/Card.html:12:5\n@http://localhost:5173/src/main.js:1:1';
    expect(parseStackFrames(stack).map((f) => [f.file, f.line, f.kind])).toEqual([
      ['http://localhost:5173/src/Card.html', 12, 'html'],
      ['http://localhost:5173/src/main.js', 1, 'js'],
    ]);
  });

  it('skips internal and anonymous frames', () => {
    const stack = [
      'Error',
      '    at node:internal/process/task_queues:95:5',
      '    at eval (eval at <anonymous> (/a.js:1:1), <anonymous>:1:1)',
      '    at new Promise (<anonymous>)',
      '    at ok (/app/App.vel:2:3)',
    ].join('\n');
    expect(parseStackFrames(stack).map((f) => f.file)).toEqual(['/app/App.vel']);
  });

  it('accepts a frame with no column', () => {
    expect(parseStackFrames('    at f (/a/App.html:9)')[0]).toMatchObject({ line: 9, column: undefined });
  });

  it('returns [] for text with no frames', () => {
    expect(parseStackFrames('just a message')).toEqual([]);
    expect(parseStackFrames('')).toEqual([]);
  });
});

describe('findLocationInMessage', () => {
  it.each([
    ['Failed to compile src/App.html:12:5: Unexpected token', 'src/App.html', 12, 5, 'html'],
    ['[teloce] Failed to compile App.vel: bad template', 'App.vel', undefined, undefined, 'vel'],
    ['Error in C:\\proj\\Card.html:3', 'C:\\proj\\Card.html', 3, undefined, 'html'],
    ["Cannot parse 'views/Nav.teloce'", 'views/Nav.teloce', undefined, undefined, 'teloce'],
  ])('%s', (message, file, line, column, kind) => {
    expect(findLocationInMessage(message)).toEqual({ file, line, column, kind });
  });

  it('does not match unrelated text', () => {
    expect(findLocationInMessage('x is not defined')).toBeUndefined();
    expect(findLocationInMessage('Cannot read properties of undefined')).toBeUndefined();
    expect(findLocationInMessage('see index.htmlx')).toBeUndefined();
  });
});

describe('findSourceLocation', () => {
  const stack = [
    'TypeError: x',
    '    at helper (/app/node_modules/@teloce/runtime-core/dist/index.js:100:2)',
    '    at util (/app/src/util.js:5:1)',
    '    at render (/app/src/Card.html:12:5)',
  ].join('\n');

  it('prefers a .html component frame over earlier plain JS frames', () => {
    expect(findSourceLocation(stack)).toMatchObject({ file: '/app/src/Card.html', line: 12, kind: 'html' });
  });

  it('prefers a .vel component frame the same way', () => {
    expect(findSourceLocation(stack.replace('Card.html', 'Card.vel'))).toMatchObject({ kind: 'vel' });
  });

  it('falls back to the first non-node_modules frame', () => {
    const plain = 'E\n    at a (/app/node_modules/x/i.js:1:1)\n    at b (/app/src/util.js:5:1)';
    expect(findSourceLocation(plain)).toMatchObject({ file: '/app/src/util.js' });
  });

  it('falls back to a component named in the message when the stack has no user frame', () => {
    const lib = 'E\n    at a (/app/node_modules/x/i.js:1:1)';
    expect(findSourceLocation(lib, 'Failed to compile Card.html:3:4')).toMatchObject({
      file: 'Card.html',
      line: 3,
      column: 4,
    });
  });

  it('uses the message when there is no stack at all (compile errors)', () => {
    expect(findSourceLocation(undefined, 'Failed to compile src/App.html:1:2: oops')).toMatchObject({
      file: 'src/App.html',
      kind: 'html',
    });
  });

  it('finally falls back to a library frame, then to nothing', () => {
    expect(findSourceLocation('E\n    at a (/app/node_modules/x/i.js:1:1)')).toMatchObject({ file: '/app/node_modules/x/i.js' });
    expect(findSourceLocation(undefined, 'plain message')).toBeUndefined();
    expect(findSourceLocation()).toBeUndefined();
  });
});
