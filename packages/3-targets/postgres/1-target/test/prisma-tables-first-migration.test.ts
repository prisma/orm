import { describe, expect, it } from 'vitest';
import FirstMigration from '../migrations/20261126T1200_create_prisma_tables/migration';
import metadata from '../migrations/20261126T1200_create_prisma_tables/migration.json' with {
  type: 'json',
};
import ops from '../migrations/20261126T1200_create_prisma_tables/ops.json' with { type: 'json' };
import endContract from '../migrations/snapshots/3e3fe1bcd6f092d5ff575bf3bfe9b2fe5020a50a9c25071879df08299c689ce7/contract.json' with {
  type: 'json',
};

interface ContractColumn {
  readonly dataType: string;
  readonly nullable: boolean;
  readonly many?: unknown;
}

const tableNames = ['signatures', 'config', 'ledger', 'contract'] as const;

/** What the release candidates of Prisma 8 created as `prisma_contract.marker`, which the first migration moves into `signatures` and `config`. */
const releaseCandidateMarkerColumns = [
  { name: 'app_tag', type: 'text', notNull: false },
  { name: 'canonical_version', type: 'integer', notNull: false },
  { name: 'contract_json', type: 'jsonb', notNull: false },
  { name: 'core_hash', type: 'text', notNull: true },
  { name: 'invariants', type: 'text[]', notNull: true },
  { name: 'meta', type: 'jsonb', notNull: true },
  { name: 'profile_hash', type: 'text', notNull: true },
  { name: 'space', type: 'text', notNull: true },
  { name: 'updated_at', type: 'timestamp with time zone', notNull: true },
];

const endTables = (
  endContract.storage.namespaces as unknown as Record<
    string,
    {
      readonly entries: {
        readonly table: Record<string, { columns: Record<string, ContractColumn> }>;
      };
    }
  >
)['_prisma']?.entries.table;

const formatTypeOf: Record<string, string> = {
  'pg/text': 'text',
  'pg/jsonb': 'jsonb',
  'pg/int4': 'integer',
  'pg/int8': 'bigint',
  'pg/bool': 'boolean',
  'pg/timestamptz': 'timestamp with time zone',
};

function endContractColumns(table: string) {
  return Object.entries(endTables?.[table]?.columns ?? {})
    .map(([name, column]) => ({
      name,
      type: `${formatTypeOf[column.dataType] ?? column.dataType}${column.many === undefined ? '' : '[]'}`,
      notNull: !column.nullable,
    }))
    .sort((a, b) => a.name.localeCompare(b.name));
}

function checkedColumns(operationId: string) {
  const operation = ops.find((op) => op.id === operationId) as
    | { readonly precheck: readonly { readonly params: readonly unknown[] }[] }
    | undefined;
  return (operation?.precheck ?? [])
    .map(({ params: [, , name, type, notNull] }) => ({ name, type, notNull }))
    .sort((a, b) => String(a.name).localeCompare(String(b.name)));
}

