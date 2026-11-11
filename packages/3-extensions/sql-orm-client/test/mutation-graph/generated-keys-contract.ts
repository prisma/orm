import { int4Column, textColumn } from '@internal/adapter-postgres/column-types';
import type { Contract } from '@internal/contract/types';
import type { SqlStorage } from '@internal/sql-contract/types';
import { autoincrement } from '@internal/sql-contract-ts/contract-builder';
import { defineContract, field, model, rel } from '../contract-builder';
import { buildTestContextFromContract } from '../helpers';

const Counter = model('Counter', {
  fields: {
    id: field.column(int4Column).default(autoincrement()).id(),
    label: field.column(textColumn),
    slug: field.column(textColumn).unique(),
  },
}).sql({ table: 'counters' });
const Note = model('Note', {
  fields: {
    id: field.column(textColumn).defaultSql('gen_random_uuid()').id(),
    body: field.column(textColumn),
  },
}).sql({ table: 'notes' });

const OwnerBase = model('Owner', {
  fields: { id: field.column(int4Column).id() },
});
const FolderBase = model('Folder', {
  fields: {
    id: field.column(textColumn).defaultSql('gen_random_uuid()').id(),
    name: field.column(textColumn),
    ownerId: field.column(int4Column).column('owner_id'),
  },
  relations: { owner: rel.belongsTo(OwnerBase, { from: 'ownerId', to: 'id' }) },
});
const Page = model('Page', {
  fields: {
    id: field.column(int4Column).id(),
    folderId: field.column(textColumn).column('folder_id'),
  },
  relations: { folder: rel.belongsTo(FolderBase, { from: 'folderId', to: 'id' }) },
}).sql({ table: 'pages' });
const Folder = FolderBase.relations({
  pages: rel.hasMany(() => Page, { by: 'folderId' }),
}).sql({ table: 'folders' });
const Owner = OwnerBase.relations({
  folders: rel.hasMany(() => Folder, { by: 'ownerId' }),
}).sql({ table: 'owners' });

const generatedContract: Contract<SqlStorage> = {
  ...defineContract({ models: { Counter, Note, Owner, Folder, Page } }),
  capabilities: { sql: { defaultInInsert: true } },
};

export const generatedContext = {
  ...buildTestContextFromContract(generatedContract),
  contract: generatedContract,
};
