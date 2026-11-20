import type { Contract, ControlPolicy } from '@internal/contract/types';
import { INIT_ADDITIVE_POLICY } from '@internal/family-sql/control';
import { createDataTypeLookup } from '@internal/framework-components/codec';
import { EMPTY_GENERATOR_FUNCTIONS } from '@internal/framework-components/components';
import {
  APP_SPACE_ID,
  assembleAuthoringContributions,
  type MigrationOperationPolicy,
  planOriginOf,
} from '@internal/framework-components/control';
import { withSeedDiagnostics } from '@internal/psl-parser/interpret';
import { bindPslSchema } from '@internal/psl-parser/test';
import type { SqlStorage } from '@internal/sql-contract/types';
import { interpretPslDocumentToSqlContract } from '@internal/sql-contract-psl';
import {
  describeUnsupportedSqlAttribute,
  sqlAttributeSpecs,
} from '@internal/sql-contract-psl/attribute-specs';
import { sqlContextInput } from '@internal/sql-contract-psl/test';
import type { SqlSchemaIRNode } from '@internal/sql-schema-ir/types';
import { createPostgresBuiltinCodecLookup } from '@internal/target-postgres/codecs';
import { postgresDataTypes } from '@internal/target-postgres/data-types';
import {
  PostgresDatabaseSchemaNode,
  postgresCreateNamespace,
} from '@internal/target-postgres/types';
import { ifDefined } from '@internal/utils/defined';
import {
  controlAdapter,
  emptySchema,
  familyInstance,
  formatRunnerFailure,
  frameworkComponents,
  type PostgresControlDriver,
  postgresTargetDescriptor,
  synthEdges,
} from './runner-fixtures';

export const postgresDataTypeLookup = createDataTypeLookup(postgresDataTypes);

// ============================================================================
// PSL sources
// ============================================================================

export const PSL_WITH_ENUM = `
namespace public {
  native_enum OrderStatus {
    draft  = "draft"
    review = "review"
    done   = "done"
    @@map("order_status")
  }

  model orders {
    id     Int @id
    status pg.enum(OrderStatus)
  }
}
`;

export const PSL_WITHOUT_ENUM = `
namespace public {
  model orders {
    id Int @id
  }
}
`;

// Named (non-`public`) schema: this is the shape that exercises the
// schema-qualified, per-segment-quoted enum type name in CREATE TABLE DDL
// (`"auth"."aal_level"`). The `auth` schema is not in the default search_path,
// so a mis-quoted / bare type name fails at apply.
export const PSL_AUTH_WITH_ENUM = `
namespace auth {
  native_enum AalLevel {
    aal1 = "aal1"
    aal2 = "aal2"
    aal3 = "aal3"
    @@map("aal_level")
  }

  model sessions {
    id  Int @id
    aal pg.enum(AalLevel)
  }
}
`;

export const PSL_AUTH_WITHOUT_ENUM = `
namespace auth {
  model sessions {
    id Int @id
  }
}
`;

// Suffix-append / refusal fixtures (Phase 2 Slice B): each shares the same
// `public.order_status` type and `orders.status` column as PSL_WITH_ENUM
// (draft, review, done) and either appends declaration-ordered members or
// changes an existing one, to drive the append/refusal end-to-end proofs.

export const PSL_ENUM_TWO_MEMBERS = `
namespace public {
  native_enum OrderStatus {
    draft  = "draft"
    review = "review"
    @@map("order_status")
  }

  model orders {
    id     Int @id
    status pg.enum(OrderStatus)
  }
}
`;

export const PSL_ENUM_SIX_MEMBERS = `
namespace public {
  native_enum OrderStatus {
    draft     = "draft"
    review    = "review"
    done      = "done"
    archived  = "archived"
    cancelled = "cancelled"
    refunded  = "refunded"
    @@map("order_status")
  }

  model orders {
    id     Int @id
    status pg.enum(OrderStatus)
  }
}
`;

