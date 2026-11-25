import type { ResolvedMigrationStatement } from '@internal/framework-components/control';
import { workspaceMigrationModule } from '@repo/test-utils';
import { describe, expect, it } from 'vitest';
import type { PlannerProducedMongoMigration } from '../src/core/migrations/planner-produced-migration';
import {
  type CollectionSpec,
  contract,
  type EnumSpec,
  type FieldTypeSpec,
  type ModelSpec,
  NS,
  plan,
  planned,
  schemaCollection,
} from './mongo-statement-fixtures';

const OBJECT_ID: FieldTypeSpec = { codecId: 'mongo/objectId@1' };
const STATUS: FieldTypeSpec = { codecId: 'mongo/string@1', valueSet: 'Status' };

const renameValue = (from: string, to: string): ResolvedMigrationStatement => ({
  kind: 'rename',
  entity: 'enumValue',
  from: { namespaceId: NS, enum: 'Status', member: from },
  to: { namespaceId: NS, enum: 'Status', member: to },
});

const enumValue = (member: string) => ({
  kind: 'enumValue' as const,
  namespaceId: NS,
  enum: 'Status',
  member,
});

function statuses(members: Readonly<Record<string, unknown>>, codecId?: string): EnumSpec {
  return { members, ...(codecId === undefined ? {} : { codecId }) };
}

const BEFORE = statuses({ ACTIVE: 'active', ARCHIVED: 'archived' });
const RENAMED = statuses({ ACTIVE: 'active', RETIRED: 'retired' });
const REMOVED = statuses({ ACTIVE: 'active' });

/** Users with an optional `status` and a list `tags`, both typed by `Status`. */
function users(
  seed: string,
  status: EnumSpec,
  types: Readonly<Record<string, FieldTypeSpec>> = {
    status: { ...STATUS, nullable: true },
    tags: { ...STATUS, many: true },
  },
  collection: CollectionSpec = {},
  models: Readonly<Record<string, ModelSpec>> = {},
  valueObjects: Readonly<Record<string, Readonly<Record<string, FieldTypeSpec>>>> = {},
) {
  return contract(
    seed,
    {
      User: {
        collection: 'users',
        fields: ['_id', ...Object.keys(types)],
        types: { _id: OBJECT_ID, ...types },
      },
      ...models,
    },
    { users: collection },
    valueObjects,
    { Status: status },
  );
}

const live = [schemaCollection('users')];

/** The stored value calls of the plan's migration.ts, without white space. */
function rendered(result: ReturnType<typeof plan>): readonly string[] {
  if (result.kind !== 'success') throw new Error(JSON.stringify(result.conflicts, null, 2));
  const source = (result.plan as PlannerProducedMongoMigration)
    .renderTypeScript(workspaceMigrationModule.mongo)
    .replace(/\s+/g, '')
    .replace(/,\}/g, '}');
  return source.match(/(?:replace|remove)StoredValue\(\{(?:[^{}]|\{[^{}]*\})*\}\)/g) ?? [];
}

