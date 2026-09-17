/**
 * `@@rls` authoring end-to-end in the Postgres target:
 *
 *  1. Lowering: `@@rls` on a model lowers through the `modelAttributes`
 *     contribution to a `PostgresRlsEnablement` marker in `entries.rls`,
 *     keyed by table name, without clobbering block-produced entry kinds.
 *  2. Serializer round-trip: a contract carrying `policy`, `role`, AND `rls`
 *     entries survives serialize → deserialize losslessly.
 *  3. Diagnostics: duplicate `@@rls`; `@@rls` without the Postgres pack;
 *     `policy_*` targeting an unmarked model at load time, naming
 *     the model and the policy prefix, order-independently.
 */

import type { Contract } from '@internal/contract/types';
import { assembleAuthoringContributions } from '@internal/framework-components/control';
import { buildSymbolTable } from '@internal/psl-parser';
import { parse } from '@internal/psl-parser/syntax';
import type { SqlStorage } from '@internal/sql-contract/types';
import { interpretPslDocumentToSqlContract } from '@internal/sql-contract-psl';
import { createSqlContract } from '@repo/test-utils';
import { describe, expect, it } from 'vitest';
import {
  postgresAuthoringEntityTypes,
  postgresAuthoringModelAttributes,
  postgresAuthoringPslBlockDescriptors,
} from '../src/core/authoring';
import { PostgresContractSerializer } from '../src/core/postgres-contract-serializer';
import { PostgresRlsEnablement } from '../src/core/postgres-rls-enablement';
import { PostgresRlsPolicy } from '../src/core/postgres-rls-policy';
import { PostgresRole } from '../src/core/postgres-role';
import { PostgresSchema, postgresCreateNamespace } from '../src/core/postgres-schema';

const assembled = assembleAuthoringContributions([
  {
    authoring: {
      entityTypes: postgresAuthoringEntityTypes,
      pslBlockDescriptors: postgresAuthoringPslBlockDescriptors,
      modelAttributes: postgresAuthoringModelAttributes,
    },
  },
]);

const postgresTarget = {
  kind: 'target' as const,
  familyId: 'sql' as const,
  targetId: 'postgres' as const,
  id: 'postgres',
  version: '0.0.1',
  capabilities: {},
  defaultNamespaceId: 'public',
};

const scalarTypeDescriptors = new Map<string, { codecId: string; nativeType: string }>([
  ['String', { codecId: 'pg/text@1', nativeType: 'text' }],
  ['Int', { codecId: 'pg/int4@1', nativeType: 'int4' }],
]);

function interpret(source: string, options?: { readonly withoutModelAttributes?: boolean }) {
  const { document, sources } = parse(source, 'psl-rls-authoring.test.psl');
  const { symbolTable, diagnostics } = buildSymbolTable({
    documents: [document],
    sources,
    pslBlockDescriptors: assembled.pslBlockDescriptors,
  });
  expect(diagnostics).toEqual([]);

  return interpretPslDocumentToSqlContract({
    document,
    symbolTable,
    sources,
    target: postgresTarget,
    scalarColumnDescriptors: scalarTypeDescriptors,
    authoringContributions: options?.withoutModelAttributes
      ? { ...assembled, modelAttributes: {} }
      : assembled,
    composedExtensionContracts: new Map(),
    createNamespace: postgresCreateNamespace,
    capabilities: { sql: { scalarList: true } },
  });
}

const MARKED_MODEL_WITH_POLICY = `
namespace public {
  model profile {
    id       Int @id
    owner_id Int

    @@rls
  }

  policy_select p_read {
    target = profile
    roles  = [app_user]
    using  = "owner_id = current_setting('app.uid')::int"
  }
}
`;

