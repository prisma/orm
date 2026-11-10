import type { Contract } from '@internal/contract/types';
import { describe, expect, it } from 'vitest';
import { TEMPORAL_REWRITES } from '../../../../../packages/2-mongo-family/2-authoring/contract-ts/src/removed-field-presets';
import { PRESETS } from '../../../../../packages/2-sql-family/2-authoring/contract-ts/src/removed-field-presets';
import {
  emitMongo,
  emitPostgres,
  emitSqlite,
  mongoTs,
  postgresTs,
  sqliteTs,
} from './preset-replacement-contracts';
import {
  mongoRows,
  type PresetReplacementRow,
  postgresRows,
  sqliteRows,
} from './preset-replacement-rows';

const REFUSAL =
  /^field\.(\S+) was a field preset, and Prisma 8 removed field presets\. Write (.+)\. The upgrade guide "Field presets are removed" lists every rewrite\.$/;

/** The code a rewrite writes, in order: each `field.…` call chain, and each `.onCreate(…)` or `.onUpdate(…)` it says to add. */
function codesIn(rewrite: string): readonly string[] {
  const words: string[] = [];
  let depth = 0;
  let word = '';
  for (const character of rewrite) {
    if (depth === 0 && (character === ' ' || character === ',')) {
      words.push(word);
      word = '';
      continue;
    }
    if (character === '(') depth += 1;
    if (character === ')') depth -= 1;
    word += character;
  }
  words.push(word);
  return words.filter((code) => /^(?:field)?\.\w+\(/.test(code));
}

/** How a schema that called the preset writes its rewrite: from the code the rewrite names, with the arguments that call gave. */
type Write = (codes: readonly string[]) => string;

const first: Write = ([code = '']) => code;

/** The second form the rewrite names, with `n` replaced by `size`. */
const sized =
  (size: number): Write =>
  ([, code = '']) =>
    code.replaceAll('(n)', `(${size})`);

/** The general form of `field.generated(...)`, with its length and generator. */
const generated =
  (length: number, generator: string): Write =>
  ([code = '']) =>
    code.replace('(n)', `(${length})`).replace('gen.fn()', `gen.${generator}`);

/** The column with `precision` for `p`, or without the precision when it is empty: `type.X(p)` for an explicit type, `precision: p` in the options of a type choice. */
function withPrecision(column: string, precision: string): string {
  if (precision !== '') {
    return column
      .replace('(p)', `(${precision})`)
      .replace('precision: p', `precision: ${precision}`);
  }
  return column
    .replace('(p)', '()')
    .replace('({ precision: p })', '()')
    .replace(', precision: p', '');
}

/** The column the rewrite names, with `precision` for `p` (`undefined` when the preset took no precision, so the rewrite must name none), and the rewrite's `.onCreate(...)` and `.onUpdate(...)` for the phases the preset set. */
const withPhases =
  (precision: string | undefined, phases: readonly ('onCreate' | 'onUpdate')[]): Write =>
  ([column = '', ...modifiers]) => {
    if (precision === undefined && /\(p\)|precision: p/.test(column)) {
      throw new Error(`the rewrite ${column} names a precision the preset did not take`);
    }
    const modifiersOfPhases = phases.map((phase) => {
      const modifier = modifiers.find((code) => code.startsWith(`.${phase}(`));
      if (modifier === undefined) throw new Error(`the rewrite names no .${phase}(...)`);
      return modifier;
    });
    return withPrecision(column, precision ?? '') + modifiersOfPhases.join('');
  };

const BOTH = ['onCreate', 'onUpdate'] as const;

/** A removed TypeScript preset, the row of the parity test whose replacement a call to it stores, and how that call is rewritten. */
type Case = readonly [helper: string, model: string, write: Write];

const SQL_FAMILY_CASES: readonly Case[] = [
  ['uuidString', 'UuidStringColumn', first],
  ['ulid', 'UlidColumn', first],
  ['nanoid', 'NanoidColumn', first],
  ['nanoid', 'NanoidSized', sized(12)],
  ['cuid2', 'Cuid2Column', first],
  ['ksuid', 'KsuidColumn', first],
  ['id.uuidv4String', 'IdUuidv4String', first],
  ['id.uuidv7String', 'IdUuidv7String', first],
  ['id.ulid', 'IdUlid', first],
  ['id.nanoid', 'IdNanoid', first],
  ['id.nanoid', 'IdNanoidSized', sized(16)],
  ['id.cuid2', 'IdCuid2', first],
  ['id.ksuid', 'IdKsuid', first],
  ['generated', 'GeneratedUuidv4', ([, example = '']) => example],
  ['generated', 'GeneratedUuidv7', generated(36, 'uuid(7)')],
  ['generated', 'GeneratedUlid', generated(26, 'ulid()')],
  ['generated', 'GeneratedNanoid', generated(21, 'nanoid()')],
  ['generated', 'GeneratedNanoidSized', generated(16, 'nanoid(16)')],
  ['generated', 'GeneratedCuid2', generated(24, 'cuid(2)')],
  ['generated', 'GeneratedKsuid', generated(27, 'ksuid()')],
  ['generated', 'GeneratedUuidv4Id', (codes) => `${generated(36, 'uuid()')(codes)}.id()`],
  ['temporal.createdAt', 'CreatedAt', first],
  ['temporal.updatedAt', 'UpdatedAt', first],
];

const POSTGRES_CASES: readonly Case[] = [
  ...SQL_FAMILY_CASES,
  ['text', 'Text', first],
  ['int', 'Int4', first],
  ['bigint', 'Int8', first],
  ['float', 'Float8', first],
  ['decimal', 'NumericColumn', first],
  ['boolean', 'Bool', first],
  ['json', 'JsonbColumn', first],
  ['bytes', 'Bytea', first],
  ['dateTime', 'DateTimeColumn', first],
  ['uuidNative', 'UuidNative', first],
  ['id.uuidv4Native', 'IdUuidv4Native', first],
  ['id.uuidv7Native', 'IdUuidv7Native', first],
  ['temporal.createdAtString', 'CreatedAtString', first],
  ['temporal.updatedAtString', 'UpdatedAtString', first],
  ['temporal.createdAtJsDate', 'CreatedAtJsDate', first],
  ['temporal.updatedAtJsDate', 'UpdatedAtJsDate', first],
  ['temporal.timestamp', 'TimestampBothPhases', withPhases('3', BOTH)],
  ['temporal.timestamp', 'TimestampNamedPrecision', withPhases('6', ['onCreate'])],
  ['temporal.timestamp', 'TimestampBare', withPhases('', [])],
  ['temporal.timestamptz', 'TimestamptzOnCreate', withPhases('', ['onCreate'])],
  ['temporal.timestamptz', 'TimestamptzBare', withPhases('', [])],
  ['temporal.timestampString', 'TimestampStringOnUpdate', withPhases('6', ['onUpdate'])],
  ['temporal.timestamptzString', 'TimestamptzStringBothPhases', withPhases('3', BOTH)],
  ['temporal.timestamptzJsDate', 'TimestamptzJsDateOnCreate', withPhases('3', ['onCreate'])],
  ['temporal.date', 'DateColumn', withPhases(undefined, ['onCreate'])],
  ['temporal.dateString', 'DateStringBothPhases', withPhases(undefined, BOTH)],
  ['temporal.time', 'TimeOnUpdate', withPhases('3', ['onUpdate'])],
  ['temporal.time', 'TimeWithoutPrecision', withPhases('', ['onCreate'])],
  ['temporal.timeString', 'TimeStringOnCreate', withPhases('3', ['onCreate'])],
  ['temporal.timetz', 'TimetzBothPhases', withPhases('6', BOTH)],
];

const SQLITE_CASES: readonly Case[] = [
  ...SQL_FAMILY_CASES,
  ['temporal.datetime', 'DatetimeBothPhases', withPhases(undefined, BOTH)],
  ['temporal.datetime', 'DatetimeOnCreate', withPhases(undefined, ['onCreate'])],
];

const MONGO_CASES: readonly Case[] = [
  ['temporal.createdAt', 'CreatedAt', first],
  ['temporal.updatedAt', 'UpdatedAt', first],
  ['temporal.timestamp', 'TimestampBothPhases', withPhases(undefined, BOTH)],
  ['temporal.timestamp', 'TimestampOnUpdate', withPhases(undefined, ['onUpdate'])],
];

/** Every preset the SQL TypeScript builder had, on one target or another. */
const SQL_PRESETS = [
  ...new Set([...POSTGRES_CASES, ...SQLITE_CASES].map(([helper]) => helper)),
].sort();

const MONGO_PRESETS = [...new Set(MONGO_CASES.map(([helper]) => helper))].sort();

interface TargetCase<Helpers, Field> {
  readonly target: string;
  readonly rows: readonly PresetReplacementRow<Helpers, Field>[];
  readonly cases: readonly Case[];
  readonly presets: readonly string[];
  readonly ts: (rows: readonly PresetReplacementRow<Helpers, Field>[]) => Contract;
  readonly emit: (contract: Contract) => Promise<string>;
}

function readPath(root: unknown, path: string): unknown {
  return path.split('.').reduce<unknown>((value, key) => Reflect.get(Object(value), key), root);
}

function describeTarget<Helpers extends { readonly field: object }, Field>(
  targetCase: TargetCase<Helpers, Field>,
): void {
  function refusalOf(helper: string): string {
    try {
      targetCase.ts([
        {
          model: 'Refusal',
          psl: { replacement: '' },
          ts: (helpers) => {
            readPath(helpers.field, helper);
            throw new Error(`reading field.${helper} did not throw`);
          },
        },
      ]);
    } catch (error) {
      return error instanceof Error ? error.message : String(error);
    }
    throw new Error('the contract built');
  }

  async function emitted(row: PresetReplacementRow<Helpers, Field>): Promise<unknown> {
    return JSON.parse(await targetCase.emit(targetCase.ts([row])));
  }

  const named = new Set(targetCase.cases.map(([helper]) => helper));
  const unnamed = targetCase.presets.filter((helper) => !named.has(helper));

  describe(`on ${targetCase.target}`, () => {
    it.each(targetCase.cases)(
      'field.%s names a rewrite that stores what the %s replacement stores',
      async (helper, model, write) => {
        const row = targetCase.rows.find((candidate) => candidate.model === model);
        if (row === undefined) throw new Error(`no parity row ${model}`);
        const [, refused, rewrite = ''] = REFUSAL.exec(refusalOf(helper)) ?? [];
        expect(refused).toBe(helper);
        const code = write(codesIn(rewrite));
        const evaluate = new Function('field', 'type', 'gen', `return ${code};`) as (
          ...helpers: unknown[]
        ) => Field;
        const rewritten = {
          ...row,
          ts: (helpers: Helpers) =>
            evaluate(helpers.field, Reflect.get(helpers, 'type'), Reflect.get(helpers, 'gen')),
        };
        expect(await emitted(rewritten)).toEqual(await emitted(row));
      },
    );

    it.runIf(unnamed.length > 0).each(unnamed)(
      'field.%s, which this target never had, names the forms that replace presets',
      (helper) => {
        expect(refusalOf(helper)).toMatch(
          new RegExp(
            `^field\\.${helper.replace('.', '\\.')} does not exist\\. Prisma 8 removed field presets: `,
          ),
        );
      },
    );
  });
}

describe('the removed TypeScript field preset tables', () => {
  it('have a case for every SQL preset', () => {
    expect(Object.keys(PRESETS).sort()).toEqual(SQL_PRESETS);
  });

  it('have a case for every MongoDB preset', () => {
    expect(
      Object.keys(TEMPORAL_REWRITES)
        .map((preset) => `temporal.${preset}`)
        .sort(),
    ).toEqual(MONGO_PRESETS);
  });
});

describe('the rewrite a removed TypeScript field preset names', () => {
  describeTarget({
    target: 'postgres',
    rows: postgresRows,
    cases: POSTGRES_CASES,
    presets: SQL_PRESETS,
    ts: postgresTs,
    emit: emitPostgres,
  });
  describeTarget({
    target: 'sqlite',
    rows: sqliteRows,
    cases: SQLITE_CASES,
    presets: SQL_PRESETS,
    ts: sqliteTs,
    emit: emitSqlite,
  });
  describeTarget({
    target: 'mongo',
    rows: mongoRows,
    cases: MONGO_CASES,
    presets: MONGO_PRESETS,
    ts: mongoTs,
    emit: emitMongo,
  });
});
