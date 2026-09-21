import { describe, expect, it } from 'vitest';
import { UNBOUND_DOMAIN_NAMESPACE_ID } from '../src/domain-envelope';
import { asNamespaceId } from '../src/namespace-id';

function crossRef(model: string, namespace: string = UNBOUND_DOMAIN_NAMESPACE_ID) {
  return { namespace: asNamespaceId(namespace), model };
}

import { blindCast } from '@internal/utils/casts';
import { ifDefined } from '@internal/utils/defined';
import { ContractValidationError } from '../src/contract-validation-error';
import type { ContractValueObject } from '../src/domain-types';
import type { DomainContractShape } from '../src/validate-domain';
import { validateContractDomain } from '../src/validate-domain';
import { applicationDomainOf } from './support/application-domain-of';

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
      fields: { _id: { nullable: false, type: { kind: 'scalar', codecId: 'mongo/objectId@1' } } },
    }),
  };
  const {
    models: modelsOverride,
    valueObjects,
    roots: rootsOverride,
    domain: domainOverride,
    ...rest
  } = overrides;
  const models = {
    ...defaultModels,
    ...(modelsOverride !== undefined
      ? (modelsOverride as Record<string, ReturnType<typeof makeMinimalModel>>)
      : {}),
  };
  return {
    roots: (rootsOverride as DomainContractShape['roots']) ?? { items: crossRef('Item') },
    domain:
      domainOverride !== undefined
        ? (domainOverride as DomainContractShape['domain'])
        : applicationDomainOf({
            models,
            ...ifDefined(
              'valueObjects',
              valueObjects !== undefined
                ? blindCast<
                    Record<string, ContractValueObject>,
                    'validate-domain fixtures use structural value-object shapes'
                  >(valueObjects)
                : undefined,
            ),
          }),
    ...rest,
  } as DomainContractShape;
}