export const PSL_ENUM_RENAMED = `
namespace public {
  native_enum OrderStatus {
    draft    = "draft"
    reviewed = "reviewed"
    done     = "done"
    @@map("order_status")
  }

  model orders {
    id     Int @id
    status pg.enum(OrderStatus)
  }
}
`;

export const PSL_ENUM_VALUE_CHANGED = `
namespace public {
  native_enum OrderStatus {
    draft  = "draft"
    review = "reviewed"
    done   = "done"
    @@map("order_status")
  }

  model orders {
    id     Int @id
    status pg.enum(OrderStatus)
  }
}
`;

export const PSL_ENUM_MEMBER_REMOVED = `
namespace public {
  native_enum OrderStatus {
    draft = "draft"
    done  = "done"
    @@map("order_status")
  }

  model orders {
    id     Int @id
    status pg.enum(OrderStatus)
  }
}
`;

export const PSL_ENUM_REORDERED = `
namespace public {
  native_enum OrderStatus {
    review = "review"
    draft  = "draft"
    done   = "done"
    @@map("order_status")
  }

  model orders {
    id     Int @id
    status pg.enum(OrderStatus)
  }
}
`;

// ============================================================================
// PSL → contract helpers (mirrors rls-lifecycle-e2e.integration.test.ts)
// ============================================================================

export function buildContractFromPsl(psl: string, control: ControlPolicy): Contract<SqlStorage> {
  const assembled = assembleAuthoringContributions([postgresTargetDescriptor]);
  const bound = bindPslSchema(psl, {
    sourceId: 'native-enum-lifecycle-e2e.integration.test.psl',
    context: {
      composedExtensions: [],
      defaultNamespaceId: 'public',
      composedExtensionContracts: new Map(),
      authoringContributions: {
        ...assembled,
        attributeSpecs: sqlAttributeSpecs,
      },
      pslDiagnostics: { describeUnsupportedAttribute: describeUnsupportedSqlAttribute },
      codecLookup: createPostgresBuiltinCodecLookup(),
      controlMutationDefaults: { defaultFunctionRegistry: new Map(), generatorDescriptors: [] },
      generatorFunctions: EMPTY_GENERATOR_FUNCTIONS,
      dataTypes: {
        entries: assembled.dataTypes,
        lookup: postgresDataTypeLookup,
        dataTypeOfCodec: () => undefined,
      },
      resolvedInputs: [],
      capabilities: { sql: { scalarList: true } },
    },
  });
  const result = withSeedDiagnostics(
    interpretPslDocumentToSqlContract({
      documents: bound.documents,
      sources: bound.sources,
      symbolTable: bound.symbolTable,
      binder: bound.binder,
      ...sqlContextInput(bound.context),
      // Carries the REAL Postgres target pack's authoring contributions
      // (`postgresTargetDescriptor.authoring`, including `qualifyColumnType` =
      // `postgresQualifyColumnType`), which schema-qualifies a `pg.enum` column's
      // native type for a named (non-default) schema (`aal_level` → `auth.aal_level`).
      // A hand-built target that omits it silently leaves the column bare — the
      // exact contrived-harness gap that let D3-F1 hide — so the authoring object
      // here is the production one, not a fabricated hook.
      target: {
        kind: 'target' as const,
        familyId: 'sql' as const,
        targetId: 'postgres' as const,
        id: 'postgres',
        version: postgresTargetDescriptor.version,
        capabilities: {},
        defaultNamespaceId: 'public',
        ...ifDefined('authoring', postgresTargetDescriptor.authoring),
      },
      createNamespace: postgresCreateNamespace,
    }),
    bound.seedDiagnostics,
  );

  if (!result.ok) throw new Error(`PSL interpretation failed: ${JSON.stringify(result)}`);
  // `native_enum` leaves per-node control unset; the effective grade resolves
  // from the contract-level default policy — set it to model the managed /
  // external grade under test.
  return { ...(result.value as Contract<SqlStorage>), defaultControlPolicy: control };
}

export const ALLOW_DESTRUCTIVE: MigrationOperationPolicy = {
  allowedOperationClasses: ['additive', 'widening', 'destructive'],
};

