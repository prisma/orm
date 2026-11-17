import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'pathe';
import { describe, expect, it } from 'vitest';
import { detectionPatterns, guideChanges } from '../guide-detections';

const here = dirname(fileURLToPath(import.meta.url));
const repoRoot = join(here, '../../../../..');

const GUIDE_PATHS = {
  app: 'skills/prisma-8/upgrading/app/upgrades/8.0.0-rc.19-to-8.0.0-rc.20/instructions.md',
  extension:
    'skills/prisma-8/upgrading/extension/upgrades/8.0.0-rc.19-to-8.0.0-rc.20/instructions.md',
} as const;

function patternsOf(audience: keyof typeof GUIDE_PATHS, id: string): readonly RegExp[] {
  return detectionPatterns(GUIDE_PATHS[audience], id);
}

function detection(audience: 'app' | 'extension', id: string) {
  const patterns = patternsOf(audience, id);
  return (source: string) => patterns.some((pattern) => pattern.test(source));
}

const enumOn = (codecId: string, member: string) =>
  `enum E {\n  @@type("${codecId}")\n  ${member}\n}\n`;

describe('mongo-quoted-enum-members detection', () => {
  const detects = detection('app', 'mongo-quoted-enum-members');

  it.each([
    ['a quoted NaN on a Double enum', enumOn('mongo/double@1', 'Unknown = "NaN"')],
    ['a quoted Int64 member', enumOn('mongo/int64@1', 'Big = "9007199254740993"')],
    ['a quoted Decimal128 member', enumOn('mongo/decimal128@1', 'Zero = "-0"')],
    ['a quoted Date member', enumOn('mongo/date@1', 'Day = "2024-01-01T00:00:00.000Z"')],
    ['a quoted Binary member', enumOn('mongo/binary@1', 'Hi = "aGk="')],
    ['a quoted member before the @@type', 'enum E {\n  Big = "1"\n  @@type("mongo/int64@1")\n}\n'],
  ])('finds %s', (_name, source) => {
    expect(detects(source)).toBe(true);
  });

  it.each([
    ['an unquoted Double member', enumOn('mongo/double@1', 'Unknown = NaN')],
    ['a quoted String member', enumOn('mongo/string@1', 'Low = "low"')],
    ['a tagged Date member', enumOn('mongo/date@1', 'Day = date`2024-01-01T00:00:00Z`')],
    ['a quoted member of a Postgres enum', enumOn('pg/int8@1', 'Big = "1"')],
    [
      'a quoted member of the next enum',
      `${enumOn('mongo/int64@1', 'Big = 1')}enum F {\n  Low = "low"\n}\n`,
    ],
  ])('skips %s', (_name, source) => {
    expect(detects(source)).toBe(false);
  });
});

describe('mongo-integer-enum-members-with-a-fraction detection', () => {
  const detects = detection('app', 'mongo-integer-enum-members-with-a-fraction');

  it.each([
    ['an Int32 member with a fraction', enumOn('mongo/int32@1', 'One = 1.0')],
    ['an Int64 member with a fraction', enumOn('mongo/int64@1', 'Minus = -2.50')],
  ])('finds %s', (_name, source) => {
    expect(detects(source)).toBe(true);
  });

  it.each([
    ['a whole Int32 member', enumOn('mongo/int32@1', 'One = 1')],
    ['a Double member with a fraction', enumOn('mongo/double@1', 'Half = 0.5')],
  ])('skips %s', (_name, source) => {
    expect(detects(source)).toBe(false);
  });
});

describe('discriminator-optional-or-list detection', () => {
  const detects = detection('app', 'discriminator-optional-or-list');
  const base = (kind: string) =>
    `model Asset {\n  id   ObjectId @id @map("_id")\n  kind ${kind}\n\n  @@discriminator(kind)\n}\n`;

  it.each([
    ['an optional discriminator', base('String?')],
    ['a list discriminator', base('String[]')],
  ])('finds %s', (_name, source) => {
    expect(detects(source)).toBe(true);
  });

  it.each([
    ['a required discriminator', base('String')],
    [
      'an optional field that is not the discriminator',
      'model Asset {\n  kind  String\n  title String?\n\n  @@discriminator(kind)\n}\n',
    ],
  ])('skips %s', (_name, source) => {
    expect(detects(source)).toBe(false);
  });
});

describe('discriminator-base-value-not-a-member detection', () => {
  const detects = detection('app', 'discriminator-base-value-not-a-member');
  const hierarchy =
    'model Asset {\n  kind Kind\n  @@discriminator(kind)\n}\n\nmodel Photo {\n  @@base(Asset, "photo")\n}\n';

  it('finds a hierarchy in a schema with an enum', () => {
    expect(detects(`enum Kind {\n  Photo = "photo"\n}\n\n${hierarchy}`)).toBe(true);
  });

  it('skips a hierarchy in a schema without an enum', () => {
    expect(detects(hierarchy.replace('Kind', 'String'))).toBe(false);
  });
});