describe('validateContractDomain()', () => {
  describe('namespace coordinate identity', () => {
    it('treats the same model name in different namespaces as distinct models', () => {
      const contract = makeValidContract({
        roots: {
          authUsers: crossRef('User', 'auth'),
          publicUsers: crossRef('User', 'public'),
        },
        domain: {
          namespaces: {
            auth: {
              models: {
                User: makeMinimalModel({
                  fields: {
                    id: {
                      nullable: false,
                      type: { kind: 'scalar', codecId: 'pg/int4@1' },
                    },
                  },
                }),
              },
            },
            public: {
              models: {
                User: makeMinimalModel({
                  fields: {
                    id: {
                      nullable: false,
                      type: { kind: 'scalar', codecId: 'pg/text@1' },
                    },
                  },
                }),
              },
            },
          },
        },
      });
      expect(() => validateContractDomain(contract)).not.toThrow();
    });
  });

  describe('root validation', () => {
    it('accepts valid roots', () => {
      expect(() => validateContractDomain(makeValidContract())).not.toThrow();
    });

    it('rejects duplicate root values with domain phase', () => {
      const contract = makeValidContract({
        roots: { items: crossRef('Item'), things: crossRef('Item') },
      });
      expect(() => validateContractDomain(contract)).toThrow(ContractValidationError);
      expect(() => validateContractDomain(contract)).toThrow(/duplicate root.*Item/i);
      try {
        validateContractDomain(contract);
      } catch (e) {
        expect((e as ContractValidationError).phase).toBe('domain');
        expect((e as ContractValidationError).code).toBe('CONTRACT.VALIDATION_FAILED');
      }
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
              type: { nullable: false, type: { kind: 'scalar', codecId: 'mongo/string@1' } },
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
              type: { nullable: false, type: { kind: 'scalar', codecId: 'mongo/string@1' } },
            },
            discriminator: { field: 'type' },
            variants: { Ghost: { value: 'ghost' } },
          }),
        },
      });
      expect(() => validateContractDomain(contract)).toThrow(/variant.*Ghost.*not exist/i);
    });

    it('rejects variant whose base is undefined', () => {
      const contract = makeValidContract({
        roots: { items: crossRef('Item') },
        models: {
          Item: makeMinimalModel({
            fields: {
              type: { nullable: false, type: { kind: 'scalar', codecId: 'mongo/string@1' } },
            },
            discriminator: { field: 'type' },
            variants: { Child: { value: 'child' } },
          }),
          Child: makeMinimalModel(),
        },
      });
      expect(() => validateContractDomain(contract)).toThrow(
        /variant.*Child.*base.*\(none\).*expected.*Item/i,
      );
    });

    it('rejects variant whose base does not match the declaring model', () => {
      const contract = makeValidContract({
        roots: { items: crossRef('Item') },
        models: {
          Item: makeMinimalModel({
            fields: {
              type: { nullable: false, type: { kind: 'scalar', codecId: 'mongo/string@1' } },
            },
            discriminator: { field: 'type' },
            variants: { Child: { value: 'child' } },
          }),
          Other: makeMinimalModel({
            fields: {
              type: { nullable: false, type: { kind: 'scalar', codecId: 'mongo/string@1' } },
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
              type: { nullable: false, type: { kind: 'scalar', codecId: 'mongo/string@1' } },
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
    it('accepts models with undefined relations', () => {
      const contract = makeValidContract({
        roots: { items: crossRef('Item') },
        models: {
          Item: { fields: {} },
        },
      });
      expect(() => validateContractDomain(contract)).not.toThrow();
    });

    it('accepts relations with valid targets', () => {
      const contract = makeValidContract({
        roots: { items: crossRef('Item'), users: crossRef('User') },
        models: {
          Item: makeMinimalModel({
            relations: {
              creator: {
                to: crossRef('User'),
                cardinality: 'N:1',
                nullable: false,
                on: { localFields: ['creatorId'], targetFields: ['_id'] },
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
              creator: {
                to: crossRef('Ghost'),
                cardinality: 'N:1',
                nullable: false,
                on: { localFields: ['creatorId'], targetFields: ['_id'] },
              },
            },
          }),
        },
      });
      expect(() => validateContractDomain(contract)).toThrow(
        /relation.*creator.*Item.*target.*Ghost.*not exist/i,
      );
    });
  });

  describe('relation nullability flag', () => {
    function contractWithRelation(relation: Record<string, unknown>) {
      return makeValidContract({
        roots: { items: crossRef('Item'), users: crossRef('User') },
        models: {
          Item: makeMinimalModel({ relations: { rel: relation } }),
          User: makeMinimalModel(),
        },
      });
    }

    it.each(['N:1', '1:1'] as const)(
      'accepts a %s relation without the flag, which hydration fills in from storage',
      (cardinality) => {
        const contract = contractWithRelation({
          to: crossRef('User'),
          cardinality,
          on: { localFields: ['userId'], targetFields: ['_id'] },
        });
        expect(() => validateContractDomain(contract)).not.toThrow();
      },
    );

    it.each([true, false])('accepts a to-one relation with nullable: %s', (nullable) => {
      const contract = contractWithRelation({
        to: crossRef('User'),
        cardinality: 'N:1',
        nullable,
        on: { localFields: ['userId'], targetFields: ['_id'] },
      });
      expect(() => validateContractDomain(contract)).not.toThrow();
    });

    it('rejects a non-boolean flag', () => {
      const contract = contractWithRelation({
        to: crossRef('User'),
        cardinality: 'N:1',
        nullable: 'yes',
        on: { localFields: ['userId'], targetFields: ['_id'] },
      });
      expect(() => validateContractDomain(contract)).toThrow(
        /Relation "rel" on model ".*Item".*"nullable" must be a boolean/,
      );
    });

    it('rejects the flag on a 1:N relation', () => {
      const contract = contractWithRelation({
        to: crossRef('User'),
        cardinality: '1:N',
        nullable: true,
        on: { localFields: ['_id'], targetFields: ['itemId'] },
      });
      expect(() => validateContractDomain(contract)).toThrow(
        /Relation "rel" on model ".*Item".*1:N.*must not carry "nullable"/,
      );
    });

    it('rejects the flag on an N:M relation', () => {
      const contract = contractWithRelation({
        to: crossRef('User'),
        cardinality: 'N:M',
        nullable: false,
        on: { localFields: ['_id'], targetFields: ['_id'] },
        through: {
          table: 'item_users',
          namespaceId: 'public',
          parentColumns: ['item_id'],
          childColumns: ['user_id'],
          targetColumns: ['_id'],
        },
      });
      expect(() => validateContractDomain(contract)).toThrow(/N:M.*must not carry "nullable"/);
    });

    it('rejects the flag on an embed relation', () => {
      const contract = contractWithRelation({
        to: crossRef('User'),
        cardinality: '1:1',
        nullable: true,
      });
      expect(() => validateContractDomain(contract)).toThrow(
        /embed relation.*must not carry "nullable"/,
      );
    });

    it('accepts embed and to-many relations without the flag', () => {
      const contract = makeValidContract({
        roots: { items: crossRef('Item'), users: crossRef('User') },
        models: {
          Item: makeMinimalModel({
            relations: {
              owner: { to: crossRef('User'), cardinality: '1:1' },
              users: {
                to: crossRef('User'),
                cardinality: '1:N',
                on: { localFields: ['_id'], targetFields: ['itemId'] },
              },
            },
          }),
          User: makeMinimalModel(),
        },
      });
      expect(() => validateContractDomain(contract)).not.toThrow();
    });
  });

  describe('discriminator invariants', () => {
    it('rejects model with discriminator but no variants', () => {
      const contract = makeValidContract({
        models: {
          Item: makeMinimalModel({
            fields: {
              type: { nullable: false, type: { kind: 'scalar', codecId: 'mongo/string@1' } },
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
              _id: { nullable: false, type: { kind: 'scalar', codecId: 'mongo/objectId@1' } },
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
              type: { nullable: false, type: { kind: 'scalar', codecId: 'mongo/string@1' } },
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
              type: { nullable: false, type: { kind: 'scalar', codecId: 'mongo/string@1' } },
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
              type: { nullable: false, type: { kind: 'scalar', codecId: 'mongo/string@1' } },
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

  it('does not reject orphaned models (advisory, removed from runtime validation)', () => {
    const contract = makeValidContract({
      roots: { items: crossRef('Item') },
      models: {
        Item: makeMinimalModel(),
        Orphan: makeMinimalModel(),
      },
    });
    expect(() => validateContractDomain(contract)).not.toThrow();
  });

  describe('ownership validation', () => {
    it('accepts valid owner reference', () => {
      const contract = makeValidContract({
        roots: { items: crossRef('Item') },
        models: {
          Item: makeMinimalModel({
            relations: { address: { to: crossRef('Address'), cardinality: '1:1' } },
          }),
          Address: makeMinimalModel({ owner: 'Item' }),
        },
      });
      expect(() => validateContractDomain(contract)).not.toThrow();
    });

    it('rejects self-ownership', () => {
      const contract = makeValidContract({
        models: {
          Item: makeMinimalModel({ owner: 'Item' }),
        },
      });
      expect(() => validateContractDomain(contract)).toThrow(/Item.*cannot own itself/i);
    });

    it('rejects owner referencing non-existent model', () => {
      const contract = makeValidContract({
        models: {
          Item: makeMinimalModel({ owner: 'Ghost' }),
        },
      });
      expect(() => validateContractDomain(contract)).toThrow(/Item.*owner.*Ghost.*not exist/i);
    });

    it('rejects owned model appearing in roots', () => {
      const contract = makeValidContract({
        roots: { items: crossRef('Item'), addresses: crossRef('Address') },
        models: {
          Item: makeMinimalModel({
            relations: { address: { to: crossRef('Address'), cardinality: '1:1' } },
          }),
          Address: makeMinimalModel({ owner: 'Item' }),
        },
      });
      expect(() => validateContractDomain(contract)).toThrow(
        /owned model.*Address.*must not appear in roots/i,
      );
    });
  });

  describe('happy path', () => {
    it('validates a complex contract with polymorphism, relations, and ownership', () => {
      const contract = makeValidContract({
        roots: { tasks: crossRef('Task'), users: crossRef('User') },
        models: {
          Task: makeMinimalModel({
            fields: {
              _id: { nullable: false, type: { kind: 'scalar', codecId: 'mongo/objectId@1' } },
              title: { nullable: false, type: { kind: 'scalar', codecId: 'mongo/string@1' } },
              type: { nullable: false, type: { kind: 'scalar', codecId: 'mongo/string@1' } },
              assigneeId: {
                nullable: false,
                type: { kind: 'scalar', codecId: 'mongo/objectId@1' },
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
              severity: { nullable: false, type: { kind: 'scalar', codecId: 'mongo/string@1' } },
            },
            base: crossRef('Task'),
          }),
          Feature: makeMinimalModel({
            fields: {
              priority: { nullable: false, type: { kind: 'scalar', codecId: 'mongo/string@1' } },
              targetRelease: {
                nullable: false,
                type: { kind: 'scalar', codecId: 'mongo/string@1' },
              },
            },
            base: crossRef('Task'),
          }),
          User: makeMinimalModel({
            fields: {
              _id: { nullable: false, type: { kind: 'scalar', codecId: 'mongo/objectId@1' } },
              name: { nullable: false, type: { kind: 'scalar', codecId: 'mongo/string@1' } },
              email: { nullable: false, type: { kind: 'scalar', codecId: 'mongo/string@1' } },
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
              street: { nullable: false, type: { kind: 'scalar', codecId: 'mongo/string@1' } },
              city: { nullable: false, type: { kind: 'scalar', codecId: 'mongo/string@1' } },
              zip: { nullable: false, type: { kind: 'scalar', codecId: 'mongo/string@1' } },
            },
            owner: 'User',
          }),
          Comment: makeMinimalModel({
            fields: {
              _id: { nullable: false, type: { kind: 'scalar', codecId: 'mongo/objectId@1' } },
              text: { nullable: false, type: { kind: 'scalar', codecId: 'mongo/string@1' } },
              createdAt: { nullable: false, type: { kind: 'scalar', codecId: 'mongo/date@1' } },
            },
            owner: 'Task',
          }),
        },
      });
      expect(() => validateContractDomain(contract)).not.toThrow();
    });
  });

  describe('value object reference validation', () => {
    it('accepts valid value object references from model fields', () => {
      const contract = makeValidContract({
        roots: { users: crossRef('User') },
        models: {
          User: makeMinimalModel({
            fields: {
              id: { nullable: false, type: { kind: 'scalar', codecId: 'pg/int4@1' } },
              homeAddress: { nullable: false, type: { kind: 'valueObject', name: 'Address' } },
            },
          }),
        },
        valueObjects: {
          Address: {
            fields: {
              street: { nullable: false, type: { kind: 'scalar', codecId: 'pg/text@1' } },
              city: { nullable: false, type: { kind: 'scalar', codecId: 'pg/text@1' } },
            },
          },
        },
      });
      expect(() => validateContractDomain(contract)).not.toThrow();
    });

    it('rejects nonexistent value object reference from model field', () => {
      const contract = makeValidContract({
        roots: { users: crossRef('User') },
        models: {
          User: makeMinimalModel({
            fields: {
              id: { nullable: false, type: { kind: 'scalar', codecId: 'pg/int4@1' } },
              addr: { nullable: false, type: { kind: 'valueObject', name: 'Missing' } },
            },
          }),
        },
      });
      expect(() => validateContractDomain(contract)).toThrow(/Missing.*does not exist/);
    });

    it('accepts self-referencing value object', () => {
      const contract = makeValidContract({
        roots: {},
        models: {},
        valueObjects: {
          TreeNode: {
            fields: {
              label: { nullable: false, type: { kind: 'scalar', codecId: 'pg/text@1' } },
              child: { nullable: true, type: { kind: 'valueObject', name: 'TreeNode' } },
            },
          },
        },
      });
      expect(() => validateContractDomain(contract)).not.toThrow();
    });

    it('rejects nonexistent value object reference from another value object', () => {
      const contract = makeValidContract({
        roots: {},
        models: {},
        valueObjects: {
          Wrapper: {
            fields: {
              inner: { nullable: false, type: { kind: 'valueObject', name: 'Nonexistent' } },
            },
          },
        },
      });
      expect(() => validateContractDomain(contract)).toThrow(/Nonexistent.*does not exist/);
    });

    it('rejects nonexistent value object reference inside union members', () => {
      const contract = makeValidContract({
        roots: { users: crossRef('User') },
        models: {
          User: makeMinimalModel({
            fields: {
              id: { nullable: false, type: { kind: 'scalar', codecId: 'pg/int4@1' } },
              data: {
                nullable: false,
                type: {
                  kind: 'union',
                  members: [
                    { kind: 'scalar', codecId: 'pg/text@1' },
                    { kind: 'valueObject', name: 'Ghost' },
                  ],
                },
              },
            },
          }),
        },
      });
      expect(() => validateContractDomain(contract)).toThrow(/Ghost.*does not exist/);
    });

    it('accepts valid value object reference inside union members', () => {
      const contract = makeValidContract({
        roots: { users: crossRef('User') },
        models: {
          User: makeMinimalModel({
            fields: {
              id: { nullable: false, type: { kind: 'scalar', codecId: 'pg/int4@1' } },
              data: {
                nullable: false,
                type: {
                  kind: 'union',
                  members: [
                    { kind: 'scalar', codecId: 'pg/text@1' },
                    { kind: 'valueObject', name: 'Address' },
                  ],
                },
              },
            },
          }),
        },
        valueObjects: {
          Address: {
            fields: {
              street: { nullable: false, type: { kind: 'scalar', codecId: 'pg/text@1' } },
            },
          },
        },
      });
      expect(() => validateContractDomain(contract)).not.toThrow();
    });
  });

  describe('field modifier validation', () => {
    it('rejects many + dict on the same field', () => {
      const contract = makeValidContract({
        roots: {},
        models: {
          User: makeMinimalModel({
            fields: {
              tags: {
                nullable: false,
                type: { kind: 'scalar', codecId: 'pg/text@1' },
                many: true,
                dict: true,
              },
            },
          }),
        },
      });
      expect(() => validateContractDomain(contract)).toThrow(/many.*dict|dict.*many/i);
    });
  });
});
