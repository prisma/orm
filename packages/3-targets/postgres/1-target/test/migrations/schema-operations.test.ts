import type { ExecuteRequestLowerer } from '@internal/family-sql/control-adapter';
import { UNBOUND_NAMESPACE_ID } from '@internal/framework-components/ir';
import { describe, expect, it } from 'vitest';
import {
  schemaExistsAst,
  schemaHoldsNoObjectsAst,
  tableExistsAst,
  unboundTableMovedAst,
} from '../../src/contract-free/checks';
import {
  PostgresAlterSchemaRename,
  PostgresAlterTableSetSchema,
  PostgresDropSchema,
} from '../../src/core/ddl/nodes';
import { planIssues } from '../../src/core/migrations/issue-planner';
import {
  CreateSchemaCall,
  DropSchemaCall,
  DropTableCall,
  RenameSchemaCall,
  SetTableSchemaCall,
} from '../../src/core/migrations/op-factory-call';
import {
  dropSchema,
  renameSchema,
  setTableSchema,
} from '../../src/core/migrations/operations/schemas';
import { postgresTypeLookups } from '../postgres-type-lookups';
import { makeContract, planTrees } from './node-issue-planner-fixtures';

function recordingLowerer(): { lowerer: ExecuteRequestLowerer; received: unknown[] } {
  const received: unknown[] = [];
  const lowerer: ExecuteRequestLowerer = {
    lower: () => Object.freeze({ sql: 'UNUSED', params: Object.freeze([]) }),
    renderColumnDefault: async () => '',
    lowerToExecuteRequest: async (ast) => {
      received.push(ast);
      return Object.freeze({
        sql: `LOWERED ${received.length}`,
        params: Object.freeze([`p${received.length}`]),
      });
    },
  };
  return { lowerer, received };
}

function lowered(n: number) {
  return { sql: `LOWERED ${n}`, params: [`p${n}`] };
}

describe('setTableSchema', () => {
  it('moves the table with ALTER TABLE … SET SCHEMA, checked on both sides', async () => {
    const { lowerer, received } = recordingLowerer();
    const op = await setTableSchema('billing', 'invoice', 'finance', lowerer);

    expect(received).toEqual([
      tableExistsAst('billing', 'invoice').tablePresent(),
      schemaExistsAst('finance').schemaPresent(),
      tableExistsAst('finance', 'invoice').tableAbsent(),
      new PostgresAlterTableSetSchema({ schema: 'billing', table: 'invoice', to: 'finance' }),
      tableExistsAst('finance', 'invoice').tablePresent(),
      tableExistsAst('billing', 'invoice').tableAbsent(),
    ]);
    expect(op).toEqual({
      id: 'setTableSchema.invoice',
      label: 'Move table "invoice" to schema "finance"',
      operationClass: 'widening',
      target: {
        id: 'postgres',
        details: { schema: 'finance', objectType: 'table', name: 'invoice' },
      },
      precheck: [
        { description: 'ensure table "invoice" exists', ...lowered(1) },
        { description: 'ensure schema "finance" exists', ...lowered(2) },
        { description: 'ensure schema "finance" has no table "invoice"', ...lowered(3) },
      ],
      execute: [{ description: 'move table "invoice" to schema "finance"', ...lowered(4) }],
      postcheck: [
        { description: 'verify table "invoice" exists in schema "finance"', ...lowered(5) },
        { description: 'verify table "invoice" no longer exists where it was', ...lowered(6) },
      ],
    });
  });

  it('leaves the source unqualified for the unbound namespace, and lets the search path find the moved table afterwards', async () => {
    const { lowerer, received } = recordingLowerer();
    await setTableSchema(UNBOUND_NAMESPACE_ID, 'invoice', 'billing', lowerer);

    expect(received).toContainEqual(
      new PostgresAlterTableSetSchema({ schema: undefined, table: 'invoice', to: 'billing' }),
    );
    expect(received.at(-1)).toEqual(unboundTableMovedAst('invoice', 'billing'));
  });
});

describe('renameSchema', () => {
  it('renames with ALTER SCHEMA … RENAME TO, checked under both names', async () => {
    const { lowerer, received } = recordingLowerer();
    const op = await renameSchema('billing', 'finance', lowerer);

    expect(received).toEqual([
      schemaExistsAst('billing').schemaPresent(),
      schemaExistsAst('finance').schemaAbsent(),
      new PostgresAlterSchemaRename({ schema: 'billing', to: 'finance' }),
      schemaExistsAst('finance').schemaPresent(),
      schemaExistsAst('billing').schemaAbsent(),
    ]);
    expect(op).toEqual({
      id: 'renameSchema.billing',
      label: 'Rename schema "billing" to "finance"',
      operationClass: 'widening',
      target: { id: 'postgres' },
      precheck: [
        { description: 'ensure schema "billing" exists', ...lowered(1) },
        { description: 'ensure schema "finance" does not exist', ...lowered(2) },
      ],
      execute: [{ description: 'rename schema "billing" to "finance"', ...lowered(3) }],
      postcheck: [
        { description: 'verify schema "finance" exists', ...lowered(4) },
        { description: 'verify schema "billing" no longer exists', ...lowered(5) },
      ],
    });
  });
});

