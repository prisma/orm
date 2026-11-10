import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import mongoAdapterControl from '@internal/adapter-mongo/control';
import type { ContractSourceContext } from '@internal/config/config-types';
import type { Contract, JsonValue } from '@internal/contract/types';
import mongoDriverControl from '@internal/driver-mongo/control';
import { mongoFamilyDescriptor } from '@internal/family-mongo/control';
import { MongoContractSerializer } from '@internal/family-mongo/ir';
import {
  type DataTypeAuthoringEntry,
  printTaggedLiteral,
} from '@internal/framework-components/authoring';
import { enumRefusalOf } from '@internal/framework-components/codec';
import { createControlStack } from '@internal/framework-components/control';
import { defineContract, enumType, member } from '@internal/mongo/contract-builder';
import mongoStatic, { contractFromJson } from '@internal/mongo/static';
import type {
  AnyMongoTypeMaps,
  MongoContract,
  MongoContractWithTypeMaps,
} from '@internal/mongo-contract';
import { mongoContract } from '@internal/mongo-contract-psl/provider';
import { mongoTargetDescriptor as mongoTargetControl } from '@internal/target-mongo/control';
import mongoTargetPack from '@internal/target-mongo/pack';
import { join } from 'pathe';
import { describe, expect, it } from 'vitest';
import { timeouts, withMongoPort } from '../_harness/mongo';
import { enumNameOf, tableNameOf } from './enum-name-of';
import { literalOf } from './literal-of';
import { sameValue } from './same-value';

const stack = createControlStack({
  family: mongoFamilyDescriptor,
  target: mongoTargetControl,
  adapter: mongoAdapterControl,
  driver: mongoDriverControl,
  extensions: [],
});

const sourceContext: ContractSourceContext = {
  composedExtensions: [],
  defaultNamespaceId: stack.target.defaultNamespaceId,
  composedExtensionContracts: new Map(),
  authoringContributions: stack.authoringContributions,
  codecLookup: stack.codecLookup,
  dataTypes: stack.dataTypes,
  controlMutationDefaults: stack.controlMutationDefaults,
  generatorFunctions: stack.generatorFunctions,
  resolvedInputs: [],
  capabilities: stack.capabilities,
};

/** The stored form of one member for each data type a codec an enum can use represents, and a stored value that is not a member. */
const storedMembers: Readonly<
  Record<string, { readonly member: JsonValue; readonly other: JsonValue }>
> = {
  'mongo/string': { member: 'low', other: 'high' },
  'mongo/double': { member: 2.25, other: 3.25 },
  'mongo/int32': { member: 7, other: 8 },
  'mongo/bool': { member: true, other: false },
  'mongo/objectid': { member: '65a1b2c3d4e5f6a7b8c9d0e1', other: '65a1b2c3d4e5f6a7b8c9d0e2' },
  'mongo/date': { member: '2024-01-02T03:04:05.500Z', other: '2024-01-03T03:04:05.500Z' },
  'mongo/vector': { member: [1, 2], other: [2, 1] },
  'mongo/int64': { member: '9007199254740991', other: '1' },
  'mongo/decimal128': { member: '1.5', other: '2.5' },
  'mongo/binary': { member: 'aGVsbG8=', other: 'aGk=' },
};

