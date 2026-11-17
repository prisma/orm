import type { ResolvedMigrationStatement } from '@internal/framework-components/control';
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
  refusal,
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

const OVERLAP_WHY = (advice: string) =>
  `MongoDB applies a migration's operations one at a time, without a transaction, and knows that an operation already ran only from the documents. An operation that reads a value another operation of the same migration writes acts on what that operation wrote: at once when it runs later, and when the migration runs again after a later operation stops. ${advice}`;

const ENUM_TWO_MIGRATIONS =
  'Make the change in two migrations: first move every value they swap or chain to a stored value the enum does not use, all in one migration, and apply it; then move them to their final values in a second.';

const NO_THIRD_BOOLEAN =
  'A boolean enum has no third value to move a stored value to, so the change cannot be split into two migrations.';

const SWAP_IN_ONE_UPDATE =
  'swap the stored values yourself in one update of the database, such as an updateMany whose pipeline sets each field that holds the enum to its negation with $not';

/** The replacements of the plan's fields `status` and `tags`, as a refusal lists them. */
const replacementsOf = (...moves: readonly (readonly [string, string])[]) =>
  moves
    .flatMap(([from, to]) =>
      ['status', 'tags'].map(
        (field) => `Replace value "${from}" with "${to}" in field ${field} of collection users`,
      ),
    )
    .join('; ');

const TWO_MIGRATIONS = (members: string) =>
  `To keep that data, make the change in two migrations: first move the stored values of ${members} to values the enum does not use, all in one migration, and apply it; then move them to their final values in a second. MongoDB applies a migration's operations one at a time, so replacements whose old values other replacements write cannot safely run again after a later operation stops.`;

/** A call as `migration.ts` writes it, without white space or trailing commas. */
const compact = (text: string | undefined) => text?.replace(/\s+/g, '').replace(/,(?=[)}\]])/g, '');

