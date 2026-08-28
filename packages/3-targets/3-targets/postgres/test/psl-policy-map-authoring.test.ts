/**
 * PSL `@@map` on policy blocks lowers an EXACT-named policy: `name` is the
 * map value verbatim, no `prefix`, no content hash, and no wire-prefix
 * length cap (an exact name is a verbatim physical name, same stance as
 * index `map:`). The block-head identifier stays the source-level logical
 * key — head-keyed duplicate checking is byte-unchanged — and every `@@map`
 * policy pushes an exact-name body-comparison warning into the same
 * per-build batch as indexes (one flush covering both).
 */

import { assembleAuthoringContributions } from '@internal/framework-components/control';
import { buildSymbolTable } from '@internal/psl-parser';
import { parse } from '@internal/psl-parser/syntax';
import { interpretPslDocumentToSqlContract } from '@internal/sql-contract-psl';
import {
  afterAll,
  afterEach,
  beforeAll,
  describe,
  expect,
  it,
  type MockInstance,
  vi,
} from 'vitest';
import {
  postgresAuthoringEntityTypes,
  postgresAuthoringModelAttributes,
  postgresAuthoringPslBlockDescriptors,
} from '../src/core/authoring';
import { PostgresRlsPolicy } from '../src/core/postgres-rls-policy';
import type { PostgresSchema } from '../src/core/postgres-schema';
import { postgresCreateNamespace } from '../src/core/postgres-schema';

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

const scalarColumnDescriptors = new Map<string, { codecId: string; nativeType: string }>([
  ['String', { codecId: 'pg/text@1', nativeType: 'text' }],
  ['Int', { codecId: 'pg/int4@1', nativeType: 'int4' }],
]);

function parsePsl(source: string) {
  const { document, sourceFile } = parse(source);
  return buildSymbolTable({
    document,
    sourceFile,
    pslBlockDescriptors: assembled.pslBlockDescriptors,
  });
}

function interpret(source: string) {
  const { document, sourceFile } = parse(source);
  const { table: symbolTable, diagnostics } = buildSymbolTable({
    document,
    sourceFile,
    pslBlockDescriptors: assembled.pslBlockDescriptors,
  });
  expect(diagnostics).toEqual([]);
  return interpretPslDocumentToSqlContract({
    symbolTable,
    sourceFile,
    sourceId: 'schema.prisma',
    target: postgresTarget,
    scalarColumnDescriptors,
    authoringContributions: assembled,
    composedExtensionContracts: new Map(),
    createNamespace: postgresCreateNamespace,
    capabilities: { sql: { scalarList: true } },
  });
}

function policyDoc(policyBlocks: string, modelAttributes = ''): string {
  return `
namespace public {
  model profile {
    id       Int @id
    owner_id Int
    email    String

    @@rls
${modelAttributes}
  }

${policyBlocks}
}
`;
}

function publicNamespace(result: ReturnType<typeof interpret>): PostgresSchema {
  expect(result.ok).toBe(true);
  if (!result.ok) throw new Error('interpretation failed');
  return result.value.storage.namespaces['public'] as PostgresSchema;
}

/**
 * Spies `process.emitWarning` for one suite. The spy is installed in
 * `beforeAll` rather than at collection time because the suites in this file
 * share the global: stacked collection-time spies let one suite's restore
 * discard the next suite's instrumentation.
 */
function useEmitWarningSpy(): () => MockInstance<typeof process.emitWarning> {
  let spy: MockInstance<typeof process.emitWarning>;
  beforeAll(() => {
    spy = vi.spyOn(process, 'emitWarning').mockImplementation(() => {});
  });
  afterEach(() => {
    spy.mockClear();
  });
  afterAll(() => {
    spy.mockRestore();
  });
  return () => spy;
}

