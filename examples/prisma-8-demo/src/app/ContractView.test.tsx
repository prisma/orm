// @vitest-environment jsdom

import { UNBOUND_NAMESPACE_ID } from '@prisma/orm-postgres/components/ir';
import { blindCast } from '@prisma/orm-postgres/utils/casts';
import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import type { Contract } from '../prisma/contract.d';
import { ContractView } from './ContractView';

function buildContract(overrides?: Partial<Contract>): Contract {
  const userModel = {
    storage: {
      table: 'users',
      fields: {
        id: { column: 'id' },
        email: { column: 'email' },
      },
    },
    fields: {
      id: { codecId: 'pg/uuid@1', nullable: false },
      email: { codecId: 'pg/text@1', nullable: false },
    },
    relations: {},
  };
  const base = blindCast<
    Contract,
    'deliberately partial mock contract covering only what ContractView renders'
  >({
    target: 'postgres',
    targetFamily: 'sql',
    domain: {
      namespaces: {
        [UNBOUND_NAMESPACE_ID]: {
          models: {
            user: userModel,
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
    capabilities: {
      sql: { returning: true },
    },
    extensions: {
      pgvector: {},
    },
  });

  return { ...base, ...overrides };
}

describe('ContractView', () => {
  it('renders expected section headings and badges', () => {
    const contract = buildContract();
    render(<ContractView contract={contract} />);

    expect(screen.getByText('Target: postgres')).toBeDefined();
    expect(screen.getByText('Models')).toBeDefined();
    expect(screen.getByText('Tables')).toBeDefined();
    expect(screen.getByText('Capabilities')).toBeDefined();
    expect(screen.getByText('Extensions')).toBeDefined();
    expect(screen.getByText('sql/returning')).toBeDefined();
    expect(screen.getByText('pgvector')).toBeDefined();
  });

  it('renders untrusted values as text content (no XSS)', () => {
    const untrusted = '<img src=x onerror=alert(1) />';
    const contract = buildContract({
      domain: {
        namespaces: {
          [UNBOUND_NAMESPACE_ID]: {
            models: {
              [untrusted]: {
                storage: {
                  table: 'users',
                  fields: {
                    [untrusted]: { column: untrusted },
                  },
                },
                fields: {
                  [untrusted]: { codecId: 'pg/text@1', nullable: false },
                },
                relations: {},
              },
            },
          },
        },
      },
    } as unknown as Partial<Contract>);

    const { container } = render(<ContractView contract={contract} />);

    expect(container.querySelector('img')).toBeNull();
    expect(screen.getByText(untrusted)).toBeDefined();
  });
});
