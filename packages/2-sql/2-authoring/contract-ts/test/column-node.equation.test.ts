import { describe, expect, it } from 'vitest';
import type { ContractDefinition, ModelNode } from '../src/contract-definition';
import { enumType, member } from '../src/enum-type';
import {
  build,
  columnIndex,
  definitionOf,
  field,
  withFieldAsColumnNode,
} from './table-node-helpers';

const id = field('id');

function user(...fields: ModelNode['fields']): ModelNode {
  return { modelName: 'User', tableName: 'User', fields: [id, ...fields], id: { columns: ['id'] } };
}

const Role = enumType(
  'Role',
  { codecId: 'pg/text@1' },
  member('User', 'user'),
  member('Admin', 'admin'),
);

const nativeLevel = { kind: 'native-enum', typeName: 'aal_level', values: ['aal1', 'aal2'] };

interface Row {
  readonly kind: string;
  readonly definition: ContractDefinition;
  readonly modelName?: string;
  readonly fieldName: string;
}

const rows: readonly Row[] = [
  {
    kind: 'plain scalar',
    definition: definitionOf([user(field('nickname', 'pg/text@1', { nullable: true }))]),
    fieldName: 'nickname',
  },
  {
    kind: 'list column in the middle of a model',
    definition: definitionOf([
      user(
        field('tags', 'pg/text@1', { many: true }),
        field('labels', 'pg/text@1', { many: true }),
      ),
    ]),
    fieldName: 'tags',
  },
  {
    kind: 'enumType() column in the middle of a model',
    definition: definitionOf(
      [
        user(
          field('role', 'pg/text@1', { enumTypeHandle: Role }),
          field('formerRole', 'pg/text@1', { enumTypeHandle: Role }),
        ),
      ],
      { enums: { Role } },
    ),
    fieldName: 'role',
  },
  {
    kind: 'list',
    definition: definitionOf([user(field('tags', 'pg/text@1', { many: true }))]),
    fieldName: 'tags',
  },
  {
    kind: 'enumType() handle',
    definition: definitionOf([user(field('role', 'pg/text@1', { enumTypeHandle: Role }))], {
      enums: { Role },
    }),
    fieldName: 'role',
  },
  {
    kind: 'pg.enum(handle)',
    definition: definitionOf([
      {
        ...user(
          field('level', 'pg/enum@1', {
            descriptor: {
              codecId: 'pg/enum@1',
              typeParams: { typeName: 'aal_level' },
              entityRef: {
                entityKind: 'native_enum',
                entityName: 'aal_level',
                entity: nativeLevel,
              },
            },
          }),
        ),
        namespaceId: 'auth',
      },
    ]),
    fieldName: 'level',
  },
  {
    kind: 'named storage type',
    definition: definitionOf(
      [
        user(
          field('email', 'pg/text@1', { descriptor: { codecId: 'pg/text@1', typeRef: 'Email' } }),
        ),
      ],
      {
        storageTypes: {
          Email: { kind: 'codec-instance', codecId: 'pg/text@1', typeParams: { length: 320 } },
        },
      },
    ),
    fieldName: 'email',
  },
  {
    kind: 'value-object column',
    definition: definitionOf(
      [
        user({
          fieldName: 'address',
          columnName: 'address',
          valueObjectName: 'Address',
          descriptor: { codecId: 'pg/jsonb@1' },
          nullable: true,
          many: true,
        }),
      ],
      {
        valueObjects: [
          {
            name: 'Address',
            fields: [{ fieldName: 'city', descriptor: { codecId: 'pg/text@1' }, nullable: false }],
          },
        ],
      },
    ),
    fieldName: 'address',
  },
  {
    kind: 'TypeScript literal default',
    definition: definitionOf([
      user(field('plan', 'pg/text@1', { default: { kind: 'literal', value: 'free' } })),
    ]),
    fieldName: 'plan',
  },
  {
    kind: 'canonical literal default',
    definition: definitionOf([
      user(
        field('plan', 'pg/text@1', {
          default: { kind: 'literal', value: 'free', canonical: true },
        }),
      ),
    ]),
    fieldName: 'plan',
  },
  {
    kind: 'function default',
    definition: definitionOf([
      user(
        field('createdAt', 'pg/timestamptz@1', {
          default: { kind: 'function', expression: 'now()' },
        }),
      ),
    ]),
    fieldName: 'createdAt',
  },
  {
    kind: 'column inside a foreign key with a backing index',
    definition: definitionOf([
      user(),
      {
        modelName: 'Post',
        tableName: 'Post',
        fields: [id, field('authorId')],
        id: { columns: ['id'] },
        foreignKeys: [
          {
            columns: ['authorId'],
            references: { model: 'User', table: 'User', columns: ['id'] },
            index: true,
          },
        ],
      },
    ]),
    modelName: 'Post',
    fieldName: 'authorId',
  },
  {
    kind: 'column inside an authored index',
    definition: definitionOf([
      {
        ...user(field('email', 'pg/text@1')),
        indexes: [columnIndex(['email'])],
      },
    ]),
    fieldName: 'email',
  },
  {
    kind: 'column on a single-table base table',
    definition: definitionOf([
      {
        modelName: 'Task',
        tableName: 'task',
        fields: [
          id,
          field('notes', 'pg/text@1'),
          field('severity', 'pg/text@1', { nullable: true }),
        ],
        id: { columns: ['id'] },
      },
      {
        modelName: 'Bug',
        tableName: 'task',
        sharesBaseTable: true,
        fields: [field('severity', 'pg/text@1')],
      },
    ]),
    modelName: 'Task',
    fieldName: 'notes',
  },
  {
    kind: "column on a multi-table variant's table",
    definition: definitionOf([
      { modelName: 'Task', tableName: 'task', fields: [id], id: { columns: ['id'] } },
      {
        modelName: 'Bug',
        tableName: 'bug',
        fields: [id, field('severity', 'pg/text@1')],
        id: { columns: ['id'] },
        foreignKeys: [
          { columns: ['id'], references: { model: 'Task', table: 'task', columns: ['id'] } },
        ],
      },
    ]),
    modelName: 'Bug',
    fieldName: 'severity',
  },
  {
    kind: 'column on a table that is not managed',
    definition: definitionOf([
      { ...user(field('tags', 'pg/text@1', { many: true, noCheck: [] })), control: 'external' },
    ]),
    fieldName: 'tags',
  },
];

describe('a column node lowers exactly as the field it replaces', () => {
  it.each(rows)('$kind', ({ definition, modelName = 'User', fieldName }) => {
    expect(build(withFieldAsColumnNode(definition, modelName, fieldName)).storage).toStrictEqual(
      build(definition).storage,
    );
  });
});
