import type { ControlPolicy } from '@internal/contract/types';
import { effectiveControlPolicy } from '@internal/contract/types';
import { UNBOUND_NAMESPACE_ID } from '@internal/framework-components/ir';
import {
  createMongoContractSchema,
  type MongoCollection,
  type MongoContract,
  type MongoStorageShape,
} from '@internal/mongo-contract';
import { type as arktype } from 'arktype';
import { describe, expect, it } from 'vitest';
import { defineContract, field, index, model } from '../src/contract-builder';
import { mongoFamilyPack, mongoTargetPack, type } from './mongo-test-packs';

function unboundCollections(storage: MongoStorageShape): Record<string, MongoCollection> {
  const namespace = storage.namespaces[UNBOUND_NAMESPACE_ID];
  if (!namespace) {
    throw new Error(`expected namespace ${UNBOUND_NAMESPACE_ID}`);
  }
  return {
    ...((namespace.entries['collection'] as
      | Readonly<Record<string, MongoCollection>>
      | undefined) ?? {}),
  };
}

function collectionEffectiveControl(
  collectionControl: ControlPolicy | undefined,
  defaultControlPolicy: ControlPolicy | undefined,
): ControlPolicy {
  return effectiveControlPolicy(collectionControl, defaultControlPolicy);
}

function defaultControlPolicyOf(contract: MongoContract): ControlPolicy | undefined {
  return contract.defaultControlPolicy;
}

const policies = [
  'managed',
  'tolerated',
  'external',
  'observed',
] as const satisfies readonly ControlPolicy[];

describe('defineContract defaultControlPolicy', () => {
  it('lowers defaultControlPolicy to Contract.defaultControlPolicy', () => {
    const built = defineContract({
      family: mongoFamilyPack,
      target: mongoTargetPack,
      defaultControlPolicy: 'external',
      models: {
        User: model('User', {
          collection: 'users',
          fields: { _id: field.scalar(type.ObjectId()) },
        }),
      },
    });

    expect(built.defaultControlPolicy).toBe('external');
  });

  it('omits defaultControlPolicy when unset', () => {
    const built = defineContract({
      family: mongoFamilyPack,
      target: mongoTargetPack,
      models: {
        User: model('User', {
          collection: 'users',
          fields: { _id: field.scalar(type.ObjectId()) },
        }),
      },
    });

    expect(built).not.toHaveProperty('defaultControlPolicy');
  });
});

describe('defineContract per-collection controlPolicy', () => {
  it('accepts each ControlPolicy on the model collection', () => {
    for (const controlPolicy of policies) {
      const built = defineContract({
        family: mongoFamilyPack,
        target: mongoTargetPack,
        models: {
          User: model('User', {
            collection: 'users',
            controlPolicy,
            fields: { _id: field.scalar(type.ObjectId()) },
          }),
        },
      });

      const collection = unboundCollections(built.storage)['users'];
      expect(collectionEffectiveControl(collection?.control, defaultControlPolicyOf(built))).toBe(
        controlPolicy,
      );
      if (controlPolicy === 'managed') {
        expect(collection?.control).toBe('managed');
      }
    }
  });

  it('omits per-node control and defaultControlPolicy when neither is authored', () => {
    const built = defineContract({
      family: mongoFamilyPack,
      target: mongoTargetPack,
      models: {
        User: model('User', {
          collection: 'users',
          fields: { _id: field.scalar(type.ObjectId()) },
        }),
      },
    });

    expect(built).not.toHaveProperty('defaultControlPolicy');
    const collection = unboundCollections(built.storage)['users'];
    expect(collection).not.toHaveProperty('control');
  });
});

