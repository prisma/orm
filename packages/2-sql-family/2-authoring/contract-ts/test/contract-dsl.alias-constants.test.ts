import type { FamilyPackRef, TargetPackRef } from '@internal/framework-components/components';
import { describe, expect, it } from 'vitest';
import { createTestSqlNamespace } from '../../../1-core/contract/test/test-support';
import { testTypeLookups } from '../../../1-core/contract/test/test-type-lookups';
import {
  fixtureDataTypeEntries,
  fixtureDataTypes,
} from '../../contract-psl/test/fixture-data-types';
import { createComposedAuthoringHelpers } from '../src/composed-authoring-helpers';
import { buildSqlContractFromDefinition, defineContract } from '../src/contract-builder';
import { buildContractDefinition } from '../src/contract-lowering';
import { now } from '../src/default-functions';
import {
  familyPack as generatorFamilyPack,
  targetPack as generatorTargetPack,
} from './helpers/generator-function-packs';
import { unboundTables } from './unbound-tables';

const familyPackBase = {
  ...generatorFamilyPack,
  dataTypes: fixtureDataTypes,
  authoring: { dataTypes: fixtureDataTypeEntries },
} as const satisfies FamilyPackRef<'sql'>;

const familyPack: typeof familyPackBase & {
  readonly __dataTypeArguments?: {
    readonly 'pg/int4': { readonly argument: number; readonly parameter: number };
  };
} = familyPackBase;

const targetPack = {
  ...generatorTargetPack,
  authoring: {
    type: {
      VarChar: {
        kind: 'typeConstructor',
        args: [{ kind: 'value', dataType: 'pg/int4', name: 'length', optional: true }],
        output: { codecId: 'sql/varchar@1', typeParams: { length: { kind: 'arg', index: 0 } } },
      },
      Time: {
        kind: 'typeConstructor',
        args: [{ kind: 'value', dataType: 'pg/int4', name: 'precision', optional: true }],
        output: {
          codecId: 'pg/time-temporal@1',
          typeParams: { precision: { kind: 'arg', index: 0 } },
        },
      },
      temporal: {
        CreatedAt: {
          kind: 'typeAlias',
          output: {
            type: { codecId: 'pg/time-temporal@1', typeParams: { precision: 3 } },
            onCreate: { name: 'now', args: {} },
          },
        },
        UpdatedAt: {
          kind: 'typeAlias',
          output: {
            type: { codecId: 'pg/time-temporal@1', typeParams: { precision: 3 } },
            onCreate: { name: 'now', args: {} },
            onUpdate: { name: 'now', args: {} },
          },
        },
      },
    },
  },
} as const satisfies TargetPackRef<'sql', 'postgres'>;

const scaffold = {
  ...testTypeLookups,
  family: familyPack,
  target: targetPack,
  createNamespace: createTestSqlNamespace,
};

const { field, gen } = createComposedAuthoringHelpers({
  ...testTypeLookups,
  family: familyPack,
  target: targetPack,
});

const time3 = { codecId: 'pg/time-temporal@1', typeParams: { precision: 3 } } as const;
const plainTimeNow = { kind: 'generator', id: 'plainTimeNow', params: { precision: 3 } } as const;

