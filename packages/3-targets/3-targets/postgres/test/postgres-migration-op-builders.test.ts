import type { Contract as FrameworkContract } from '@internal/contract/types';
import type { SqlMigrationPlanOperation } from '@internal/family-sql/control';
import type {
  ExecuteRequestLowerer,
  SqlControlAdapter,
} from '@internal/family-sql/control-adapter';
import type { ControlStack } from '@internal/framework-components/control';
import type { SqlStorage } from '@internal/sql-contract/types';
import type { DdlColumn, DdlTableConstraint } from '@internal/sql-relational-core/ast';
import { col, lit } from '@internal/sql-relational-core/contract-free';
import { blindCast } from '@internal/utils/casts';
import { describe, expect, it } from 'vitest';
import type { AlterColumnTypeOptions } from '../src/core/migrations/op-factory-call';
import type { DataTransformOptions } from '../src/core/migrations/operations/data-transform';
import type { CreateIndexExtras } from '../src/core/migrations/operations/indexes';
import type { ForeignKeySpec } from '../src/core/migrations/operations/shared';
import type { PostgresPlanTargetDetails } from '../src/core/migrations/planner-target-details';
import { PostgresMigration } from '../src/core/migrations/postgres-migration';
import type { Contract } from './fixtures/namespaced-contract.d';
import contractJson from './fixtures/namespaced-contract.json' with { type: 'json' };

type Op = SqlMigrationPlanOperation<PostgresPlanTargetDetails>;

/**
 * Exposes every protected op-builder method of `PostgresMigration` as a
 * public method so tests outside the class hierarchy can call them directly.
 * Each wrapper's parameter type is copied verbatim from the corresponding
 * protected method in `postgres-migration.ts`.
 */
class ExposedMigration extends PostgresMigration<Contract, Contract> {
  override readonly endContractJson = contractJson;
  override get operations() {
    return [];
  }

  callDataTransform(
    contract: FrameworkContract<SqlStorage>,
    name: string,
    options: DataTransformOptions,
  ): Promise<Op> {
    return this.dataTransform(contract, name, options);
  }

  callCreateTable(options: {
    readonly schema: string;
    readonly table: string;
    readonly ifNotExists?: boolean;
    readonly columns: readonly DdlColumn[];
    readonly constraints?: readonly DdlTableConstraint[];
  }): Promise<Op> {
    return this.createTable(options);
  }

  callCreateSchema(options: {
    readonly schema: string;
    readonly ifNotExists?: boolean;
  }): Promise<Op> {
    return this.createSchema(options);
  }

  callCreateNativeEnumType(options: {
    readonly schema: string;
    readonly typeName: string;
    readonly members: readonly string[];
  }): Promise<Op> {
    return this.createNativeEnumType(options);
  }

  callDropNativeEnumType(options: {
    readonly schema: string;
    readonly typeName: string;
  }): Promise<Op> {
    return this.dropNativeEnumType(options);
  }

  callAddNativeEnumValue(options: {
    readonly schema: string;
    readonly typeName: string;
    readonly value: string;
  }): Promise<Op> {
    return this.addNativeEnumValue(options);
  }

  callAddColumn(options: {
    readonly schema: string;
    readonly table: string;
    readonly column: DdlColumn;
  }): Promise<Op> {
    return this.addColumn(options);
  }

  callAddPrimaryKey(options: {
    readonly schema: string;
    readonly table: string;
    readonly constraint: string;
    readonly columns: readonly string[];
  }): Promise<Op> {
    return this.addPrimaryKey(options);
  }

  callAddUnique(options: {
    readonly schema: string;
    readonly table: string;
    readonly constraint: string;
    readonly columns: readonly string[];
  }): Promise<Op> {
    return this.addUnique(options);
  }

  callAddForeignKey(options: {
    readonly schema: string;
    readonly table: string;
    readonly foreignKey: ForeignKeySpec;
  }): Promise<Op> {
    return this.addForeignKey(options);
  }

  callAddCheckConstraint(options: {
    readonly schema: string;
    readonly table: string;
    readonly constraint: string;
    readonly expression: string;
  }): Promise<Op> {
    return this.addCheckConstraint(options);
  }

