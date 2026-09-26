import { keepInternalSpecifiers } from '@internal/framework-components/emission';
import type { MongoMigrationPlanOperation } from '@internal/mongo-query-ast/control';
import { describe, expect, it } from 'vitest';
import { CreateIndexCall, DropIndexCall } from '../src/core/migrations/op-factory-call';
import { PlannerProducedMongoMigration } from '../src/core/migrations/planner-produced-migration';

const SNAPSHOTS_IMPORT_PATH = '../../snapshots';
const META = {
  from: 'a'.repeat(64),
  to: 'b'.repeat(64),
} as const;

describe('PlannerProducedMongoMigration', () => {
  it("identifies as the 'mongo' target", () => {
    const migration = new PlannerProducedMongoMigration([], META, SNAPSHOTS_IMPORT_PATH);

    expect(migration.targetId).toBe('mongo');
  });

  it('exposes describe() metadata as supplied', () => {
    const migration = new PlannerProducedMongoMigration([], META, SNAPSHOTS_IMPORT_PATH);

    expect(migration.describe()).toEqual(META);
  });

  it('derives origin/destination from describe() (round-trips through MigrationPlan surface)', () => {
    const migration = new PlannerProducedMongoMigration([], META, SNAPSHOTS_IMPORT_PATH);

    expect(migration.origin).toEqual({ storageHash: META.from });
    expect(migration.destination).toEqual({ storageHash: META.to });
  });

  it("treats a null 'from' as a null origin so runners do not match against an empty hash", () => {
    const migration = new PlannerProducedMongoMigration(
      [],
      { from: null, to: META.to },
      SNAPSHOTS_IMPORT_PATH,
    );

    expect(migration.origin).toBeNull();
    expect(migration.destination).toEqual({ storageHash: META.to });
  });

  it('renders the supplied OpFactoryCall list to runnable mongo operations via the operations getter', () => {
    const calls = [
      new CreateIndexCall('users', [{ field: 'email', direction: 1 }], { unique: true }),
      new DropIndexCall('users', [{ field: 'legacy', direction: 1 }]),
    ];
    const migration = new PlannerProducedMongoMigration(calls, META, SNAPSHOTS_IMPORT_PATH);

    const ops = migration.operations;

    expect(ops).toHaveLength(2);
    expect((ops[0] as MongoMigrationPlanOperation).execute[0]?.command.kind).toBe('createIndex');
    expect((ops[1] as MongoMigrationPlanOperation).execute[0]?.command.kind).toBe('dropIndex');
  });

  it('returns an empty operations list when constructed with no calls', () => {
    const migration = new PlannerProducedMongoMigration([], META, SNAPSHOTS_IMPORT_PATH);

    expect(migration.operations).toEqual([]);
  });

  it('renders authoring TypeScript that wires up MigrationCLI.run and derives describe() from contract JSON', () => {
    const calls = [new CreateIndexCall('users', [{ field: 'email', direction: 1 }])];
    const migration = new PlannerProducedMongoMigration(calls, META, SNAPSHOTS_IMPORT_PATH);

    const source = migration.renderTypeScript(keepInternalSpecifiers);

    // New shape: base derives describe() from the imported contract JSON, so the
    // scaffold carries `Migration<Start, End>` + the JSON/field imports and emits
    // no describe()/hash literals.
    expect(source).toContain('class M extends Migration<Start, End>');
    expect(source).toContain('override readonly startContractJson = startContract;');
    expect(source).toContain('override readonly endContractJson = endContract;');
    expect(source).toContain('override get operations()');
    expect(source).toContain('createIndex');
    expect(source).not.toContain('describe()');
    expect(source).not.toContain(`'${META.from}'`);
    expect(source).not.toContain(`'${META.to}'`);
    expect(source).toContain(
      "import { Migration, MigrationCLI, createIndex } from '@internal/target-mongo/migration';",
    );
    expect(source).toContain('MigrationCLI.run(import.meta.url, M);');
  });

  it('renders an empty-class stub when constructed with no calls', () => {
    const migration = new PlannerProducedMongoMigration([], META, SNAPSHOTS_IMPORT_PATH);

    const source = migration.renderTypeScript(keepInternalSpecifiers);

    expect(source).toContain('class M extends Migration<Start, End>');
    expect(source).toContain('override readonly endContractJson = endContract;');
    expect(source).toContain('override get operations()');
    expect(source).not.toContain('describe()');
  });

  it('renderTypeScript emits no describe() block (so no labels leak through it)', () => {
    const calls = [new CreateIndexCall('users', [{ field: 'email', direction: 1 }])];
    const migration = new PlannerProducedMongoMigration(calls, META, SNAPSHOTS_IMPORT_PATH);

    const source = migration.renderTypeScript(keepInternalSpecifiers);

    expect(source).toContain('class M extends Migration<Start, End>');
    expect(source).not.toContain('describe()');
    expect(source).not.toContain('labels:');
  });
});