describe('@@map lowers an exact-named policy', () => {
  const emitWarning = useEmitWarningSpy();

  it('name is the map value verbatim, prefix absent, no hash, keyed by the head', () => {
    const result = interpret(
      policyDoc(`
  policy_select p_read {
    target = profile
    roles  = [app_user]
    using  = "owner_id = current_setting('app.uid')::int"
    @@map("Tenant members can read")
  }
`),
    );
    const ns = publicNamespace(result);
    expect(Object.keys(ns.policy)).toEqual(['p_read']);
    const policy = ns.policy['p_read'];
    expect(policy).toBeInstanceOf(PostgresRlsPolicy);
    expect(policy?.name).toBe('Tenant members can read');
    expect(policy?.prefix).toBeUndefined();
    expect(Object.hasOwn(policy ?? {}, 'prefix')).toBe(false);
    expect(policy?.using).toBe("owner_id = current_setting('app.uid')::int");
  });

  it('a map value over the 54-character wire-prefix cap lowers fine (exact names are uncapped)', () => {
    const longName = 'x'.repeat(60);
    const result = interpret(
      policyDoc(`
  policy_select p_read {
    target = profile
    roles  = [app_user]
    using  = "owner_id = 1"
    @@map("${longName}")
  }
`),
    );
    const ns = publicNamespace(result);
    expect(ns.policy['p_read']?.name).toBe(longName);
  });

  it('two same-table blocks sharing one map value are rejected — CREATE POLICY would collide', () => {
    expect(() =>
      interpret(
        policyDoc(`
  policy_select p_read {
    target = profile
    roles  = [app_user]
    using  = "owner_id = 1"
    @@map("shared physical name")
  }

  policy_update p_write {
    target = profile
    roles  = [app_user]
    using  = "owner_id = 1"
    @@map("shared physical name")
  }
`),
      ),
    ).toThrow(/"shared physical name" is declared multiple times/);
  });

  it('two blocks sharing one map value on DIFFERENT tables both lower — policy names are per-table in Postgres', () => {
    const result = interpret(`
namespace public {
  model profile {
    id       Int @id
    owner_id Int

    @@rls
  }

  model account {
    id       Int @id
    owner_id Int

    @@rls
  }

  policy_select p_read_profile {
    target = profile
    roles  = [app_user]
    using  = "owner_id = 1"
    @@map("shared physical name")
  }

  policy_select p_read_account {
    target = account
    roles  = [app_user]
    using  = "owner_id = 1"
    @@map("shared physical name")
  }
}
`);
    const ns = publicNamespace(result);
    expect(Object.keys(ns.policy).sort()).toEqual(['p_read_account', 'p_read_profile']);
  });

  it('two reopened spellings sharing one head stay a duplicate-entity diagnostic (head-keyed)', () => {
    const result = interpret(`
namespace public {
  model profile {
    id       Int @id
    owner_id Int
    email    String

    @@rls
  }

  policy_select p_read {
    target = profile
    roles  = [app_user]
    using  = "owner_id = 1"
    @@map("first physical name")
  }
}

policy_select p_read {
  target = profile
  roles  = [app_user]
  using  = "owner_id = 1"
  @@map("second physical name")
}
`);
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.failure.diagnostics).toContainEqual(
      expect.objectContaining({
        code: 'PSL_DUPLICATE_EXTENSION_ENTITY',
        message: expect.stringContaining('p_read'),
      }),
    );
  });

  it('an argument-less @@map() is a symbol-table diagnostic from the kit', () => {
    const { diagnostics } = parsePsl(
      policyDoc(`
  policy_select p_read {
    target = profile
    roles  = [app_user]
    using  = "owner_id = 1"
    @@map()
  }
`),
    );
    expect(diagnostics).toEqual([
      expect.objectContaining({
        code: 'PSL_INVALID_ATTRIBUTE_SYNTAX',
        message: 'Attribute "map" is missing required argument "name"',
      }),
    ]);
  });

  it('an unquoted @@map(foo) argument is a symbol-table diagnostic from the kit', () => {
    const { diagnostics } = parsePsl(
      policyDoc(`
  policy_select p_read {
    target = profile
    roles  = [app_user]
    using  = "owner_id = 1"
    @@map(foo)
  }
`),
    );
    expect(diagnostics).toEqual([
      expect.objectContaining({
        code: 'PSL_INVALID_ATTRIBUTE_SYNTAX',
        message: 'Expected a string literal',
      }),
    ]);
  });

  it('an empty @@map("") argument is PSL_POLICY_INVALID_MAP — an empty string is not a legal physical name', () => {
    const { diagnostics } = parsePsl(
      policyDoc(`
  policy_select p_read {
    target = profile
    roles  = [app_user]
    using  = "owner_id = 1"
    @@map("")
  }
`),
    );
    expect(diagnostics).toEqual([
      expect.objectContaining({
        code: 'PSL_POLICY_INVALID_MAP',
        message: '@@map policy name must be a non-empty string',
      }),
    ]);
  });

  it('without @@map the wire lowering is unchanged — head prefix, wire name', () => {
    const result = interpret(
      policyDoc(`
  policy_select p_read {
    target = profile
    roles  = [app_user]
    using  = "owner_id = 1"
  }
`),
    );
    const ns = publicNamespace(result);
    const policy = ns.policy['p_read'];
    expect(policy?.prefix).toBe('p_read');
    expect(policy?.name).toMatch(/^p_read_[0-9a-f]{8}$/);
    expect(
      emitWarning().mock.calls.filter(
        ([, options]) =>
          (options as { code?: string } | undefined)?.code === 'PN_EXACT_NAME_BODY_COMPARISON',
      ),
    ).toEqual([]);
  });
});

