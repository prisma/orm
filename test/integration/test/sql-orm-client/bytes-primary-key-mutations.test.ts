import { byteaColumn, int4Column, textColumn } from '@internal/adapter-postgres/column-types';
import postgresAdapter from '@internal/adapter-postgres/runtime';
import { defineContract, field, model, rel } from '@internal/postgres/contract-builder';
import { Collection } from '@internal/sql-orm-client';
import { createExecutionContext, createSqlExecutionStack } from '@internal/sql-runtime';
import postgresTarget from '@internal/target-postgres/runtime';
import { describe, expect, it } from 'vitest';
import { timeouts, withPushedContractRuntime } from './integration-helpers';

const DocumentBase = model('Document', {
  fields: {
    id: field.column(byteaColumn).id(),
    title: field.column(textColumn),
  },
});

const Revision = model('Revision', {
  fields: {
    id: field.column(int4Column).id(),
    documentId: field.column(byteaColumn).column('document_id'),
    body: field.column(textColumn),
  },
  relations: {
    document: rel.belongsTo(DocumentBase, { from: 'documentId', to: 'id' }),
  },
}).sql({ table: 'bpk_revisions' });

const Document = DocumentBase.relations({
  revisions: rel.hasMany(() => Revision, { by: 'documentId' }),
}).sql({ table: 'bpk_documents' });

const documentsContract = defineContract({ models: { Document, Revision } });
const documentsContext = createExecutionContext({
  contract: documentsContract,
  stack: createSqlExecutionStack({ target: postgresTarget, adapter: postgresAdapter }),
});

type Documents = Collection<typeof documentsContract, 'Document'>;

const firstId = new Uint8Array([0x01, 0x02, 0x03]);
const secondId = new Uint8Array([0xff, 0x00, 0x10]);

async function withDocuments(fn: (documents: Documents) => Promise<void>): Promise<void> {
  await withPushedContractRuntime(documentsContract, async (runtime) => {
    const documents = new Collection({ runtime, context: documentsContext }, 'Document', {
      namespaceId: 'public',
    });
    await documents.create({ id: firstId, title: 'First' });
    await documents.create({ id: secondId, title: 'Second' });
    await fn(documents);
  });
}

async function readDocuments(documents: Documents) {
  return documents
    .select('id', 'title')
    .orderBy((document) => document.title.asc())
    .include('revisions', (revision) =>
      revision.select('id', 'body').orderBy((r) => r['id']!.asc()),
    )
    .all();
}

describe('integration/mutations on a Bytes primary key', () => {
  it(
    'update() changes and returns the matched row',
    async () => {
      await withDocuments(async (documents) => {
        const updated = await documents
          .select('id', 'title')
          .where({ id: secondId })
          .update({ title: 'Second, edited' });

        expect(updated).toEqual({ id: secondId, title: 'Second, edited' });
        expect(await readDocuments(documents)).toEqual([
          { id: firstId, title: 'First', revisions: [] },
          { id: secondId, title: 'Second, edited', revisions: [] },
        ]);
      });
    },
    timeouts.spinUpPpgDev,
  );

  it(
    'a nested update changes the matched row and creates its children',
    async () => {
      await withDocuments(async (documents) => {
        const updated = await documents
          .select('id', 'title')
          .where({ id: secondId })
          .update({
            title: 'Second, revised',
            revisions: (revisions) => revisions.create([{ id: 1, body: 'draft' }]),
          });

        expect(updated).toEqual({ id: secondId, title: 'Second, revised' });
        expect(await readDocuments(documents)).toEqual([
          { id: firstId, title: 'First', revisions: [] },
          { id: secondId, title: 'Second, revised', revisions: [{ id: 1, body: 'draft' }] },
        ]);
      });
    },
    timeouts.spinUpPpgDev,
  );

  it(
    'a nested create reloads the created row',
    async () => {
      await withDocuments(async (documents) => {
        const thirdId = new Uint8Array([0x0a, 0x0b]);
        const created = await documents.select('id', 'title').create({
          id: thirdId,
          title: 'Third',
          revisions: (revisions) => revisions.create([{ id: 2, body: 'outline' }]),
        });

        expect(created).toEqual({ id: thirdId, title: 'Third' });
        expect(await readDocuments(documents)).toEqual([
          { id: firstId, title: 'First', revisions: [] },
          { id: secondId, title: 'Second', revisions: [] },
          { id: thirdId, title: 'Third', revisions: [{ id: 2, body: 'outline' }] },
        ]);
      });
    },
    timeouts.spinUpPpgDev,
  );

  it(
    'delete() removes only the matched row',
    async () => {
      await withDocuments(async (documents) => {
        const deleted = await documents.select('id', 'title').where({ id: firstId }).delete();

        expect(deleted).toEqual({ id: firstId, title: 'First' });
        expect(await readDocuments(documents)).toEqual([
          { id: secondId, title: 'Second', revisions: [] },
        ]);
      });
    },
    timeouts.spinUpPpgDev,
  );
});
