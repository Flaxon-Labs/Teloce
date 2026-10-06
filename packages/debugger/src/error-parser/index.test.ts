import { describe, expect, it } from 'vitest';
import { parseError, translateError } from './index';

const errorWithStack = (message: string, stack: string) => Object.assign(new Error(message), { stack });

describe('parseError locations', () => {
  it('reads the location from a .html component frame', () => {
    const e = errorWithStack('x is not defined', 'ReferenceError: x is not defined\n    at render (/app/src/Card.html:12:5)');
    expect(parseError(e)).toMatchObject({ file: '/app/src/Card.html', line: 12, column: 5, sourceKind: 'html' });
  });

  it('reads the location from a .vel component frame', () => {
    const e = errorWithStack('x is not defined', 'ReferenceError\n    at render (/app/src/Card.vel:3:7)');
    expect(parseError(e)).toMatchObject({ file: '/app/src/Card.vel', line: 3, column: 7, sourceKind: 'vel' });
  });

  it('handles frames without parentheses (the old parser missed these)', () => {
    const e = errorWithStack('oops', 'Error: oops\n    at /app/src/Card.html:2:9');
    expect(parseError(e)).toMatchObject({ file: '/app/src/Card.html', line: 2, column: 9 });
  });

  it('strips dev-server query strings so the file is clean', () => {
    const e = errorWithStack('oops', 'Error\n    at f (http://localhost:5173/src/Card.html?t=1700:4:2)');
    expect(parseError(e).file).toBe('http://localhost:5173/src/Card.html');
  });

  it('finds the component even when a library frame comes first', () => {
    const e = errorWithStack('oops', 'Error\n    at a (/app/node_modules/@teloce/runtime-core/i.js:1:1)\n    at b (/app/Card.html:5:5)');
    expect(parseError(e)).toMatchObject({ file: '/app/Card.html', sourceKind: 'html' });
  });

  it('takes the location from a compile-error message when there is no stack', () => {
    expect(parseError('Failed to compile src/Card.html:7:3: Unclosed tag')).toMatchObject({
      file: 'src/Card.html',
      line: 7,
      column: 3,
      sourceKind: 'html',
    });
  });

  it('has no location for a plain message', () => {
    const parsed = parseError('something broke');
    expect(parsed.file).toBeUndefined();
    expect(parsed.sourceKind).toBeUndefined();
  });

  it('still categorises the error and keeps the location', () => {
    const parsed = parseError(errorWithStack('foo is not defined', 'ReferenceError\n    at f (/a/Card.html:1:1)'));
    expect(parsed.category).toBe('reference_error');
    expect(parsed.name).toBe('foo');
    expect(parsed.file).toBe('/a/Card.html');
  });
});

describe('modern runtime error messages', () => {
  it.each([
    ['foo is not defined', 'reference_error', 'foo'],
    ['ReferenceError: user is not defined', 'reference_error', 'user'],
    ['Uncaught ReferenceError: window.app is not defined', 'reference_error', 'window.app'],
    ["Cannot read properties of undefined (reading 'name')", 'property_error', 'name'],
    ["Cannot read properties of null (reading 'length')", 'property_error', 'length'],
    ["Cannot set properties of undefined (setting 'value')", 'property_error', 'value'],
    ["Cannot read property 'name' of undefined", 'property_error', 'name'],
  ])('%s', (message, category, name) => {
    const parsed = parseError(message);
    expect(parsed.category).toBe(category);
    expect(parsed.name).toBe(name);
  });

  it('explains an undefined variable usefully', () => {
    const t = translateError('items is not defined');
    expect(t.title).toBe('Undefined Variable');
    expect(t.fix).toContain('this.items');
  });

  it('says whether it was undefined or null', () => {
    expect(translateError("Cannot read properties of null (reading 'x')").description).toContain('null');
    expect(translateError("Cannot read properties of undefined (reading 'x')").description).toContain('undefined');
  });

  it('does not mistake "is not a function" for "is not defined"', () => {
    expect(parseError('foo is not a function').category).toBe('function_error');
  });
});

describe('translateError', () => {
  it('gives a title and description for any error', () => {
    const t = translateError('totally unknown failure');
    expect(t.title).toBeTruthy();
    expect(t.description).toBeTruthy();
  });
});
