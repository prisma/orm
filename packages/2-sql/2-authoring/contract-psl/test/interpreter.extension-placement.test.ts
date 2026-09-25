import type {
  AuthoringContributions,
  AuthoringEntityTypeFactoryOutput,
} from '@internal/framework-components/authoring';
import type { PslBlockSpecDescriptor } from '@internal/psl-parser';
import { entityRef, fixedBlock, optional, str } from '@internal/psl-parser';
import type {
  ResolvedPslModelRefs,
  SqlPslEntityPlacementOutput,
} from '@internal/sql-contract/entity-handle-lowering-hook';
import type { SqlNamespaceBase, SqlNamespaceInput } from '@internal/sql-contract/types';
import type { SqlValueSetDerivingEntityTypeOutput } from '@internal/sql-contract/value-set-derivation-hook';
import { describe, expect, it } from 'vitest';
import { createTestSqlNamespace } from '../../../1-core/contract/test/test-support';
import { interpretPslDocumentToSqlContract } from '../src/interpreter';
import { fixtureDataTypeSupport } from './fixture-data-types';
import {
  postgresScalarTypeDescriptors,
  postgresTarget,
  symbolTableInputFromParseArgs,
} from './fixtures';

interface GuardEntity {
  readonly guardName: string;
  readonly namespaceId: string;
  readonly tableName: string;
  readonly lexicalNamespaceId: string;
}

interface AnnotatedGuardBlock {
  readonly name: string;
  readonly namespaceId: string;
  readonly values: Readonly<Record<string, unknown>>;
  readonly resolvedModelRefs?: ResolvedPslModelRefs;
}

function guardFactory(block: AnnotatedGuardBlock): GuardEntity | undefined {
  const target = block.resolvedModelRefs?.['target'];
  if (target === undefined) return undefined;
  if (block.values['disabled'] === 'yes') return undefined;
  return {
    guardName: block.name,
    namespaceId: target.namespaceId,
    tableName: target.tableName,
    lexicalNamespaceId: block.namespaceId,
  };
}

const guardSpec = () =>
  fixedBlock({
    parameters: {
      target: { type: entityRef({ kind: 'model' }), documentation: 'The guarded model.' },
      disabled: { type: optional(str()), documentation: 'Set to "yes" to skip lowering.' },
    },
  });

const PLACED_GUARD_DESCRIPTORS = {
  guard_rule: {
    kind: 'pslBlock',
    keyword: 'guard_rule',
    discriminator: 'guard',
    name: { required: true },
    spec: guardSpec,
  } satisfies PslBlockSpecDescriptor,
};

const placedGuardOutput = {
  factory: guardFactory,
  pslPlacement: (entity: GuardEntity) => ({ namespaceId: entity.namespaceId }),
  deriveValueSet: (entity: GuardEntity) => ({
    kind: 'valueSet' as const,
    values: [entity.tableName],
  }),
} satisfies AuthoringEntityTypeFactoryOutput<AnnotatedGuardBlock, GuardEntity | undefined> &
  SqlPslEntityPlacementOutput &
  SqlValueSetDerivingEntityTypeOutput;

const unplacedGuardOutput = {
  factory: guardFactory,
} satisfies AuthoringEntityTypeFactoryOutput<AnnotatedGuardBlock, GuardEntity | undefined>;

function contributionsWith(
  output:
    | typeof placedGuardOutput
    | typeof unplacedGuardOutput
    | (AuthoringEntityTypeFactoryOutput<AnnotatedGuardBlock, GuardEntity | undefined> &
        SqlPslEntityPlacementOutput),
): AuthoringContributions {
  return {
    entityTypes: {
      guard: { kind: 'entity', discriminator: 'guard', output },
    },
    pslBlockDescriptors: PLACED_GUARD_DESCRIPTORS,
  };
}

function interpretWith(schema: string, contributions: AuthoringContributions) {
  const capturedEntries: Record<string, Record<string, Record<string, unknown>>> = {};
  const createNamespace = (input: SqlNamespaceInput): SqlNamespaceBase => {
    capturedEntries[input.id] = { ...(capturedEntries[input.id] ?? {}), ...input.entries };
    return createTestSqlNamespace(input);
  };
  const symbolTableInput = symbolTableInputFromParseArgs({
    schema,
    sourceId: 'schema.prisma',
  });
  const result = interpretPslDocumentToSqlContract({
    ...symbolTableInput,
    target: postgresTarget,
    scalarColumnDescriptors: postgresScalarTypeDescriptors,
    composedExtensionContracts: new Map(),
    createNamespace,
    dataTypeLookup: fixtureDataTypeSupport.lookup,
    capabilities: { sql: { scalarList: true } },
    authoringContributions: contributions,
  });
  return { result, capturedEntries };
}

const FALLBACK_TARGET_SCHEMA = `
namespace audit {
  guard_rule inherited_write {
    target = Widget
  }
}

model Widget {
  id Int @id

  @@map("root_widgets")
}
`;

