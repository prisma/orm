import { computeProfileHash } from '@internal/contract/hashing';
import { type Contract, coreHash } from '@internal/contract/types';
import type { TargetBoundComponentDescriptor } from '@internal/framework-components/components';
import { applicationDomainOf } from '@repo/test-utils';
import { describe, expect, it } from 'vitest';
import { enrichContract } from '../../src/control-api/contract-enrichment';

function makeIR(overrides?: Partial<Contract>): Contract {
  const capabilities = overrides?.capabilities ?? {};
  return {
    targetFamily: 'sql',
    target: 'postgres',
    roots: {},
    domain: applicationDomainOf({ models: {} }),
    storage: { storageHash: coreHash('test'), namespaces: {} },
    extensions: {},
    capabilities,
    profileHash: computeProfileHash({ target: 'postgres', targetFamily: 'sql', capabilities }),
    meta: {},
    ...overrides,
  };
}

function makeAdapter(
  overrides?: Partial<TargetBoundComponentDescriptor<'sql', 'postgres'>>,
): TargetBoundComponentDescriptor<'sql', 'postgres'> {
  return {
    kind: 'adapter',
    id: 'postgres',
    familyId: 'sql',
    targetId: 'postgres',
    version: '0.0.1',
    ...overrides,
  } as TargetBoundComponentDescriptor<'sql', 'postgres'>;
}

function makeExtension(
  overrides?: Partial<TargetBoundComponentDescriptor<'sql', 'postgres'>>,
): TargetBoundComponentDescriptor<'sql', 'postgres'> {
  return {
    kind: 'extension',
    id: 'pgvector',
    familyId: 'sql',
    targetId: 'postgres',
    version: '0.0.1',
    ...overrides,
  } as TargetBoundComponentDescriptor<'sql', 'postgres'>;
}