/** The codecs an enum accepts whose PSL enum the contract build refuses, with its message: a BSON type whose values a collection validator cannot list as an enum. */
const buildRefusals: Readonly<Record<string, readonly string[]>> = {
  'mongo/objectId@1': [
    'enum "MongoObjectId1" @@type codec "mongo/objectId@1" stores BSON type objectId, which a collection validator cannot list as an enum value. Use a codec whose BSON type is string, int, double, bool, object or array.',
  ],
  'mongo/date@1': [
    'enum "MongoDate1" @@type codec "mongo/date@1" stores BSON type date, which a collection validator cannot list as an enum value. Use a codec whose BSON type is string, int, double, bool, object or array.',
  ],
  'mongo/int64@1': [
    'enum "MongoInt641" @@type codec "mongo/int64@1" stores BSON type long, which a collection validator cannot list as an enum value. Use a codec whose BSON type is string, int, double, bool, object or array.',
  ],
  'mongo/int64Number@1': [
    'enum "MongoInt64Number1" @@type codec "mongo/int64Number@1" stores BSON type long, which a collection validator cannot list as an enum value. Use a codec whose BSON type is string, int, double, bool, object or array.',
  ],
  'mongo/decimal128@1': [
    'enum "MongoDecimal1281" @@type codec "mongo/decimal128@1" stores BSON type decimal, which a collection validator cannot list as an enum value. Use a codec whose BSON type is string, int, double, bool, object or array.',
  ],
  'mongo/binary@1': [
    'enum "MongoBinary1" @@type codec "mongo/binary@1" stores BSON type binData, which a collection validator cannot list as an enum value. Use a codec whose BSON type is string, int, double, bool, object or array.',
  ],
};

/** The entry that writes a value of `dataType`: its own, or the number entry when a number of that type is written. */
function entryFor(dataType: string): DataTypeAuthoringEntry | undefined {
  return (
    stack.dataTypes.entries[dataType] ??
    Object.values(stack.dataTypes.entries).find(
      ({ written }) =>
        written.kind === 'plain' &&
        written.syntax === 'number' &&
        written.types.some((type) => type === dataType),
    )
  );
}

/** A stored value as its entry prints it, in the syntax the entry reads. */
function literal(entry: DataTypeAuthoringEntry, stored: JsonValue): string {
  const text = entry.print(stored);
  const { written } = entry;
  if (written.kind === 'tag') return printTaggedLiteral(written.tag, text);
  return written.syntax === 'string' ? JSON.stringify(text) : text;
}

/** A member stored as `stored` written in the syntax of the data type: through its own entry, through the entry of a type it casts from, or as a list through its list cast. */
function writtenMember(dataType: string, stored: JsonValue): string {
  const own = entryFor(dataType);
  if (own !== undefined) return literal(own, stored);
  const type = stack.dataTypes.lookup.get(dataType);
  const elementEntry = type?.listCast?.of.map(entryFor).find((entry) => entry !== undefined);
  if (elementEntry !== undefined && Array.isArray(stored)) {
    return `[${stored.map((element) => literal(elementEntry, element)).join(', ')}]`;
  }
  const castEntry = Object.keys(type?.casts ?? {})
    .map(entryFor)
    .find((entry) => entry !== undefined);
  if (castEntry === undefined) throw new Error(`no contract source can write ${dataType}`);
  return literal(castEntry, stored);
}

function enumBlock(codecId: string, dataType: string, stored: JsonValue): string {
  const name = enumNameOf(codecId);
  return `enum ${name} {\n  @@type("${codecId}")\n  Only = ${writtenMember(dataType, stored)}\n}\n\nmodel ${name}Model {\n  id    ObjectId @id @map("_id")\n  value ${name}\n\n  @@map("${tableNameOf(name)}")\n}\n`;
}

