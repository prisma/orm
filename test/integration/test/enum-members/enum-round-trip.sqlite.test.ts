import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { integerColumn } from '@internal/adapter-sqlite/column-types';
import sqliteAdapterControl from '@internal/adapter-sqlite/control';
import type { Contract, JsonValue } from '@internal/contract/types';
import sqliteDriverControl from '@internal/driver-sqlite/control';
import sqlFamilyControl, { INIT_ADDITIVE_POLICY } from '@internal/family-sql/control';
import { enumRefusalOf, readContractValue } from '@internal/framework-components/codec';
import { APP_SPACE_ID, createControlStack } from '@internal/framework-components/control';
import { buildFabricatedMigrationEdge } from '@internal/migration-tools/aggregate';
import type { SqlStorage } from '@internal/sql-contract/types';
import { defineContract, enumType, field, member, model } from '@internal/sqlite/contract-builder';
import sqlite from '@internal/sqlite/runtime';
import { contractFromJson } from '@internal/sqlite/static';
import sqliteTargetControl from '@internal/target-sqlite/control';
import { SqliteContractSerializer } from '@internal/target-sqlite/runtime';
import { join } from 'pathe';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { enumNameOf, tableNameOf } from './enum-name-of';
import { literalOf } from './literal-of';
import { sameValue } from './same-value';

const stack = createControlStack({
  family: sqlFamilyControl,
  target: sqliteTargetControl,
  adapter: sqliteAdapterControl,
  driver: sqliteDriverControl,
  extensions: [],
});
const controlFamily = sqlFamilyControl.create(stack);
const frameworkComponents = [sqliteTargetControl, sqliteAdapterControl] as const;

/** The stored form of one member for each data type a codec an enum can use represents. */
const storedMembers: Readonly<Record<string, JsonValue>> = {
  'sqlite/character': 'a',
  'sqlite/character-varying': 'low',
  'sqlite/text': 'low',
  'sqlite/integer': '9007199254740991',
  'sqlite/real': 2.25,
  'sqlite/blob': '68656C6C6F',
  'sqlite/datetime': '2024-01-02T03:04:05.500Z',
  'sqlite/date': '2024-02-29',
  'sqlite/time': '09:30:00.500',
  'sqlite/duration': 'PT1H30M',
  'sqlite/json': '"low"',
};

type EnumTypeHandle = ReturnType<typeof enumType>;

/** The codecs an enum accepts whose enum the contract build still refuses, with its message: a member stored as neither a string nor a finite number, which the column check that enforces membership cannot list. */
const authoringRefusals: Readonly<Record<string, string>> = {};

function contractWith(enums: Record<string, EnumTypeHandle>) {
  return defineContract({
    enums,
    models: Object.fromEntries(
      Object.entries(enums).map(([name, handle]) => [
        name,
        model(name, {
          fields: { id: field.column(integerColumn).id(), value: field.namedType(handle) },
        }).sql({ table: tableNameOf(name) }),
      ]),
    ),
  });
}

/** The enum on a codec, with one member stored as `stored`, or why the contract build refuses it. */
function enumOn(
  codecId: string,
  stored: JsonValue,
): { readonly handle: EnumTypeHandle } | { readonly refusal: string } {
  try {
    const codec = stack.codecLookup.forCodecRef({ codecId });
    const handle = enumType(
      enumNameOf(codecId),
      { codecId },
      member('Only', readContractValue(codec, stored, undefined)),
    );
    contractWith({ [handle.enumName]: handle });
    return { handle };
  } catch (error) {
    return { refusal: error instanceof Error ? error.message : String(error) };
  }
}

const refused = stack.codecDescriptors.flatMap((descriptor) => {
  const refusal = enumRefusalOf(descriptor);
  return refusal === undefined ? [] : [{ codecId: descriptor.codecId, refusal }];
});
const accepted = stack.codecDescriptors
  .filter((descriptor) => enumRefusalOf(descriptor) === undefined)
  .map((descriptor) => ({
    codecId: descriptor.codecId,
    dataType: descriptor.dataType,
    built: enumOn(descriptor.codecId, storedMembers[descriptor.dataType] ?? null),
  }));