describe("the first migration of the Postgres target's _prisma space", () => {
  it('produces from its migration.ts exactly the operations in its ops.json', () => {
    const produced = JSON.parse(JSON.stringify(new FirstMigration().operations));
    expect(produced).toEqual(ops);
  });

  it("labels its operations in the planner's imperative form", () => {
    expect(ops.map((op) => op.label)).toEqual([
      'Check the columns of table "prisma_contract"."marker"',
      'Check the columns of table "prisma_contract"."ledger"',
      'Check the columns of table "prisma_contract"."contract"',
      'Rename schema "prisma_contract" to "_prisma"',
      'Create schema "_prisma"',
      'Create table "_prisma"."signatures"',
      'Create table "_prisma"."config"',
      'Create table "_prisma"."ledger"',
      'Create table "_prisma"."contract"',
      'Check the columns of table "_prisma"."marker"',
      'Check the columns of table "_prisma"."signatures"',
      'Check the columns of table "_prisma"."config"',
      'Check the columns of table "_prisma"."ledger"',
      'Check the columns of table "_prisma"."contract"',
      'Move table "_prisma"."marker" into "_prisma"."signatures" and "_prisma"."config"',
    ]);
  });

  it('gives, where the role may not act as the owner of the old schema or a table in it, the statements that make the migrating role own the schema and every table', () => {
    const rename = ops.find((op) => op.id === '_prisma.rename-release-candidate-schema');
    const ownership = (rename?.precheck ?? [])
      .map((check) => check.description)
      .filter(
        (description) =>
          description.includes('owns schema "prisma_contract"') ||
          description.includes('owns table'),
      );
    const statements = [
      'ALTER SCHEMA "prisma_contract" OWNER TO <migrating role>',
      'ALTER TABLE "prisma_contract"."marker" OWNER TO <migrating role>',
      'ALTER TABLE "prisma_contract"."ledger" OWNER TO <migrating role>',
      'ALTER TABLE "prisma_contract"."contract" OWNER TO <migrating role>',
    ];
    expect({
      checks: ownership.length,
      missing: ownership.flatMap((description) =>
        statements.filter((statement) => !description.includes(statement)),
      ),
    }).toEqual({ checks: 4, missing: [] });
  });

  it('says why it needs the owner of each table, and finds only the owners of tables', () => {
    const rename = ops.find((op) => op.id === '_prisma.rename-release-candidate-schema');
    const descriptions = (rename?.precheck ?? []).map((check) => check.description);
    const reasonFor = (table: string) =>
      descriptions
        .filter((description) => description.includes(`owns table "prisma_contract"."${table}"`))
        .map((description) => description.slice(0, description.indexOf(' Give the schema')));
    const later = (table: string) =>
      `The role that runs this command must have the privileges of the role that owns table "prisma_contract"."${table}", because a later migration of Prisma's own tables may add a column to it, and that needs those privileges.`;
    expect({
      marker: reasonFor('marker'),
      ledger: reasonFor('ledger'),
      contract: reasonFor('contract'),
      ownerQuery: descriptions.some((description) =>
        description.includes(
          "SELECT relname, relowner::regrole FROM pg_class WHERE relnamespace = to_regnamespace('prisma_contract') AND relkind = 'r'",
        ),
      ),
    }).toEqual({
      marker: [
        'The role that runs this command must have the privileges of the role that owns table "prisma_contract"."marker", because this migration drops it once its rows are moved into "_prisma"."signatures" and "_prisma"."config", and dropping a table needs those privileges.',
      ],
      ledger: [later('ledger')],
      contract: [later('contract')],
      ownerQuery: true,
    });
  });

  it('locks marker against changes to its row-level security, then checks it again, before it copies and drops it', () => {
    const move = ops.find((op) => op.id === '_prisma.move-marker');
    const statements = (move?.execute ?? []).map((step) => step.sql.split('\n')[0]);
    const recheck = move?.execute[1]?.sql ?? '';
    expect({
      statements,
      recheckRaises: recheck.includes('RAISE EXCEPTION'),
      recheckNamesTheTable: recheck.includes(
        "WHERE n.nspname = '_prisma' AND c.relname = 'marker' AND c.relrowsecurity",
      ),
    }).toEqual({
      statements: [
        'LOCK TABLE "_prisma"."marker" IN SHARE MODE',
        'DO $$',
        'INSERT INTO "_prisma"."signatures" ("space", "core_hash", "profile_hash", "invariants", "signed_at")',
        'INSERT INTO "_prisma"."config" ("policies")',
        'DROP TABLE "_prisma"."marker"',
      ],
      recheckRaises: true,
      recheckNamesTheTable: true,
    });
  });

  it('ends at the contract its snapshot holds', () => {
    expect(endContract.storage.storageHash).toBe(metadata.to);
  });

  it('describes the same tables in its end contract', () => {
    expect(Object.keys(endTables ?? {}).sort()).toEqual([...tableNames].sort());
  });

  it.each(tableNames)(
    'checks the columns of %s exactly as its end contract describes them',
    (table) => {
      expect(checkedColumns(`_prisma.check-columns.${table}`)).toEqual(endContractColumns(table));
    },
  );

  it.each(['ledger', 'contract'] as const)(
    "checks the columns of the release candidates' %s exactly as its end contract describes them",
    (table) => {
      expect(checkedColumns(`_prisma.check-release-candidate-columns.${table}`)).toEqual(
        endContractColumns(table),
      );
    },
  );

  it("checks the release candidates' marker in both schemas, before it moves its rows", () => {
    expect({
      releaseCandidate: checkedColumns('_prisma.check-release-candidate-columns.marker'),
      current: checkedColumns('_prisma.check-columns.marker'),
    }).toEqual({
      releaseCandidate: releaseCandidateMarkerColumns,
      current: releaseCandidateMarkerColumns,
    });
  });
});
