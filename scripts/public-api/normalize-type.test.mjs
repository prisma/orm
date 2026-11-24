import { strictEqual, throws } from 'node:assert/strict';
import { describe, it } from 'node:test';
import { normalizeTypes } from './normalize-type.mjs';

describe('normalizeTypes', () => {
  it('sorts the members of a union by their text', () => {
    strictEqual(normalizeTypes('type A = "b" | "a" | C', 'declaration'), 'type A = "a" | "b" | C');
  });

  it('sorts unions nested in generics, tuples, functions and conditional types', () => {
    strictEqual(
      normalizeTypes(
        'const x: Map<"b" | "a", readonly [2 | 1, (v: "d" | "c") => T extends "f" | "e" ? 4 | 3 : never]>',
        'declaration',
      ),
      'const x: Map<"a" | "b", readonly [1 | 2, (v: "c" | "d") => T extends "e" | "f" ? 3 | 4 : never]>',
    );
  });

  it('sorts a union by the text of its members after their own unions are sorted', () => {
    strictEqual(
      normalizeTypes('type A = { k: "b" | "a" } | { k: "a" }', 'declaration'),
      'type A = { k: "a" | "b" } | { k: "a" }',
    );
  });

  it('keeps the order of intersections, tuple elements, parameters and members', () => {
    strictEqual(
      normalizeTypes('function f(b: B & A, a: [B, A]): { z: 1; y: 2 }', 'declaration'),
      'function f(b: B & A, a: [B, A]): { z: 1; y: 2 }',
    );
  });

  it('prints an import("…") reference as its name, with its type arguments', () => {
    strictEqual(
      normalizeTypes(
        'const x: import("pkg/a").Ns.Thing<import("pkg/b").Arg | null>',
        'declaration',
      ),
      'const x: Ns.Thing<Arg | null>',
    );
  });

  it('keeps typeof on a typeof import("…") reference', () => {
    strictEqual(
      normalizeTypes('const x: typeof import("pkg").value', 'declaration'),
      'const x: typeof value',
    );
  });

  it('normalises interface members, class members and enum members', () => {
    strictEqual(
      normalizeTypes('readonly k?: "b" | "a"', 'interface member'),
      'readonly k?: "a" | "b"',
    );
    strictEqual(
      normalizeTypes('constructor(v: "b" | "a")', 'class member'),
      'constructor(v: "a" | "b")',
    );
    strictEqual(normalizeTypes('Red = 0', 'enum member'), 'Red = 0');
  });

  it('leaves declarations without types unchanged', () => {
    strictEqual(
      normalizeTypes('class Circle extends Base<"b" | "a">', 'declaration'),
      'class Circle extends Base<"a" | "b">',
    );
    strictEqual(normalizeTypes('interface Shape', 'declaration'), 'interface Shape');
    strictEqual(normalizeTypes('namespace Units', 'declaration'), 'namespace Units');
  });

  it('fails on an import("…") of a file rather than a package', () => {
    throws(
      () => normalizeTypes('const x: import("./chunk-AbCd1234.mjs").Foo', 'declaration'),
      /import\("\.\/chunk-AbCd1234\.mjs"\) names a file, not a package\. Declarations must refer to another package by its name/,
    );
    throws(
      () =>
        normalizeTypes('const x: import("/home/ci/repo/x").Foo', 'declaration', {
          keepImportModules: true,
        }),
      /import\("\/home\/ci\/repo\/x"\) names a file, not a package/,
    );
  });

  it('decides that an import names a file from the value of the specifier, not its spelling', () => {
    throws(
      () => normalizeTypes('const x: import("\\u002e/chunk.mjs").T', 'declaration'),
      /import\("\.\/chunk\.mjs"\) names a file, not a package/,
    );
  });

  it('prints import("…").Name in a class heritage clause by name, with the module when asked', () => {
    strictEqual(
      normalizeTypes(
        'class A extends import("pkg").Base<1> implements import("other").Shape',
        'declaration',
      ),
      'class A extends Base<1> implements Shape',
    );
    strictEqual(
      normalizeTypes('class A extends import("pkg").Base<1>', 'declaration', {
        qualify: (name, specifier) => (name === 'Base' ? specifier : undefined),
      }),
      'class A extends pkg.Base<1>',
    );
    throws(
      () => normalizeTypes('class A extends import("./chunk.mjs").Base', 'declaration'),
      /names a file, not a package/,
    );
  });

  it('fails on text it cannot parse, naming the text', () => {
    throws(() => normalizeTypes('const x: {', 'declaration'), /cannot parse "const x: \{"/);
  });
});