describe('dropSchema', () => {
  it('drops without CASCADE after checking the schema holds nothing', async () => {
    const { lowerer, received } = recordingLowerer();
    const op = await dropSchema('billing', lowerer);

    expect(received).toEqual([
      schemaHoldsNoObjectsAst('billing'),
      new PostgresDropSchema({ schema: 'billing' }),
      schemaExistsAst('billing').schemaAbsent(),
    ]);
    expect(op).toEqual({
      id: 'dropSchema.billing',
      label: 'Drop schema "billing"',
      operationClass: 'widening',
      target: { id: 'postgres' },
      precheck: [
        {
          description:
            'ensure schema "billing" holds no tables, views, sequences, types or functions',
          ...lowered(1),
          meta: { schemaContents: { schema: 'billing' } },
        },
      ],
      execute: [{ description: 'drop schema "billing"', ...lowered(2) }],
      postcheck: [{ description: 'verify schema "billing" does not exist', ...lowered(3) }],
    });
  });
});

describe('schema operation calls', () => {
  it('are widening calls named after their facade methods', () => {
    expect(new SetTableSchemaCall('billing', 'invoice', 'finance')).toMatchObject({
      factoryName: 'setTableSchema',
      operationClass: 'widening',
      schemaName: 'billing',
      tableName: 'invoice',
      toSchemaName: 'finance',
      label: 'Move table "invoice" to schema "finance"',
    });
    expect(new RenameSchemaCall('billing', 'finance')).toMatchObject({
      factoryName: 'renameSchema',
      operationClass: 'widening',
      schemaName: 'billing',
      toSchemaName: 'finance',
      label: 'Rename schema "billing" to "finance"',
    });
    expect(new DropSchemaCall('billing')).toMatchObject({
      factoryName: 'dropSchema',
      operationClass: 'widening',
      schemaName: 'billing',
      label: 'Drop schema "billing"',
    });
  });

  it('lower to the operations their factories build', async () => {
    const pairs = [
      [
        new SetTableSchemaCall('billing', 'invoice', 'finance'),
        (l: ExecuteRequestLowerer) => setTableSchema('billing', 'invoice', 'finance', l),
      ],
      [
        new RenameSchemaCall('billing', 'finance'),
        (l: ExecuteRequestLowerer) => renameSchema('billing', 'finance', l),
      ],
      [new DropSchemaCall('billing'), (l: ExecuteRequestLowerer) => dropSchema('billing', l)],
    ] as const;
    for (const [call, factory] of pairs) {
      expect(await call.toOp(recordingLowerer().lowerer)).toEqual(
        await factory(recordingLowerer().lowerer),
      );
    }
  });

  it('refuse to lower without a lowerer', async () => {
    for (const call of [
      new SetTableSchemaCall('billing', 'invoice', 'finance'),
      new RenameSchemaCall('billing', 'finance'),
      new DropSchemaCall('billing'),
    ]) {
      await expect(call.toOp()).rejects.toMatchObject({
        code: 'MIGRATION.POSTGRES_CONTROL_STACK_MISSING',
      });
    }
  });

  it('render the facade call, leaving out an unbound source schema', () => {
    expect(new SetTableSchemaCall('billing', 'invoice', 'finance').renderTypeScript()).toBe(
      'this.setTableSchema({ schema: "billing", table: "invoice", to: "finance" })',
    );
    expect(
      new SetTableSchemaCall(UNBOUND_NAMESPACE_ID, 'invoice', 'billing').renderTypeScript(),
    ).toBe('this.setTableSchema({ table: "invoice", to: "billing" })');
    expect(new RenameSchemaCall('billing', 'finance').renderTypeScript()).toBe(
      'this.renameSchema({ schema: "billing", to: "finance" })',
    );
    expect(new DropSchemaCall('billing').renderTypeScript()).toBe(
      'this.dropSchema({ schema: "billing" })',
    );
  });

  it('need no import, since each renders as a method of the migration', () => {
    expect(new SetTableSchemaCall('billing', 'invoice', 'finance').importRequirements()).toEqual(
      [],
    );
    expect(new RenameSchemaCall('billing', 'finance').importRequirements()).toEqual([]);
    expect(new DropSchemaCall('billing').importRequirements()).toEqual([]);
  });
});

describe('schema operation order in a plan', () => {
  it('runs moves and schema renames with the renames, and a schema drop after the table drops and moves', () => {
    const contract = makeContract({});
    const calls = [
      new DropSchemaCall('legacy'),
      new SetTableSchemaCall('legacy', 'invoice', 'billing'),
      new DropTableCall('legacy', 'audit'),
      new RenameSchemaCall('old', 'new'),
      new CreateSchemaCall('billing'),
    ];
    const result = planIssues({
      issues: [],
      ...planTrees(),
      toContract: contract,
      fromContract: null,
      schemaName: 'public',
      codecHooks: new Map(),
      types: postgresTypeLookups,
      strategies: [(issues) => ({ kind: 'match', issues, calls })],
    });

    expect(result.ok && result.value.calls.map((call) => call.factoryName)).toEqual([
      'createSchema',
      'dropTable',
      'setTableSchema',
      'renameSchema',
      'dropSchema',
    ]);
  });
});
