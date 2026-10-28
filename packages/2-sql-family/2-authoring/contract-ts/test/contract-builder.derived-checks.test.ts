import { crossRef } from '@internal/contract/types';
import type { CheckExpressionInput } from '@internal/sql-contract/check-expressions';
import { composeCheckWirePrefix } from '@internal/sql-schema-ir/naming';
import { describe, expect, it } from 'vitest';
import { createTestSqlNamespace } from '../../../1-core/contract/test/test-support';
import { testTypeLookups } from '../../../1-core/contract/test/test-type-lookups';
import { buildSqlContractFromDefinition } from '../src/contract-builder';
import type { ContractDefinition, ModelNode } from '../src/contract-definition';
import { enumType, member } from '../src/enum-type';

const renderedInputs: CheckExpressionInput[] = [];

function renderCheckExpressions(input: CheckExpressionInput) {
  renderedInputs.push(input);
  return [
    ...(input.memberValues === undefined
      ? []
      : [
          {
            kind: 'membership' as const,
            columnName: input.columnName,
            expression: `"${input.columnName}" IN (${input.memberValues.join(', ')})`,
          },
        ]),
    ...(input.valueObject === undefined
      ? []
      : [
          {
            kind: 'shape' as const,
            columnName: input.columnName,
            expression: `shape of "${input.columnName}"`,
          },
        ]),
  ];
}

const targetPack = {
  kind: 'target',
  id: 'postgres',
  familyId: 'sql',
  targetId: 'postgres',
  version: '0.0.1',
  defaultNamespaceId: 'public',
  authoring: { type: {}, renderCheckExpressions },
} as const;

const int4 = { codecId: 'pg/int4@1' } as const;
const text = { codecId: 'pg/text@1' } as const;
const jsonb = { codecId: 'pg/jsonb@1' } as const;
const idField = { fieldName: 'id', columnName: 'id', descriptor: int4, nullable: false } as const;

const Kind = enumType('Kind', text, member('Home', 'home'), member('Work', 'work'));

function definition(models: readonly ModelNode[]): ContractDefinition {
  return {
    warnings: undefined,
    target: targetPack,
    createNamespace: createTestSqlNamespace,
    enums: { Kind },
    models,
    valueObjects: [
      {
        name: 'Address',
        fields: [
          { fieldName: 'street', descriptor: text, nullable: false },
          { fieldName: 'kind', descriptor: text, nullable: true, enumTypeHandle: Kind },
          { fieldName: 'geo', valueObjectName: 'Geo', nullable: false },
        ],
      },
      { name: 'Geo', fields: [{ fieldName: 'lat', descriptor: text, nullable: false }] },
    ],
  };
}

function userModel(control?: 'external'): ModelNode {
  return {
    modelName: 'User',
    tableName: 'user',
    fields: [
      idField,
      {
        fieldName: 'home',
        columnName: 'home',
        valueObjectName: 'Address',
        descriptor: jsonb,
        nullable: true,
      },
      {
        fieldName: 'stops',
        columnName: 'stops',
        valueObjectName: 'Address',
        descriptor: jsonb,
        nullable: false,
        many: true,
        elementNullable: true,
      },
    ],
    id: { columns: ['id'] },
    ...(control !== undefined ? { control } : {}),
  };
}

function build(models: readonly ModelNode[]) {
  renderedInputs.length = 0;
  return buildSqlContractFromDefinition(
    definition(models),
    testTypeLookups.codecLookup,
    testTypeLookups.dataTypeLookup,
  );
}

function checkNames(contract: ReturnType<typeof build>, tableName: string) {
  return (contract.storage.namespaces['public']?.entries.table?.[tableName]?.checks ?? []).map(
    (check) => check.prefix,
  );
}

const resolvedAddress = {
  fields: {
    street: {
      nullable: false,
      many: false,
      type: { kind: 'scalar', jsonType: 'string', values: undefined },
    },
    kind: {
      nullable: true,
      many: false,
      type: { kind: 'scalar', jsonType: 'string', values: ['home', 'work'] },
    },
    geo: {
      nullable: false,
      many: false,
      type: {
        kind: 'valueObject',
        valueObject: {
          fields: {
            lat: {
              nullable: false,
              many: false,
              type: { kind: 'scalar', jsonType: 'string', values: undefined },
            },
          },
        },
      },
    },
  },
} as const;

describe('the derived check of a column that holds a value object', () => {
  it('hands the renderer the value object resolved from storage, with the field nullability and list shape', () => {
    build([userModel()]);
    expect(
      renderedInputs
        .filter((input) => input.valueObject !== undefined)
        .map(({ columnName, many, valueObject }) => ({ columnName, many, valueObject })),
    ).toEqual([
      {
        columnName: 'home',
        many: false,
        valueObject: { nullable: true, many: false, valueObject: resolvedAddress },
      },
      {
        columnName: 'stops',
        many: false,
        valueObject: {
          nullable: false,
          many: { elementNullable: true },
          valueObject: resolvedAddress,
        },
      },
    ]);
  });

  it('is named after the table, the column and the shape kind', () => {
    expect(checkNames(build([userModel()]), 'user')).toEqual([
      composeCheckWirePrefix('user', 'home', 'shape'),
      composeCheckWirePrefix('user', 'stops', 'shape'),
    ]);
  });

  it('is not derived for a table that is not managed', () => {
    expect(checkNames(build([userModel('external')]), 'user')).toEqual([]);
  });

  it('refuses an authored check whose name a value object check would use', () => {
    const model = {
      ...userModel(),
      checks: [
        {
          expression: 'true',
          map: undefined,
          name: composeCheckWirePrefix('user', 'home', 'shape'),
        },
      ],
    };
    expect(() => build([model])).toThrow(/derived enforcement check would use for column "home"/);
  });
});

function taskModels(options: { readonly typedByEnum?: boolean } = {}): readonly ModelNode[] {
  return [
    {
      modelName: 'Task',
      tableName: 'task',
      fields: [
        idField,
        {
          fieldName: 'type',
          columnName: 'type',
          descriptor: text,
          nullable: false,
          ...(options.typedByEnum === true ? { enumTypeHandle: Kind } : {}),
        },
      ],
      id: { columns: ['id'] },
      discriminator: { field: 'type' },
      variants: { work: crossRef('Bug', 'public'), home: crossRef('Feature', 'public') },
    },
    ...['Bug', 'Feature'].map((modelName) => ({
      modelName,
      tableName: 'task',
      fields: [],
      sharesBaseTable: true,
      base: crossRef('Task', 'public'),
    })),
  ];
}

describe('the derived check of a discriminator column', () => {
  it('is a membership check holding the variant values, sorted', () => {
    const contract = build(taskModels());
    expect(contract.storage.namespaces['public']?.entries.table?.['task']?.checks).toEqual([
      expect.objectContaining({
        prefix: composeCheckWirePrefix('task', 'type', 'membership'),
        expression: '"type" IN (home, work)',
      }),
    ]);
  });

  it('is only the enum membership check when an enum types the discriminator', () => {
    const contract = build(taskModels({ typedByEnum: true }));
    expect({
      checks: checkNames(contract, 'task'),
      memberValues: renderedInputs.map((input) => input.memberValues),
    }).toEqual({
      checks: [composeCheckWirePrefix('task', 'type', 'membership')],
      memberValues: [undefined, ['home', 'work']],
    });
  });

  it('is not derived for a table that is not managed', () => {
    const [task, ...variants] = taskModels();
    expect(
      checkNames(build([{ ...task, control: 'external' } as ModelNode, ...variants]), 'task'),
    ).toEqual([]);
  });
});
