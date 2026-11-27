import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';
import { describe, it } from 'node:test';
import { ApiLineError, compareCodeUnits, exportOfLine } from './api-lines.mjs';

describe('exportOfLine', () => {
  const cases = [
    ['./config: function defineConfig(options: Options): Config', './config', 'defineConfig'],
    ['./config: interface Options, readonly optional property db?: string', './config', 'Options'],
    ['.: class Client<T>, required method close(): Promise<void>', '.', 'Client'],
    ['.: abstract class Base<T> implements X', '.', 'Base'],
    ['.: const field: Helpers', '.', 'field'],
    ['.: deprecated: class Builder, required method sql(): Builder', '.', 'Builder'],
    ['./codecs: export type class Descriptor extends Base<P>', './codecs', 'Descriptor'],
    ['./control: export default = const descriptor: Descriptor', './control', 'default'],
    ['./control: export default = class Thing, required method go(): void', './control', 'default'],
    ['./x: export type default = class Thing', './x', 'default'],
    ['./b: export autoincrement from @prisma/orm-family-sql/builder', './b', 'autoincrement'],
    ['./b: export type EnumMember from @prisma/orm-framework/x', './b', 'EnumMember'],
    ['./b: export now = currentTime from @prisma/orm-framework/x', './b', 'now'],
    ['./b: export type ns = everything from @prisma/orm-framework/x', './b', 'ns'],
    [
      './adapter: everything from @prisma/orm-target-postgres/adapter',
      './adapter',
      'everything from @prisma/orm-target-postgres/adapter',
    ],
    [
      './runtime: augments @prisma/orm-family-sql/c interface Registry, readonly required property x: X',
      './runtime',
      'augments @prisma/orm-family-sql/c interface Registry',
    ],
    [
      './runtime: augments @prisma/a/b interface Registry',
      './runtime',
      'augments @prisma/a/b interface Registry',
    ],
    ['.: namespace Ns, function inner(): void', '.', 'Ns'],
    ['.: enum Level, member High = 2', '.', 'Level'],
    ['(not exported) type BindingKind = Binding["kind"]', undefined, 'BindingKind'],
    [
      '(not exported) interface Member_2, readonly required property name: Name',
      undefined,
      'Member_2',
    ],
  ];
  for (const [line, subpath, name] of cases) {
    it(`reads ${line.slice(0, 60)}`, () => {
      assert.deepEqual(exportOfLine(line), { subpath, name });
    });
  }

  it('fails on a line it cannot read', () => {
    assert.throws(() => exportOfLine('./x: something new'), ApiLineError);
    assert.throws(() => exportOfLine('./x: something new'), /scripts\/public-api\/api-lines.mjs/);
  });

  it('reads every line of every committed api.txt', () => {
    const root = new URL('../../packages/9-public/@prisma/', import.meta.url);
    let read = 0;
    for (const dir of readdirSync(root)) {
      const text = readFileSync(new URL(`${dir}/api.txt`, root), 'utf8');
      for (const line of text.split('\n')) {
        if (line === '' || line.startsWith('#')) continue;
        exportOfLine(line);
        read++;
      }
    }
    assert.ok(read > 1000, `read only ${read} lines`);
  });
});

describe('compareCodeUnits', () => {
  it('orders by UTF-16 code units, as api.txt is sorted', () => {
    assert.deepEqual(['b', 'B', '(', '.'].sort(compareCodeUnits), ['(', '.', 'B', 'b']);
  });

  it('agrees with the order of every committed api.txt', () => {
    const root = new URL('../../packages/9-public/@prisma/', import.meta.url);
    for (const dir of readdirSync(root)) {
      const lines = readFileSync(new URL(`${dir}/api.txt`, root), 'utf8')
        .split('\n')
        .filter((line) => line !== '' && !line.startsWith('#'));
      assert.deepEqual([...lines].sort(compareCodeUnits), lines, dir);
    }
  });
});