/** The stored value calls of the plan's migration.ts, without white space. */
function rendered(result: ReturnType<typeof plan>): readonly string[] {
  if (result.kind !== 'success') throw new Error(JSON.stringify(result.conflicts, null, 2));
  const source = (result.plan as PlannerProducedMongoMigration)
    .renderTypeScript((specifier) => specifier)
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

  it('offers to keep the data when the member keeps its name and its stored value changes', () => {
    const types = { status: { ...STATUS, nullable: true } };
    const result = plan({
      from: users('from', BEFORE, types),
      to: users('to', statuses({ ACTIVE: 'active', ARCHIVED: 'retired' }), types),
      schema: live,
    });
    if (result.kind !== 'success') throw new Error('Expected a plan');
    expect(
      result.dataLoss.map(({ subject, keepDataEdit }) => ({
        subject,
        remove: compact(keepDataEdit?.remove),
        replaceWith: compact(keepDataEdit?.replaceWith),
      })),
    ).toEqual([
      {
        subject: enumValue('ARCHIVED'),
        remove:
          'removeStoredValue({collection:"users",field:"status",value:"archived",enumValue:{enum:"Status",member:"ARCHIVED"}})',
        replaceWith:
          'replaceStoredValue({collection:"users",field:"status",from:"archived",to:{$literal:"retired"}})',
      },
    ]);
  });

  it('asks about two values that trade places, and advises two migrations instead of an edit', () => {
    const types = { status: { ...STATUS, nullable: true } };
    const result = plan({
      from: users('from', BEFORE, types),
      to: users('to', statuses({ ACTIVE: 'archived', ARCHIVED: 'active' }), types),
      schema: live,
    });
    if (result.kind !== 'success') throw new Error('Expected a plan');
    expect(
      result.dataLoss.map(({ subject, keepDataEdit, keepDataAdvice }) => ({
        subject,
        keepDataEdit,
        keepDataAdvice,
      })),
    ).toEqual([
      {
        subject: enumValue('ACTIVE'),
        keepDataEdit: undefined,
        keepDataAdvice: TWO_MIGRATIONS('enum values "Status.ACTIVE" and "Status.ARCHIVED"'),
      },
      {
        subject: enumValue('ARCHIVED'),
        keepDataEdit: undefined,
        keepDataAdvice: TWO_MIGRATIONS('enum values "Status.ACTIVE" and "Status.ARCHIVED"'),
      },
    ]);
  });

  it('advises naming the new member of a member whose stored value a kept member takes, which the plan cannot tell from a removal', () => {
    const types = { status: { ...STATUS, nullable: true } };
    const lossesTo = (members: Readonly<Record<string, unknown>>) => {
      const result = plan({
        from: users('from', BEFORE, types),
        to: users('to', statuses(members), types),
        schema: live,
      });
      if (result.kind !== 'success') throw new Error('Expected a plan');
      return result.dataLoss.map(({ subject, keepDataEdit, keepDataAdvice }) => ({
        subject,
        keepDataEdit,
        keepDataAdvice,
      }));
    };

    expect({
      oneNewMember: lossesTo({ ACTIVE: 'archived', RETIRED: 'retired' }),
      twoNewMembers: lossesTo({ ACTIVE: 'archived', RETIRED: 'retired', GONE: 'gone' }),
      noNewMember: lossesTo({ ACTIVE: 'archived' }),
    }).toEqual({
      oneNewMember: [
        {
          subject: enumValue('ACTIVE'),
          keepDataEdit: undefined,
          keepDataAdvice:
            'Its new stored value "archived" was the stored value of enum value "Status.ARCHIVED", which the enum no longer has. If "Status.ARCHIVED" is now "Status.RETIRED", add --rename Status.ARCHIVED:Status.RETIRED, and the next question says how to keep the data of both.',
        },
      ],
      twoNewMembers: [
        {
          subject: enumValue('ACTIVE'),
          keepDataEdit: undefined,
          keepDataAdvice:
            'Its new stored value "archived" was the stored value of enum value "Status.ARCHIVED", which the enum no longer has. If "Status.ARCHIVED" is now another member, add --rename \'Status.ARCHIVED:Status.<new member>\', and the next question says how to keep the data of both.',
        },
      ],
      noNewMember: [
        { subject: enumValue('ACTIVE'), keepDataEdit: undefined, keepDataAdvice: undefined },
      ],
    });
  });

  it('leaves out a member another rename names when it picks the member to suggest', () => {
    const types = { status: { ...STATUS, nullable: true } };
    const result = plan({
      from: users('from', statuses({ ACTIVE: 'active', ARCHIVED: 'archived', OLD: 'old' }), types),
      to: users('to', statuses({ ACTIVE: 'archived', RETIRED: 'retired', NEW: 'old' }), types),
      schema: live,
      statements: [renameValue('OLD', 'NEW')],
    });
    if (result.kind !== 'success') throw new Error('Expected a plan');
    expect(result.dataLoss.map(({ keepDataAdvice }) => keepDataAdvice)).toEqual([
      'Its new stored value "archived" was the stored value of enum value "Status.ARCHIVED", which the enum no longer has. If "Status.ARCHIVED" is now "Status.RETIRED", add --rename Status.ARCHIVED:Status.RETIRED, and the next question says how to keep the data of both.',
    ]);
  });

  it('advises a boolean enum whose values trade places to swap them in one update, which two migrations cannot do', () => {
    const BOOLEAN_SWAP_ADVICE = `${NO_THIRD_BOOLEAN} To keep that data, ${SWAP_IN_ONE_UPDATE}, and remove the removeStoredValue calls of this enum from migration.ts before you apply it.`;
    const flags = (seed: string, members: Readonly<Record<string, unknown>>) =>
      users(seed, statuses(members, 'mongo/bool@1'), {
        flag: { codecId: 'mongo/bool@1', valueSet: 'Status', nullable: true },
      });
    const result = plan({
      from: flags('from', { YES: true, NO: false }),
      to: flags('to', { YES: false, NO: true }),
      schema: live,
    });
    if (result.kind !== 'success') throw new Error('Expected a plan');
    expect(
      result.dataLoss.map(({ keepDataEdit, keepDataAdvice }) => ({ keepDataEdit, keepDataAdvice })),
    ).toEqual([
      { keepDataEdit: undefined, keepDataAdvice: BOOLEAN_SWAP_ADVICE },
      { keepDataEdit: undefined, keepDataAdvice: BOOLEAN_SWAP_ADVICE },
    ]);
  });

  it('imports replaceStoredValue only when a removal can be replaced by an edit', () => {
    const optional = { status: { ...STATUS, nullable: true } };
    const importsReplace = (result: ReturnType<typeof plan>) => {
      if (result.kind !== 'success') throw new Error('Expected a plan');
      const source = (result.plan as PlannerProducedMongoMigration).renderTypeScript(
        (specifier) => specifier,
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

describe('MongoMigrationPlanner, enum value refusals', () => {
  it('refuses an enum whose values are objects', () => {
    const result = plan({
      from: users('from', statuses({ A: { x: 1 }, B: { x: 2 } }, 'mongo/document@1')),
      to: users('to', statuses({ A: { x: 1 } }, 'mongo/document@1')),
      schema: live,
    });
    expect(refusal(result)).toEqual([
      {
        kind: 'fieldRemovalRefused',
        summary:
          'Cannot remove enum value "Status.B": its stored value {"x":2} is not a string, a number or a boolean',
        why: 'The plan matches stored enum values by equality, and MongoDB\'s equality on an object depends on the order of its keys and on a list matches lists that contain it. Rewrite the documents that hold enum value "Status.B" in a dataTransform operation of migration.ts, then plan again.',
      },
    ]);
  });

  it('refuses a rename that merges two values', () => {
    const result = plan({
      from: users('from', BEFORE),
      to: users('to', statuses({ ACTIVE: 'active', RETIRED: 'active' })),
      schema: live,
      statements: [renameValue('ARCHIVED', 'RETIRED')],
    });
    expect(refusal(result).map(({ summary }) => summary)).toEqual([
      'Cannot rename enum value "Status.ARCHIVED" to "Status.RETIRED": the origin enum already stores "active", as enum value "Status.ACTIVE"',
    ]);
  });

  it('refuses renames that move values in a cycle', () => {
    const result = plan({
      from: users('from', statuses({ A: 'a', B: 'b' })),
      to: users('to', statuses({ C: 'b', D: 'a' })),
      schema: live,
      statements: [renameValue('A', 'C'), renameValue('B', 'D')],
    });
    expect(refusal(result)).toEqual([
      {
        kind: 'statementRefused',
        summary: `Cannot rename enum value "Status.A" to "Status.C": the migration writes a value that another of its operations reads (${replacementsOf(['a', 'b'], ['b', 'a'])})`,
        why: OVERLAP_WHY(ENUM_TWO_MIGRATIONS),
      },
    ]);
  });

  it('refuses renames that move values along a chain', () => {
    const result = plan({
      from: users('from', statuses({ A: 'a', B: 'b' })),
      to: users('to', statuses({ B: 'b', C: 'c' })),
      schema: live,
      statements: [renameValue('A', 'B'), renameValue('B', 'C')],
    });
    if (result.kind !== 'failure') throw new Error('Expected the plan to be refused');
    expect(
      result.conflicts.map(({ summary, refusedStatement, leaveOut }) => ({
        summary,
        refusedStatement,
        leaveOut,
      })),
    ).toEqual([
      {
        summary: `Cannot rename enum value "Status.A" to "Status.B": the migration writes a value that another of its operations reads (${replacementsOf(['a', 'b'], ['b', 'c'])})`,
        refusedStatement: renameValue('A', 'B'),
        leaveOut: undefined,
      },
    ]);
  });

  it('refuses renames that swap the values of a boolean enum, with advice to swap them in one update', () => {
    const flags = (seed: string, members: Readonly<Record<string, unknown>>) =>
      users(seed, statuses(members, 'mongo/bool@1'), {
        flag: { codecId: 'mongo/bool@1', valueSet: 'Status' },
      });
    const result = plan({
      from: flags('from', { YES: true, NO: false }),
      to: flags('to', { ON: false, OFF: true }),
      schema: live,
      statements: [renameValue('YES', 'ON'), renameValue('NO', 'OFF')],
    });
    expect(refusal(result).map(({ why }) => why)).toEqual([
      OVERLAP_WHY(
        `${NO_THIRD_BOOLEAN} Leave out these statements, ${SWAP_IN_ONE_UPDATE}, and remove the removeStoredValue calls of this enum from the migration.ts that migration plan writes before you apply it.`,
      ),
    ]);
  });

  it('refuses an enum whose values are lists', () => {
    const result = plan({
      from: users('from', statuses({ A: ['a'], B: ['b'] }, 'mongo/array@1')),
      to: users('to', statuses({ A: ['a'] }, 'mongo/array@1')),
      schema: live,
    });
    expect(refusal(result).map(({ summary }) => summary)).toEqual([
      'Cannot remove enum value "Status.B": its stored value ["b"] is not a string, a number or a boolean',
    ]);
  });

  it('refuses a removal in a time-series collection', () => {
    const result = plan({
      from: users('from', BEFORE),
      to: users('to', REMOVED),
      schema: [schemaCollection('users', { timeseries: true })],
    });
    expect(refusal(result).map(({ summary }) => summary)).toEqual([
      'Cannot remove enum value "Status.ARCHIVED" inside field "status" from collection "users": it is a time-series collection',
      'Cannot remove enum value "Status.ARCHIVED" inside field "tags" from collection "users": it is a time-series collection',
    ]);
  });

  it('refuses a removal in a collection two root models share with no discriminator', () => {
    const shared = (seed: string, status: EnumSpec) =>
      users(
        seed,
        status,
        undefined,
        {},
        {
          Guest: {
            collection: 'users',
            fields: ['_id', 'status'],
            types: { _id: OBJECT_ID, status: { ...STATUS, nullable: true } },
          },
        },
      );
    const result = plan({ from: shared('from', BEFORE), to: shared('to', REMOVED), schema: live });
    expect(refusal(result).map(({ summary }) => summary)[0]).toBe(
      'Cannot remove enum value "Status.ARCHIVED" inside field "status" of model "User" from collection "users": model "Guest" stores it in the same collection',
    );
  });

  it('refuses a rename in a time-series collection', () => {
    const result = plan({
      from: users('from', BEFORE),
      to: users('to', RENAMED),
      schema: [schemaCollection('users', { timeseries: true })],
      statements: [renameValue('ARCHIVED', 'RETIRED')],
    });
    expect(refusal(result).map(({ summary }) => summary)).toEqual([
      'Cannot replace enum value "Status.ARCHIVED" inside field "status" in collection "users": it is a time-series collection',
      'Cannot replace enum value "Status.ARCHIVED" inside field "tags" in collection "users": it is a time-series collection',
    ]);
  });

  it('refuses a rename in a collection two root models share with no discriminator', () => {
    const shared = (seed: string, status: EnumSpec) =>
      users(
        seed,
        status,
        undefined,
        {},
        {
          Guest: {
            collection: 'users',
            fields: ['_id', 'status'],
            types: { _id: OBJECT_ID, status: { ...STATUS, nullable: true } },
          },
        },
      );
    const result = plan({
      from: shared('from', BEFORE),
      to: shared('to', RENAMED),
      schema: live,
      statements: [renameValue('ARCHIVED', 'RETIRED')],
    });
    expect(refusal(result).map(({ summary }) => summary)[0]).toBe(
      'Cannot replace enum value "Status.ARCHIVED" inside field "status" of model "User" in collection "users": model "Guest" stores it in the same collection',
    );
  });

  it('refuses a rename in a collection whose control policy is not managed', () => {
    const result = plan({
      from: users('from', BEFORE, undefined, { control: 'external' }),
      to: users('to', RENAMED, undefined, { control: 'external' }),
      schema: live,
      statements: [renameValue('ARCHIVED', 'RETIRED')],
    });
    expect(refusal(result).map(({ summary }) => summary)).toEqual([
      'Cannot rename enum value "Status.ARCHIVED" to "Status.RETIRED": collection "users" has control policy "external"',
    ]);
  });
});
