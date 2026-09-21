import { describe, expect, it } from 'vitest';
import {
  assembleAuthoringDataTypes,
  assembleDataTypes,
  enforceDataTypeInvariants,
} from '../src/control/control-stack';
import { type DataType, type DataTypeId, dataType, dataTypeId } from '../src/shared/data-type';
import { loweringEntryKey } from '../src/shared/framework-authoring';
import { isRuntimeError } from '../src/shared/runtime-error';

const int2 = dataType('demo/int2', {});
const int8 = dataType('demo/int8', { casts: { [int2.id]: (value) => String(value) } });
const text = dataType('demo/text', {});

const contributor = (id: string, dataTypes: readonly DataType[]) => ({ id, dataTypes });

const numberEntry = (types: readonly DataTypeId[] = [int2.id]) =>
  ({
    written: {
      kind: 'plain',
      syntax: 'number',
      types,
      classify: () => ({ type: int2.id, value: 0 }),
    },
    print: String,
    documentation: 'A number.',
  }) as const;

const tagEntry = (tag: string) =>
  ({
    written: { kind: 'tag', tag, parse: (text_: string) => text_ },
    print: String,
    documentation: `A ${tag} body.`,
  }) as const;

const codec = (codecId: string, type: DataType) => ({ codecId, dataType: type.id });

const invariants = (overrides: Partial<Parameters<typeof enforceDataTypeInvariants>[0]>) =>
  enforceDataTypeInvariants({
    lookup: assembleDataTypes([contributor('demo', [int2, int8, text])]).lookup,
    declaredTypes: [{ type: int2, contributedBy: 'demo' }],
    codecs: [],
    authoringEntries: [],
    ...overrides,
  });

describe('assembleDataTypes', () => {
  it('collects every contributor’s types into one lookup', () => {
    const { lookup } = assembleDataTypes([
      contributor('demo', [int2]),
      contributor('other', [text]),
    ]);
    expect([lookup.has(int2.id), lookup.has(text.id)]).toEqual([true, true]);
  });

  it('holds nothing when no contributor registers a type', () => {
    expect(assembleDataTypes([{ id: 'demo' }]).declared).toEqual([]);
  });

  it('refuses two declarations of one id, naming both contributors', () => {
    expect(() =>
      assembleDataTypes([
        contributor('demo', [int2]),
        contributor('other', [dataType('demo/int2', {})]),
      ]),
    ).toThrow(/"other".*"demo"|"demo".*"other"/);
  });
});

describe('enforceDataTypeInvariants', () => {
  it('refuses a codec whose data type nobody registered, naming the contributor and the id', () => {
    expect(() =>
      invariants({
        codecs: [{ ...codec('demo/x@1', dataType('demo/gone', {})), contributedBy: 'x-pack' }],
      }),
    ).toThrow(/x-pack.*demo\/gone|demo\/gone.*x-pack/s);
  });

  it('refuses an authoring entry for a data type nobody registered', () => {
    expect(() =>
      invariants({
        authoringEntries: [{ key: 'demo/gone', entry: tagEntry('gone'), contributedBy: 'x-pack' }],
      }),
    ).toThrow(/x-pack.*demo\/gone|demo\/gone.*x-pack/s);
  });

  it('refuses a classifier that returns a data type nobody registered', () => {
    expect(() =>
      invariants({
        authoringEntries: [
          {
            key: int2.id,
            entry: numberEntry([int2.id, dataTypeId('demo/gone')]),
            contributedBy: 'x-pack',
          },
        ],
      }),
    ).toThrow(/x-pack.*demo\/gone|demo\/gone.*x-pack/s);
  });

  it('refuses a cast from a data type nobody registered', () => {
    const casting = dataType('demo/casting', { casts: { 'demo/gone': (value) => value } });
    expect(() =>
      invariants({ declaredTypes: [{ type: casting, contributedBy: 'x-pack' }] }),
    ).toThrow(/demo\/gone/);
  });

  it('refuses two entries claiming one tag', () => {
    expect(() =>
      invariants({
        authoringEntries: [
          { key: int2.id, entry: tagEntry('json'), contributedBy: 'one' },
          { key: text.id, entry: tagEntry('json'), contributedBy: 'two' },
        ],
      }),
    ).toThrow(/"one".*"two"|"two".*"one"/s);
  });

  it('refuses two entries claiming one plain kind', () => {
    expect(() =>
      invariants({
        authoringEntries: [
          { key: int2.id, entry: numberEntry(), contributedBy: 'one' },
          { key: int8.id, entry: numberEntry(), contributedBy: 'two' },
        ],
      }),
    ).toThrow(/"one".*"two"|"two".*"one"/s);
  });

  it('refuses a cast from a data type no contract source can write', () => {
    expect(() =>
      invariants({
        declaredTypes: [{ type: int8, contributedBy: 'demo' }],
        authoringEntries: [{ key: int8.id, entry: tagEntry('int8'), contributedBy: 'demo' }],
      }),
    ).toThrow(/demo\/int2/);
  });

  it('passes a stack whose cast source can be written', () => {
    expect(() =>
      invariants({
        declaredTypes: [{ type: int8, contributedBy: 'demo' }],
        authoringEntries: [
          { key: int8.id, entry: tagEntry('int8'), contributedBy: 'demo' },
          { key: int2.id, entry: numberEntry(), contributedBy: 'demo' },
        ],
      }),
    ).not.toThrow();
  });

  it('raises a structured error', () => {
    try {
      invariants({
        codecs: [{ ...codec('demo/x@1', dataType('demo/gone', {})), contributedBy: 'x' }],
      });
      expect.unreachable();
    } catch (error) {
      expect(isRuntimeError(error) && error.code).toBe('CONTRACT.DATA_TYPE_UNREGISTERED');
    }
  });
});

describe('assembleAuthoringDataTypes', () => {
  it('merges every contributor’s entries, keyed by data type id and by lowering key', () => {
    const merged = assembleAuthoringDataTypes([
      { id: 'one', authoring: { dataTypes: { [int2.id]: numberEntry() } } },
      {
        id: 'two',
        authoring: {
          dataTypes: {
            [loweringEntryKey('sql')]: {
              written: { kind: 'tag', tag: 'sql' },
              documentation: 'An expression in the stored language.',
              lower: () => ({ ok: false, diagnostic: { code: 'x', message: 'x', sourceId: 'x' } }),
            },
          },
        },
      },
    ]);
    expect(Object.keys(merged).sort()).toEqual(['demo/int2', 'lowering:sql']);
  });

  it('refuses two contributors claiming one key', () => {
    expect(() =>
      assembleAuthoringDataTypes([
        { id: 'one', authoring: { dataTypes: { [int2.id]: numberEntry() } } },
        { id: 'two', authoring: { dataTypes: { [int2.id]: numberEntry() } } },
      ]),
    ).toThrow(/"one".*"two"|"two".*"one"/s);
  });
});

describe('loweringEntryKey', () => {
  it('is never a data type id', () => {
    expect(() => dataTypeId(loweringEntryKey('sql'))).toThrow();
  });
});