describe('alias constants', () => {
  it('expand into every column typed by them, with their generators, in every model', () => {
    const contract = defineContract(scaffold, ({ type, model }) => {
      const Slug = field.column(type.VarChar(64));
      const UpdatedAt = field.column(type.Time(3)).onCreate(gen.now()).onUpdate(gen.now());
      return {
        models: {
          Post: model('Post', {
            fields: {
              id: field.column(type.VarChar(36)).id(),
              slug: Slug,
              updatedAt: UpdatedAt.default(now()),
            },
          }).sql({ table: 'post' }),
          Tag: model('Tag', {
            fields: { slug: Slug.id(), updatedAt: UpdatedAt },
          }).sql({ table: 'tag' }),
        },
      };
    });

    const tables = unboundTables(contract.storage);
    expect({
      types: contract.storage.types,
      post: tables['post']?.columns,
      tag: tables['tag']?.columns,
      defaults: contract.execution?.mutations.defaults,
    }).toEqual({
      types: undefined,
      post: {
        id: {
          codecId: 'sql/varchar@1',
          dataType: 'pg/varchar',
          nullable: false,
          many: false,
          typeParams: { length: 36 },
        },
        slug: {
          codecId: 'sql/varchar@1',
          dataType: 'pg/varchar',
          nullable: false,
          many: false,
          typeParams: { length: 64 },
        },
        updatedAt: {
          ...time3,
          dataType: 'pg/time',
          nullable: false,
          many: false,
          default: { kind: 'function', expression: 'now()' },
        },
      },
      tag: {
        slug: {
          codecId: 'sql/varchar@1',
          dataType: 'pg/varchar',
          nullable: false,
          many: false,
          typeParams: { length: 64 },
        },
        updatedAt: { ...time3, dataType: 'pg/time', nullable: false, many: false },
      },
      defaults: [
        {
          ref: { namespace: 'public', entry: 'post', field: 'updatedAt' },
          onCreate: plainTimeNow,
          onUpdate: plainTimeNow,
        },
        {
          ref: { namespace: 'public', entry: 'tag', field: 'updatedAt' },
          onCreate: plainTimeNow,
          onUpdate: plainTimeNow,
        },
      ],
    });
  });

  it('refuse a second .default()', () => {
    const CreatedAt = field.column(time3).default(now());
    expect(() => CreatedAt.default(now())).toThrow(
      expect.objectContaining({
        code: 'CONTRACT.DEFAULT_INVALID',
        message:
          '.default() is called on a field that already has a default. Set the default once, and do not combine .default() with an alias constant that sets one.',
        meta: { reason: 'default-set-twice' },
      }),
    );
  });

  it('refuse a generator phase the constant already sets', () => {
    const UpdatedAt = field.column(time3).onCreate(gen.now()).onUpdate(gen.now());
    expect(() => UpdatedAt.onUpdate(gen.now())).toThrow(
      expect.objectContaining({
        code: 'CONTRACT.DEFAULT_INVALID',
        meta: { reason: 'generator-phase-set-twice', phase: 'onUpdate' },
      }),
    );
  });
});

describe('contributed type aliases', () => {
  it('give the column type and generator calls of the alias', () => {
    const contract = defineContract(scaffold, ({ type }) => {
      expect(type.temporal.UpdatedAt()).toEqual({
        kind: 'codec-instance',
        codecId: 'pg/time-temporal@1',
        typeParams: { precision: 3 },
        generatorCalls: {
          onCreate: { name: 'now', args: {} },
          onUpdate: { name: 'now', args: {} },
        },
      });
      return { models: {} };
    });
    expect(contract.storage.types).toBeUndefined();
  });

  it('store what the same column and generator calls store, written on the field', () => {
    const throughAlias = defineContract(scaffold, ({ type, model }) => ({
      models: {
        Event: model('Event', {
          fields: {
            id: field.column(type.VarChar(36)).id(),
            createdAt: field.column(type.temporal.CreatedAt()).onUpdate(gen.now()),
            updatedAt: field.column(type.temporal.UpdatedAt()).optional(),
          },
        }).sql({ table: 'event' }),
      },
    }));
    const onTheField = defineContract(scaffold, ({ type, model }) => ({
      models: {
        Event: model('Event', {
          fields: {
            id: field.column(type.VarChar(36)).id(),
            createdAt: field.column(type.Time(3)).onCreate(gen.now()).onUpdate(gen.now()),
            updatedAt: field
              .column(type.Time(3))
              .onCreate(gen.now())
              .onUpdate(gen.now())
              .optional(),
          },
        }).sql({ table: 'event' }),
      },
    }));
    expect(throughAlias).toEqual(onTheField);
    expect(throughAlias.execution?.mutations.defaults).toHaveLength(2);
  });

  it('refuse a generator phase the alias already sets', () => {
    defineContract(scaffold, ({ type }) => {
      expect(() => field.column(type.temporal.UpdatedAt()).onUpdate(gen.now())).toThrow(
        expect.objectContaining({
          code: 'CONTRACT.DEFAULT_INVALID',
          message:
            '.onUpdate() is called on a field that already generates a value on update. Set each phase once, and do not combine .onUpdate() with a type alias or alias constant that sets it.',
          meta: { reason: 'generator-phase-set-twice', phase: 'onUpdate' },
        }),
      );
      return { models: {} };
    });
  });

  it('are refused at assembly when a generator call does not apply to the codec', () => {
    const brokenTarget = {
      ...targetPack,
      authoring: {
        type: {
          temporal: {
            Broken: {
              kind: 'typeAlias',
              output: {
                type: { codecId: 'pg/time-temporal@1' },
                onCreate: { name: 'uuid', args: {} },
              },
            },
          },
        },
      },
    } as const satisfies TargetPackRef<'sql', 'postgres'>;
    expect(() =>
      defineContract({ ...scaffold, target: brokenTarget }, () => ({ models: {} })),
    ).toThrow(
      expect.objectContaining({
        code: 'CONTRACT.PACK_CONTRIBUTION_INVALID',
        message:
          'Type alias "temporal.Broken" calls uuid() on create, which does not apply to its codec "pg/time-temporal@1".',
      }),
    );
  });
});