describe('psl-value-refused-code detection', () => {
  const detects = detection('app', 'psl-value-refused-code');

  it.each([
    [
      'the MongoDB member message',
      'expect(message).toContain(\'was rejected by codec "mongo/int32@1"\');',
    ],
    ['the MongoDB discriminator message', "expect(m).toMatch('must be of type String');"],
    [
      'the SQL @@base code',
      "const schema = '@@base(Shape, \"circle\")';\nexpect(code).toBe('PSL_INVALID_DEFAULT_LITERAL');",
    ],
  ])('finds %s', (_name, source) => {
    expect(detects(source)).toBe(true);
  });

  it.each([
    [
      'a default code in a file with no @@base',
      "expect(code).toBe('PSL_INVALID_DEFAULT_LITERAL');",
    ],
    ['a Postgres codec refusal', 'expect(m).toContain(\'was rejected by codec "pg/int4@1"\');'],
  ])('skips %s', (_name, source) => {
    expect(detects(source)).toBe(false);
  });
});

describe('decimal128-spelling detection', () => {
  const detects = detection('app', 'decimal128-spelling');

  it.each([
    [
      'a TypeScript member with leading zeros',
      "enumType('Ratio', { codecId: 'mongo/decimal128@1' }, member('Half', '007.5'));",
    ],
    [
      'a stored member with leading zeros',
      '{ "codecId": "mongo/decimal128@1", "members": [{ "name": "Half", "value": "007.5" }] }',
    ],
    [
      'a member with more than 34 digits',
      `enum R {\n  @@type("mongo/decimal128@1")\n  One = 1.${'0'.repeat(36)}\n}`,
    ],
  ])('finds %s', (_name, source) => {
    expect(detects(source)).toBe(true);
  });

  it.each([
    [
      'a TypeScript member without leading zeros',
      "enumType('Ratio', { codecId: 'mongo/decimal128@1' }, member('Half', '7.5'));",
    ],
    ['a member of a zero below one', `enum R {\n  @@type("mongo/decimal128@1")\n  Half = 0.5\n}`],
    [
      'leading zeros on another codec',
      "enumType('Ratio', { codecId: 'pg/numeric@1' }, member('Half', '007.5'));",
    ],
  ])('skips %s', (_name, source) => {
    expect(detects(source)).toBe(false);
  });
});

describe('decimal128-spelling detection on a contract.json', () => {
  const detects = detection('app', 'decimal128-spelling');
  const contract = readFileSync(
    join(repoRoot, 'test/integration/test/mongo/bson-scalars/_fixture/generated/contract.json'),
    'utf-8',
  );
  const storageHash = /"storageHash": "([0-9a-f]{64})"/.exec(contract)?.[1] ?? '';

  it('skips the bson-scalars contract', () => {
    expect({ storageHash: storageHash.length, detected: detects(contract) }).toEqual({
      storageHash: 64,
      detected: false,
    });
  });

  it('skips the bson-scalars contract with a storage hash that starts with 0 and a digit', () => {
    expect(detects(contract.replace(storageHash, `07${storageHash.slice(2)}`))).toBe(false);
  });
});

describe('detection patterns that look at the whole file', () => {
  const lookAheadOverTheFile = String.raw`(?=[\s\S]*`;
  const startOfFile = String.raw`(?<![\s\S])`;

  it.each(['app', 'extension'] as const)(
    'start at the start of the file in the %s guide, so each file is read once',
    (audience) => {
      const unanchored = guideChanges(GUIDE_PATHS[audience])
        .flatMap((change) => change.detection?.matches ?? [])
        .filter(
          (pattern) => pattern.includes(lookAheadOverTheFile) && !pattern.startsWith(startOfFile),
        );
      expect(unanchored).toEqual([]);
    },
  );
});

describe('entity-context-data-types detection', () => {
  const detects = detection('extension', 'entity-context-data-types');

  it.each([
    [
      'the removed hook',
      'const ctx = { readWrittenValueForCodec: ({ written }) => read(written) };',
    ],
    ['the removed type', 'const refused: WrittenValueReading = { ok: false, code, message };'],
    ['a context built by hand', 'const ctx: AuthoringEntityContext = {\n  family: "sql",'],
    ['a read of the removed lookup', 'const type = ctx.dataTypeLookup.get(id);'],
  ])('finds %s', (_name, source) => {
    expect(detects(source)).toBe(true);
  });

  it.each([
    [
      'the new reader',
      'const read = readWrittenValueIntoCodec({ support, codecLookup, ref, written });',
    ],
    ['a context passed through', 'function factory(ctx: AuthoringEntityContext) {}'],
    ['the lookup on the data types', 'const type = ctx.dataTypes.lookup.get(id);'],
  ])('skips %s', (_name, source) => {
    expect(detects(source)).toBe(false);
  });
});

describe('enum-block-members-written-values detection', () => {
  const detects = detection('extension', 'enum-block-members-written-values');

  it.each([
    [
      'a call of readEnumBlockMembers',
      'const members = readEnumBlockMembers(block, id, codec, ctx);',
    ],
    ['a read of writtenValues', 'const written = block.writtenValues?.[name];'],
  ])('finds %s', (_name, source) => {
    expect(detects(source)).toBe(true);
  });

  it('skips a name that only starts the same', () => {
    expect(detects('const w = block.writtenValuesByKey;')).toBe(false);
  });
});