export async function planContract(
  contract: Contract<SqlStorage>,
  schema: SqlSchemaIRNode,
  policy: MigrationOperationPolicy,
) {
  const planner = postgresTargetDescriptor.createPlanner(controlAdapter);
  const planResult = planner.plan({
    contract,
    schema,
    policy,
    fromContract: null,
    origin: null,
    statements: [],
    frameworkComponents,
    spaceId: APP_SPACE_ID,
    snapshotsImportPath: '../../snapshots',
  });
  if (planResult.kind !== 'success')
    throw new Error(`Planner failed: ${JSON.stringify(planResult)}`);
  return planResult.plan;
}

export async function applyPlan(
  driver: PostgresControlDriver,
  plan: Awaited<ReturnType<typeof planContract>>,
  contract: Contract<SqlStorage>,
  policy: MigrationOperationPolicy,
): Promise<void> {
  const runner = postgresTargetDescriptor.createRunner(familyInstance);
  const executeResult = await runner.execute({
    driver,
    perSpaceOptions: [
      {
        space: plan.spaceId ?? APP_SPACE_ID,
        plan,
        migrationEdges: synthEdges(plan),
        driver,
        destinationContract: contract,
        policy,
        frameworkComponents,
      },
    ],
  });
  if (!executeResult.ok)
    throw new Error(`Runner failed:\n${formatRunnerFailure(executeResult.failure)}`);
}

export async function opIds(
  plan: Awaited<ReturnType<typeof planContract>>,
): Promise<readonly string[]> {
  const ops = await Promise.all(plan.operations);
  return ops.map((op) => op.id);
}

/** Like `planContract`, but returns the raw planner result instead of throwing on failure — for the refusal-class proofs, where failure is the expected outcome. */
export function planDirect(
  contract: Contract<SqlStorage>,
  schema: SqlSchemaIRNode,
  policy: MigrationOperationPolicy,
  fromContract: Contract<SqlStorage> | null = null,
) {
  const planner = postgresTargetDescriptor.createPlanner(controlAdapter);
  return planner.plan({
    contract,
    schema,
    policy,
    fromContract,
    origin: fromContract === null ? null : planOriginOf(fromContract),
    statements: [],
    frameworkComponents,
    spaceId: APP_SPACE_ID,
    snapshotsImportPath: '../../snapshots',
  });
}

/** The ordered member list of a native enum type in a namespace of an introspected/live schema tree, or `undefined` when the namespace or type is absent. */
export function nativeEnumMembers(
  schema: SqlSchemaIRNode,
  namespaceId: string,
  typeName: string,
): readonly string[] | undefined {
  PostgresDatabaseSchemaNode.assert(schema);
  return schema.namespaces[namespaceId]?.nativeEnums.find((e) => e.typeName === typeName)?.members;
}

/** The exact operator-worded refusal for `public.order_status` (mirrors `nativeEnumMemberChangeRefusal` in the planner — tests match it verbatim). */
export function orderStatusRefusalMessage(
  expectedMembers: readonly string[],
  actualMembers: readonly string[],
): string {
  return (
    'Native enum type "public"."order_status" changed beyond appending new values ' +
    `(contract declares [${expectedMembers.join(', ')}], database has [${actualMembers.join(', ')}]). ` +
    "Prisma 8 does not modify a native enum's existing values (rename, removal, reorder) — " +
    'see https://pris.ly/d/postgres-native-enums. Author the change manually with `migration new`.'
  );
}

/** Applies the 3-member `PSL_WITH_ENUM` baseline (draft, review, done) from an empty database — the shared starting state for the refusal-class proofs. */
export async function applyBaseEnumContract(driver: PostgresControlDriver): Promise<void> {
  const contract = buildContractFromPsl(PSL_WITH_ENUM, 'managed');
  const plan = await planContract(contract, emptySchema, INIT_ADDITIVE_POLICY);
  await applyPlan(driver, plan, contract, INIT_ADDITIVE_POLICY);
}
