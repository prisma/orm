/**
 * All RLS policy operations authorable in PSL (slice 4, W1):
 *
 *  1. `policy_insert` / `policy_update` / `policy_delete` / `policy_all` each
 *     lower to `PostgresRlsPolicy` with the right `operation`.
 *  2. `withCheck` lowers to `PostgresRlsPolicy.withCheck` and enters the content
 *     hash (two policies differing only in `withCheck` get different wire names).
 *  3. Serialize → deserialize is lossless for a policy carrying `withCheck`.
 *  4. A predicate the operation does not take (a `using` on `policy_insert`, a
 *     `withCheck` on `policy_select`/`policy_delete`) is a load-time param error.
 *  5. The `@@rls`-marked-target rule fires for every keyword.
 */

import type { Contract } from '@internal/contract/types';
import { assembleAuthoringContributions } from '@internal/framework-components/control';
import { buildSymbolTable } from '@internal/psl-parser';
import { parse } from '@internal/psl-parser/syntax';
import type { SqlStorage } from '@internal/sql-contract/types';
import { interpretPslDocumentToSqlContract } from '@internal/sql-contract-psl';
import { describe, expect, it } from 'vitest';
import {
  postgresAuthoringEntityTypes,
  postgresAuthoringModelAttributes,
  postgresAuthoringPslBlockDescriptors,
} from '../src/core/authoring';
import { PostgresContractSerializer } from '../src/core/postgres-contract-serializer';
import { PostgresRlsPolicy } from '../src/core/postgres-rls-policy';
import { type PostgresSchema, postgresCreateNamespace } from '../src/core/postgres-schema';

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

function interpret(source: string) {
  const { document, sources } = parse(source, 'psl-rls-operations.test.psl');
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
    authoringContributions: assembled,
    composedExtensionContracts: new Map(),
    createNamespace: postgresCreateNamespace,
    capabilities: { sql: { scalarList: true } },
  });
}

function onlyPolicy(source: string): PostgresRlsPolicy {
  const result = interpret(source);
  expect(result.ok).toBe(true);
  if (!result.ok) throw new Error('expected ok');
  const ns = result.value.storage.namespaces['public'] as PostgresSchema;
  const policies = Object.values(ns.policy);
  expect(policies).toHaveLength(1);
  const policy = policies[0];
  if (policy === undefined) throw new Error('expected one policy');
  return policy;
}

const MODEL = `
  model profile {
    id       Int @id
    owner_id Int

    @@rls
  }
`;

describe('non-select policy operations lower to the right operation', () => {
  it('policy_delete → operation "delete", using only', () => {
    const policy = onlyPolicy(`
namespace public {
${MODEL}
  policy_delete p_del {
    target = profile
    roles  = [app_user]
    using  = "owner_id = 1"
  }
}
`);
    expect(policy.operation).toBe('delete');
    expect(policy.using).toBe('owner_id = 1');
    expect(policy.withCheck).toBeUndefined();
  });

  it('policy_insert → operation "insert", withCheck only', () => {
    const policy = onlyPolicy(`
namespace public {
${MODEL}
  policy_insert p_ins {
    target   = profile
    roles    = [app_user]
    withCheck = "owner_id = 1"
  }
}
`);
    expect(policy.operation).toBe('insert');
    expect(policy.withCheck).toBe('owner_id = 1');
    expect(policy.using).toBeUndefined();
  });

  it('policy_update → operation "update", using + withCheck', () => {
    const policy = onlyPolicy(`
namespace public {
${MODEL}
  policy_update p_upd {
    target    = profile
    roles     = [app_user]
    using     = "owner_id = 1"
    withCheck = "owner_id = 1"
  }
}
`);
    expect(policy.operation).toBe('update');
    expect(policy.using).toBe('owner_id = 1');
    expect(policy.withCheck).toBe('owner_id = 1');
  });

  it('policy_all → operation "all", using + withCheck', () => {
    const policy = onlyPolicy(`
namespace public {
${MODEL}
  policy_all p_all {
    target    = profile
    roles     = [app_user]
    using     = "owner_id = 1"
    withCheck = "owner_id = 2"
  }
}
`);
    expect(policy.operation).toBe('all');
    expect(policy.using).toBe('owner_id = 1');
    expect(policy.withCheck).toBe('owner_id = 2');
  });
});

