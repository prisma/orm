// @vitest-environment jsdom

import { UNBOUND_NAMESPACE_ID } from '@prisma/orm-postgres/components/ir';
import { blindCast } from '@prisma/orm-postgres/utils/casts';
import { render, screen } from '@testing-library/react';
import { createElement } from 'react';
import { describe, expect, it } from 'vitest';
import { ContractView } from '../src/app/ContractView';
import type { Contract } from '../src/prisma/contract.d';

const contract = blindCast<
  Contract,
  'deliberately partial mock contract covering only what ContractView renders'
>({
  target: 'postgres',
  targetFamily: 'sql',
  domain: {
    namespaces: {
      [UNBOUND_NAMESPACE_ID]: {
        models: {
          user: {
            storage: {
              table: 'users',
              fields: { id: { column: 'id' }, email: { column: 'email' } },
            },
            fields: {
              id: { codecId: 'pg/uuid@1', nullable: false },
              email: { codecId: 'pg/text@1', nullable: false },
            },
            relations: {},
          },
        },
      },
    },
  },
  storage: {
    storageHash: 'storage_hash',
    namespaces: {
      __unbound__: {
        id: '__unbound__',
        kind: 'postgres-unbound-schema',
        entries: {
          table: {
            users: {
              primaryKey: { columns: ['id'] },
              columns: {
                id: { dataType: 'pg/uuid', nullable: false, codecId: 'pg/uuid@1' },
                email: { dataType: 'pg/text', nullable: false, codecId: 'pg/text@1' },
              },
              foreignKeys: [],
              uniques: [],
              indexes: [],
            },
          },
        },
      },
    },
  },
  capabilities: { sql: { returning: true } },
  extensions: {},
});

describe('ContractView', () => {
  it('shows the data type each column stores', () => {
    render(createElement(ContractView, { contract }));

    expect(screen.getAllByText('pg/uuid')).not.toHaveLength(0);
    expect(screen.getAllByText('pg/text')).not.toHaveLength(0);
  });
});