describe('MongoMigrationPlanner, a renamed enum value', () => {
  it('replaces the stored value in a scalar field and in a list field', () => {
    const result = plan({
      from: users('from', BEFORE),
      to: users('to', RENAMED),
      schema: live,
      statements: [renameValue('ARCHIVED', 'RETIRED')],
    });
    expect({ ...planned(result), rendered: rendered(result) }).toEqual({
      labels: [
        'Replace value "archived" with "retired" in field status of collection users',
        'Replace value "archived" with "retired" in field tags of collection users',
      ],
      classes: ['widening', 'widening'],
      applied: [[0, 1]],
      dataLoss: [],
      rendered: [
        'replaceStoredValue({collection:"users",field:"status",from:"archived",to:{$literal:"retired"}})',
        'replaceStoredValue({collection:"users",field:"tags",from:"archived",to:{$literal:"retired"}})',
      ],
    });
  });

  it('replaces it inside a value object, wherever the value object is stored', () => {
    const types = { addresses: { codecId: '', valueObject: 'Address', many: true } };
    const valueObjects = { Address: { kind: STATUS } };
    const result = plan({
      from: users('from', BEFORE, types, {}, {}, valueObjects),
      to: users('to', RENAMED, types, {}, {}, valueObjects),
      schema: live,
      statements: [renameValue('ARCHIVED', 'RETIRED')],
    });
    expect(rendered(result)).toEqual([
      'replaceStoredValue({collection:"users",field:"addresses",path:"$[*].kind",from:"archived",to:{$literal:"retired"}})',
    ]);
  });

  it('replaces it inside an embedded model', () => {
    const embedded = (seed: string, status: EnumSpec) =>
      users(
        seed,
        status,
        {},
        {},
        {
          User: {
            collection: 'users',
            fields: ['_id'],
            types: { _id: OBJECT_ID },
            embeds: { notes: { field: 'notes', model: 'Note', cardinality: '1:N' } },
          },
          Note: { owner: 'User', fields: ['state'], types: { state: STATUS } },
        },
      );
    const result = plan({
      from: embedded('from', BEFORE),
      to: embedded('to', RENAMED),
      schema: live,
      statements: [renameValue('ARCHIVED', 'RETIRED')],
    });
    expect(rendered(result)).toEqual([
      'replaceStoredValue({collection:"users",field:"notes",path:"$[*].state",from:"archived",to:{$literal:"retired"}})',
    ]);
  });

  it("replaces it in a variant's field, in that variant's documents only", () => {
    const variants = (seed: string, status: EnumSpec) =>
      users(
        seed,
        status,
        {},
        {},
        {
          User: {
            collection: 'users',
            fields: ['_id', 'kind'],
            types: { _id: OBJECT_ID },
            discriminator: 'kind',
            variants: { Admin: 'admin' },
          },
          Admin: { base: 'User', fields: ['level'], types: { level: STATUS } },
        },
      );
    const result = plan({
      from: variants('from', BEFORE),
      to: variants('to', RENAMED),
      schema: live,
      statements: [renameValue('ARCHIVED', 'RETIRED')],
    });
    expect(rendered(result)).toEqual([
      'replaceStoredValue({collection:"users",field:"level",filter:{kind:"admin"},from:"archived",to:{$literal:"retired"}})',
    ]);
  });

  it('writes a double value with $toDouble', () => {
    const weights = (seed: string, members: Readonly<Record<string, unknown>>) =>
      users(seed, statuses(members, 'mongo/double@1'), {
        weight: { codecId: 'mongo/double@1', valueSet: 'Status' },
      });
    const result = plan({
      from: weights('from', { LIGHT: 1, HEAVY: 2 }),
      to: weights('to', { LIGHT: 1, HEAVIER: 3 }),
      schema: live,
      statements: [renameValue('HEAVY', 'HEAVIER')],
    });
    expect(rendered(result)).toEqual([
      'replaceStoredValue({collection:"users",field:"weight",from:2,to:{$toDouble:3}})',
    ]);
  });

  it('plans nothing when only the member is renamed and its stored value stays', () => {
    const result = plan({
      from: users('from', BEFORE),
      to: users('to', statuses({ ACTIVE: 'active', RETIRED: 'archived' })),
      schema: live,
      statements: [renameValue('ARCHIVED', 'RETIRED')],
    });
    expect(planned(result)).toEqual({ labels: [], classes: [], applied: [[]], dataLoss: [] });
  });
});