describe('withCheck enters the content hash', () => {
  it('two policy_all differing only in withCheck get different wire names', () => {
    const a = onlyPolicy(`
namespace public {
${MODEL}
  policy_all p {
    target    = profile
    roles     = [app_user]
    using     = "owner_id = 1"
    withCheck = "owner_id = 1"
  }
}
`);
    const b = onlyPolicy(`
namespace public {
${MODEL}
  policy_all p {
    target    = profile
    roles     = [app_user]
    using     = "owner_id = 1"
    withCheck = "owner_id = 2"
  }
}
`);
    expect(a.prefix).toBe(b.prefix);
    expect(a.name).not.toBe(b.name);
  });

  it('same predicate text under different operations gets different wire names', () => {
    const del = onlyPolicy(`
namespace public {
${MODEL}
  policy_delete p {
    target = profile
    roles  = [app_user]
    using  = "owner_id = 1"
  }
}
`);
    const ins = onlyPolicy(`
namespace public {
${MODEL}
  policy_insert p {
    target    = profile
    roles     = [app_user]
    withCheck = "owner_id = 1"
  }
}
`);
    expect(del.name).not.toBe(ins.name);
  });
});

describe('serialize → deserialize round-trip with withCheck', () => {
  it('a policy_update with using + withCheck survives a full cycle', () => {
    const result = interpret(`
namespace public {
${MODEL}
  policy_update p_upd {
    target    = profile
    roles     = [app_user]
    using     = "owner_id = 1"
    withCheck = "owner_id = 2"
  }
}
`);
    expect(result.ok).toBe(true);
    if (!result.ok) return;

    const serializer = new PostgresContractSerializer();
    const interpreted = result.value as Contract<SqlStorage>;
    const json = JSON.parse(JSON.stringify(serializer.serializeContract(interpreted))) as unknown;
    const roundTripped = serializer.deserializeContract(json);

    const ns = roundTripped.storage.namespaces['public'] as PostgresSchema;
    const policy = Object.values(ns.policy)[0];
    expect(policy).toBeInstanceOf(PostgresRlsPolicy);
    expect(policy).toMatchObject({
      operation: 'update',
      using: 'owner_id = 1',
      withCheck: 'owner_id = 2',
    });
  });
});

describe('wrong-predicate-for-operation is a load-time error', () => {
  // The predicate the operation does not take is rejected in the lowering
  // (`lowerRlsPolicyFromBlock`), which pushes a diagnostic and produces no
  // entity — so the interpret result fails rather than silently dropping it.
  function expectWrongPredicate(source: string, predicate: string): void {
    const result = interpret(source);
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.failure.diagnostics).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          code: 'PSL_RLS_PREDICATE_NOT_FOR_OPERATION',
          message: expect.stringContaining(`\`${predicate}\``),
        }),
      ]),
    );
  }

  it('using on policy_insert is rejected', () => {
    expectWrongPredicate(
      `
namespace public {
${MODEL}
  policy_insert p_ins {
    target    = profile
    roles     = [app_user]
    withCheck = "owner_id = 1"
    using     = "owner_id = 1"
  }
}
`,
      'using',
    );
  });

  it('withCheck on policy_select is rejected', () => {
    expectWrongPredicate(
      `
namespace public {
${MODEL}
  policy_select p_read {
    target    = profile
    roles     = [app_user]
    using     = "owner_id = 1"
    withCheck = "owner_id = 1"
  }
}
`,
      'withCheck',
    );
  });

  it('withCheck on policy_delete is rejected', () => {
    expectWrongPredicate(
      `
namespace public {
${MODEL}
  policy_delete p_del {
    target    = profile
    roles     = [app_user]
    using     = "owner_id = 1"
    withCheck = "owner_id = 1"
  }
}
`,
      'withCheck',
    );
  });
});

describe('every keyword requires the @@rls-marked target', () => {
  const UNMARKED = `
  model profile {
    id       Int @id
    owner_id Int
  }
`;

  for (const [keyword, body] of [
    ['policy_insert', 'withCheck = "owner_id = 1"'],
    ['policy_update', 'using = "owner_id = 1"\n    withCheck = "owner_id = 1"'],
    ['policy_delete', 'using = "owner_id = 1"'],
    ['policy_all', 'using = "owner_id = 1"\n    withCheck = "owner_id = 1"'],
  ] as const) {
    it(`${keyword} on an unmarked model fails with PSL_EXTENSION_TARGET_MODEL_MISSING_ATTRIBUTE`, () => {
      const result = interpret(`
namespace public {
${UNMARKED}
  ${keyword} p {
    target = profile
    roles  = [app_user]
    ${body}
  }
}
`);
      expect(result.ok).toBe(false);
      if (result.ok) return;
      expect(result.failure.diagnostics).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            code: 'PSL_EXTENSION_TARGET_MODEL_MISSING_ATTRIBUTE',
            message: expect.stringContaining('@@rls'),
          }),
        ]),
      );
    });
  }
});