describe('@@rls lowering to the marker entity', () => {
  it('lowers @@rls to a PostgresRlsEnablement in entries.rls keyed by table name', () => {
    const result = interpret(MARKED_MODEL_WITH_POLICY);
    expect(result.ok).toBe(true);
    if (!result.ok) return;

    const ns = result.value.storage.namespaces['public'] as PostgresSchema;
    expect(ns).toBeInstanceOf(PostgresSchema);
    const marker = ns.rls['profile'];
    expect(marker).toBeInstanceOf(PostgresRlsEnablement);
    expect(marker).toMatchObject({ kind: 'rls', tableName: 'profile', namespaceId: 'public' });
    expect(Object.isFrozen(marker)).toBe(true);
  });

  it('keys the marker by the mapped table name when the model uses @@map', () => {
    const result = interpret(`
namespace public {
  model Profile {
    id Int @id

    @@map("profile_rows")
    @@rls
  }
}
`);
    expect(result.ok).toBe(true);
    if (!result.ok) return;

    const ns = result.value.storage.namespaces['public'] as PostgresSchema;
    expect(Object.keys(ns.rls)).toEqual(['profile_rows']);
    expect(ns.rls['profile_rows']).toMatchObject({ tableName: 'profile_rows' });
  });

  it('files the marker beside block-produced kinds without clobbering them', () => {
    const result = interpret(MARKED_MODEL_WITH_POLICY);
    expect(result.ok).toBe(true);
    if (!result.ok) return;

    const ns = result.value.storage.namespaces['public'] as PostgresSchema;
    expect(Object.keys(ns.policy)).toHaveLength(1);
    expect(Object.keys(ns.rls)).toEqual(['profile']);
    expect(Object.keys(ns.table)).toEqual(['profile']);
  });

  it('emits PSL_DUPLICATE_ATTRIBUTE when @@rls is declared twice on one model', () => {
    const result = interpret(`
namespace public {
  model profile {
    id Int @id

    @@rls
    @@rls
  }
}
`);
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.failure.diagnostics).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          code: 'PSL_DUPLICATE_ATTRIBUTE',
          message: '`@@rls` declared more than once on model "profile".',
        }),
      ]),
    );
  });

  it('emits PSL_INVALID_ATTRIBUTE_SYNTAX when @@rls receives an argument', () => {
    const result = interpret(`
namespace public {
  model profile {
    id Int @id

    @@rls("on")
  }
}
`);
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.failure.diagnostics).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          code: 'PSL_INVALID_ATTRIBUTE_SYNTAX',
          message: 'Attribute "rls" received too many positional arguments',
        }),
      ]),
    );
  });

  it('falls through to PSL_UNSUPPORTED_MODEL_ATTRIBUTE when the pack contributes no model attributes', () => {
    const result = interpret(
      `
namespace public {
  model profile {
    id Int @id

    @@rls
  }
}
`,
      { withoutModelAttributes: true },
    );
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.failure.diagnostics).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          code: 'PSL_UNSUPPORTED_MODEL_ATTRIBUTE',
          message: 'Model "profile" uses unsupported attribute "@@rls"',
        }),
      ]),
    );
  });
});