describe('extension-block lowering — selected identity projection', () => {
  it('projects a forward top-level fallback target through the real model mappings', () => {
    const { result, capturedEntries } = interpretWith(
      FALLBACK_TARGET_SCHEMA,
      contributionsWith(placedGuardOutput),
    );

    expect(result.ok).toBe(true);
    const entity = capturedEntries['public']?.['guard']?.['inherited_write'];
    expect(entity).toEqual({
      guardName: 'inherited_write',
      namespaceId: 'public',
      tableName: 'root_widgets',
      lexicalNamespaceId: 'audit',
    });
  });

  it('projects a local same-named model to its own namespace coordinate', () => {
    const { result, capturedEntries } = interpretWith(
      `
namespace audit {
  model Widget {
    id Int @id

    @@map("audit_widgets")
  }

  guard_rule local_write {
    target = Widget
  }
}

model Widget {
  id Int @id

  @@map("root_widgets")
}
`,
      contributionsWith(placedGuardOutput),
    );

    expect(result.ok).toBe(true);
    expect(capturedEntries['audit']?.['guard']?.['local_write']).toMatchObject({
      namespaceId: 'audit',
      tableName: 'audit_widgets',
    });
    expect(capturedEntries['public']?.['guard']).toBeUndefined();
  });
});

describe('extension-block lowering — placement hook', () => {
  it('keeps lexical-owner placement for outputs without the hook', () => {
    const { result, capturedEntries } = interpretWith(
      `
namespace audit {
  model Local {
    id Int @id
  }

  guard_rule stays_home {
    target = Widget
  }
}

model Widget {
  id Int @id

  @@map("root_widgets")
}
`,
      contributionsWith(unplacedGuardOutput),
    );

    expect(result.ok).toBe(true);
    expect(capturedEntries['audit']?.['guard']?.['stays_home']).toMatchObject({
      namespaceId: 'public',
      tableName: 'root_widgets',
    });
    expect(capturedEntries['public']?.['guard']).toBeUndefined();
  });

  it('files the row and its derived value-set at the hook-selected destination', () => {
    const { result, capturedEntries } = interpretWith(
      FALLBACK_TARGET_SCHEMA,
      contributionsWith(placedGuardOutput),
    );

    expect(result.ok).toBe(true);
    expect(capturedEntries['public']?.['valueSet']?.['inherited_write']).toEqual({
      kind: 'valueSet',
      values: ['root_widgets'],
    });
    expect(capturedEntries['audit']?.['guard']).toBeUndefined();
    expect(capturedEntries['audit']?.['valueSet']).toBeUndefined();
  });

  it('does not materialize a policy-bearing bucket for a lexical namespace whose only block relocated', () => {
    const { result, capturedEntries } = interpretWith(
      FALLBACK_TARGET_SCHEMA,
      contributionsWith(placedGuardOutput),
    );

    expect(result.ok).toBe(true);
    expect(capturedEntries['audit']?.['guard']).toBeUndefined();
  });

  it('skips an undefined factory output before the hook runs', () => {
    const throwingOutput = {
      factory: guardFactory,
      pslPlacement: (entity: GuardEntity | undefined) => {
        if (entity === undefined) throw new Error('hook must never see undefined');
        return { namespaceId: entity.namespaceId };
      },
    } satisfies AuthoringEntityTypeFactoryOutput<AnnotatedGuardBlock, GuardEntity | undefined> &
      SqlPslEntityPlacementOutput;
    const { result, capturedEntries } = interpretWith(
      `
namespace audit {
  guard_rule skipped {
    target   = Widget
    disabled = "yes"
  }
}

model Widget {
  id Int @id
}
`,
      contributionsWith(throwingOutput),
    );

    expect(result.ok).toBe(true);
    expect(capturedEntries['audit']?.['guard']).toBeUndefined();
    expect(capturedEntries['public']?.['guard']).toBeUndefined();
  });

  it('rejects two lexically distinct blocks converging on one destination key', () => {
    const { result } = interpretWith(
      `
namespace audit {
  guard_rule converged {
    target = Widget
  }
}

namespace billing {
  guard_rule converged {
    target = Widget
  }
}

model Widget {
  id Int @id
}
`,
      contributionsWith(placedGuardOutput),
    );

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.failure.diagnostics).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          code: 'PSL_DUPLICATE_EXTENSION_ENTITY',
          message: expect.stringContaining('"public"'),
        }),
      ]),
    );
  });

  it('skips invalid blocks entirely; the parser diagnostics arrive as seeds', () => {
    const { result, capturedEntries } = interpretWith(
      `
namespace audit {
  guard_rule broken {
    target = Missing
  }
}

model Widget {
  id Int @id
}
`,
      contributionsWith(placedGuardOutput),
    );

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.failure.diagnostics).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          code: 'PSL_UNRESOLVED_REFERENCE',
          message: 'Cannot find entity "Missing"',
        }),
      ]),
    );
    expect(
      result.failure.diagnostics.filter((diagnostic) =>
        String(diagnostic.message).includes('Cannot find entity "Missing"'),
      ),
    ).toHaveLength(1);
    expect(capturedEntries['audit']?.['guard']).toBeUndefined();
  });
});
