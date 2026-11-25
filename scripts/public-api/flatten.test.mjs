import { deepStrictEqual, strictEqual, throws } from 'node:assert/strict';
import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { describe, it } from 'node:test';
import { fileURLToPath } from 'node:url';
import { compareCodeUnits } from './api-lines.mjs';
import { flattenPackage, moduleUsersImport, oneLine, portabilityProblems } from './flatten.mjs';
import { readPackageApi } from './read-api.mjs';

const fixtures = join(dirname(fileURLToPath(import.meta.url)), 'fixtures');

function linesOf(fixture, editModel) {
  const packageDir = join(fixtures, fixture);
  const entryPoints = readPackageApi(packageDir);
  if (editModel) {
    for (const { modelFile } of entryPoints) {
      const model = JSON.parse(readFileSync(modelFile, 'utf8'));
      editModel(model);
      writeFileSync(modelFile, JSON.stringify(model));
    }
  }
  return flattenPackage(packageDir, entryPoints);
}

const membersOf = (model) => model.members[0].members;

const SHAPES = [
  '.: class Accessors',
  '.: class Accessors, readonly required property get onlyGet(): number',
  '.: class Accessors, required property get both(): string; set both(value: string)',
  '.: class Accessors, required property set onlySet(value: string)',
  '.: class Both',
  '.: class Both, readonly required property fromClass: number',
  '.: const Pair: { readonly size: 2 }',
  '.: const enum Mode',
  '.: const key: unique symbol',
  '.: enum Level',
  '.: enum Level, member High = 1',
  '.: enum Level, member Low = 0',
  '.: enum Mode, member Off = "off"',
  '.: enum Mode, member On = "on"',
  '.: export default = const _default: { readonly answer: 42; }',
  '.: function build(): void',
  '.: interface Both',
  '.: interface Both, readonly required property fromInterface: string',
  '.: interface Keyed',
  '.: interface Keyed, index signature [index: number]: string',
  '.: interface Keyed, index signature [name: string]: unknown',
  '.: interface Keyed, readonly required property [key]: string',
  '.: interface Keyed, required method [Symbol.iterator](): Iterator<string>',
  '.: namespace build',
  '.: namespace build, const version: string',
  '.: namespace build, interface Options',
  '.: namespace build, interface Options, readonly required property fast: boolean',
  '.: type Pair = readonly [string, string]',
];

function removeItem(model, name) {
  model.members[0].members = membersOf(model).filter((item) => item.name !== name);
}

