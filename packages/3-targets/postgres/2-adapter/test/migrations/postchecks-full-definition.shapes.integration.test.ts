/**
 * The structural postchecks, checked both ways (see `fixtures/postcheck-cases.ts`) on the input shapes where a catalog check can fail after a correct execute: quoted mixed-case names, a schema other than `public`, the unbound namespace, columns in order across several columns, enum, list and raw column types, index element lists of plain columns, and policy roles written as SQL keywords.
 */
import { UNBOUND_NAMESPACE_ID } from '@internal/framework-components/ir';
import { col, fn } from '@internal/sql-relational-core/contract-free';
import { parseNaming } from '@internal/sql-schema-ir/naming';
import { postgresDataTypes } from '@internal/target-postgres/data-types';
import {
  AddColumnCall,
  AddForeignKeyCall,
  AddPrimaryKeyCall,
  AddUniqueCall,
  CreateIndexCall,
  CreatePostgresRlsPolicyCall,
  CreateTableCall,
  SetDefaultCall,
} from '@internal/target-postgres/op-factory-call';
import { PostgresRlsPolicy } from '@internal/target-postgres/types';
import { describePostcheckCases, type PostcheckCase } from './fixtures/postcheck-cases';
import { controlAdapter } from './fixtures/runner-fixtures';

const ORDER_ITEM =
  'create table public."OrderItem" ("Id" int4 not null, "Quantity" int4 not null, "Label" text)';
const APP_PARENT =
  'create table app.parent ("tenantId" int4 not null, id int4 not null, code int4 not null, primary key ("tenantId", id), unique ("tenantId", code))';
const PUBLIC_CHILD =
  'create table public.child (id int4 primary key, "tenantId" int4, "parentId" int4)';
const ITEM = 'create table public.item (id int4 primary key, price int4, label text)';

function itemPolicy(roles: readonly string[]) {
  return new PostgresRlsPolicy({
    naming: parseNaming('item_read', undefined),
    tableName: 'item',
    namespaceId: 'public',
    operation: 'all',
    roles,
    using: 'price > 0',
    withCheck: undefined,
    permissive: true,
  });
}

function addColumn(column: ReturnType<typeof col>, schema = 'public') {
  return () => new AddColumnCall(schema, 'item', column, postgresDataTypes).toOp(controlAdapter);
}

function itemIndex(expression: string) {
  return () =>
    new CreateIndexCall('public', 'item', 'item_lookup', { expression }).toOp(controlAdapter);
}