describe('MongoMigrationPlanner, a removed enum value', () => {
  it('removes it from an optional field and a list, as a data loss of the enum value', () => {
    const result = plan({ from: users('from', BEFORE), to: users('to', REMOVED), schema: live });
    expect({ ...planned(result), rendered: rendered(result) }).toEqual({
      labels: [
        'Remove value "archived" from field status of collection users',
        'Remove value "archived" from field tags of collection users',
      ],
      classes: ['destructive', 'destructive'],
      applied: [],
      dataLoss: [
        {
          operationIndex: 0,
          subject: enumValue('ARCHIVED'),
          loss: 'drop',
          label: 'Remove value "archived" from field status of collection users',
        },
        {
          operationIndex: 1,
          subject: enumValue('ARCHIVED'),
          loss: 'drop',
          label: 'Remove value "archived" from field tags of collection users',
        },
      ],
      rendered: [
        'removeStoredValue({collection:"users",field:"status",value:"archived",enumValue:{enum:"Status",member:"ARCHIVED"}})',
        'removeStoredValue({collection:"users",field:"tags",value:"archived",enumValue:{enum:"Status",member:"ARCHIVED"}})',
      ],
    });
  });

  it('marks a required field, whose removal checks first that no document holds the value', () => {
    const types = { status: STATUS };
    const result = plan({
      from: users('from', BEFORE, types),
      to: users('to', REMOVED, types),
      schema: live,
    });
    expect(rendered(result)).toEqual([
      'removeStoredValue({collection:"users",field:"status",value:"archived",required:true,enumValue:{enum:"Status",member:"ARCHIVED"}})',
    ]);
  });

  it('marks the field required when any model sharing the collection requires it', () => {
    const shared = (seed: string, status: EnumSpec) =>
      contract(
        seed,
        {
          User: {
            collection: 'people',
            fields: ['_id', 'status'],
            types: { _id: OBJECT_ID, status: { ...STATUS, nullable: true } },
          },
          Admin: {
            collection: 'people',
            fields: ['_id', 'status'],
            types: { _id: OBJECT_ID, status: STATUS },
          },
        },
        { people: {} },
        {},
        { Status: status },
      );
    expect(
      rendered(
        plan({
          from: shared('from', BEFORE),
          to: shared('to', REMOVED),
          schema: [schemaCollection('people')],
        }),
      ),
    ).toEqual([
      'removeStoredValue({collection:"people",field:"status",value:"archived",required:true,enumValue:{enum:"Status",member:"ARCHIVED"}})',
    ]);
  });

  it('runs removals after the other rewrites and replacements before them', () => {
    const result = plan({
      from: users('from', statuses({ ACTIVE: 'active', ARCHIVED: 'archived', OLD: 'old' })),
      to: users('to', statuses({ ACTIVE: 'active', RETIRED: 'retired' })),
      schema: live,
      statements: [renameValue('ARCHIVED', 'RETIRED')],
    });
    expect(planned(result).labels).toEqual([
      'Replace value "archived" with "retired" in field status of collection users',
      'Replace value "archived" with "retired" in field tags of collection users',
      'Remove value "old" from field status of collection users',
      'Remove value "old" from field tags of collection users',
    ]);
  });

  it('imports replaceStoredValue for a replacement and for the removal from a required field', () => {
    const optional = { status: { ...STATUS, nullable: true } };
    const importsReplace = (result: ReturnType<typeof plan>) => {
      if (result.kind !== 'success') throw new Error('Expected a plan');
      const source = (result.plan as PlannerProducedMongoMigration).renderTypeScript(
        workspaceMigrationModule.mongo,
      );
      return /import \{[^}]*\breplaceStoredValue\b[^}]*\}/.test(source);
    };
    expect({
      removed: importsReplace(
        plan({
          from: users('from', BEFORE, optional),
          to: users('to', REMOVED, optional),
          schema: live,
        }),
      ),
      valueChanged: importsReplace(
        plan({
          from: users('from', BEFORE, optional),
          to: users('to', statuses({ ACTIVE: 'active', ARCHIVED: 'retired' }), optional),
          schema: live,
        }),
      ),
      required: importsReplace(
        plan({
          from: users('from', BEFORE, { status: STATUS }),
          to: users('to', REMOVED, { status: STATUS }),
          schema: live,
        }),
      ),
    }).toEqual({ removed: false, valueChanged: true, required: true });
  });

  it('leaves out a collection whose control policy is not managed', () => {
    const result = plan({
      from: users('from', BEFORE, undefined, { control: 'tolerated' }),
      to: users('to', REMOVED, undefined, { control: 'tolerated' }),
      schema: live,
    });
    expect(planned(result).labels).toEqual([]);
  });

  it('plans nothing without an origin contract', () => {
    const result = plan({ from: null, to: users('to', REMOVED), schema: live });
    expect(planned(result).labels).toEqual([]);
  });
});
