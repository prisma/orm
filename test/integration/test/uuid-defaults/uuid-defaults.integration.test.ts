import { existsSync, rmSync, writeFileSync } from 'node:fs';
import { int4Column } from '@internal/adapter-postgres/column-types';
import postgresAdapter from '@internal/adapter-postgres/control';
import { createControlClient } from '@internal/cli/control-api';
import type { Contract } from '@internal/contract/types';
import postgresDriver from '@internal/driver-postgres/control';
import sql from '@internal/family-sql/control';
import { createControlStack } from '@internal/framework-components/control';
import {
  defineContract,
  enumType,
  field,
  member,
  model,
} from '@internal/postgres/contract-builder';
import postgresClient from '@internal/postgres/runtime';
import { sqlContractCanonicalizationHooks } from '@internal/sql-contract/canonicalization-hooks';
import { sqlEmission } from '@internal/sql-contract-emitter';
import { prismaContract } from '@internal/sql-contract-psl/provider';
import postgres from '@internal/target-postgres/control';
import postgresPackRef from '@internal/target-postgres/pack';
import { postgresCreateNamespace } from '@internal/target-postgres/types';
import { timeouts, withClient, withDevDatabase } from '@repo/test-utils';
import { join } from 'pathe';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { emit } from '../../utils/emit';
import { createIntegrationTestDir } from '../utils/cli-test-helpers';

const schema = `// use prisma-8

model T {
  id              Int    @id
  literal         Uuid   @default("A0EEBC99-9C0B-4EF8-BB6D-6BB9BD380A11")
  sqlLiteral      Uuid   @default(sql\`'B0EEBC99-9C0B-4EF8-BB6D-6BB9BD380A11'::uuid\`)
  braced          Uuid   @default("{C0EEBC99-9C0B4EF8-BB6D6BB9-BD380A11}")
  literalList     Uuid[] @default(["D0EEBC99-9C0B-4EF8-BB6D-6BB9BD380A11"])
  sqlArrayLiteral Uuid[] @default(sql\`'{E0EEBC99-9C0B-4EF8-BB6D-6BB9BD380A11}'::uuid[]\`)
  sqlConstructor  Uuid[] @default(sql\`ARRAY['F0EEBC99-9C0B-4EF8-BB6D-6BB9BD380A11'::uuid]\`)
}
`;

const uuidColumn = { codecId: 'pg/uuid@1', nativeType: 'uuid' } as const;

interface EmittedEnum {
  readonly domain: {
    readonly namespaces: {
      readonly public: { readonly enum: { readonly Key: unknown } };
    };
  };
  readonly storage: {
    readonly namespaces: {
      readonly public: {
        readonly entries: {
          readonly valueSet: { readonly Key: unknown };
          readonly table: {
            readonly T: { readonly checks: readonly { readonly expression: string }[] };
          };
        };
      };
    };
  };
}

/**
 * The runtime enum accessor, read with a value from the database. Its declared member types are
 * the literals as authored, while its values are what the codec stores.
 */
interface RuntimeEnumAccessor {
  readonly members: Record<string, unknown>;
  has(value: unknown): boolean;
}

interface EmittedColumns {
  readonly storage: {
    readonly namespaces: {
      readonly public: {
        readonly entries: {
          readonly table: {
            readonly T: { readonly columns: Record<string, { default?: unknown }> };
          };
        };
      };
    };
  };
}

function createClient() {
  return createControlClient({
    family: sql,
    target: postgres,
    adapter: postgresAdapter,
    driver: postgresDriver,
    extensions: [],
  });
}

function defaultsOf(contractJson: Record<string, unknown>): Record<string, unknown> {
  const columns = (contractJson as unknown as EmittedColumns).storage.namespaces.public.entries
    .table.T.columns;
  return Object.fromEntries(
    Object.entries(columns).map(([name, column]) => [name, column.default]),
  );
}