const cases: readonly PostcheckCase[] = [
  {
    name: 'createTable with a mixed-case quoted name over a view',
    before: [],
    conflicting: ['create view public."OrderItem" as select 1 as "Id"'],
    operation: () =>
      new CreateTableCall('public', 'OrderItem', [col('Id', 'int4', { notNull: true })]).toOp(
        controlAdapter,
      ),
  },
  {
    name: 'createTable in a schema other than public over a table in public',
    before: ['create schema app'],
    conflicting: ['create view app.thing as select 1 as id'],
    operation: () =>
      new CreateTableCall('app', 'thing', [col('id', 'int4', { notNull: true })]).toOp(
        controlAdapter,
      ),
  },
  {
    name: 'addColumn with mixed-case quoted names over a column of another type',
    before: [ORDER_ITEM],
    conflicting: ['alter table public."OrderItem" add column "Note" text'],
    operation: () =>
      new AddColumnCall('public', 'OrderItem', col('Note', 'int4'), postgresDataTypes).toOp(
        controlAdapter,
      ),
  },
  {
    name: 'addColumn of a list over a column of the element type',
    before: [ITEM],
    conflicting: ['alter table public.item add column tags text'],
    operation: addColumn(col('tags', 'text[]')),
  },
  {
    name: 'addColumn of an enum in another schema over a text column',
    before: ['create schema app', "create type app.\"Mood\" as enum ('happy', 'sad')", ITEM],
    conflicting: ['alter table public.item add column mood text'],
    operation: addColumn(col('mood', '"app"."Mood"')),
  },
  {
    name: 'addColumn of a raw type no data type reads over a text column',
    before: [ITEM],
    conflicting: ['alter table public.item add column search text'],
    operation: addColumn(col('search', 'tsvector')),
  },
  {
    name: 'addColumn of a SERIAL column over an integer column with no sequence',
    before: [ITEM],
    conflicting: ['alter table public.item add column number int4 not null default 0'],
    operation: addColumn(col('number', 'SERIAL', { notNull: true })),
  },
  {
    name: 'addColumn of a SERIAL column over one that owns a sequence but defaults to another',
    before: [ITEM, 'create sequence public.other_seq as integer'],
    conflicting: [
      "alter table public.item add column number int4 not null default nextval('public.other_seq')",
      'create sequence public.item_number_seq as integer owned by public.item.number',
    ],
    operation: addColumn(col('number', 'SERIAL', { notNull: true })),
  },
  {
    name: 'setDefault(autoincrement()) over a column that owns a sequence but defaults to another',
    before: [
      ITEM,
      'alter table public.item add column number int4 not null',
      'create sequence public.item_number_seq as integer owned by public.item.number',
      'create sequence public.other_seq as integer',
    ],
    conflicting: [
      "alter table public.item alter column number set default nextval('public.other_seq')",
    ],
    operation: () =>
      new SetDefaultCall(
        'public',
        'item',
        col('number', 'int4', { notNull: true, default: fn('autoincrement()') }),
        'widening',
      ).toOp(controlAdapter),
  },
  {
    name: 'addColumn in the unbound namespace over a column of another type',
    before: [ITEM],
    conflicting: ['alter table public.item add column note text'],
    operation: addColumn(col('note', 'int4'), UNBOUND_NAMESPACE_ID),
  },
  {
    name: 'addPrimaryKey on two columns over a primary key on them in the other order',
    before: [ORDER_ITEM],
    conflicting: [
      'alter table public."OrderItem" add constraint "OrderItem_pkey" primary key ("Quantity", "Id")',
    ],
    operation: () =>
      new AddPrimaryKeyCall('public', 'OrderItem', 'OrderItem_pkey', ['Id', 'Quantity']).toOp(
        controlAdapter,
      ),
  },
  {
    name: 'addUnique on two columns in another schema over a unique on one of them',
    before: ['create schema app', 'create table app.thing (a int4, b int4)'],
    conflicting: ['alter table app.thing add constraint thing_key unique (a)'],
    operation: () =>
      new AddUniqueCall('app', 'thing', 'thing_key', ['a', 'b']).toOp(controlAdapter),
  },
  {
    name: 'addForeignKey on two columns across schemas over one to the other key',
    before: ['create schema app', APP_PARENT, PUBLIC_CHILD],
    conflicting: [
      'alter table public.child add constraint child_parent_fk foreign key ("tenantId", "parentId") references app.parent ("tenantId", code)',
    ],
    operation: () =>
      new AddForeignKeyCall('public', 'child', {
        name: 'child_parent_fk',
        columns: ['tenantId', 'parentId'],
        references: { schema: 'app', table: 'parent', columns: ['tenantId', 'id'] },
      }).toOp(controlAdapter),
  },
  {
    name: 'addForeignKey in the unbound namespace over one with another update action',
    before: [
      ITEM,
      'create table public.owner (id int4 primary key)',
      'alter table public.item add column owner_id int4',
    ],
    conflicting: [
      'alter table public.item add constraint item_owner_fk foreign key (owner_id) references public.owner (id) on update cascade',
    ],
    operation: () =>
      new AddForeignKeyCall(UNBOUND_NAMESPACE_ID, 'item', {
        name: 'item_owner_fk',
        columns: ['owner_id'],
        references: { schema: UNBOUND_NAMESPACE_ID, table: 'owner', columns: ['id'] },
      }).toOp(controlAdapter),
  },
  {
    name: 'createIndex with mixed-case quoted names over an index on another column',
    before: [ORDER_ITEM],
    conflicting: ['create index "OrderItem_Label_idx" on public."OrderItem" ("Quantity")'],
    operation: () =>
      new CreateIndexCall('public', 'OrderItem', 'OrderItem_Label_idx', {
        columns: ['Label'],
      }).toOp(controlAdapter),
  },
  {
    name: 'createIndex of a descending column over an index on another table',
    before: [ITEM, 'create table public.other (price int4)'],
    conflicting: ['create index item_lookup on public.other (price)'],
    operation: itemIndex('"price" DESC'),
  },
  {
    name: 'createIndex of a column with an operator class over a unique index',
    before: [ITEM],
    conflicting: ['create unique index item_lookup on public.item (label text_pattern_ops)'],
    operation: itemIndex('"label" text_pattern_ops'),
  },
  {
    name: 'createIndex of a column with a collation over a hash index',
    before: [ITEM],
    conflicting: ['create index item_lookup on public.item using hash (label)'],
    operation: itemIndex('"label" COLLATE "C"'),
  },
  {
    name: 'createIndex of two plain columns with a sort order over a partial index',
    before: [ITEM],
    conflicting: ['create index item_lookup on public.item (price) where price > 0'],
    operation: itemIndex('"price" DESC, "label"'),
  },
  {
    name: 'createRlsPolicy for current_user over a policy for public',
    before: [ITEM],
    conflicting: ['create policy item_read on public.item for all to public using (price > 0)'],
    operation: () =>
      new CreatePostgresRlsPolicyCall('public', 'item', itemPolicy(['current_user'])).toOp(
        controlAdapter,
      ),
  },
  {
    name: 'createRlsPolicy for session_user and public over a policy for select only',
    before: [ITEM],
    conflicting: ['create policy item_read on public.item for select to public using (price > 0)'],
    operation: () =>
      new CreatePostgresRlsPolicyCall(
        'public',
        'item',
        itemPolicy(['session_user', 'public']),
      ).toOp(controlAdapter),
  },
];

describePostcheckCases('structural postchecks on other input shapes', cases, { schemas: ['app'] });