  callDropCheckConstraint(options: {
    readonly schema: string;
    readonly table: string;
    readonly constraint: string;
  }): Promise<Op> {
    return this.dropCheckConstraint(options);
  }

  callDropConstraint(options: {
    readonly schema: string;
    readonly table: string;
    readonly constraint: string;
    readonly kind?: 'foreignKey' | 'unique' | 'primaryKey';
  }): Promise<Op> {
    return this.dropConstraint(options);
  }

  callDropTable(options: { readonly schema: string; readonly table: string }): Promise<Op> {
    return this.dropTable(options);
  }

  callDropColumn(options: {
    readonly schema: string;
    readonly table: string;
    readonly column: string;
  }): Promise<Op> {
    return this.dropColumn(options);
  }

  callAlterColumnType(options: {
    readonly schema: string;
    readonly table: string;
    readonly column: string;
    readonly options: AlterColumnTypeOptions;
  }): Promise<Op> {
    return this.alterColumnType(options);
  }

  callSetNotNull(options: {
    readonly schema: string;
    readonly table: string;
    readonly column: string;
  }): Promise<Op> {
    return this.setNotNull(options);
  }

  callDropNotNull(options: {
    readonly schema: string;
    readonly table: string;
    readonly column: string;
  }): Promise<Op> {
    return this.dropNotNull(options);
  }

  callSetDefault(options: {
    readonly schema: string;
    readonly table: string;
    readonly column: DdlColumn;
    readonly operationClass?: 'additive' | 'widening';
  }): Promise<Op> {
    return this.setDefault(options);
  }

  callDropDefault(options: {
    readonly schema: string;
    readonly table: string;
    readonly column: string;
  }): Promise<Op> {
    return this.dropDefault(options);
  }

  callCreateIndex(options: {
    readonly schema: string;
    readonly table: string;
    readonly index: string;
    readonly columns: readonly string[];
    readonly extras?: CreateIndexExtras;
  }): Promise<Op> {
    return this.createIndex(options);
  }

  callDropIndex(options: {
    readonly schema: string;
    readonly table: string;
    readonly index: string;
  }): Promise<Op> {
    return this.dropIndex(options);
  }

  callInstallExtension(options: {
    readonly extensionName: string;
    readonly invariantId: string;
    readonly id: string;
    readonly label?: string;
  }): Promise<Op> {
    return this.installExtension(options);
  }
}

// The raw JSON fixture import is not structurally assignable to the branded
// Contract type (NamespaceId brand, etc). The dataTransform case throws
// MIGRATION.POSTGRES_CONTROL_STACK_MISSING before ever reading the contract,
// so a blindCast fixture value is sufficient — no live serializer/deserializer
// seam is needed here.
const contract = blindCast<
  FrameworkContract<SqlStorage>,
  'raw JSON fixture import; dataTransform throws before reading the contract'
>(contractJson);

// ============================================================================
// (A) No ControlStack: every op-builder throws
// MIGRATION.POSTGRES_CONTROL_STACK_MISSING synchronously.
// ============================================================================