async function initAndVerify(
  connectionString: string,
  contractJson: Record<string, unknown>,
  migrationsDir: string,
): Promise<{ readonly init: unknown; readonly verify?: unknown }> {
  const client = createClient();
  try {
    await client.connect(connectionString);
    const init = await client.dbInit({ contract: contractJson, mode: 'apply', migrationsDir });
    if (!init.ok) return { init: init.failure };
    const verified = await client.dbVerify({
      contract: postgres.contractSerializer.deserializeContract(contractJson),
      migrationsDir,
      strict: true,
      skipSchema: false,
      skipMarker: false,
    });
    if (!verified.ok) return { init: 'applied', verify: verified.failure };
    return {
      init: 'applied',
      verify: {
        markerDrift: verified.value.markerDrift,
        unclaimed: verified.value.unclaimed,
        issues: [...verified.value.schemaResults.values()].flatMap(
          (result) => result.schema.issues,
        ),
      },
    };
  } finally {
    await client.close();
  }
}

/** Runs db init and db verify --strict, then runs `insertSql` and reads every row of `T` back. */
async function initVerifyAndRead(
  contractJson: Record<string, unknown>,
  migrationsDir: string,
  insertSql = 'INSERT INTO "T" (id) VALUES (1)',
) {
  return withDevDatabase(async ({ connectionString }) => {
    const checked = await initAndVerify(connectionString, contractJson, migrationsDir);
    if (checked.init !== 'applied') return checked;
    const stored = await withClient(connectionString, async (raw) => {
      await raw.query(insertSql);
      const rows = await raw.query<{ row: Record<string, unknown> }>(
        `SELECT to_jsonb(t) - 'id' AS row FROM "T" t ORDER BY id`,
      );
      return rows.rows.map((row) => row.row);
    });
    return { ...checked, stored };
  });
}

async function emitTypeScriptContract(contract: Contract): Promise<Record<string, unknown>> {
  const emitted = await emit(
    contract,
    createControlStack({ family: sql, target: postgres, adapter: postgresAdapter }),
    sqlEmission,
    {
      serializeContract: (c) =>
        postgres.contractSerializer.serializeContract(
          c as Parameters<typeof postgres.contractSerializer.serializeContract>[0],
        ),
      ...sqlContractCanonicalizationHooks,
    },
  );
  return JSON.parse(emitted.contractJson) as Record<string, unknown>;
}

function emitPsl(testDir: string, source: string) {
  const schemaPath = join(testDir, 'schema.prisma');
  writeFileSync(schemaPath, source, 'utf-8');
  return createClient().emit({
    contractConfig: {
      source: prismaContract(schemaPath, {
        target: postgresPackRef,
        createNamespace: postgresCreateNamespace,
      }).source,
      output: join(testDir, 'contract.json'),
    },
  });
}

const STORED_KEYS = [
  'a0eebc99-9c0b-4ef8-bb6d-6bb9bd380a11',
  'b0eebc99-9c0b-4ef8-bb6d-6bb9bd380a11',
] as const;

const storedKeyEnum = {
  domainEnum: {
    codecId: 'pg/uuid@1',
    members: [
      { name: 'A', value: STORED_KEYS[0] },
      { name: 'B', value: STORED_KEYS[1] },
    ],
  },
  valueSet: { kind: 'valueSet', values: [...STORED_KEYS] },
  checks: [`"key" IN ('${STORED_KEYS[0]}', '${STORED_KEYS[1]}')`],
};

const insertBothSpellings = `INSERT INTO "T" (id, key) VALUES (1, 'A0EEBC99-9C0B-4EF8-BB6D-6BB9BD380A11'), (2, '{B0EEBC99-9C0B4EF8-BB6D6BB9-BD380A11}')`;

const storedKeyRows = STORED_KEYS.map((key) => ({ key }));

function emittedKeyEnum(contractJson: Record<string, unknown>) {
  const emitted = contractJson as unknown as EmittedEnum;
  return {
    domainEnum: emitted.domain.namespaces.public.enum.Key,
    valueSet: emitted.storage.namespaces.public.entries.valueSet.Key,
    checks: emitted.storage.namespaces.public.entries.table.T.checks.map(
      (check) => check.expression,
    ),
  };
}

/** What the runtime enum accessor says about the values read back from the database. */
function accessorAgainst(
  accessor: RuntimeEnumAccessor | undefined,
  rows: readonly { readonly key: string }[],
) {
  return {
    members: accessor?.members,
    has: rows.map((row) => accessor?.has(row.key)),
  };
}

const accessorAgreeing = {
  members: { A: STORED_KEYS[0], B: STORED_KEYS[1] },
  has: [true, true],
};

