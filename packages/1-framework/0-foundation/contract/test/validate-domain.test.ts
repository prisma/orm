import { describe, expect, it } from 'vitest';
import { UNBOUND_DOMAIN_NAMESPACE_ID } from '../src/domain-envelope';
import { asNamespaceId } from '../src/namespace-id';

function crossRef(model: string, namespace: string = UNBOUND_DOMAIN_NAMESPACE_ID) {
  return { namespace: asNamespaceId(namespace), model };
}

import { ContractValidationError } from '../src/contract-validation-error';
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
        : applicationDomainOf({ models }),
    storage: {
      namespaces: {
        [UNBOUND_DOMAIN_NAMESPACE_ID]: {
          id: UNBOUND_DOMAIN_NAMESPACE_ID,
          entries: valueObjects !== undefined ? { valueObject: valueObjects } : {},
        },
      },
    },
    ...rest,
  } as DomainContractShape;
}

/** A field type that refers to the value object `name` in the storage namespace `namespaceId`. */
function valueObjectType(name: string, namespaceId: string = UNBOUND_DOMAIN_NAMESPACE_ID) {
  return {
    kind: 'valueObject',
    plane: 'storage',
    namespaceId,
    entityKind: 'valueObject',
    entityName: name,
  };
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
            variants: { special: crossRef('SpecialItem') },
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
            variants: { ghost: crossRef('Ghost') },
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
            variants: { child: crossRef('Child') },
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
            variants: { child: crossRef('Child') },
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

    it('accepts a variant in a different namespace from its base', () => {
      const contract = makeValidContract({
        roots: { tasks: crossRef('Task', 'a') },
        domain: {
          namespaces: {
            a: {
              models: {
                Task: makeMinimalModel({
                  fields: {
                    type: { nullable: false, type: { kind: 'scalar', codecId: 'pg/text@1' } },
                  },
                  discriminator: { field: 'type' },
                  variants: { b: crossRef('Epic', 'b'), c: crossRef('Epic', 'c') },
                }),
              },
            },
            b: { models: { Epic: makeMinimalModel({ base: crossRef('Task', 'a') }) } },
            c: { models: { Epic: makeMinimalModel({ base: crossRef('Task', 'a') }) } },
          },
        },
      });
      expect(() => validateContractDomain(contract)).not.toThrow();
    });

    it('rejects a variant listed under two discriminator values', () => {
      const contract = makeValidContract({
        models: {
          Item: makeMinimalModel({
            fields: {
              type: { nullable: false, type: { kind: 'scalar', codecId: 'mongo/string@1' } },
            },
            discriminator: { field: 'type' },
            variants: { bug: crossRef('Bug'), defect: crossRef('Bug') },
          }),
          Bug: makeMinimalModel({ base: crossRef('Item') }),
        },
      });
      expect(() => validateContractDomain(contract)).toThrow(
        'Model "__unbound__:Item" lists variant "__unbound__:Bug" under both discriminator values "bug" and "defect"',
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
            variants: { special: crossRef('Special') },
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
            variants: { child: crossRef('Child') },
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
            variants: { special: crossRef('Special') },
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
            variants: { child: crossRef('Child') },
          }),
          Child: makeMinimalModel({
            base: crossRef('Item'),
            variants: { grandchild: crossRef('Grandchild') },
          }),
        },
      });
      expect(() => validateContractDomain(contract)).toThrow(
        /model.*Child.*base.*must not.*variants/i,
      );
    });

    it('accepts variants with distinct discriminator values', () => {
      const contract = makeValidContract({
        models: {
          Item: makeMinimalModel({
            fields: {
              type: { nullable: false, type: { kind: 'scalar', codecId: 'mongo/string@1' } },
            },
            discriminator: { field: 'type' },
            variants: { bug: crossRef('Bug'), feature: crossRef('Feature') },
          }),
          Bug: makeMinimalModel({ base: crossRef('Item') }),
          Feature: makeMinimalModel({ base: crossRef('Item') }),
        },
      });
      expect(() => validateContractDomain(contract)).not.toThrow();
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
              bug: crossRef('Bug'),
              feature: crossRef('Feature'),
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
    const address = {
      fields: {
        street: { nullable: false, type: { kind: 'scalar', codecId: 'pg/text@1' } },
        city: { nullable: false, type: { kind: 'scalar', codecId: 'pg/text@1' } },
      },
    };

    it('accepts a model field that refers to a value object in storage', () => {
      const contract = makeValidContract({
        roots: { users: crossRef('User') },
        models: {
          User: makeMinimalModel({
            fields: {
              id: { nullable: false, type: { kind: 'scalar', codecId: 'pg/int4@1' } },
              homeAddress: { nullable: false, type: valueObjectType('Address') },
            },
          }),
        },
        valueObjects: { Address: address },
      });
      expect(() => validateContractDomain(contract)).not.toThrow();
    });

    it('refuses a model field that refers to a value object storage does not have, naming the field and the coordinate', () => {
      const contract = makeValidContract({
        roots: { users: crossRef('User') },
        models: {
          User: makeMinimalModel({
            fields: {
              id: { nullable: false, type: { kind: 'scalar', codecId: 'pg/int4@1' } },
              addr: { nullable: false, type: valueObjectType('Missing') },
            },
          }),
        },
        valueObjects: { Address: address },
      });
      expect(() => validateContractDomain(contract)).toThrow(
        `Model "__unbound__:User" field "addr" refers to value object "Missing" in storage namespace "__unbound__", which storage.namespaces.__unbound__.entries.valueObject does not have`,
      );
    });

    it('refuses a reference into a storage namespace the contract does not have', () => {
      const contract = makeValidContract({
        roots: { users: crossRef('User') },
        models: {
          User: makeMinimalModel({
            fields: { addr: { nullable: false, type: valueObjectType('Address', 'billing') } },
          }),
        },
        valueObjects: { Address: address },
      });
      expect(() => validateContractDomain(contract)).toThrow(
        `Model "__unbound__:User" field "addr" refers to value object "Address" in storage namespace "billing", which storage.namespaces.billing.entries.valueObject does not have`,
      );
    });

    it('refuses a value object reference that does not point at a storage value object', () => {
      const contract = makeValidContract({
        roots: { users: crossRef('User') },
        models: {
          User: makeMinimalModel({
            fields: {
              addr: {
                nullable: false,
                type: { ...valueObjectType('Address'), plane: 'domain', entityKind: 'enum' },
              },
            },
          }),
        },
        valueObjects: { Address: address },
      });
      expect(() => validateContractDomain(contract)).toThrow(
        `Model "__unbound__:User" field "addr" refers to a value object with plane "domain" and entityKind "enum"; a value object reference has plane "storage" and entityKind "valueObject"`,
      );
    });

    it('refuses a reference by name, the old shape, and says to re-emit', () => {
      const contract = makeValidContract({
        roots: { users: crossRef('User') },
        models: {
          User: makeMinimalModel({
            fields: { addr: { nullable: false, type: { kind: 'valueObject', name: 'Address' } } },
          }),
        },
        valueObjects: { Address: address },
      });
      expect(() => validateContractDomain(contract)).toThrow(
        'Model "__unbound__:User" field "addr" refers to value object "Address" by name; contracts no longer do: a field refers to its value object by the coordinate of a storage entity under storage.namespaces.<namespace>.entries.valueObject, so re-emit the contract from its source, or rewrite a stored contract such as a migration snapshot with value-objects-in-storage.ts, which ships in the value-objects-in-storage scripts of the Prisma 8 upgrade guide',
      );
    });

    it('accepts a value object whose field refers to another value object', () => {
      const contract = makeValidContract({
        roots: { users: crossRef('User') },
        models: {
          User: makeMinimalModel({
            fields: { profile: { nullable: false, type: valueObjectType('Profile') } },
          }),
        },
        valueObjects: {
          Address: address,
          Profile: { fields: { home: { nullable: true, type: valueObjectType('Address') } } },
        },
      });
      expect(() => validateContractDomain(contract)).not.toThrow();
    });

    it('accepts a value object that refers to itself', () => {
      const contract = makeValidContract({
        roots: {},
        models: {},
        valueObjects: {
          TreeNode: {
            fields: {
              label: { nullable: false, type: { kind: 'scalar', codecId: 'pg/text@1' } },
              child: { nullable: true, type: valueObjectType('TreeNode') },
            },
          },
        },
      });
      expect(() => validateContractDomain(contract)).not.toThrow();
    });

    it('refuses a union member that refers to a value object storage does not have', () => {
      const contract = makeValidContract({
        roots: { users: crossRef('User') },
        models: {
          User: makeMinimalModel({
            fields: {
              data: {
                nullable: false,
                type: {
                  kind: 'union',
                  members: [{ kind: 'scalar', codecId: 'pg/text@1' }, valueObjectType('Ghost')],
                },
              },
            },
          }),
        },
      });
      expect(() => validateContractDomain(contract)).toThrow(/value object "Ghost"/);
    });

    it('accepts a union member that refers to a value object in storage', () => {
      const contract = makeValidContract({
        roots: { users: crossRef('User') },
        models: {
          User: makeMinimalModel({
            fields: {
              data: {
                nullable: false,
                type: {
                  kind: 'union',
                  members: [{ kind: 'scalar', codecId: 'pg/text@1' }, valueObjectType('Address')],
                },
              },
            },
          }),
        },
        valueObjects: { Address: address },
      });
      expect(() => validateContractDomain(contract)).not.toThrow();
    });

    it('refuses value objects in the domain plane, and says where they live now', () => {
      const contract = makeValidContract({
        domain: {
          namespaces: {
            public: { models: {}, valueObjects: { Address: address } },
          },
        },
        roots: {},
      });
      expect(() => validateContractDomain(contract)).toThrow(
        'domain.namespaces.public.valueObjects: contracts no longer store value objects in the domain plane; they are storage entities under storage.namespaces.<namespace>.entries.valueObject, so re-emit the contract from its source, or rewrite a stored contract such as a migration snapshot with value-objects-in-storage.ts, which ships in the value-objects-in-storage scripts of the Prisma 8 upgrade guide',
      );
    });
  });

  describe('field modifier validation', () => {
    it('rejects list many + dict on the same field', () => {
      const contract = makeValidContract({
        roots: {},
        models: {
          User: makeMinimalModel({
            fields: {
              tags: {
                nullable: false,
                type: { kind: 'scalar', codecId: 'pg/text@1' },
                many: { elementNullable: false },
                dict: true,
              },
            },
          }),
        },
      });
      expect(() => validateContractDomain(contract)).toThrow(/many.*dict|dict.*many/i);
    });

    it('accepts nullable elements inside the list descriptor', () => {
      const contract = makeValidContract({
        roots: {},
        models: {
          User: makeMinimalModel({
            fields: {
              tags: {
                nullable: false,
                type: { kind: 'scalar', codecId: 'pg/text@1' },
                many: { elementNullable: true },
              },
            },
          }),
        },
      });
      expect(() => validateContractDomain(contract)).not.toThrow();
    });

    it('rejects the old sibling elementNullable shape when type checking is bypassed', () => {
      const contract = makeValidContract({
        roots: {},
        models: {
          User: makeMinimalModel({
            fields: {
              tags: {
                nullable: false,
                type: { kind: 'scalar', codecId: 'pg/text@1' },
                many: false,
                elementNullable: true,
              },
            },
          }),
        },
      });
      expect(() => validateContractDomain(contract)).toThrow(/sibling "elementNullable"/);
    });
  });
});