const cases: ReadonlyArray<{
  readonly name: string;
  readonly run: (m: ExposedMigration) => unknown;
}> = [
  {
    name: 'dataTransform',
    run: (m) =>
      m.callDataTransform(contract, 'backfill', {
        run: () => {
          throw new Error('unreachable: dataTransform factory never runs without a stack');
        },
      }),
  },
  {
    name: 'createTable',
    run: (m) =>
      m.callCreateTable({ schema: 'public', table: 'widget', columns: [col('id', 'integer')] }),
  },
  { name: 'createSchema', run: (m) => m.callCreateSchema({ schema: 'reporting' }) },
  {
    name: 'createNativeEnumType',
    run: (m) =>
      m.callCreateNativeEnumType({ schema: 'public', typeName: 'color', members: ['red'] }),
  },
  {
    name: 'dropNativeEnumType',
    run: (m) => m.callDropNativeEnumType({ schema: 'public', typeName: 'color' }),
  },
  {
    name: 'addNativeEnumValue',
    run: (m) => m.callAddNativeEnumValue({ schema: 'public', typeName: 'color', value: 'blue' }),
  },
  {
    name: 'addColumn',
    run: (m) => m.callAddColumn({ schema: 'public', table: 'widget', column: col('name', 'text') }),
  },
  {
    name: 'addPrimaryKey',
    run: (m) =>
      m.callAddPrimaryKey({
        schema: 'public',
        table: 'widget',
        constraint: 'widget_pkey',
        columns: ['id'],
      }),
  },
  {
    name: 'addUnique',
    run: (m) =>
      m.callAddUnique({
        schema: 'public',
        table: 'widget',
        constraint: 'widget_name_key',
        columns: ['name'],
      }),
  },
  {
    name: 'addForeignKey',
    run: (m) =>
      m.callAddForeignKey({
        schema: 'public',
        table: 'widget',
        foreignKey: {
          name: 'widget_owner_fk',
          columns: ['owner_id'],
          references: { schema: 'public', table: 'user', columns: ['id'] },
        },
      }),
  },
  {
    name: 'addCheckConstraint',
    run: (m) =>
      m.callAddCheckConstraint({
        schema: 'public',
        table: 'widget',
        constraint: 'widget_status_check',
        expression: `"status" IN ('active', 'inactive')`,
      }),
  },
  {
    name: 'dropCheckConstraint',
    run: (m) =>
      m.callDropCheckConstraint({
        schema: 'public',
        table: 'widget',
        constraint: 'widget_status_check',
      }),
  },
  {
    name: 'dropConstraint',
    run: (m) =>
      m.callDropConstraint({ schema: 'public', table: 'widget', constraint: 'widget_name_key' }),
  },
  { name: 'dropTable', run: (m) => m.callDropTable({ schema: 'public', table: 'widget' }) },
  {
    name: 'dropColumn',
    run: (m) => m.callDropColumn({ schema: 'public', table: 'widget', column: 'name' }),
  },
  {
    name: 'alterColumnType',
    run: (m) =>
      m.callAlterColumnType({
        schema: 'public',
        table: 'widget',
        column: 'name',
        options: {
          qualifiedTargetType: 'text',
          formatTypeExpected: 'text',
          rawTargetTypeForLabel: 'text',
        },
      }),
  },
  {
    name: 'setNotNull',
    run: (m) => m.callSetNotNull({ schema: 'public', table: 'widget', column: 'name' }),
  },
  {
    name: 'dropNotNull',
    run: (m) => m.callDropNotNull({ schema: 'public', table: 'widget', column: 'name' }),
  },
  {
    name: 'setDefault',
    run: (m) =>
      m.callSetDefault({
        schema: 'public',
        table: 'widget',
        column: col('name', 'text', { default: lit('unnamed') }),
      }),
  },
  {
    name: 'dropDefault',
    run: (m) => m.callDropDefault({ schema: 'public', table: 'widget', column: 'name' }),
  },
  {
    name: 'createIndex',
    run: (m) =>
      m.callCreateIndex({
        schema: 'public',
        table: 'widget',
        index: 'widget_name_idx',
        columns: ['name'],
      }),
  },
  {
    name: 'dropIndex',
    run: (m) => m.callDropIndex({ schema: 'public', table: 'widget', index: 'widget_name_idx' }),
  },
  {
    name: 'installExtension',
    run: (m) =>
      m.callInstallExtension({
        extensionName: 'pgcrypto',
        invariantId: 'ext.pgcrypto',
        id: 'ext.pgcrypto',
      }),
  },
];

describe('PostgresMigration op-builder methods without a ControlStack', () => {
  it.each(cases)(
    '$name throws MIGRATION.POSTGRES_CONTROL_STACK_MISSING synchronously',
    ({ name, run }) => {
      const m = new ExposedMigration();
      expect(() => run(m)).toThrow(
        expect.objectContaining({
          name: 'CliStructuredError',
          code: 'MIGRATION.POSTGRES_CONTROL_STACK_MISSING',
          message: `PostgresMigration.${name} requires a control adapter`,
          meta: { operation: name },
        }),
      );
    },
  );

  it('covers every declared case exactly once', () => {
    expect(cases.map((c) => c.name).sort()).toEqual(
      [
        'addCheckConstraint',
        'addColumn',
        'addForeignKey',
        'addNativeEnumValue',
        'addPrimaryKey',
        'addUnique',
        'alterColumnType',
        'createIndex',
        'createNativeEnumType',
        'createSchema',
        'createTable',
        'dataTransform',
        'dropCheckConstraint',
        'dropColumn',
        'dropConstraint',
        'dropDefault',
        'dropIndex',
        'dropNativeEnumType',
        'dropNotNull',
        'dropTable',
        'installExtension',
        'setDefault',
        'setNotNull',
      ].sort(),
    );
  });
});

