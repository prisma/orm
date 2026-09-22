import {
  asNamespaceId,
  type ContractModelBase,
  UNBOUND_DOMAIN_NAMESPACE_ID,
} from '@internal/contract/types';
import {
  type DomainContractShape,
  validateContractDomain,
} from '@internal/contract/validate-domain';
import { applicationDomainOf } from '@repo/test-utils';
import { describe, expect, it } from 'vitest';

function crossRef(model: string, namespace: string = UNBOUND_DOMAIN_NAMESPACE_ID) {
  return { namespace: asNamespaceId(namespace), model };
}

function makeMinimalModel(overrides: Record<string, unknown> = {}) {
  return {
    fields: {},
    relations: {},
    storage: {},
    ...overrides,
  };
}

function makeValidContract(overrides: Record<string, unknown> = {}): DomainContractShape {
  const defaultModels = {
    Item: makeMinimalModel({
      fields: { _id: { type: { kind: 'scalar', codecId: 'mongo/objectId@1' }, nullable: false } },
    }),
  };
  const {
    models: modelsOverride,
    roots: rootsOverride,
    domain: domainOverride,
    ...rest
  } = overrides;
  const models = {
    ...defaultModels,
    ...(modelsOverride !== undefined ? (modelsOverride as Record<string, ContractModelBase>) : {}),
  };
  return {
    roots: (rootsOverride as DomainContractShape['roots']) ?? { items: crossRef('Item') },
    domain:
      domainOverride !== undefined
        ? (domainOverride as DomainContractShape['domain'])
        : applicationDomainOf({ models }),
    ...rest,
  } as DomainContractShape;
}