/** Reads PSL text through the Mongo PSL contract source, the way `contract emit` does. */
async function readPsl(
  text: string,
): Promise<{ readonly contract: Contract } | { readonly messages: readonly string[] }> {
  const directory = mkdtempSync(join(tmpdir(), 'enum-round-trip-mongo-'));
  try {
    const path = join(directory, 'contract.prisma');
    writeFileSync(path, `// use prisma-8\n\n${text}`);
    const result = await mongoContract(path, {
      target: mongoTargetPack,
    }).source.load({
      ...sourceContext,
      resolvedInputs: [path],
    });
    return result.ok
      ? { contract: result.value }
      : { messages: result.failure.diagnostics.map((diagnostic) => diagnostic.message) };
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
}

const refused = stack.codecDescriptors.flatMap((descriptor) => {
  const refusal = enumRefusalOf(descriptor);
  return refusal === undefined ? [] : [{ codecId: descriptor.codecId, refusal }];
});

const accepted = await Promise.all(
  stack.codecDescriptors
    .filter((descriptor) => enumRefusalOf(descriptor) === undefined)
    .map(async (descriptor) => {
      const stored = storedMembers[descriptor.dataType] ?? { member: null, other: null };
      return {
        codecId: descriptor.codecId,
        dataType: descriptor.dataType,
        stored,
        read: await readPsl(enumBlock(descriptor.codecId, descriptor.dataType, stored.member)),
      };
    }),
);
const refusedOnBuild = accepted.flatMap(({ codecId, read }) =>
  'messages' in read ? [[codecId, read.messages] as const] : [],
);
const roundTripped = accepted.filter(({ read }) => 'contract' in read);

type AnyMongoContract = MongoContractWithTypeMaps<MongoContract, AnyMongoTypeMaps>;

const combined = await readPsl(
  roundTripped
    .map(({ codecId, dataType, stored }) => enumBlock(codecId, dataType, stored.member))
    .join('\n'),
);
if (!('contract' in combined)) throw new Error(`the PSL did not load: ${combined.messages}`);
const contractJson = new MongoContractSerializer().serializeContract(
  contractFromJson<AnyMongoContract>(combined.contract),
);
const { enums } = mongoStatic({ contract: contractFromJson<AnyMongoContract>(contractJson) });

describe('every codec an enum can use on MongoDB reads back the member it writes', () => {
  it('puts every registered codec in exactly one group', () => {
    expect(
      [
        ...refused.map(({ codecId }) => codecId),
        ...refusedOnBuild.map(([codecId]) => codecId),
        ...roundTripped.map(({ codecId }) => codecId),
      ].sort(),
    ).toEqual(stack.codecDescriptors.map(({ codecId }) => codecId).sort());
  });

  it('has a stored member for the data type of every codec an enum can use', () => {
    expect(new Set(accepted.map(({ dataType }) => dataType))).toEqual(
      new Set(Object.keys(storedMembers)),
    );
  });

  it.each(refused)('refuses an enum on $codecId with its reason', ({ codecId, refusal }) => {
    expect(() =>
      defineContract({
        enums: { Refused: enumType('Refused', { codecId }, member('Only', 'only')) },
      }),
    ).toThrow(refusal);
  });

  it('refuses, when the PSL contract is built, each other enum a collection validator cannot enforce', () => {
    expect(Object.fromEntries(refusedOnBuild)).toEqual(buildRefusals);
  });

  it(
    'refuses a value that is not a member, writes the member past the collection validator, and reads back the member, which the codec renders as the literal of the value read',
    () =>
      withMongoPort<AnyMongoContract>({ contractJson }, async ({ db, mongoDb }) => {
        const results: Record<string, unknown> = {};
        const expected: Record<string, unknown> = {};
        for (const { codecId, stored } of roundTripped) {
          const enumName = enumNameOf(codecId);
          const collectionName = tableNameOf(enumName);
          const enumAccessor = enums[enumName];
          if (enumAccessor === undefined) expect.unreachable(`the client has the enum ${enumName}`);
          const codec = stack.codecLookup.forCodecRef({ codecId });
          const otherWrite = await mongoDb
            .collection(collectionName)
            .insertOne({
              value: await codec.toWire(
                codec.fromDataTypeValue(codec.dataType.fromContract(stored.other, {})),
                {},
              ),
            })
            .then(
              () => 'accepted',
              (error: { code?: number }) => (error.code === 121 ? 'refused' : String(error)),
            );
          const written = enumAccessor.members['Only'];
          await db[collectionName]?.create({ value: written });
          const row = await db[collectionName]?.first();
          results[codecId] = {
            otherWrite,
            has: enumAccessor.has(row?.['value']),
            equal: sameValue(row?.['value'], written),
            literal: stack.codecLookup.renderValueLiteralFor?.(codecId, stored.member, 'output'),
          };
          expected[codecId] = {
            otherWrite: 'refused',
            has: true,
            equal: true,
            literal: literalOf(row?.['value']),
          };
        }

        expect(results).toEqual(expected);
      }),
    timeouts.spinUpMongoMemoryServer,
  );
});