describe('enrichContract', () => {
  it('returns IR unchanged when no components are provided', () => {
    const ir = makeIR();
    const result = enrichContract(ir, []);
    expect(result).toEqual(ir);
  });

  it('merges adapter capabilities into IR', () => {
    const ir = makeIR();
    const adapter = makeAdapter({
      capabilities: {
        postgres: { lateral: true, returning: true },
      },
    });

    const result = enrichContract(ir, [adapter]);

    expect(result.capabilities).toEqual({
      postgres: { lateral: true, returning: true },
    });
  });

  it('merges capabilities from multiple components', () => {
    const ir = makeIR();
    const adapter = makeAdapter({
      capabilities: {
        postgres: { lateral: true, returning: true },
      },
    });
    const extension = makeExtension({
      capabilities: {
        postgres: { 'pgvector.cosine': true },
      },
    });

    const result = enrichContract(ir, [adapter, extension]);

    expect(result.capabilities).toEqual({
      postgres: {
        lateral: true,
        returning: true,
        'pgvector.cosine': true,
      },
    });
  });

  it('merges framework capabilities with IR baseline capabilities', () => {
    const ir = makeIR({
      capabilities: { sql: { select: true } },
    });
    const adapter = makeAdapter({
      capabilities: { postgres: { returning: true } },
    });

    const result = enrichContract(ir, [adapter]);

    expect(result.capabilities).toEqual({
      sql: { select: true },
      postgres: { returning: true },
    });
  });

  it('writes the profile hash of the capabilities it writes, not the one its source computed over fewer', () => {
    const ir = makeIR({ capabilities: { sql: { select: true } } });
    const adapter = makeAdapter({
      capabilities: { postgres: { lateral: true, returning: true } },
    });

    const result = enrichContract(ir, [adapter]);

    expect(result.profileHash).not.toBe(ir.profileHash);
    expect(result.profileHash).toBe(
      computeProfileHash({
        target: 'postgres',
        targetFamily: 'sql',
        capabilities: {
          postgres: { lateral: true, returning: true },
          sql: { select: true },
        },
      }),
    );
  });

  it('extracts extension pack metadata from extension descriptors', () => {
    const extension = makeExtension({
      id: 'pgvector',
      version: '0.0.2',
      capabilities: { postgres: { 'pgvector.cosine': true } },
    });

    const result = enrichContract(makeIR(), [extension]);

    expect(result.extensions).toEqual({
      pgvector: {
        kind: 'extension',
        id: 'pgvector',
        familyId: 'sql',
        targetId: 'postgres',
        version: '0.0.2',
        capabilities: { postgres: { 'pgvector.cosine': true } },
      },
    });
  });

  it('replaces runtime-only extension pack fields with normalized metadata', () => {
    const extension = makeExtension({
      capabilities: { postgres: { 'pgvector.cosine': true } },
      types: {
        codecTypes: {
          import: {
            package: '@internal/extension-pgvector/codec-types',
            named: 'CodecTypes',
            alias: 'PgVectorTypes',
          },
        },
      },
    });

    const result = enrichContract(
      makeIR({
        extensions: {
          pgvector: {
            kind: 'extension',
            id: 'pgvector',
            familyId: 'sql',
            targetId: 'postgres',
            version: '0.0.1',
            create: () => ({ familyId: 'sql', targetId: 'postgres' }),
            authoring: { type: { pgvector: {} } },
          },
        },
      }),
      [extension],
    );

    expect(result.extensions).toEqual({
      pgvector: {
        kind: 'extension',
        id: 'pgvector',
        familyId: 'sql',
        targetId: 'postgres',
        version: '0.0.1',
        capabilities: { postgres: { 'pgvector.cosine': true } },
      },
    });
  });

  it('records no type-import declaration and no control-plane hooks of an extension', () => {
    const extension = makeExtension({
      types: {
        codecTypes: {
          controlPlaneHooks: { 'pg/vector@1': { resolveIdentityValue: () => null } },
          import: { package: '@ext/pgvector', named: 'CodecTypes', alias: 'PgvectorTypes' },
          parameterizedOutputTypes: {
            package: '@ext/pgvector',
            named: 'ParameterizedOutputTypesForTypeParams',
            alias: 'PgvectorOutputTypes',
          },
          typeImports: [{ package: '@ext/pgvector', named: 'Vector', alias: 'Vector' }],
        },
        queryOperationTypes: {
          import: { package: '@ext/pgvector', named: 'QueryOperationTypes', alias: 'Q' },
        },
      },
    });

    const result = enrichContract(makeIR(), [extension]);

    expect(result.extensions['pgvector']).toEqual({
      kind: 'extension',
      id: 'pgvector',
      familyId: 'sql',
      targetId: 'postgres',
      version: '0.0.1',
    });
  });

  it('copies only the aggregate descriptors of the type metadata, leaving out the storage list an older pack still declares', () => {
    const typesOfAnOlderPack = {
      codecTypes: {
        import: { package: '@ext/acme', named: 'CodecTypes', alias: 'AcmeTypes' },
      },
      queryOperationTypes: {
        import: { package: '@ext/acme', named: 'QueryOperationTypes', alias: 'AcmeQueryOps' },
      },
      aggregateDescriptors: [],
      operationTypes: {
        import: { package: '@ext/acme', named: 'OperationTypes', alias: 'AcmeOps' },
      },
      storage: [{ typeId: 'acme/shape@1', familyId: 'sql', targetId: 'postgres' }],
    };
    const extension = makeExtension({ types: typesOfAnOlderPack });

    const result = enrichContract(makeIR(), [extension]);

    expect((result.extensions['pgvector'] as Record<string, unknown>)['types']).toEqual({
      aggregateDescriptors: [],
    });
  });

  it('does not create extension pack entries for non-extension components', () => {
    const adapter = makeAdapter({
      capabilities: { postgres: { returning: true } },
    });

    const result = enrichContract(makeIR(), [adapter]);

    expect(result.extensions).toEqual({});
  });
});