describe('validateContractDomain()', () => {
  describe('root validation', () => {
    it('accepts valid roots', () => {
      expect(() => validateContractDomain(makeValidContract())).not.toThrow();
    });

    it('rejects duplicate root values', () => {
      const contract = makeValidContract({
        roots: { items: crossRef('Item'), things: crossRef('Item') },
      });
      expect(() => validateContractDomain(contract)).toThrow(/duplicate root.*Item/i);
    });

    it('rejects root referencing non-existent model', () => {
      const contract = makeValidContract({
        roots: { items: crossRef('Item'), ghosts: crossRef('Ghost') },
      });
      expect(() => validateContractDomain(contract)).toThrow(/root.*ghosts.*Ghost.*not exist/i);
    });
  });

  describe('variant-base bidirectional consistency', () => {
    it('accepts consistent variant-base relationships', () => {
      const contract = makeValidContract({
        roots: { items: crossRef('Item') },
        models: {
          Item: makeMinimalModel({
            fields: {
              type: { type: { kind: 'scalar', codecId: 'mongo/string@1' }, nullable: false },
            },
            discriminator: { field: 'type' },
            variants: { SpecialItem: { value: 'special' } },
          }),
          SpecialItem: makeMinimalModel({ base: crossRef('Item') }),
        },
      });
      expect(() => validateContractDomain(contract)).not.toThrow();
    });

    it('rejects variant referencing non-existent model', () => {
      const contract = makeValidContract({
        models: {
          Item: makeMinimalModel({
            fields: {
              type: { type: { kind: 'scalar', codecId: 'mongo/string@1' }, nullable: false },
            },
            discriminator: { field: 'type' },
            variants: { Ghost: { value: 'ghost' } },
          }),
        },
      });
      expect(() => validateContractDomain(contract)).toThrow(/variant.*Ghost.*not exist/i);
    });

    it('rejects variant whose base does not match the declaring model', () => {
      const contract = makeValidContract({
        roots: { items: crossRef('Item') },
        models: {
          Item: makeMinimalModel({
            fields: {
              type: { type: { kind: 'scalar', codecId: 'mongo/string@1' }, nullable: false },
            },
            discriminator: { field: 'type' },
            variants: { Child: { value: 'child' } },
          }),
          Other: makeMinimalModel({
            fields: {
              type: { type: { kind: 'scalar', codecId: 'mongo/string@1' }, nullable: false },
            },
            discriminator: { field: 'type' },
            variants: {},
          }),
          Child: makeMinimalModel({ base: crossRef('Other') }),
        },
      });
      expect(() => validateContractDomain(contract)).toThrow(
        /variant.*Child.*base.*Other.*expected.*Item/i,
      );
    });

    it('rejects model with base that does not list it as a variant', () => {
      const contract = makeValidContract({
        roots: { items: crossRef('Item') },
        models: {
          Item: makeMinimalModel({
            fields: {
              type: { type: { kind: 'scalar', codecId: 'mongo/string@1' }, nullable: false },
            },
            discriminator: { field: 'type' },
            variants: {},
          }),
          Orphan: makeMinimalModel({ base: crossRef('Item') }),
        },
      });
      expect(() => validateContractDomain(contract)).toThrow(
        /model.*Orphan.*base.*Item.*not list.*variant/i,
      );
    });

    it('rejects model with base referencing non-existent model', () => {
      const contract = makeValidContract({
        models: {
          Item: makeMinimalModel({ base: crossRef('Ghost') }),
        },
      });
      expect(() => validateContractDomain(contract)).toThrow(/base.*Ghost.*not exist/i);
    });
  });

  describe('relation target validation', () => {
    it('accepts relations with valid targets', () => {
      const contract = makeValidContract({
        roots: { items: crossRef('Item') },
        models: {
          Item: makeMinimalModel({
            relations: {
              owner: {
                to: crossRef('User'),
                cardinality: 'N:1',
                nullable: false,
                on: { localFields: ['ownerId'], targetFields: ['_id'] },
              },
            },
          }),
          User: makeMinimalModel(),
        },
      });
      expect(() => validateContractDomain(contract)).not.toThrow();
    });

    it('rejects relation targeting non-existent model', () => {
      const contract = makeValidContract({
        models: {
          Item: makeMinimalModel({
            relations: {
              owner: {
                to: crossRef('Ghost'),
                cardinality: 'N:1',
                nullable: false,
                on: { localFields: ['ownerId'], targetFields: ['_id'] },
              },
            },
          }),
        },
      });
      expect(() => validateContractDomain(contract)).toThrow(
        /relation.*owner.*Item.*target.*Ghost.*not exist/i,
      );
    });
  });

  describe('discriminator invariants', () => {
    it('rejects model with discriminator but no variants', () => {
      const contract = makeValidContract({
        models: {
          Item: makeMinimalModel({
            fields: {
              type: { type: { kind: 'scalar', codecId: 'mongo/string@1' }, nullable: false },
            },
            discriminator: { field: 'type' },
          }),
        },
      });
      expect(() => validateContractDomain(contract)).toThrow(
        /model.*Item.*discriminator.*no variants/i,
      );
    });

    it('rejects model with discriminator field not in fields', () => {
      const contract = makeValidContract({
        models: {
          Item: makeMinimalModel({
            fields: {
              _id: { type: { kind: 'scalar', codecId: 'mongo/objectId@1' }, nullable: false },
            },
            discriminator: { field: 'kind' },
            variants: { Special: { value: 'special' } },
          }),
          Special: makeMinimalModel({ base: crossRef('Item') }),
        },
      });
      expect(() => validateContractDomain(contract)).toThrow(
        /discriminator.*kind.*not.*field.*Item/i,
      );
    });

    it('rejects model with base that also has discriminator', () => {
      const contract = makeValidContract({
        roots: { items: crossRef('Item') },
        models: {
          Item: makeMinimalModel({
            fields: {
              type: { type: { kind: 'scalar', codecId: 'mongo/string@1' }, nullable: false },
            },
            discriminator: { field: 'type' },
            variants: { Child: { value: 'child' } },
          }),
          Child: makeMinimalModel({
            base: crossRef('Item'),
            discriminator: { field: 'type' },
          }),
        },
      });
      expect(() => validateContractDomain(contract)).toThrow(
        /model.*Child.*base.*must not.*discriminator/i,
      );
    });

    it('rejects model with variants but no discriminator', () => {
      const contract = makeValidContract({
        models: {
          Item: makeMinimalModel({
            fields: {
              type: { type: { kind: 'scalar', codecId: 'mongo/string@1' }, nullable: false },
            },
            variants: { Special: { value: 'special' } },
          }),
          Special: makeMinimalModel({ base: crossRef('Item') }),
        },
      });
      expect(() => validateContractDomain(contract)).toThrow(
        /model.*Item.*variants.*no discriminator/i,
      );
    });

    it('rejects model with base that also has variants', () => {
      const contract = makeValidContract({
        roots: { items: crossRef('Item') },
        models: {
          Item: makeMinimalModel({
            fields: {
              type: { type: { kind: 'scalar', codecId: 'mongo/string@1' }, nullable: false },
            },
            discriminator: { field: 'type' },
            variants: { Child: { value: 'child' } },
          }),
          Child: makeMinimalModel({
            base: crossRef('Item'),
            variants: { Grandchild: { value: 'grandchild' } },
          }),
        },
      });
      expect(() => validateContractDomain(contract)).toThrow(
        /model.*Child.*base.*must not.*variants/i,
      );
    });
  });

  describe('orphaned models', () => {
    it('does not reject orphaned models', () => {
      const contract = makeValidContract({
        roots: { items: crossRef('Item') },
        models: {
          Item: makeMinimalModel(),
          Orphan: makeMinimalModel(),
        },
      });
      expect(() => validateContractDomain(contract)).not.toThrow();
    });
  });

  describe('happy path', () => {
    it('validates a complex contract with polymorphism and relations', () => {
      const contract = makeValidContract({
        roots: { tasks: crossRef('Task'), users: crossRef('User') },
        models: {
          Task: makeMinimalModel({
            fields: {
              _id: { type: { kind: 'scalar', codecId: 'mongo/objectId@1' }, nullable: false },
              title: { type: { kind: 'scalar', codecId: 'mongo/string@1' }, nullable: false },
              type: { type: { kind: 'scalar', codecId: 'mongo/string@1' }, nullable: false },
              assigneeId: {
                type: { kind: 'scalar', codecId: 'mongo/objectId@1' },
                nullable: false,
              },
            },
            relations: {
              assignee: {
                to: crossRef('User'),
                cardinality: 'N:1',
                nullable: false,
                on: { localFields: ['assigneeId'], targetFields: ['_id'] },
              },
              comments: {
                to: crossRef('Comment'),
                cardinality: '1:N',
              },
            },
            discriminator: { field: 'type' },
            variants: {
              Bug: { value: 'bug' },
              Feature: { value: 'feature' },
            },
          }),
          Bug: makeMinimalModel({
            fields: {
              severity: { type: { kind: 'scalar', codecId: 'mongo/string@1' }, nullable: false },
            },
            base: crossRef('Task'),
          }),
          Feature: makeMinimalModel({
            fields: {
              priority: { type: { kind: 'scalar', codecId: 'mongo/string@1' }, nullable: false },
              targetRelease: {
                type: { kind: 'scalar', codecId: 'mongo/string@1' },
                nullable: false,
              },
            },
            base: crossRef('Task'),
          }),
          User: makeMinimalModel({
            fields: {
              _id: { type: { kind: 'scalar', codecId: 'mongo/objectId@1' }, nullable: false },
              name: { type: { kind: 'scalar', codecId: 'mongo/string@1' }, nullable: false },
              email: { type: { kind: 'scalar', codecId: 'mongo/string@1' }, nullable: false },
            },
            relations: {
              addresses: {
                to: crossRef('Address'),
                cardinality: '1:N',
              },
            },
          }),
          Address: makeMinimalModel({
            fields: {
              street: { type: { kind: 'scalar', codecId: 'mongo/string@1' }, nullable: false },
              city: { type: { kind: 'scalar', codecId: 'mongo/string@1' }, nullable: false },
              zip: { type: { kind: 'scalar', codecId: 'mongo/string@1' }, nullable: false },
            },
          }),
          Comment: makeMinimalModel({
            fields: {
              _id: { type: { kind: 'scalar', codecId: 'mongo/objectId@1' }, nullable: false },
              text: { type: { kind: 'scalar', codecId: 'mongo/string@1' }, nullable: false },
              createdAt: { type: { kind: 'scalar', codecId: 'mongo/date@1' }, nullable: false },
            },
          }),
        },
      });
      expect(() => validateContractDomain(contract)).not.toThrow();
    });
  });
});