const refusedOnBuild = accepted.flatMap(({ codecId, built }) =>
  'refusal' in built ? [[codecId, built.refusal] as const] : [],
);
const roundTripped = accepted.flatMap(({ codecId, dataType, built }) =>
  'handle' in built
    ? [{ codecId, handle: built.handle, stored: storedMembers[dataType] ?? null }]
    : [],
);

const contract = contractFromJson<Contract<SqlStorage>>(
  new SqliteContractSerializer().serializeContract(
    contractWith(Object.fromEntries(roundTripped.map(({ handle }) => [handle.enumName, handle]))),
  ),
);

async function pushContract(path: string): Promise<void> {
  const driver = await sqliteDriverControl.create(path);
  try {
    const planResult = sqliteTargetControl.createPlanner(sqliteAdapterControl.create(stack)).plan({
      contract,
      schema: await controlFamily.introspect({ driver }),
      policy: INIT_ADDITIVE_POLICY,
      fromContract: null,
      origin: null,
      statements: [],
      frameworkComponents,
      spaceId: APP_SPACE_ID,
      snapshotsImportPath: '../../snapshots',
    });
    if (planResult.kind !== 'success') {
      throw new Error(`Contract push planning failed: ${JSON.stringify(planResult)}`);
    }
    const applied = await sqliteTargetControl.createRunner(controlFamily).execute({
      driver,
      perSpaceOptions: [
        {
          space: APP_SPACE_ID,
          plan: planResult.plan,
          migrationEdges: [
            buildFabricatedMigrationEdge({
              currentMarkerStorageHash: planResult.plan.origin?.storageHash,
              destinationStorageHash: planResult.plan.destination.storageHash,
              operationCount: planResult.plan.operations.length,
            }),
          ],
          driver,
          destinationContract: contract,
          policy: INIT_ADDITIVE_POLICY,
          frameworkComponents,
        },
      ],
    });
    if (!applied.ok) {
      throw new Error(`Contract push apply failed: ${JSON.stringify(applied.failure)}`);
    }
  } finally {
    await driver.close();
  }
}

let directory: string;
let client: ReturnType<typeof sqlite<typeof contract>>;

beforeAll(async () => {
  directory = mkdtempSync(join(tmpdir(), 'enum-round-trip-sqlite-'));
  const path = join(directory, 'test.db');
  await pushContract(path);
  client = sqlite({ contract, path, verifyMarker: false });
  await client.connect();
});

afterAll(async () => {
  await client?.close();
  rmSync(directory, { recursive: true, force: true });
});

describe('every codec an enum can use on SQLite reads back the member it writes', () => {
  it('has a stored member for the data type of every codec an enum can use', () => {
    expect(new Set(accepted.map(({ dataType }) => dataType))).toEqual(
      new Set(Object.keys(storedMembers)),
    );
  });

  it.each(refused)('refuses an enum on $codecId with its reason', ({ codecId, refusal }) => {
    expect(() =>
      contractWith({ Refused: enumType('Refused', { codecId }, member('Only', 'only')) }),
    ).toThrow(refusal);
  });

  it('refuses, when the contract is built, each other enum it cannot store in a checked column', () => {
    expect(Object.fromEntries(refusedOnBuild)).toEqual(authoringRefusals);
  });

  it.each(roundTripped)(
    'writes the member of an enum on $codecId past the column check, reads back the member, and renders the literal of the value read',
    async ({ codecId, handle: { enumName }, stored }) => {
      const enumAccessor = client.enums[enumName];
      const collection = client.orm[enumName];
      if (enumAccessor === undefined || collection === undefined) {
        expect.unreachable(`the client has the enum and model ${enumName}`);
      }
      const written = enumAccessor.members['Only'];
      await collection.create({ id: 1, value: written });
      const row = await collection.first();

      expect({
        has: enumAccessor.has(row?.['value']),
        equal: sameValue(row?.['value'], written),
        literal: stack.codecLookup.renderValueLiteralFor?.(codecId, stored, 'output'),
      }).toEqual({ has: true, equal: true, literal: literalOf(row?.['value']) });
    },
  );
});
