import { describe, expect, it } from 'vitest';
import { asNamespaceId } from '../src/namespace-id';
import { applicationDomainOf } from './support/application-domain-of';

function crossRef(model: string, namespace = 'default') {
  return { namespace: asNamespaceId(namespace), model };
}

import type { Contract } from '../src/contract-types';
import { domainModelsAtDefaultNamespace } from '../src/domain-namespace-access';
import type { ContractModel } from '../src/domain-types';
import type { ExecutionHashBase, ProfileHashBase, StorageHashBase } from '../src/types';

describe('unified contract types', () => {
  describe('ContractModel', () => {
    it('preserves polymorphism fields (discriminator, variants, base, owner)', () => {
      const model: ContractModel = {
        fields: {
          type: { nullable: false, type: { kind: 'scalar', codecId: 'pg/text@1' }, many: false },
        },
        relations: {},
        storage: {},
        discriminator: { field: 'type' },
        variants: { Special: { value: 'special' } },
        owner: 'Parent',
      };
      expect(model.discriminator?.field).toBe('type');
      expect(model.owner).toBe('Parent');
    });
  });

  describe('StorageBase', () => {
    it('carries branded storageHash', () => {
      const hash = 'abc123' as StorageHashBase<'abc123'>;
      const storage = { storageHash: hash, namespaces: {} };
      expect(storage.storageHash).toBe('abc123');
    });
  });

  describe('Contract<TStorage>', () => {
    it('accepts a full contract value', () => {
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
      expect(contract.target).toBe('postgres');
      expect(contract.roots['users']).toEqual(crossRef('User'));
    });

    it('accepts optional execution', () => {
      const hash = 'abc123' as StorageHashBase<'abc123'>;
      const execHash = 'exec456' as ExecutionHashBase<'exec456'>;
      const profHash = 'prof789' as ProfileHashBase<'prof789'>;
      const contract: Contract = {
        target: 'postgres',
        targetFamily: 'sql',
        roots: {},
        domain: applicationDomainOf({ models: {} }),
        storage: { storageHash: hash, namespaces: {} },
        capabilities: {},
        extensions: {},
        meta: {},
        execution: {
          executionHash: execHash,
          mutations: { defaults: [] },
        },
        profileHash: profHash,
      };
      expect(contract.execution?.executionHash).toBe('exec456');
      expect(contract.profileHash).toBe('prof789');
    });
  });

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