describe('permissive is an authorable block property', () => {
  useEmitWarningSpy();

  it('permissive = false lowers a RESTRICTIVE policy', () => {
    const result = interpret(
      policyDoc(`
  policy_select p_read {
    target     = profile
    roles      = [app_user]
    using      = "owner_id = 1"
    permissive = false
  }
`),
    );
    const ns = publicNamespace(result);
    const policy = ns.policy['p_read'];
    expect(policy?.permissive).toBe(false);
    expect(policy?.name).toMatch(/^p_read_[0-9a-f]{8}$/);
  });

  it('permissive participates in the wire hash — the RESTRICTIVE twin gets a different name', () => {
    const restrictive = interpret(
      policyDoc(`
  policy_select p_read {
    target     = profile
    roles      = [app_user]
    using      = "owner_id = 1"
    permissive = false
  }
`),
    );
    const permissive = interpret(
      policyDoc(`
  policy_select p_read {
    target = profile
    roles  = [app_user]
    using  = "owner_id = 1"
  }
`),
    );
    const restrictiveName = publicNamespace(restrictive).policy['p_read']?.name;
    const permissiveName = publicNamespace(permissive).policy['p_read']?.name;
    expect(restrictiveName).not.toBe(permissiveName);
  });

  it('omitted permissive defaults true — the wire name is byte-unchanged', () => {
    const explicit = interpret(
      policyDoc(`
  policy_select p_read {
    target     = profile
    roles      = [app_user]
    using      = "owner_id = 1"
    permissive = true
  }
`),
    );
    const omitted = interpret(
      policyDoc(`
  policy_select p_read {
    target = profile
    roles  = [app_user]
    using  = "owner_id = 1"
  }
`),
    );
    const explicitPolicy = publicNamespace(explicit).policy['p_read'];
    const omittedPolicy = publicNamespace(omitted).policy['p_read'];
    expect(explicitPolicy?.permissive).toBe(true);
    expect(explicitPolicy?.name).toBe(omittedPolicy?.name);
  });

  it('an @@map policy carries permissive = false verbatim', () => {
    const result = interpret(
      policyDoc(`
  policy_select p_read {
    target     = profile
    roles      = [app_user]
    using      = "owner_id = 1"
    permissive = false
    @@map("Restrictive tenant read")
  }
`),
    );
    const policy = publicNamespace(result).policy['p_read'];
    expect(policy?.permissive).toBe(false);
    expect(policy?.name).toBe('Restrictive tenant read');
  });
});

describe('exact-name body-comparison warning for @@map policies — shared per-build batch with indexes', () => {
  const emitWarning = useEmitWarningSpy();

  function exactNameWarningCalls() {
    return emitWarning().mock.calls.filter(
      ([, options]) =>
        (options as { code?: string } | undefined)?.code === 'PN_EXACT_NAME_BODY_COMPARISON',
    );
  }

  it('an @@map policy warns once, naming the policy subject and exact name', () => {
    interpret(
      policyDoc(`
  policy_select p_read {
    target = profile
    roles  = [app_user]
    using  = "owner_id = 1"
    @@map("Tenant members can read")
  }
`),
    );
    const calls = exactNameWarningCalls();
    expect(calls).toHaveLength(1);
    const message = String(calls[0]?.[0]);
    expect(message).toContain('policy "Tenant members can read" uses @@map with a SQL body.');
    expect(message).toContain(
      "drop @@map and let the policy block's head name the policy; to migrate an adopted policy to wire naming, remove @@map",
    );
    expect(message).not.toContain('name:');
  });

  it('an over-threshold mixed batch flushes once as TWO summaries, each true of every member', () => {
    const indexAttributes = [1, 2, 3, 4, 5, 6]
      .map((n) => `    @@index([email], where: "(owner_id = ${n})", map: "adopted_idx_${n}")`)
      .join('\n');
    const policyBlocks = ['a', 'b', 'c', 'd', 'e', 'f']
      .map(
        (n) => `
  policy_select p_read_${n} {
    target = profile
    roles  = [app_user]
    using  = "owner_id = 1"
    @@map("adopted policy ${n}")
  }
`,
      )
      .join('\n');
    interpret(policyDoc(policyBlocks, indexAttributes));
    // One flush per build; warnings batch iff code AND summary match, so the
    // mixed batch renders one summary per subject — each carrying its own
    // subject's feature name and remediation, true of every listed member.
    const calls = exactNameWarningCalls();
    expect(calls).toHaveLength(2);
    const messages = calls.map((c) => String(c[0]));
    const policySummary = messages.find((m) =>
      m.startsWith('6 objects use @@map with a SQL body.'),
    );
    const indexSummary = messages.find((m) => m.startsWith('6 objects use map: with a SQL body.'));
    expect(policySummary).toBeDefined();
    expect(indexSummary).toBeDefined();
    expect(policySummary).toContain(
      "drop @@map and let the policy block's head name the policy; to migrate an adopted policy to wire naming, remove @@map (keeping the body text unchanged) and apply the resulting rename migration.",
    );
    for (const n of ['a', 'b', 'c', 'd', 'e', 'f']) {
      expect(policySummary).toContain(`  - policy "adopted policy ${n}"`);
    }
    expect(policySummary).not.toContain('index "');
    expect(indexSummary).toContain(
      'use name: and let Prisma Next manage the physical name; to migrate an adopted object to wire naming, replace map: with name: (keeping the body text unchanged) and apply the resulting rename migration.',
    );
    for (const n of [1, 2, 3, 4, 5, 6]) {
      expect(indexSummary).toContain(`  - index "adopted_idx_${n}"`);
    }
    expect(indexSummary).not.toContain('policy "');
  });
});
