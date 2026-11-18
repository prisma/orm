/**
 * The runner skips an operation whose postchecks all hold before it runs. So a postcheck may hold only once the operation's full effect is in place. Each case below prepares a database holding an object with the operation's name but another definition, and asserts the postchecks do not all hold there; then it runs the operation on a database without that object and asserts they all hold.
 */
import { UNBOUND_NAMESPACE_ID } from '@internal/framework-components/ir';
import { col, fn, primaryKey } from '@internal/sql-relational-core/contract-free';
import { parseNaming } from '@internal/sql-schema-ir/naming';
import { postgresDataTypes } from '@internal/target-postgres/data-types';
import {
  AddCheckConstraintCall,
  AddColumnCall,
  AddColumnWithTemporaryDefaultCall,
  AddForeignKeyCall,
  AddPrimaryKeyCall,
  AddRequiredColumnToEmptyTableCall,
  AddUniqueCall,
  AlterColumnTypeCall,
  CreateIndexCall,
  CreatePostgresRlsPolicyCall,
  CreateTableCall,
  RenameConstraintCall,
  RenameIndexCall,
  RenamePostgresRlsPolicyCall,
  SetDefaultCall,
} from '@internal/target-postgres/op-factory-call';
import { PostgresRlsPolicy } from '@internal/target-postgres/types';
import { expect, it } from 'vitest';
import { describePostcheckCases, type PostcheckCase } from './fixtures/postcheck-cases';
import { controlAdapter, testTimeout } from './fixtures/runner-fixtures';

function itemPolicy(name: string, operation: 'all' | 'select', permissive = true) {
  return new PostgresRlsPolicy({
    naming: parseNaming(name, undefined),
    tableName: 'item',
    namespaceId: 'public',
    operation,
    roles: [],
    using: 'price > 0',
    withCheck: undefined,
    permissive,
  });
}

const ITEM = 'create table public.item (id int4 primary key, price int4, owner_id int4)';
const OWNER = 'create table public.owner (id int4 primary key, code int4 unique)';

