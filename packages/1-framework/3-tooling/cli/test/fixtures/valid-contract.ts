import { defineContract, field, model } from '@internal/sql-contract-ts/contract-builder';
import { createTestSqlNamespace } from '../../../../../2-sql/1-core/contract/test/test-support';
import { testTypeLookups } from '../../../../../2-sql/1-core/contract/test/test-type-lookups';
import { int4Column, textColumn } from '../helpers/column-descriptors';
import { postgresPack } from '../helpers/postgres-pack';
import { sqlFamilyPack } from '../helpers/sql-family-pack';

const contractObj = defineContract({
  ...testTypeLookups,
  family: sqlFamilyPack,
  target: postgresPack,
  createNamespace: createTestSqlNamespace,
  models: {
    User: model('User', {
      fields: {
        id: field.column(int4Column).id(),
        email: field.column(textColumn),
      },
    }).sql({ table: 'user' }),
  },
});

export const contract = {
  ...contractObj,
  extensions: {
    postgres: {
      version: '0.0.1',
    },
  },
};
