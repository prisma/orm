import { type ControlPolicy, effectiveControlPolicy } from '@internal/contract/types';
import { issueOutcome } from '@internal/framework-components/control';
import { UNBOUND_NAMESPACE_ID } from '@internal/framework-components/ir';
import {
  defaultMongoIndexName,
  MongoCollection,
  type MongoContract,
} from '@internal/mongo-contract';
import { MongoSchemaCollection, MongoSchemaIndex, MongoSchemaIR } from '@internal/mongo-schema-ir';
import { describe, expect, it } from 'vitest';
import { contractToMongoSchemaIR } from '../src/core/contract-to-schema';
import { diffMongoSchemas } from '../src/core/schema-diff';
import { canonicalizeSchemasForVerification } from '../src/core/schema-verify/canonicalize-introspection';
import { verifyMongoSchema } from '../src/core/schema-verify/verify-mongo-schema';

function buildContract(
  collections: Record<string, { control?: 'managed' | 'tolerated' | 'external' | 'observed' }>,
  defaultControlPolicy?: 'managed' | 'tolerated' | 'external' | 'observed',
): MongoContract {
  const built: Record<string, MongoCollection> = {};
  for (const [name, data] of Object.entries(collections)) {
    built[name] = new MongoCollection({
      indexes: [],
      ...(data.control !== undefined ? { control: data.control } : {}),
    });
  }
  return {
    target: 'mongo',
    targetFamily: 'mongo',
    roots: {},
    models: {},
    storage: {
      storageHash: 'test',
      namespaces: {
        [UNBOUND_NAMESPACE_ID]: {
          id: UNBOUND_NAMESPACE_ID,
          entries: { collection: built },
        },
      },
    },
    capabilities: {},
    extensions: {},
    profileHash: 'profile',
    meta: {},
    ...(defaultControlPolicy !== undefined ? { defaultControlPolicy } : {}),
  } as unknown as MongoContract;
}

function idx(keys: Array<{ field: string; direction: 1 | -1 }>): MongoSchemaIndex {
  return new MongoSchemaIndex({ name: defaultMongoIndexName(keys), keys });
}

/**
 * Runs the same diff `verifyMongoSchema` runs internally (contract →
 * expected IR, canonicalize, diff under the contract's own control policy)
 * so tests can assert on `warnings`, which the verify envelope no longer
 * carries.
 */
function diffFromContractAndLive(
  contract: MongoContract,
  liveSchema: MongoSchemaIR,
  strict: boolean,
) {
  const expectedIR = contractToMongoSchemaIR(contract);
  const { live, expected } = canonicalizeSchemasForVerification(liveSchema, expectedIR);
  const namespace = contract.storage.namespaces[UNBOUND_NAMESPACE_ID];
  const collections: Record<string, MongoCollection> = namespace?.entries.collection ?? {};
  const collectionControlPolicy = (name: string): ControlPolicy =>
    effectiveControlPolicy(collections[name]?.control, contract.defaultControlPolicy);
  return diffMongoSchemas(live, expected, strict, collectionControlPolicy);
}