describe('defineContract mixed default and per-collection controlPolicy', () => {
  it('resolves effective control per collection and round-trips through the canonical deserializer', () => {
    const built = defineContract({
      family: mongoFamilyPack,
      target: mongoTargetPack,
      defaultControlPolicy: 'external',
      models: {
        User: model('User', {
          collection: 'users',
          fields: { _id: field.scalar(type.ObjectId()) },
        }),
        Profile: model('Profile', {
          collection: 'profiles',
          controlPolicy: 'managed',
          fields: { _id: field.scalar(type.ObjectId()) },
        }),
        Audit: model('Audit', {
          collection: 'audit_log',
          controlPolicy: 'tolerated',
          fields: { _id: field.scalar(type.ObjectId()), ts: field.scalar(type.String()) },
          indexes: [index({ ts: 1 })],
        }),
      },
    });

    const collections = unboundCollections(built.storage);
    const contractDefault = defaultControlPolicyOf(built);
    expect(collectionEffectiveControl(collections['users']?.control, contractDefault)).toBe(
      'external',
    );
    expect(collectionEffectiveControl(collections['profiles']?.control, contractDefault)).toBe(
      'managed',
    );
    expect(collectionEffectiveControl(collections['audit_log']?.control, contractDefault)).toBe(
      'tolerated',
    );

    const envelope = JSON.parse(JSON.stringify(built)) as unknown;
    const contractSchema = createMongoContractSchema();
    expect(contractSchema(envelope) instanceof arktype.errors).toBe(false);

    type RoundTrippedCollection = { readonly control?: ControlPolicy };
    type RoundTrippedEnvelope = {
      readonly defaultControlPolicy?: ControlPolicy;
      readonly storage: {
        readonly namespaces: Record<
          string,
          {
            readonly entries: {
              readonly collection: Record<string, RoundTrippedCollection>;
            };
          }
        >;
      };
    };
    const roundTripped = envelope as RoundTrippedEnvelope;
    const roundTrippedCollections =
      roundTripped.storage.namespaces[UNBOUND_NAMESPACE_ID]!.entries.collection;
    const def = roundTripped.defaultControlPolicy;

    expect(def).toBe('external');
    expect(collectionEffectiveControl(roundTrippedCollections['users']?.control, def)).toBe(
      'external',
    );
    expect(collectionEffectiveControl(roundTrippedCollections['profiles']?.control, def)).toBe(
      'managed',
    );
    expect(collectionEffectiveControl(roundTrippedCollections['audit_log']?.control, def)).toBe(
      'tolerated',
    );

    expect(roundTrippedCollections['users']).not.toHaveProperty('control');
  });
});

describe('defineContract collection validators under a control policy', () => {
  function validatedCollections(contract: MongoContract): readonly string[] {
    return Object.entries(unboundCollections(contract.storage))
      .filter(([, collection]) => collection.validator !== undefined)
      .map(([name]) => name)
      .sort();
  }

  it('gives a validator only to managed collections', () => {
    const built = defineContract({
      family: mongoFamilyPack,
      target: mongoTargetPack,
      models: Object.fromEntries(
        policies.map((controlPolicy) => [
          controlPolicy,
          model(controlPolicy, {
            collection: controlPolicy,
            controlPolicy,
            fields: { _id: field.scalar(type.ObjectId()), name: field.scalar(type.String()) },
          }),
        ]),
      ),
    });

    expect(validatedCollections(built)).toEqual(['managed']);
  });

  it('gives no validator to a collection that takes a non-managed default policy', () => {
    const built = defineContract({
      family: mongoFamilyPack,
      target: mongoTargetPack,
      defaultControlPolicy: 'observed',
      models: {
        Job: model('Job', { collection: 'jobs', fields: { _id: field.scalar(type.ObjectId()) } }),
        User: model('User', {
          collection: 'users',
          controlPolicy: 'managed',
          fields: { _id: field.scalar(type.ObjectId()) },
        }),
      },
    });

    expect(validatedCollections(built)).toEqual(['users']);
  });

  it('gives no validator to a managed collection under an external default policy', () => {
    const built = defineContract({
      family: mongoFamilyPack,
      target: mongoTargetPack,
      defaultControlPolicy: 'external',
      models: {
        User: model('User', {
          collection: 'users',
          controlPolicy: 'managed',
          fields: { _id: field.scalar(type.ObjectId()) },
        }),
      },
    });

    expect(validatedCollections(built)).toEqual([]);
  });
});