const cases: readonly PostcheckCase[] = [
  {
    name: 'createTable over a view of the same name',
    before: [],
    conflicting: ['create view public.item as select 1 as id'],
    operation: () =>
      new CreateTableCall(
        'public',
        'item',
        [col('id', 'int4', { notNull: true })],
        [primaryKey(['id'])],
      ).toOp(controlAdapter),
  },
  {
    name: 'addColumn over a column of another type',
    before: [ITEM],
    conflicting: ['alter table public.item add column label text'],
    operation: () =>
      new AddColumnCall('public', 'item', col('label', 'int4'), postgresDataTypes).toOp(
        controlAdapter,
      ),
  },
  {
    name: 'addColumn NOT NULL over a nullable column',
    before: [ITEM],
    conflicting: ['alter table public.item add column label int4'],
    operation: () =>
      new AddColumnCall(
        'public',
        'item',
        col('label', 'int4', { notNull: true, default: fn('0') }),
        postgresDataTypes,
      ).toOp(controlAdapter),
  },
  {
    name: 'addColumn of a varchar over a varchar of another length',
    before: [ITEM],
    conflicting: ['alter table public.item add column label varchar(10)'],
    operation: () =>
      new AddColumnCall('public', 'item', col('label', 'varchar(20)'), postgresDataTypes).toOp(
        controlAdapter,
      ),
  },
  {
    name: 'addColumnWithTemporaryDefault over a NOT NULL column of another type',
    before: [ITEM],
    conflicting: [
      "alter table public.item add column label text not null default ''",
      'alter table public.item alter column label drop default',
    ],
    operation: () =>
      new AddColumnWithTemporaryDefaultCall(
        'public',
        'item',
        'label',
        'int4',
        '0',
        postgresDataTypes,
      ).toOp(controlAdapter),
  },
  {
    name: 'addRequiredColumnToEmptyTable over a NOT NULL column of another type',
    before: [ITEM],
    conflicting: ['alter table public.item add column label text not null'],
    operation: () =>
      new AddRequiredColumnToEmptyTableCall(
        'public',
        'item',
        'label',
        'int4',
        postgresDataTypes,
      ).toOp(controlAdapter),
  },
  {
    name: 'createIndex over an index on another column',
    before: [ITEM],
    conflicting: ['create index item_lookup on public.item (owner_id)'],
    operation: () =>
      new CreateIndexCall('public', 'item', 'item_lookup', { columns: ['price'] }).toOp(
        controlAdapter,
      ),
  },
  {
    name: 'createIndex over an index on the same columns in another order',
    before: [ITEM],
    conflicting: ['create index item_lookup on public.item (owner_id, price)'],
    operation: () =>
      new CreateIndexCall('public', 'item', 'item_lookup', {
        columns: ['price', 'owner_id'],
      }).toOp(controlAdapter),
  },
  {
    name: 'createIndex unique over an index that is not unique',
    before: [ITEM],
    conflicting: ['create index item_lookup on public.item (price)'],
    operation: () =>
      new CreateIndexCall(
        'public',
        'item',
        'item_lookup',
        { columns: ['price'] },
        { unique: true },
      ).toOp(controlAdapter),
  },
  {
    name: 'createIndex over an index with another access method',
    before: [ITEM],
    conflicting: ['create index item_lookup on public.item using hash (price)'],
    operation: () =>
      new CreateIndexCall('public', 'item', 'item_lookup', { columns: ['price'] }).toOp(
        controlAdapter,
      ),
  },
  {
    name: 'createIndex partial over an index without a predicate',
    before: [ITEM],
    conflicting: ['create index item_lookup on public.item (price)'],
    operation: () =>
      new CreateIndexCall(
        'public',
        'item',
        'item_lookup',
        { columns: ['price'] },
        { where: 'price > 0' },
      ).toOp(controlAdapter),
  },
  {
    name: 'createIndex on an expression over a unique index',
    before: [ITEM],
    conflicting: ['create unique index item_lookup on public.item ((price * 2))'],
    operation: () =>
      new CreateIndexCall('public', 'item', 'item_lookup', { expression: '(price * 2)' }).toOp(
        controlAdapter,
      ),
  },
  {
    name: 'createIndex over a table of the same name',
    before: [ITEM],
    conflicting: ['create table public.item_lookup (id int4)'],
    operation: () =>
      new CreateIndexCall('public', 'item', 'item_lookup', { columns: ['price'] }).toOp(
        controlAdapter,
      ),
  },
  {
    name: 'addPrimaryKey over a unique constraint of the same name',
    before: ['create table public.item (id int4 not null, price int4)'],
    conflicting: ['alter table public.item add constraint item_pkey unique (id)'],
    operation: () =>
      new AddPrimaryKeyCall('public', 'item', 'item_pkey', ['id']).toOp(controlAdapter),
  },
  {
    name: 'addUnique over a unique constraint on other columns',
    before: [ITEM],
    conflicting: ['alter table public.item add constraint item_key unique (owner_id)'],
    operation: () =>
      new AddUniqueCall('public', 'item', 'item_key', ['price']).toOp(controlAdapter),
  },
  {
    name: 'addUnique in the unbound namespace over a check constraint of the same name',
    before: [ITEM],
    conflicting: ['alter table public.item add constraint item_key check (price > 0)'],
    operation: () =>
      new AddUniqueCall(UNBOUND_NAMESPACE_ID, 'item', 'item_key', ['price']).toOp(controlAdapter),
  },
  {
    name: 'addForeignKey over a foreign key with another delete action',
    before: [ITEM, OWNER],
    conflicting: [
      'alter table public.item add constraint item_owner_fk foreign key (owner_id) references public.owner (id) on delete cascade',
    ],
    operation: () =>
      new AddForeignKeyCall('public', 'item', {
        name: 'item_owner_fk',
        columns: ['owner_id'],
        references: { schema: 'public', table: 'owner', columns: ['id'] },
      }).toOp(controlAdapter),
  },
  {
    name: 'addForeignKey over a foreign key to other referenced columns',
    before: [ITEM, OWNER],
    conflicting: [
      'alter table public.item add constraint item_owner_fk foreign key (owner_id) references public.owner (code)',
    ],
    operation: () =>
      new AddForeignKeyCall('public', 'item', {
        name: 'item_owner_fk',
        columns: ['owner_id'],
        references: { schema: 'public', table: 'owner', columns: ['id'] },
        onUpdate: 'cascade',
      }).toOp(controlAdapter),
  },
  {
    name: 'addCheckConstraint over a unique constraint of the same name',
    before: [ITEM],
    conflicting: ['alter table public.item add constraint item_price_check unique (price)'],
    operation: () =>
      new AddCheckConstraintCall('public', 'item', 'item_price_check', 'price > 0').toOp(
        controlAdapter,
      ),
  },
  {
    name: 'createRlsPolicy over a policy for another command',
    before: [ITEM],
    conflicting: ['create policy item_read on public.item for select using (price > 0)'],
    operation: () =>
      new CreatePostgresRlsPolicyCall('public', 'item', itemPolicy('item_read', 'all')).toOp(
        controlAdapter,
      ),
  },
  {
    name: 'createRlsPolicy over a policy that is not restrictive',
    before: [ITEM],
    conflicting: ['create policy item_read on public.item for all using (price > 0)'],
    operation: () =>
      new CreatePostgresRlsPolicyCall('public', 'item', itemPolicy('item_read', 'all', false)).toOp(
        controlAdapter,
      ),
  },
  {
    name: 'createRlsPolicy over a policy for other roles',
    before: [ITEM],
    conflicting: [
      'create policy item_read on public.item for all to current_user using (price > 0)',
    ],
    operation: () =>
      new CreatePostgresRlsPolicyCall('public', 'item', itemPolicy('item_read', 'all')).toOp(
        controlAdapter,
      ),
  },
  {
    name: 'renameIndex while the old index still exists',
    before: [ITEM, 'create index item_old on public.item (price)'],
    conflicting: ['create index item_new on public.item (owner_id)'],
    operation: () =>
      new RenameIndexCall('public', 'item', 'item_old', 'item_new').toOp(controlAdapter),
  },
  {
    name: 'renameConstraint while the old constraint still exists',
    before: [ITEM, 'alter table public.item add constraint item_old unique (price)'],
    conflicting: ['alter table public.item add constraint item_new unique (owner_id)'],
    operation: () =>
      new RenameConstraintCall('public', 'item', 'unique', 'item_old', 'item_new').toOp(
        controlAdapter,
      ),
  },
  {
    name: 'renameRlsPolicy while the old policy still exists',
    before: [ITEM, 'create policy item_old on public.item for all using (price > 0)'],
    conflicting: ['create policy item_new on public.item for all using (price > 0)'],
    operation: () =>
      new RenamePostgresRlsPolicyCall('public', 'item', 'item_old', 'item_new').toOp(
        controlAdapter,
      ),
  },
  {
    name: 'setDefault(autoincrement()) on a bigint column that owns an integer sequence',
    before: ['create table public.item (id int8 not null)'],
    conflicting: [
      'create sequence public.item_id_seq as integer owned by public.item.id',
      "alter table public.item alter column id set default nextval('public.item_id_seq')",
    ],
    operation: () =>
      new SetDefaultCall(
        'public',
        'item',
        col('id', 'int8', { notNull: true, default: fn('autoincrement()') }),
        'additive',
      ).toOp(controlAdapter),
  },
  {
    name: 'alterColumnType to bigint on an autoincrement() column whose sequence is still integer',
    before: ['create table public.item (id serial not null)'],
    conflicting: ['alter table public.item alter column id type int8'],
    operation: () =>
      new AlterColumnTypeCall({
        schemaName: 'public',
        tableName: 'item',
        columnName: 'id',
        type: 'int8',
        dataTypes: postgresDataTypes,
        ownsAutoincrementSequence: true,
      }).toOp(controlAdapter),
  },
];

describePostcheckCases('postchecks hold only once the full effect is in place', cases, {
  schemas: [],
  extra: (db) => {
    it('renameRlsPolicy refuses to run while a policy already has the new name', {
      timeout: testTimeout,
    }, async () => {
      await db.run([
        ITEM,
        'create policy item_old on public.item for all using (price > 0)',
        'create policy item_new on public.item for all using (price > 0)',
      ]);
      const op = await new RenamePostgresRlsPolicyCall(
        'public',
        'item',
        'item_old',
        'item_new',
      ).toOp(controlAdapter);

      expect(await db.allHold(op.precheck)).toBe(false);
    });
  },
});