describe('verifyMongoSchema control policy', () => {
  it('fails any drift under managed', () => {
    const contract = buildContract({ items: { control: 'managed' } });
    const result = verifyMongoSchema({
      contract,
      schema: new MongoSchemaIR(
        [
          new MongoSchemaCollection({
            name: 'items',
            indexes: [idx([{ field: 'extra', direction: 1 }])],
          }),
        ],
        { fromDatabase: false },
      ),
      strict: true,
      frameworkComponents: [],
    });
    expect(result.ok).toBe(false);
    expect(result.schema.issues.length).toBeGreaterThan(0);
    expect(
      result.schema.issues.some(
        (i) => issueOutcome(i) === 'not-expected' && i.path[1]?.startsWith('index:'),
      ),
    ).toBe(true);
  });

  it('grades a managed collection under an external default as external, as the planner does', () => {
    const contract = buildContract({ items: { control: 'managed' } }, 'external');
    const result = verifyMongoSchema({
      contract,
      schema: new MongoSchemaIR(
        [
          new MongoSchemaCollection({
            name: 'items',
            indexes: [idx([{ field: 'extra', direction: 1 }])],
          }),
        ],
        { fromDatabase: false },
      ),
      strict: true,
      frameworkComponents: [],
    });
    expect(result.ok).toBe(true);
    expect(result.schema.issues).toEqual([]);
  });

  it('fails a missing declared collection under external (existence required)', () => {
    const contract = buildContract({ items: { control: 'external' } });
    const result = verifyMongoSchema({
      contract,
      schema: new MongoSchemaIR([], { fromDatabase: false }),
      strict: true,
      frameworkComponents: [],
    });
    expect(result.ok).toBe(false);
    expect(result.schema.issues).toContainEqual(expect.objectContaining({ path: ['items'] }));
  });

  it('ignores an extra live collection under external', () => {
    const contract = buildContract({ items: { control: 'external' } }, 'external');
    const result = verifyMongoSchema({
      contract,
      schema: new MongoSchemaIR(
        [
          new MongoSchemaCollection({ name: 'items', indexes: [] }),
          new MongoSchemaCollection({ name: 'audit', indexes: [] }),
        ],
        { fromDatabase: false },
      ),
      strict: true,
      frameworkComponents: [],
    });
    expect(result.ok).toBe(true);
    expect(
      result.schema.issues.some((i) => issueOutcome(i) === 'not-expected' && i.path.length === 1),
    ).toBe(false);
  });

  it('softens a non-strict extra index to warn for tolerated and observed alike', () => {
    for (const controlPolicy of ['tolerated', 'observed'] as const) {
      const contract = buildContract({ items: { control: controlPolicy } });
      const liveSchema = new MongoSchemaIR(
        [
          new MongoSchemaCollection({
            name: 'items',
            indexes: [idx([{ field: 'extra', direction: 1 }])],
          }),
        ],
        { fromDatabase: false },
      );
      const result = verifyMongoSchema({
        contract,
        schema: liveSchema,
        strict: false,
        frameworkComponents: [],
      });
      expect(result.ok).toBe(true);
      expect(result.schema.issues.length).toBe(0);

      const diff = diffFromContractAndLive(contract, liveSchema, false);
      expect(diff.failures.length).toBe(0);
      expect(diff.warnings.length).toBeGreaterThan(0);
    }
  });

  it('fails missing declared collection under tolerated', () => {
    const contract = buildContract({ items: { control: 'tolerated' } });
    const result = verifyMongoSchema({
      contract,
      schema: new MongoSchemaIR([], { fromDatabase: false }),
      strict: true,
      frameworkComponents: [],
    });
    expect(result.ok).toBe(false);
    expect(result.schema.issues).toContainEqual(expect.objectContaining({ path: ['items'] }));
  });

  it('suppresses extra indexes under external', () => {
    const contract = buildContract({ items: { control: 'external' } });
    const result = verifyMongoSchema({
      contract,
      schema: new MongoSchemaIR(
        [
          new MongoSchemaCollection({
            name: 'items',
            indexes: [idx([{ field: 'extra', direction: 1 }])],
          }),
        ],
        { fromDatabase: false },
      ),
      strict: true,
      frameworkComponents: [],
    });
    expect(result.ok).toBe(true);
    expect(
      result.schema.issues.some(
        (i) => issueOutcome(i) === 'not-expected' && i.path[1]?.startsWith('index:'),
      ),
    ).toBe(false);
  });

  it('downgrades drift to warn under observed', () => {
    const contract = buildContract({ items: { control: 'observed' } });
    const liveSchema = new MongoSchemaIR(
      [
        new MongoSchemaCollection({
          name: 'items',
          indexes: [idx([{ field: 'extra', direction: 1 }])],
        }),
      ],
      { fromDatabase: false },
    );
    const result = verifyMongoSchema({
      contract,
      schema: liveSchema,
      strict: true,
      frameworkComponents: [],
    });
    expect(result.ok).toBe(true);
    expect(result.schema.issues.length).toBe(0);

    const diff = diffFromContractAndLive(contract, liveSchema, true);
    expect(diff.failures.length).toBe(0);
    expect(diff.warnings.length).toBeGreaterThan(0);
  });
});
