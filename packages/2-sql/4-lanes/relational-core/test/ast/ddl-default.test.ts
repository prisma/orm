import type { JsonValue } from '@internal/contract/types';
import type { AnyCodecDescriptor } from '@internal/framework-components/codec';
import { InternalError } from '@internal/utils/internal-error';
import { describe, expect, it } from 'vitest';
import { encodeListLiteralDefault, encodeLiteralDefault } from '../../src/ast/ddl-default';
import { sqlTextDescriptor } from '../../src/ast/sql-codecs';
import { defineTestCodec } from './test-codec';

const document = defineTestCodec({
  typeId: 'test/document@1',
  encode: (value: JsonValue) => JSON.stringify(value),
  decode: (wire: string): JsonValue => JSON.parse(wire),
});

const documentDescriptor = {
  codecId: 'test/document@1',
  paramsSchema: undefined,
  factory: () => () => document,
} as unknown as AnyCodecDescriptor;

const brokenDescriptor = {
  codecId: 'test/broken@1',
  paramsSchema: undefined,
  factory: () => () => ({
    ...document,
    id: 'test/broken@1',
    decodeJson: () => {
      throw new InternalError('a codec broke an invariant');
    },
  }),
} as unknown as AnyCodecDescriptor;

const descriptors: readonly AnyCodecDescriptor[] = [
  sqlTextDescriptor as unknown as AnyCodecDescriptor,
  documentDescriptor,
  brokenDescriptor,
];

const lookup = {
  descriptorFor: (id: string) => descriptors.find((descriptor) => descriptor.codecId === id),
};

const where = { table: 'posts', column: 'title' };

describe('encodeLiteralDefault', () => {
  it('reads a stored default with the codec and encodes it, and encodes a Date as it is', async () => {
    const date = new Date('2024-01-02T03:04:05.000Z');
    expect([
      await encodeLiteralDefault(lookup, { codecId: 'sql/text@1' }, 'hello', where),
      await encodeLiteralDefault(lookup, { codecId: 'sql/text@1' }, date, where),
      await encodeLiteralDefault(lookup, { codecId: 'test/document@1' }, { a: 1 }, where),
    ]).toEqual([
      { kind: 'wire', wire: 'hello' },
      { kind: 'wire', wire: date },
      { kind: 'wire', wire: '{"a":1}' },
    ]);
  });

  it('reads a null default as SQL NULL when the codec refuses null, and as the value null when it reads it', async () => {
    expect([
      await encodeLiteralDefault(lookup, { codecId: 'sql/text@1' }, null, where),
      await encodeLiteralDefault(lookup, { codecId: 'test/document@1' }, null, where),
    ]).toEqual([{ kind: 'sql-null' }, { kind: 'wire', wire: 'null' }]);
  });

  it('answers undefined for a codec no descriptor has', async () => {
    expect(
      await encodeLiteralDefault(lookup, { codecId: 'test/unknown@1' }, 'x', where),
    ).toBeUndefined();
  });

  it('refuses a value the codec refuses as a contract error naming the column', async () => {
    await expect(encodeLiteralDefault(lookup, { codecId: 'sql/text@1' }, 1, where)).rejects.toThrow(
      expect.objectContaining({
        code: 'CONTRACT.DEFAULT_INVALID',
        message:
          'Column "posts"."title" has a default its codec sql/text@1 refuses: sql/text@1 JSON value must be a string',
        why: "A contract.json that an earlier version emitted, or a migration.ts it planned, can hold a default that this version's codec refuses, and so can either file after a hand edit.",
        fix: 'If contract.json holds the default, emit the contract again with this version, and correct the default in the contract source if emit refuses it. If a migration.ts sets it, correct it in that file.',
        meta: {
          table: 'posts',
          column: 'title',
          codecId: 'sql/text@1',
          value: 1,
          reason: 'codec-refused-default',
        },
      }),
    );
  });

  it('passes a codec internal error through, for a value and for null, instead of blaming the default', async () => {
    const encode = (value: JsonValue) =>
      encodeLiteralDefault(lookup, { codecId: 'test/broken@1' }, value, where);
    await expect(encode('x')).rejects.toThrow(InternalError);
    await expect(encode(null)).rejects.toThrow(InternalError);
  });
});

describe('encodeListLiteralDefault', () => {
  const tags = { codecId: 'sql/text@1', many: true } as const;

  it('reads and encodes each element with the codec, a null element as SQL NULL, and an empty list as no elements', async () => {
    expect([
      await encodeListLiteralDefault(lookup, tags, ['a', null, 'b'], where),
      await encodeListLiteralDefault(lookup, tags, [], where),
      await encodeListLiteralDefault(
        lookup,
        { codecId: 'test/document@1', many: true },
        [{ a: 1 }, null],
        where,
      ),
    ]).toEqual([
      [{ kind: 'wire', wire: 'a' }, { kind: 'sql-null' }, { kind: 'wire', wire: 'b' }],
      [],
      [
        { kind: 'wire', wire: '{"a":1}' },
        { kind: 'wire', wire: 'null' },
      ],
    ]);
  });

  it('answers undefined for a codec no descriptor has', async () => {
    expect(
      await encodeListLiteralDefault(
        lookup,
        { codecId: 'test/unknown@1', many: true },
        ['x'],
        where,
      ),
    ).toBeUndefined();
  });

  it('refuses an element the codec refuses as a contract error naming the column and the element', async () => {
    await expect(encodeListLiteralDefault(lookup, tags, ['a', 1], where)).rejects.toThrow(
      expect.objectContaining({
        code: 'CONTRACT.DEFAULT_INVALID',
        message:
          'Column "posts"."title" has a default (element 2) its codec sql/text@1 refuses: sql/text@1 JSON value must be a string',
        meta: {
          table: 'posts',
          column: 'title',
          codecId: 'sql/text@1',
          value: 1,
          elementPosition: 2,
          reason: 'codec-refused-default',
        },
      }),
    );
  });

  it('passes a codec internal error through instead of blaming the default', async () => {
    await expect(
      encodeListLiteralDefault(lookup, { codecId: 'test/broken@1', many: true }, ['x'], where),
    ).rejects.toThrow(InternalError);
  });
});