describe('policy_* blocks require an @@rls-marked target model at load time', () => {
  it('accepts a policy whose target model declares @@rls', () => {
    const result = interpret(MARKED_MODEL_WITH_POLICY);
    expect(result.ok).toBe(true);
  });

  it('rejects a policy whose target model does not declare @@rls, naming the model and the prefix', () => {
    const result = interpret(`
namespace public {
  model profile {
    id       Int @id
    owner_id Int
  }

  policy_select p_read {
    target = profile
    roles  = [app_user]
    using  = "owner_id = current_setting('app.uid')::int"
  }
}
`);
    expect(result.ok).toBe(false);
    if (result.ok) return;
    const diagnostic = result.failure.diagnostics.find(
      (d) => d.code === 'PSL_EXTENSION_TARGET_MODEL_MISSING_ATTRIBUTE',
    );
    expect(diagnostic).toMatchObject({
      code: 'PSL_EXTENSION_TARGET_MODEL_MISSING_ATTRIBUTE',
      message: expect.stringContaining('"p_read"'),
    });
    expect(diagnostic?.message).toContain('"profile"');
    expect(diagnostic?.message).toContain('@@rls');
    expect(diagnostic?.message).not.toMatch(/p_read_[0-9a-f]{8}/);
  });

  it('is order-independent: the policy block may precede its target model', () => {
    const beforeUnmarked = interpret(`
namespace public {
  policy_select p_read {
    target = profile
    roles  = [app_user]
    using  = "owner_id = current_setting('app.uid')::int"
  }

  model profile {
    id       Int @id
    owner_id Int
  }
}
`);
    expect(beforeUnmarked.ok).toBe(false);
    if (!beforeUnmarked.ok) {
      expect(beforeUnmarked.failure.diagnostics).toEqual(
        expect.arrayContaining([
          expect.objectContaining({ code: 'PSL_EXTENSION_TARGET_MODEL_MISSING_ATTRIBUTE' }),
        ]),
      );
    }

    const beforeMarked = interpret(`
namespace public {
  policy_select p_read {
    target = profile
    roles  = [app_user]
    using  = "owner_id = current_setting('app.uid')::int"
  }

  model profile {
    id       Int @id
    owner_id Int

    @@rls
  }
}
`);
    expect(beforeMarked.ok).toBe(true);
  });
});

describe('a policy whose target does not resolve to a declared model', () => {
  it('emits PSL_EXTENSION_MODEL_REF_UNRESOLVED naming the prefix and the model, without throwing', () => {
    const result = interpret(`
namespace public {
  model profile {
    id Int @id

    @@rls
  }

  policy_select p_read {
    target = porfile
    roles  = [app_user]
    using  = "true"
  }
}
`);
    expect(result.ok).toBe(false);
    if (result.ok) return;
    const diagnostic = result.failure.diagnostics.find(
      (d) => d.code === 'PSL_EXTENSION_MODEL_REF_UNRESOLVED',
    );
    expect(diagnostic).toMatchObject({
      code: 'PSL_EXTENSION_MODEL_REF_UNRESOLVED',
      message: expect.stringContaining('"p_read"'),
    });
    expect(diagnostic?.message).toContain('"porfile"');
    expect(diagnostic?.message).not.toMatch(/p_read_[0-9a-f]{8}/);
  });
});

describe("a policy's tableName resolves to the target model's declared storage name", () => {
  it('keys the policy by the @@map storage name, agreeing with the rls marker', () => {
    const result = interpret(`
namespace public {
  model Profile {
    id       Int @id
    owner_id Int

    @@map("profile_rows")
    @@rls
  }

  policy_select p_read {
    target = Profile
    roles  = [app_user]
    using  = "owner_id = current_setting('app.uid')::int"
  }
}
`);
    expect(result.ok).toBe(true);
    if (!result.ok) return;

    const ns = result.value.storage.namespaces['public'] as PostgresSchema;
    expect(Object.keys(ns.rls)).toEqual(['profile_rows']);
    const [policyKey] = Object.keys(ns.policy);
    const policy = ns.policy[policyKey!]!;
    expect(policy.tableName).toBe('profile_rows');
    expect(policy.tableName).toBe(Object.keys(ns.rls)[0]);
  });
});