function removeMember(model, container, name) {
  const item = membersOf(model).find((candidate) => candidate.name === container);
  item.members = item.members.filter((member) => member.name !== name);
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
        './named: export norm = normalize from pathe',
        './default: export paths = default from pathe',
        './named: export res = resolve from pathe',
        './types: export type join from pathe',
        './types: export type norm = normalize from pathe',
        './types: export type res = resolve from pathe',
      ]),
    );
  });

  it('lists members a path adds to another module with declare module', () => {
    deepStrictEqual(
      linesOf('augment'),
      sorted([
        '.: augments fixture-augment/registry interface Registry extends Extra',
        '.: augments fixture-augment/registry interface Registry, optional property label?: string',
        '.: augments fixture-augment/registry interface Registry, optional property name?: string',
        '.: deprecated: augments fixture-augment/registry interface Registry, optional property name?: string',
        '.: augments fixture-augment/registry interface Registry, readonly required property "fixture/size": number',
        '.: augments fixture-augment/registry interface Registry, readonly required property kind: Kind',
        '.: augments fixture-augment/registry interface Registry, readonly required property mode: "read" | "write"',
        '.: augments fixture-augment/registry interface Registry, readonly required property spaced: "a  b"',
        '.: augments fixture-augment/registry interface Registry, required method describe(): string',
        '.: function plain(): void',
        '.: interface Extra',
        '.: interface Extra, readonly required property more: string',
        '.: type Kind = "a" | "b"',
        './registry: interface Registry',
        './registry: interface Registry, readonly required property base: string',
      ]),
    );
  });

  it('lists an @internal export and member like any other', () => {
    deepStrictEqual(
      linesOf('internal'),
      sorted([
        '.: function hidden(): void',
        '.: interface Thing',
        '.: interface Thing, readonly required property secret: string',
        '.: interface Thing, readonly required property shown: string',
      ]),
    );
  });

  it('lists a declaration once under each name it is exported as', () => {
    deepStrictEqual(
      linesOf('alias'),
      sorted([
        '.: const descriptor: { readonly id: string }',
        '.: export default = const descriptor: { readonly id: string }',
        '.: function aliasHelper(): void',
        '.: function helper(): void',
        '.: type NarrowSegment = string',
        '.: type WideSegment = readonly string[] | string',
      ]),
    );
  });

  it('tells apart two exported declarations with the same declared name by their export names', () => {
    deepStrictEqual(
      linesOf('same-declared-name'),
      sorted([
        '.: interface AlphaOptions',
        '.: interface AlphaOptions, readonly required property alpha: boolean',
        '.: interface BetaOptions',
        '.: interface BetaOptions, readonly required property beta: boolean',
      ]),
    );
  });

  it('lists an export whose name a global also has under its own name', () => {
    deepStrictEqual(
      linesOf('dom'),
      sorted([
        '.: function read(range: Range): Document',
        '.: interface Range',
        '.: interface Range, readonly required property start: number',
        '.: type Document = Record<string, unknown>',
      ]),
    );
  });

  it('keeps apart non-exported declarations that read alike but refer to different types', () => {
    deepStrictEqual(
      linesOf('merge'),
      sorted([
        '(not exported) interface Holder',
        '(not exported) interface Holder, readonly required property options: Options',
        '(not exported) interface Holder_2',
        '(not exported) interface Holder_2, readonly required property options: Options_2',
        '(not exported) interface Options',
        '(not exported) interface Options, readonly required property alpha: boolean',
        '(not exported) interface Options_2',
        '(not exported) interface Options_2, readonly required property beta: boolean',
        '.: function first(holder: Holder): void',
        '.: function second(holder: Holder_2): void',
      ]),
    );
  });

  it('lists identical copies of one non-exported declaration once', () => {
    deepStrictEqual(
      linesOf('copies'),
      sorted([
        '(not exported) interface Shared',
        '(not exported) interface Shared, readonly required property id: string',
        '.: function first(shared: Shared): void',
        './other: function second(shared: Shared): void',
      ]),
    );
  });

  it('gives a non-exported type another name than a type of another package it references', () => {
    deepStrictEqual(
      linesOf('clash'),
      sorted([
        '(not exported) interface Stats_2',
        '(not exported) interface Stats_2, readonly required property size: number',
        '.: function fromFs(stats: Stats): void',
        '.: function local(stats: Stats_2): void',
      ]),
    );
  });

  it('prints a type of another package that the bundler renamed by its own name', () => {
    deepStrictEqual(linesOf('external-rename'), ['.: function check(errors: ArkErrors): void']);
  });

  it('lists a re-exported namespace import as everything from that module', () => {
    deepStrictEqual(linesOf('nsimport'), ['.: export paths = everything from pathe']);
  });

  it('leaves out augmentations in files of another package', () => {
    deepStrictEqual(linesOf('outside-augment'), ['.: function plain(): void']);
  });

  it('fails on declare global, which it cannot list', () => {
    throws(() => linesOf('global'), /declare global/);
  });

  it('fails when an augmentation refers to a type that no line lists', () => {
    throws(() => linesOf('augraw'), /augments pathe interface Extra.*Label/);
  });

  it('fails when API Extractor gives no item for an export', () => {
    throws(
      () => linesOf('kinds', (model) => removeItem(model, 'answer')),
      /\.: export answer has no line/,
    );
  });

  it('fails when API Extractor gives no item for a member', () => {
    throws(
      () => linesOf('kinds', (model) => removeMember(model, 'Shape', 'label')),
      /\.: member Shape\.label has no line/,
    );
  });

  it('gives stable names to non-exported declarations that refer to each other', () => {
    const expected = sorted([
      '(not exported) interface X',
      '(not exported) interface X, readonly required property p: Y_2',
      "(not exported) interface X, readonly required property z: '1'",
      '(not exported) interface X_2',
      '(not exported) interface X_2, readonly required property p: Y',
      "(not exported) interface X_2, readonly required property z: '2'",
      '(not exported) interface Y',
      '(not exported) interface Y, readonly required property q: X_2',
      "(not exported) interface Y, readonly required property w: '1'",
      '(not exported) interface Y_2',
      '(not exported) interface Y_2, readonly required property q: X',
      "(not exported) interface Y_2, readonly required property w: '2'",
      '.: function first(x: X_2): void',
      '.: function second(x: X): void',
    ]);
    deepStrictEqual(linesOf('cycle'), expected);
  });

  it('merges copies of declarations that refer to copies of other declarations', () => {
    deepStrictEqual(
      linesOf('copies-deep'),
      sorted([
        '(not exported) interface Holder',
        '(not exported) interface Holder, readonly required property options: Options',
        '(not exported) interface Options',
        '(not exported) interface Options, readonly required property verbose: boolean',
        '.: function first(holder: Holder): void',
        './other: function second(holder: Holder): void',
      ]),
    );
  });

  it('keeps apart declarations whose types differ only by the module of an import("…")', () => {
    deepStrictEqual(
      linesOf('extmerge'),
      sorted([
        '(not exported) interface Holder',
        '(not exported) interface Holder, readonly required property stream: ReadStream',
        '(not exported) interface Holder_2',
        '(not exported) interface Holder_2, readonly required property stream: ReadStream',
        '.: function fromFile(holder: Holder): void',
        '.: function fromTerminal(holder: Holder_2): void',
      ]),
    );
  });

  it('refers to a declaration exported under two names by the first name in code-unit order', () => {
    deepStrictEqual(
      linesOf('two-names'),
      sorted([
        '.: function origin(): Coordinate',
        '.: interface Coordinate',
        '.: interface Coordinate, readonly required property x: number',
        '.: interface Point',
        '.: interface Point, readonly required property x: number',
      ]),
    );
  });

  it('lists members of non-exported classes and of namespaces', () => {
    deepStrictEqual(
      linesOf('hiddenmember'),
      sorted([
        '(not exported) class Base',
        '(not exported) class Base, readonly required property secret: string',
        '(not exported) class Base, readonly required property shown: string',
        '.: function make(): Base',
        '.: namespace Units',
        '.: namespace Units, const hiddenUnit: number',
        '.: namespace Units, const meter: number',
      ]),
    );
  });

  it('fails when API Extractor gives no item for a member of a non-exported class', () => {
    throws(
      () => linesOf('hiddenmember', (model) => removeMember(model, 'Base', 'secret')),
      /member Base\.secret has no line/,
    );
  });

  it('fails when API Extractor gives no item for a member of a namespace', () => {
    throws(
      () => linesOf('hiddenmember', (model) => removeMember(model, 'Units', 'hiddenUnit')),
      /member Units\.hiddenUnit has no line/,
    );
  });

  it('fails when API Extractor gives no item for a member of an interface inside a namespace', () => {
    deepStrictEqual(
      linesOf('nested-namespace'),
      sorted([
        '.: namespace Shapes',
        '.: namespace Shapes, interface Square',
        '.: namespace Shapes, interface Square, readonly required property side: number',
      ]),
    );
    throws(
      () =>
        linesOf('nested-namespace', (model) => {
          const shapes = membersOf(model).find((item) => item.name === 'Shapes');
          const square = shapes.members.find((member) => member.name === 'Square');
          square.members = [];
        }),
      /member Shapes\.Square\.side has no line/,
    );
  });

  it('fails when API Extractor gives no item for a static member', () => {
    throws(
      () => linesOf('kinds', (model) => removeMember(model, 'Circle', 'unit')),
      /member Circle\.static unit has no line/,
    );
  });

  it('fails when an augmentation refers to a non-exported type with a plain name that no line lists', () => {
    throws(() => linesOf('augplain'), /augments pathe interface Extra: refers to Label/);
  });

  it('fails on export * as from another package, naming the form', () => {
    throws(
      () => linesOf('nsexport'),
      /\.: export \* as paths from "pathe" is a form of export this script does not support/,
    );
  });

  it('names the package and path when API Extractor fails', () => {
    throws(
      () => linesOf('nsexport-chunk'),
      /fixtures\/nsexport-chunk: API Extractor failed on import path \.: fetchAstModuleExportInfo\(\) is not supported for external modules\. /,
    );
  });

  it('lists a class merged with an interface under one name, with the members of both', () => {
    deepStrictEqual(
      linesOf('mixin'),
      sorted([
        '(not exported) class Widget',
        '(not exported) class Widget, readonly required property base: number',
        '(not exported) interface Widget',
        '(not exported) interface Widget, readonly required property extra: string',
        '.: function make(): Widget',
      ]),
    );
  });

  it('lists merged declarations, enums, symbol keys and accessors', () => {
    deepStrictEqual(linesOf('shapes'), sorted(SHAPES));
  });

  it('checks each non-exported declaration against its own declaration, not one with the same name', () => {
    deepStrictEqual(
      linesOf('bestfit'),
      sorted([
        '(not exported) interface Options',
        '(not exported) interface Options, readonly required property alpha: boolean',
        '(not exported) interface Options_2',
        '(not exported) interface Options_2, readonly required property alpha: boolean',
        '(not exported) interface Options_2, readonly required property secret: string',
        '.: function first(options: Options_2): void',
        '.: function second(options: Options): void',
      ]),
    );
    throws(
      () =>
        linesOf('bestfit', (model) => {
          for (const item of membersOf(model)) {
            item.members = item.members?.filter((member) => member.name !== 'secret');
          }
        }),
      /member Options(_2)?\.secret has no line/,
    );
  });

  it('fails when an item matches several declarations with different members', () => {
    throws(
      () => linesOf('same-source'),
      /\(not exported\) Options matches 2 different declarations, so its members cannot be checked/,
    );
  });

  it('fails when no declaration is found for an item', () => {
    throws(
      () =>
        linesOf('hiddenmember', (model) => {
          const base = membersOf(model).find((item) => item.name === 'Base');
          if (base) base.fileUrlPath = 'lib/elsewhere.d.mts';
        }),
      /\(not exported\) Base has no declaration this script can find in lib\/elsewhere\.d\.mts, the file API Extractor records for it\. If API Extractor changed how it names that file/,
    );
  });

  it('keeps apart declarations whose types differ only by the module a name is imported from', () => {
    deepStrictEqual(
      linesOf('extmerge-named'),
      sorted([
        '(not exported) interface Holder',
        '(not exported) interface Holder, readonly required property stream: ReadStream',
        '(not exported) interface Holder_2',
        '(not exported) interface Holder_2, readonly required property stream: ReadStream',
        '.: function fromFile(holder: Holder): void',
        '.: function fromTerminal(holder: Holder_2): void',
      ]),
    );
  });

  it('gives a constant and a type of one name one name, whatever file each is recorded in', () => {
    deepStrictEqual(
      linesOf('split-halves', (model) => {
        const constant = membersOf(model).find((item) => item.kind === 'Variable');
        if (constant) constant.fileUrlPath = 'lib/elsewhere.d.mts';
      }),
      sorted([
        '(not exported) const Role: readonly ["a", "b"]',
        '(not exported) type Role = (typeof Role)[number]',
        '.: function all(): typeof Role',
        '.: function pick(role: Role): void',
      ]),
    );
  });

  it('keeps the spaces inside string and template literal types', () => {
    deepStrictEqual(
      linesOf('literals'),
      sorted([
        ".: const quoted: 'c\td'",
        '.: type Commented = { readonly a: "x  y"; }',
        '.: type Spaced = "a  b"',
        '.: type Template = `x  \u0024{string}  y`',
      ]),
    );
  });

  it('checks a static member and an instance member of one name separately', () => {
    deepStrictEqual(
      linesOf('statics'),
      sorted([
        '.: class Counter',
        '.: class Counter, required property count: number',
        '.: class Counter, static required property count: number',
      ]),
    );
    const removeCount = (isStatic) => (model) => {
      const counter = membersOf(model).find((item) => item.name === 'Counter');
      counter.members = counter.members.filter(
        (member) => !(member.name === 'count' && member.isStatic === isStatic),
      );
    };
    throws(() => linesOf('statics', removeCount(true)), /member Counter\.static count has no line/);
    throws(() => linesOf('statics', removeCount(false)), /member Counter\.count has no line/);
  });

  it('finds an augmentation file the way the compiler resolves its import', () => {
    deepStrictEqual(
      linesOf('augment-js'),
      sorted([
        '.: augments fixture-augment-js/registry interface Registry',
        '.: augments fixture-augment-js/registry interface Registry, readonly required property extra: string',
        '.: function plain(): void',
        './registry: interface Registry',
        './registry: interface Registry, readonly required property base: string',
      ]),
    );
  });

  it('qualifies a type from elsewhere by its package when the package exports one of that name', () => {
    deepStrictEqual(
      linesOf('qualify'),
      sorted([
        '.: function check(errors: @ark/schema.ArkErrors): ArkErrors',
        '.: function legacy(errors: @ark/schema.ArkErrors): void',
        '.: interface ArkErrors',
        '.: interface ArkErrors, readonly required property own: true',
      ]),
    );
  });

  it('qualifies an outside type one way, by its declaring package, whatever form the build wrote', () => {
    deepStrictEqual(
      linesOf('qualify-two-ways'),
      sorted([
        '.: function viaImport(errors: @ark/schema.ArkErrors): void',
        '.: function viaNamed(errors: @ark/schema.ArkErrors): void',
        '.: interface ArkErrors',
        '.: interface ArkErrors, readonly required property own: true',
      ]),
    );
  });

  it('writes a line break inside a literal as \\n, so every item stays on one line', () => {
    deepStrictEqual(
      linesOf('multiline-literal'),
      sorted(['.: const doc: `first line\\nsecond line`', '.: type Two = "a  b" | `c\\n  d`']),
    );
  });

  it('qualifies a global type whose name the package also exports with globalThis', () => {
    deepStrictEqual(
      linesOf('global-clash'),
      sorted([
        '.: function render(target: globalThis.Document): void',
        '.: function save(document: Document): void',
        '.: interface Document',
        '.: interface Document, readonly required property id: string',
      ]),
    );
  });

  it('marks a class or constant of the package exported type-only, on the path that does so', () => {
    deepStrictEqual(
      linesOf('own-type-only'),
      sorted([
        '.: class Widget, readonly required property size: number',
        '.: export type class Widget',
        '.: export type const limit: number',
        '.: interface Shape',
        '.: interface Shape, readonly required property x: number',
        './value: class Widget',
        './value: class Widget, readonly required property size: number',
      ]),
    );
  });

  it('qualifies an outside type whose name the package forwards from another declaration', () => {
    deepStrictEqual(
      linesOf('forward-clash'),
      sorted([
        '.: export ArkErrors from arktype',
        '.: export ReadStream from node:fs',
        '.: function check(errors: ArkErrors): void',
        '.: function terminal(stream: node:tty.ReadStream): void',
      ]),
    );
  });

  it('does not qualify a forwarded Node type where the package uses that same type', () => {
    deepStrictEqual(
      linesOf('node-forward'),
      sorted([
        '.: export ReadStream from node:fs',
        '.: function viaImport(stream: ReadStream): void',
        '.: function viaNamed(stream: ReadStream): void',
      ]),
    );
  });

  it('does not qualify a forwarded DefinitelyTyped type, in either form, where the package uses it', () => {
    deepStrictEqual(
      linesOf('dt-forward'),
      sorted([
        '.: export QueryResult from pg',
        '.: function viaImport(result: QueryResult): void',
        '.: function viaNamed(result: QueryResult): void',
      ]),
    );
  });

  it('qualifies an outside type whose name a namespace forward exports', () => {
    deepStrictEqual(
      linesOf('namespace-clash'),
      sorted([
        '.: export ArkErrors = everything from pathe',
        '.: function check(errors: @ark/schema.ArkErrors): void',
      ]),
    );
  });

  it('sorts union members and prints import("…") references by name alone', () => {
    deepStrictEqual(
      linesOf('normalize'),
      sorted([
        '.: const fromImport: ParsedPath',
        '.: const nested: { readonly kind: "y" | "z"; readonly pair: readonly ["c" | "d", 1 | 2]; readonly map: Map<"m" | "n", boolean | string>; readonly fn: (value: "p" | "q") => "r" | "s"; }',
        '.: const parsed: PlatformPath["parse"]',
        '.: function generic(value: ParsedPath | null): typeof sep',
        '.: interface Holder',
        '.: interface Holder, readonly required property value: "one" | "two"',
        '.: interface Holder, required method method(arg: "a" | "b"): void',
        '.: type Both = { a: 1 } & ("x" | "y")',
        '.: type Conditional<T> = T extends "j" | "k" ? "u" | "v" : never',
        '.: type Literal = "a" | "b" | "c"',
      ]),
    );
  });

  it('fails when dropping an import("…") module makes two items give the same line', () => {
    throws(
      () => linesOf('import-duplicate'),
      /two different items give the line "\.: function describe\(value: ReadStream\): void"/,
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

describe('moduleUsersImport', () => {
  it('names the module a DefinitelyTyped package types', () => {
    deepStrictEqual(
      ['@types/pg', '@types/babel__core', 'arktype', '@ark/schema'].map(moduleUsersImport),
      ['pg', '@babel/core', 'arktype', '@ark/schema'],
    );
  });
});

describe('oneLine', () => {
  it('keeps a literal inside an interpolation whose expression holds braces', () => {
    const text = 'type Spaced = `\u0024{{ x:  string } extends { x: string } ? `a  b` : never}`';
    strictEqual(
      oneLine(text),
      'type Spaced = `\u0024{{ x: string } extends { x: string } ? `a  b` : never}`',
    );
  });

  it('keeps a literal after a template with several interpolations', () => {
    strictEqual(
      oneLine('type T =  `a\u0024{1}  b\u0024{"c  d"}  e`  |  "f  g "  |  "h"'),
      'type T = `a\u0024{1}  b\u0024{"c  d"}  e` | "f  g " | "h"',
    );
  });

  it('collapses whitespace between tokens but not inside literals, and skips comments whole', () => {
    strictEqual(
      oneLine('type  A =\n  /* it\'s   here */  "x  y" |\n  `a  \u0024{"b  c"}  d`'),
      'type A = /* it\'s here */ "x  y" | `a  \u0024{"b  c"}  d`',
    );
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

  it('reports a name the bundler renamed, but not a $1 inside a string', () => {
    deepStrictEqual(
      portabilityProblems(['.: const a: Label$1', '.: const s: "hashtext($1)"'], '/home/ci/repo'),
      ['line has a name the bundler renamed: .: const a: Label$1'],
    );
  });

  it('accepts lines that name only packages', () => {
    strictEqual(
      portabilityProblems(['.: const c: import("arktype").Type'], '/home/ci/repo').length,
      0,
    );
  });
});