// ============================================================================
// (B) With a ControlStack: the op-builder lowers to a real op shape.
// ============================================================================

function fakeControlStack(): ControlStack<'sql', 'postgres'> {
  let counter = 0;
  const lowerer: ExecuteRequestLowerer = {
    lower: () => ({ sql: 'UNUSED', params: [] }),
    renderColumnDefault: async () => '',
    lowerToExecuteRequest: async () => {
      counter += 1;
      return { sql: `LOWERED ${counter}`, params: [`p${counter}`] };
    },
  };
  const adapter = lowerer as unknown as SqlControlAdapter<'postgres'>;
  return {
    adapter: { create: () => adapter },
  } as unknown as ControlStack<'sql', 'postgres'>;
}

describe('PostgresMigration op-builder methods with a ControlStack', () => {
  it('createTable lowers to an additive create-table operation', async () => {
    const m = new ExposedMigration(fakeControlStack());
    const op = await m.callCreateTable({
      schema: 'public',
      table: 'widget',
      columns: [col('id', 'integer', { notNull: true })],
    });

    expect(op.id).toBe('table.widget');
    expect(op.operationClass).toBe('additive');
    expect(op.execute[0]?.description).toBe('create table "widget"');
    expect(typeof op.execute[0]?.sql).toBe('string');
  });

  it('addColumn lowers to an additive add-column operation', async () => {
    const m = new ExposedMigration(fakeControlStack());
    const op = await m.callAddColumn({
      schema: 'public',
      table: 'widget',
      column: col('name', 'text'),
    });

    expect(op.id).toBe('column.public.widget.name');
    expect(op.operationClass).toBe('additive');
    expect(op.execute[0]?.description).toBe('add column "name"');
    expect(typeof op.execute[0]?.sql).toBe('string');
  });

  it('setDefault refuses the options an earlier version wrote, naming the column and the rewrite', () => {
    const m = new ExposedMigration(fakeControlStack());
    const earlier = {
      schema: 'public',
      table: 'Box',
      column: 'changed',
      defaultSql: 'DEFAULT 2',
      operationClass: 'widening',
    } as unknown as Parameters<ExposedMigration['callSetDefault']>[0];

    expect(() => m.callSetDefault(earlier)).toThrow(
      expect.objectContaining({
        code: 'MIGRATION.OPERATION_OPTION_REMOVED',
        message:
          '`setDefault` in migration.ts passes `defaultSql`, which this version no longer reads, for column "changed" of table "Box"',
        fix: 'Pass the column as `col(name, type, { default, codecRef })`, with its default written as `lit(value)` or `fn(expression)`, in place of its name and `defaultSql`. Or, if the migration is not applied, delete its package and run `migration plan` again. The upgrade entry `migration-ts-column-defaults` shows the new shape: https://github.com/prisma/orm/tree/main/skills/prisma-8/upgrading',
        meta: {
          operation: 'setDefault',
          option: 'defaultSql',
          upgradeEntry: 'migration-ts-column-defaults',
        },
      }),
    );
  });

  it('createSchema lowers to an additive create-schema operation', async () => {
    const m = new ExposedMigration(fakeControlStack());
    const op = await m.callCreateSchema({ schema: 'reporting' });

    expect(op.id).toBe('schema.reporting');
    expect(op.operationClass).toBe('additive');
    expect(op.execute[0]?.description).toBe('Create schema "reporting"');
    expect(typeof op.execute[0]?.sql).toBe('string');
  });

  it('dropTable lowers to a destructive drop-table operation', async () => {
    const m = new ExposedMigration(fakeControlStack());
    const op = await m.callDropTable({ schema: 'public', table: 'widget' });

    expect(op.operationClass).toBe('destructive');
    expect(op.execute[0]?.description).toBe('drop table "widget"');
    expect(typeof op.execute[0]?.sql).toBe('string');
  });
});