describe('PostgresContractSerializer rls round-trip survives serialize → deserialize', () => {
  function makeContractWithAllThreeKinds() {
    const base = createSqlContract({
      storage: {
        namespaces: {
          public: {
            id: 'public',
            entries: {
              table: {
                profile: {
                  columns: {
                    id: { nativeType: 'int4', codecId: 'pg/int4@1', nullable: false },
                  },
                  primaryKey: { columns: ['id'] },
                  uniques: [],
                  indexes: [],
                  foreignKeys: [],
                },
              },
            },
          },
        },
      },
    });

    return {
      ...base,
      storage: {
        ...base.storage,
        namespaces: {
          public: {
            ...base.storage.namespaces['public']!,
            entries: {
              ...base.storage.namespaces['public']!.entries,
              policy: {
                p_read_deadbeef: {
                  kind: 'policy',
                  name: 'p_read_deadbeef',
                  prefix: 'p_read',
                  tableName: 'profile',
                  namespaceId: 'public',
                  operation: 'select',
                  permissive: true,
                  roles: ['app_user'],
                  using: 'true',
                },
              },
              role: {
                app_user: { kind: 'role', name: 'app_user', namespaceId: 'public' },
              },
              rls: {
                profile: { kind: 'rls', tableName: 'profile', namespaceId: 'public' },
              },
            },
          },
        },
      },
    };
  }

  it('round-trips policy, role, AND rls entries together without loss', () => {
    const serializer = new PostgresContractSerializer();
    const input = makeContractWithAllThreeKinds();

    const contract = serializer.deserializeContract(input);
    const json = serializer.serializeContract(contract);
    const reparsed = JSON.parse(JSON.stringify(json)) as typeof json;
    const roundTripped = serializer.deserializeContract(reparsed);

    const ns = roundTripped.storage.namespaces['public'] as PostgresSchema;
    expect(ns).toBeInstanceOf(PostgresSchema);

    const marker = ns.rls['profile'];
    expect(marker).toBeInstanceOf(PostgresRlsEnablement);
    expect(marker).toMatchObject({ kind: 'rls', tableName: 'profile', namespaceId: 'public' });
    expect(Object.isFrozen(marker)).toBe(true);

    expect(ns.policy['p_read_deadbeef']).toBeInstanceOf(PostgresRlsPolicy);
    expect(ns.role['app_user']).toBeInstanceOf(PostgresRole);
    expect(Object.keys(ns.table)).toEqual(['profile']);
  });

  it('serializes the marker under entries.rls with its enumerable kind', () => {
    const serializer = new PostgresContractSerializer();
    const contract = serializer.deserializeContract(makeContractWithAllThreeKinds());
    const json = serializer.serializeContract(contract);
    const storage = (json as { storage: { namespaces: Record<string, unknown> } }).storage;
    const publicNs = storage.namespaces['public'] as {
      entries: Record<string, Record<string, unknown>>;
    };
    expect(publicNs.entries['rls']).toEqual({
      profile: { kind: 'rls', tableName: 'profile', namespaceId: 'public' },
    });
  });

  it('interpreted PSL with @@rls survives a full serialize → deserialize cycle', () => {
    const result = interpret(MARKED_MODEL_WITH_POLICY);
    expect(result.ok).toBe(true);
    if (!result.ok) return;

    const serializer = new PostgresContractSerializer();
    const interpreted = result.value as Contract<SqlStorage>;
    const json = JSON.parse(JSON.stringify(serializer.serializeContract(interpreted))) as unknown;
    const roundTripped = serializer.deserializeContract(json);

    const ns = roundTripped.storage.namespaces['public'] as PostgresSchema;
    expect(ns.rls['profile']).toBeInstanceOf(PostgresRlsEnablement);
    expect(ns.rls['profile']).toMatchObject({
      kind: 'rls',
      tableName: 'profile',
      namespaceId: 'public',
    });
    expect(Object.keys(ns.policy)).toHaveLength(1);
  });
});

describe('PostgresRlsEnablement IR class', () => {
  it('constructs frozen with an enumerable kind that survives JSON', () => {
    const marker = new PostgresRlsEnablement({ tableName: 'profile', namespaceId: 'public' });
    expect(marker.kind).toBe('rls');
    expect(Object.isFrozen(marker)).toBe(true);
    expect(() => {
      (marker as { tableName: string }).tableName = 'mutated';
    }).toThrow();
    expect(JSON.parse(JSON.stringify(marker))).toEqual({
      kind: 'rls',
      tableName: 'profile',
      namespaceId: 'public',
    });
  });
});
