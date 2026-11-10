import { describe, expect, it } from 'vitest';
import { asNamespaceId } from '../src/namespace-id';
import { applicationDomainOf } from './support/application-domain-of';

function crossRef(model: string, namespace = 'default') {
  return { namespace: asNamespaceId(namespace), model };
}

import type { Contract } from '../src/contract-types';
import { domainModelsAtDefaultNamespace } from '../src/domain-namespace-access';
import type { ProfileHashBase, StorageHashBase } from '../src/types';

describe('unified contract types', () => {
  describe('framework consumer compatibility', () => {
    it('framework code reads domain fields from Contract (opaque storage)', () => {
      function frameworkConsumer(contract: Contract): string[] {
        return Object.entries(domainModelsAtDefaultNamespace(contract.domain)).map(
          ([name, model]) => {
            const fieldCount = Object.keys(model.fields).length;
            return `${name}: ${fieldCount} fields`;
          },
        );
      }

      const hash = 'abc123' as StorageHashBase<'abc123'>;
      const profHash = 'prof' as ProfileHashBase<'prof'>;
      const contract: Contract = {
        target: 'postgres',
        targetFamily: 'sql',
        roots: { users: crossRef('User') },
        domain: applicationDomainOf({
          models: {
            User: {
              fields: {
                id: {
                  nullable: false,
                  type: { kind: 'scalar', codecId: 'pg/int4@1' },
                  many: false,
                },
                email: {
                  nullable: false,
                  type: { kind: 'scalar', codecId: 'pg/text@1' },
                  many: false,
                },
              },
              relations: {},
              storage: {},
            },
          },
        }),
        storage: { storageHash: hash, namespaces: {} },
        capabilities: {},
        extensions: {},
        meta: {},
        profileHash: profHash,
      };

      const result = frameworkConsumer(contract);
      expect(result).toEqual(['User: 2 fields']);
    });
  });
});
