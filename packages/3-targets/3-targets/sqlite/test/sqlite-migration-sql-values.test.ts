import type {
  MigrationOperationClass,
  SqlMigrationPlanOperation,
} from '@internal/family-sql/control';
import type {
  ExecuteRequestLowerer,
  SqlControlAdapter,
} from '@internal/family-sql/control-adapter';
import type { ControlStack } from '@internal/framework-components/control';
import { SqlExpression } from '@internal/sql-contract/sql-expression';
import type { SqlTextInput } from '@internal/sql-relational-core/contract-free';
import { describe, expect, it } from 'vitest';
import type { SqliteIndexSpec } from '../src/core/migrations/operations/shared';
import type { RecreatePostcheck } from '../src/core/migrations/operations/tables';
import type { SqlitePlanTargetDetails } from '../src/core/migrations/planner-target-details';
import { SqliteMigration } from '../src/core/migrations/sqlite-migration';
import type { Contract } from './fixtures/sqlite-contract.d';
import contractJson from './fixtures/sqlite-contract.json' with { type: 'json' };

type Op = SqlMigrationPlanOperation<SqlitePlanTargetDetails>;

interface ColumnSpecInput {
  readonly name: string;
  readonly typeSql: string;
  readonly default?: { readonly kind: 'function'; readonly expression: SqlTextInput };
  readonly nullable: boolean;
}

class ExposedMigration extends SqliteMigration<Contract, Contract> {
  override readonly endContractJson = contractJson;
  override get operations() {
    return [];
  }

  callAddColumn(options: {
    readonly table: string;
    readonly column: ColumnSpecInput;
  }): Promise<Op> {
    return this.addColumn(options);
  }

  callRecreateTable(options: {
    readonly tableName: string;
    readonly contractTable: { readonly columns: readonly ColumnSpecInput[] };
    readonly schemaColumnNames: readonly string[];
    readonly indexes: readonly SqliteIndexSpec[];
    readonly summary: string;
    readonly postchecks: readonly RecreatePostcheck[];
    readonly operationClass: MigrationOperationClass;
  }): Promise<Op> {
    return this.recreateTable(options);
  }
}

function astRecordingControlStack(): ControlStack<'sql', 'sqlite'> {
  const lowerer: ExecuteRequestLowerer = {
    lower: () => ({ sql: 'UNUSED', params: [] }),
    renderColumnDefault: async (column) => `DEFAULT ${JSON.stringify(column.default)}`,
    lowerToExecuteRequest: async (ast) => ({ sql: JSON.stringify(ast), params: [] }),
  };
  const adapter = lowerer as unknown as SqlControlAdapter<'sqlite'>;
  return {
    adapter: { create: () => adapter },
  } as unknown as ControlStack<'sql', 'sqlite'>;
}

const DEFAULT_SQL = "lower(\n  'a' || 'b'\n)";

describe('SqliteMigration function defaults written as sql values', () => {
  const cases: ReadonlyArray<{
    readonly name: string;
    readonly run: (m: ExposedMigration, expression: SqlTextInput) => Promise<Op>;
  }> = [
    {
      name: 'addColumn',
      run: (m, expression) =>
        m.callAddColumn({
          table: 'user',
          column: {
            name: 'slug',
            typeSql: 'TEXT',
            default: { kind: 'function', expression },
            nullable: true,
          },
        }),
    },
    {
      name: 'recreateTable',
      run: (m, expression) =>
        m.callRecreateTable({
          tableName: 'user',
          contractTable: {
            columns: [
              { name: 'id', typeSql: 'INTEGER', nullable: false },
              {
                name: 'slug',
                typeSql: 'TEXT',
                default: { kind: 'function', expression },
                nullable: true,
              },
            ],
          },
          schemaColumnNames: ['id'],
          indexes: [],
          summary: 'Recreates table user',
          postchecks: [],
          operationClass: 'widening',
        }),
    },
  ];

  it.each(cases)('$name gives the same op for a string and a sql value', async ({ run }) => {
    const m = new ExposedMigration(astRecordingControlStack());
    const fromString = await run(m, DEFAULT_SQL);
    const fromSql = await run(m, new SqlExpression(DEFAULT_SQL));

    expect(JSON.stringify(fromString)).toContain("'a' || 'b'");
    expect(fromSql).toEqual(fromString);
  });

  it('names the argument when a default is neither a string nor a sql value', () => {
    const m = new ExposedMigration(astRecordingControlStack());

    expect(() =>
      m.callAddColumn({
        table: 'user',
        column: {
          name: 'slug',
          typeSql: 'TEXT',
          default: { kind: 'function', expression: { text: 'x' } as unknown as SqlTextInput },
          nullable: true,
        },
      }),
    ).toThrow(
      expect.objectContaining({
        code: 'CONTRACT.ARGUMENT_INVALID',
        message: 'addColumn "user"."slug" default must be a string or a sql`...` value.',
        meta: { what: 'addColumn "user"."slug" default' },
      }),
    );
  });
});
