import { deepStrictEqual, strictEqual, throws } from 'node:assert/strict';
import { dirname, join } from 'node:path';
import { describe, it } from 'node:test';
import { fileURLToPath } from 'node:url';
import { compareCodeUnits, flattenPackage, portabilityProblems } from './flatten.mjs';
import { readPackageApi } from './read-api.mjs';

const fixtures = join(dirname(fileURLToPath(import.meta.url)), 'fixtures');

function linesOf(fixture) {
  const packageDir = join(fixtures, fixture);
  return flattenPackage(packageDir, readPackageApi(packageDir));
}

const sorted = (lines) => [...lines].sort(compareCodeUnits);

describe('flattenPackage', () => {
  it('lists each kind of export and member with its modifiers', () => {
    deepStrictEqual(
      linesOf('kinds'),
      sorted([
        '.: abstract class Base',
        '.: class Base, abstract required method describe(): string',
        '.: class Base, protected constructor(id: string)',
        '.: class Base, protected readonly required property id: string',
        '.: class Circle extends Base',
        '.: class Circle, constructor(radius: number)',
        '.: class Circle, optional property diameter?: number',
        '.: class Circle, readonly required property radius: number',
        '.: class Circle, required method describe(): string',
        '.: class Circle, static required property unit: Circle',
        '.: const answer: 42',
        '.: const arrow: (value: number) => number',
        '.: let counter: number',
        '.: enum Color',
        '.: enum Color, member Green = 1',
        '.: enum Color, member Red = 0',
        '.: export default = const defaultShape: Shape',
        '.: function greet(name: string): string',
        '.: function greet(name: string, punctuation: string): string',
        '.: function hello(name: string): string',
        '.: deprecated: function hello(name: string): string',
        '.: interface Shape',
        '.: interface Shape, call signature (input: string): Shape',
        '.: interface Shape, construct signature new (input: string): Shape',
        '.: interface Shape, index signature [key: string]: unknown',
        '.: interface Shape, optional method scale?(factor: number): Shape',
        '.: interface Shape, optional property label?: string',
        '.: interface Shape, optional property name?: string',
        '.: deprecated: interface Shape, optional property name?: string',
        '.: interface Shape, readonly required property kind: string',
        '.: interface Shape, required method area(): number',
        '.: namespace Units',
        '.: namespace Units, const meter: number',
        '.: namespace Units, function convert(value: number): number',
        '.: type Pair<T> = readonly [T, T]',
      ]),
    );
  });

  it('lists a type that signatures use but no path exports once for the package', () => {
    deepStrictEqual(
      linesOf('shared'),
      sorted([
        '(not exported) interface Config',
        '(not exported) interface Config, readonly required property path: string',
        '(not exported) interface Config_2',
        '(not exported) interface Config_2, readonly required property url: string',
        '(not exported) interface Options',
        '(not exported) interface Options, readonly optional property verbose?: boolean',
        '.: function configure(options: Options, config: Config_2): Widget',
        './extra: function tune(options: Options, config: Config): void',
        './extra: interface Widget',
        './extra: interface Widget, readonly required property id: string',
      ]),
    );
  });

  it('prints names the bundler or API Extractor suffixed as one name per declaration', () => {
    deepStrictEqual(
      linesOf('renamed'),
      sorted([
        '(not exported) interface Options',
        '(not exported) interface Options, readonly required property alpha: boolean',
        '(not exported) interface Options_2',
        '(not exported) interface Options_2, readonly required property beta: boolean',
        '(not exported) interface Row',
        '(not exported) interface Row, readonly required property id: number',
        '(not exported) type CodecTypes_2 = { readonly text: string; }',
        '.: function column(): Column',
        '.: function first(options: Options): void',
        '.: function read(): Row',
        '.: function second(options: Options_2): void',
        '.: interface Column',
        '.: interface Column, readonly required property name: string',
        '.: type CodecTypes = CodecTypes_2',
      ]),
    );
  });

  it('lists a path that forwards another package as one line per forward', () => {
    deepStrictEqual(
      linesOf('forwards'),
      sorted([
        '.: everything from pathe/utils',
        './named: export join from pathe',
        './named: export norm from pathe (as normalize)',
        './named: export res from pathe (as resolve)',
      ]),
    );
  });

  it('lists members a path adds to another module with declare module', () => {
    deepStrictEqual(
      linesOf('augment'),
      sorted([
        '.: augments fixture-augment/registry interface Registry',
        '.: augments fixture-augment/registry interface Registry, optional property label?: string',
        '.: augments fixture-augment/registry interface Registry, optional property name?: string',
        '.: deprecated: augments fixture-augment/registry interface Registry, optional property name?: string',
        '.: augments fixture-augment/registry interface Registry, readonly required property "fixture/size": number',
        '.: augments fixture-augment/registry interface Registry, required method describe(): string',
        '.: function plain(): void',
        './registry: interface Registry',
        './registry: interface Registry, readonly required property base: string',
      ]),
    );
  });

  it('fails when two different items give the same line', () => {
    throws(
      () => linesOf('duplicate'),
      /two different items give the line "\.: function twice\(value: string\): void"/,
    );
  });

  it('gives identical output on a second run', () => {
    deepStrictEqual(linesOf('shared'), linesOf('shared'));
  });
});

describe('compareCodeUnits', () => {
  it('orders by UTF-16 code unit, whatever the locale', () => {
    deepStrictEqual(['b', 'B', '_', 'a', '(', '.'].sort(compareCodeUnits), [
      '(',
      '.',
      'B',
      '_',
      'a',
      'b',
    ]);
  });
});

describe('portabilityProblems', () => {
  it('reports a line that names an absolute path or a relative import', () => {
    deepStrictEqual(
      portabilityProblems(
        [
          '.: const a: import("/home/ci/repo/x").A',
          '.: const b: import("./chunk-AbCd1234.mjs").B',
          '.: const c: import("@prisma/orm-framework/x").C',
        ],
        '/home/ci/repo',
      ),
      [
        'line names a local path: .: const a: import("/home/ci/repo/x").A',
        'line names a local path: .: const b: import("./chunk-AbCd1234.mjs").B',
      ],
    );
  });

  it('accepts lines that name only packages', () => {
    strictEqual(
      portabilityProblems(['.: const c: import("arktype").Type'], '/home/ci/repo').length,
      0,
    );
  });
});