describe('the types key', () => {
  const message =
    'defineContract no longer takes a "types" key. Write a type alias as a constant, such as const Slug = field.column(type.VarChar(64)), and use it as a field. Register a database type of a contract space under "databaseTypes".';

  it('is refused when the callback returns it', () => {
    expect(() =>
      defineContract(scaffold, ({ type }) => ({
        types: { Slug: type.VarChar(64) },
        models: {},
      })),
    ).toThrow(
      expect.objectContaining({
        code: 'CONTRACT.TYPES_KEY_REMOVED',
        message,
        meta: { keys: ['Slug'] },
      }),
    );
  });

  it('is refused on the definition', () => {
    const definition = {
      ...scaffold,
      types: { Slug: { kind: 'codec-instance', codecId: 'sql/varchar@1', typeParams: {} } },
    } as const;
    expect(() => defineContract(definition)).toThrow(
      expect.objectContaining({ code: 'CONTRACT.TYPES_KEY_REMOVED', message }),
    );
  });

  it('is refused by buildContractDefinition', () => {
    const definition = {
      ...scaffold,
      types: { Slug: { kind: 'codec-instance', codecId: 'sql/varchar@1', typeParams: {} } },
    };
    expect(() => buildContractDefinition(definition)).toThrow(
      expect.objectContaining({
        code: 'CONTRACT.TYPES_KEY_REMOVED',
        message:
          'buildContractDefinition no longer takes a "types" key. Write a type alias as a constant, such as const Slug = field.column(type.VarChar(64)), and use it as a field. Register a database type of a contract space under "databaseTypes".',
        meta: { keys: ['Slug'] },
      }),
    );
  });

  it('is refused by buildSqlContractFromDefinition', () => {
    const definition = {
      warnings: undefined,
      target: targetPack,
      createNamespace: createTestSqlNamespace,
      models: [],
      types: { Slug: { kind: 'codec-instance', codecId: 'sql/varchar@1', typeParams: {} } },
    };
    expect(() =>
      buildSqlContractFromDefinition(
        definition,
        testTypeLookups.codecLookup,
        testTypeLookups.dataTypeLookup,
      ),
    ).toThrow(
      expect.objectContaining({
        code: 'CONTRACT.TYPES_KEY_REMOVED',
        message:
          'buildSqlContractFromDefinition no longer takes a "types" key. Write a type alias as a constant, such as const Slug = field.column(type.VarChar(64)), and use it as a field. Register a database type of a contract space under "databaseTypes".',
        meta: { keys: ['Slug'] },
      }),
    );
  });
});

describe('databaseTypes', () => {
  it('registers each entry in storage.types', () => {
    const contract = defineContract(scaffold, () => ({
      databaseTypes: {
        vector: { kind: 'codec-instance', codecId: 'pg/vector@1', typeParams: {} },
      },
      models: {},
    }));

    expect(contract.storage.types).toEqual({
      vector: {
        kind: 'codec-instance',
        codecId: 'pg/vector@1',
        dataType: 'pgvector/vector',
        typeParams: {},
      },
    });
  });
});