const initializedAndVerified = {
  init: 'applied',
  verify: { markerDrift: null, unclaimed: [], issues: [] },
};

describe(
  'uuid defaults written in a spelling other than the one Postgres prints',
  () => {
    let testDir: string;

    beforeEach(() => {
      testDir = createIntegrationTestDir();
    });

    afterEach(() => {
      if (existsSync(testDir)) rmSync(testDir, { recursive: true, force: true });
    });

    it(
      'in PSL, emit as the lower-case text Postgres stores, are created by db init, and pass db verify --strict',
      async () => {
        const emitted = await emitPsl(testDir, schema);
        if (!emitted.ok) throw new Error(JSON.stringify(emitted.failure, null, 2));
        const contractJson = JSON.parse(emitted.value.contractJson) as Record<string, unknown>;

        expect(defaultsOf(contractJson)).toEqual({
          id: undefined,
          literal: { kind: 'literal', value: 'a0eebc99-9c0b-4ef8-bb6d-6bb9bd380a11' },
          sqlLiteral: {
            kind: 'function',
            expression: "'B0EEBC99-9C0B-4EF8-BB6D-6BB9BD380A11'::uuid",
          },
          braced: { kind: 'literal', value: 'c0eebc99-9c0b-4ef8-bb6d-6bb9bd380a11' },
          literalList: { kind: 'literal', value: ['d0eebc99-9c0b-4ef8-bb6d-6bb9bd380a11'] },
          sqlArrayLiteral: {
            kind: 'function',
            expression: "'{E0EEBC99-9C0B-4EF8-BB6D-6BB9BD380A11}'::uuid[]",
          },
          sqlConstructor: {
            kind: 'function',
            expression: "ARRAY['F0EEBC99-9C0B-4EF8-BB6D-6BB9BD380A11'::uuid]",
          },
        });

        await expect(initVerifyAndRead(contractJson, join(testDir, 'migrations'))).resolves.toEqual(
          {
            ...initializedAndVerified,
            stored: [
              {
                literal: 'a0eebc99-9c0b-4ef8-bb6d-6bb9bd380a11',
                sqlLiteral: 'b0eebc99-9c0b-4ef8-bb6d-6bb9bd380a11',
                braced: 'c0eebc99-9c0b-4ef8-bb6d-6bb9bd380a11',
                literalList: ['d0eebc99-9c0b-4ef8-bb6d-6bb9bd380a11'],
                sqlArrayLiteral: ['e0eebc99-9c0b-4ef8-bb6d-6bb9bd380a11'],
                sqlConstructor: ['f0eebc99-9c0b-4ef8-bb6d-6bb9bd380a11'],
              },
            ],
          },
        );
      },
      timeouts.spinUpPpgDev,
    );

    it(
      'in the TypeScript builder, emit as the lower-case text Postgres stores, are created by db init, and pass db verify --strict',
      async () => {
        const contract = defineContract({
          models: {
            T: model('T', {
              fields: {
                id: field.column(int4Column).id(),
                literal: field.column(uuidColumn).default('A0EEBC99-9C0B-4EF8-BB6D-6BB9BD380A11'),
                braced: field.column(uuidColumn).default('{C0EEBC99-9C0B4EF8-BB6D6BB9-BD380A11}'),
                literalList: field
                  .column(uuidColumn)
                  .many()
                  .default(['D0EEBC99-9C0B-4EF8-BB6D-6BB9BD380A11']),
              },
            }).sql({ table: 'T' }),
          },
        });
        const contractJson = await emitTypeScriptContract(contract);

        expect(defaultsOf(contractJson)).toEqual({
          id: undefined,
          literal: { kind: 'literal', value: 'a0eebc99-9c0b-4ef8-bb6d-6bb9bd380a11' },
          braced: { kind: 'literal', value: 'c0eebc99-9c0b-4ef8-bb6d-6bb9bd380a11' },
          literalList: { kind: 'literal', value: ['d0eebc99-9c0b-4ef8-bb6d-6bb9bd380a11'] },
        });

        await expect(initVerifyAndRead(contractJson, join(testDir, 'migrations'))).resolves.toEqual(
          {
            ...initializedAndVerified,
            stored: [
              {
                literal: 'a0eebc99-9c0b-4ef8-bb6d-6bb9bd380a11',
                braced: 'c0eebc99-9c0b-4ef8-bb6d-6bb9bd380a11',
                literalList: ['d0eebc99-9c0b-4ef8-bb6d-6bb9bd380a11'],
              },
            ],
          },
        );
      },
      timeouts.spinUpPpgDev,
    );

    it(
      'in a TypeScript enumType written as Postgres stores it, the runtime enum accessor agrees with values read back',
      async () => {
        const Key = enumType(
          'Key',
          uuidColumn,
          member('A', 'a0eebc99-9c0b-4ef8-bb6d-6bb9bd380a11'),
          member('B', 'b0eebc99-9c0b-4ef8-bb6d-6bb9bd380a11'),
        );
        const contract = defineContract({
          enums: { Key },
          models: {
            T: model('T', {
              fields: { id: field.column(int4Column).id(), key: field.namedType(Key) },
            }).sql({ table: 'T' }),
          },
        });
        const contractJson = await emitTypeScriptContract(contract);
        expect(emittedKeyEnum(contractJson)).toEqual(storedKeyEnum);

        const result = await initVerifyAndRead(
          contractJson,
          join(testDir, 'migrations'),
          insertBothSpellings,
        );
        expect(result).toEqual({ ...initializedAndVerified, stored: storedKeyRows });

        const db = postgresClient({ contract });
        try {
          expect(accessorAgainst(db.enums['public']?.['Key'], storedKeyRows)).toEqual(
            accessorAgreeing,
          );
        } finally {
          await db.close();
        }
      },
      timeouts.spinUpPpgDev,
    );

    it(
      'in a PSL enum written as Postgres stores it, emit and type the stored text, and the runtime enum accessor agrees with values read back',
      async () => {
        const emitted = await emitPsl(
          testDir,
          `// use prisma-8

enum Key {
  @@type("pg/uuid@1")
  A = "a0eebc99-9c0b-4ef8-bb6d-6bb9bd380a11"
  B = "b0eebc99-9c0b-4ef8-bb6d-6bb9bd380a11"
}

model T {
  id  Int @id
  key Key
}
`,
        );
        if (!emitted.ok) throw new Error(JSON.stringify(emitted.failure, null, 2));
        const contractJson = JSON.parse(emitted.value.contractJson) as Record<string, unknown>;
        expect(emittedKeyEnum(contractJson)).toEqual(storedKeyEnum);
        expect(STORED_KEYS.map((key) => emitted.value.contractDts.includes(key))).toEqual([
          true,
          true,
        ]);

        const result = await initVerifyAndRead(
          contractJson,
          join(testDir, 'migrations'),
          insertBothSpellings,
        );
        expect(result).toEqual({ ...initializedAndVerified, stored: storedKeyRows });

        const db = postgresClient({ contractJson });
        try {
          expect(accessorAgainst(db.enums['public']?.['Key'], storedKeyRows)).toEqual(
            accessorAgreeing,
          );
        } finally {
          await db.close();
        }
      },
      timeouts.spinUpPpgDev,
    );

    it('in a PSL enum, refuse a member written in upper case or braces, because pg/uuid@1 reads only the stored form', async () => {
      const emitted = await emitPsl(
        testDir,
        `// use prisma-8

enum Key {
  @@type("pg/uuid@1")
  Upper  = "A0EEBC99-9C0B-4EF8-BB6D-6BB9BD380A11"
  Braced = "{b0eebc99-9c0b-4ef8-bb6d-6bb9bd380a11}"
}

model T {
  id Int @id
}
`,
      );

      const reason =
        'pg/uuid@1 JSON value must be a UUID as PostgreSQL writes it, in lower case and hyphenated 8-4-4-4-12';
      expect(emitted.ok ? [] : emitted.failure.diagnostics?.diagnostics).toEqual([
        expect.objectContaining({
          code: 'PSL_EXTENSION_INVALID_VALUE',
          message: `enum "Key" member "Upper" was rejected by codec "pg/uuid@1": ${reason}`,
        }),
        expect.objectContaining({
          code: 'PSL_EXTENSION_INVALID_VALUE',
          message: `enum "Key" member "Braced" was rejected by codec "pg/uuid@1": ${reason}`,
        }),
      ]);
    });
  },
  timeouts.spinUpPpgDev,
);
