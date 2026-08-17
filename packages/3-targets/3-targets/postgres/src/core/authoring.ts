import {
  temporalAuthoringPresets,
  temporalCodecPresetWithPrecision,
  temporalStringAuthoringPresets,
} from '@internal/family-sql/control';
import type {
  AuthoringEntityContext,
  AuthoringEntityTypeFactoryOutput,
  AuthoringEntityTypeNamespace,
  AuthoringFieldNamespace,
  AuthoringModelAttributeContext,
  AuthoringModelAttributeDescriptorNamespace,
  AuthoringPslBlockDescriptorNamespace,
  AuthoringTypeNamespace,
  PslExtensionBlock,
} from '@internal/framework-components/authoring';
import { UNBOUND_NAMESPACE_ID } from '@internal/framework-components/ir';
import type { ContributedPslDiagnosticCode } from '@internal/framework-components/psl-ast';
import { modelAttribute } from '@internal/psl-parser';
import type {
  EntityHandleLoweringInput,
  LoweredPackEntity,
  ResolvedEntityHandleRef,
  ResolvedPslModelRefs,
} from '@internal/sql-contract/entity-handle-lowering-hook';
import { exactNameBodyWarning } from '@internal/sql-contract/index-naming';
import type { SqlValueSetDerivingEntityTypeOutput } from '@internal/sql-contract/value-set-derivation-hook';
import { assertWireNamePrefixLength, normalizeSqlBody } from '@internal/sql-schema-ir/naming';
import { assertDefined } from '@internal/utils/assertions';
import { blindCast } from '@internal/utils/casts';
import { ifDefined } from '@internal/utils/defined';
import { PG_ENUM_CODEC_ID } from './codec-ids';
import { postgresError } from './errors';
import { PostgresNativeEnum } from './postgres-native-enum';
import { PostgresRlsEnablement, type PostgresRlsEnablementInput } from './postgres-rls-enablement';
import { PostgresRlsPolicy, type RlsPolicyOperation } from './postgres-rls-policy';
import { PostgresRole } from './postgres-role';
import {
  PostgresNativeEnumSchema,
  PostgresRlsEnablementSchema,
  PostgresRlsPolicySchema,
  PostgresRoleSchema,
} from './postgres-validators';
import { computeContentHash, POLICY_OPERATION_PREDICATES } from './rls/canonicalize';

// Contributed diagnostic codes, declared once as typed consts — the
// `ContributedPslDiagnosticCode` type is the only thing enforcing the
// `PSL_` prefix convention, so the declared-const form (the
// `sql-attribute-specs.ts` convention) is the settled spelling for pack
// codes; inline string literals bypass it.
const PSL_RLS_PREDICATE_NOT_FOR_OPERATION: ContributedPslDiagnosticCode =
  'PSL_RLS_PREDICATE_NOT_FOR_OPERATION';
const PSL_POLICY_INVALID_MAP: ContributedPslDiagnosticCode = 'PSL_POLICY_INVALID_MAP';
const PSL_NATIVE_ENUM_INVALID_MAP: ContributedPslDiagnosticCode = 'PSL_NATIVE_ENUM_INVALID_MAP';
const PSL_NATIVE_ENUM_BARE_MEMBER: ContributedPslDiagnosticCode = 'PSL_NATIVE_ENUM_BARE_MEMBER';
const PSL_EXTENSION_INVALID_VALUE: ContributedPslDiagnosticCode = 'PSL_EXTENSION_INVALID_VALUE';
const PSL_NATIVE_ENUM_DUPLICATE_MEMBER_VALUE: ContributedPslDiagnosticCode =
  'PSL_NATIVE_ENUM_DUPLICATE_MEMBER_VALUE';
const PSL_NATIVE_ENUM_MISSING_MEMBERS: ContributedPslDiagnosticCode =
  'PSL_NATIVE_ENUM_MISSING_MEMBERS';
const PSL_ROLE_BLOCK_OUTSIDE_UNBOUND_NAMESPACE: ContributedPslDiagnosticCode =
  'PSL_ROLE_BLOCK_OUTSIDE_UNBOUND_NAMESPACE';

/**
 * `pg.enum(<ref>)` registers as an ordinary type constructor whose sole
 * positional argument names a `native_enum` entity instead of carrying a
 * literal value. The interpreter resolves the ref to the `native_enum`
 * entity generically (driven by `entityRefArg`); the `pg/enum@1` codec
 * descriptor's `columnFromEntity` hook (see `codecs.ts`) converts that
 * entity into the column's `typeParams` and native type.
 */
export const postgresAuthoringTypes = {
  BigIntNumber: {
    kind: 'typeConstructor',
    output: {
      codecId: 'pg/int8number@1',
      nativeType: 'int8',
    },
  },
  UnboundedInt: {
    kind: 'typeConstructor',
    output: {
      codecId: 'pg/unboundedint@1',
      nativeType: 'numeric',
    },
  },
  pg: {
    enum: {
      kind: 'typeConstructor',
      entityRefArg: { index: 0, entityKind: 'native_enum' },
      output: {
        codecId: PG_ENUM_CODEC_ID,
      },
    },
  },
} as const satisfies AuthoringTypeNamespace;

export interface RlsPolicyExtensionBlock extends PslExtensionBlock {
  readonly namespaceId: string;
  /**
   * Model refs the family interpreter resolved from the block's descriptor-
   * declared `refKind: 'model'` parameters before invoking this factory
   * (keyed by parameter name). An unresolved required ref is the
   * interpreter's diagnostic; the factory is never called with one missing.
   */
  readonly resolvedModelRefs?: ResolvedPslModelRefs;
}

/** A parsed `role` block annotated with its lexical namespace id by the interpreter. */
export interface RoleExtensionBlock extends PslExtensionBlock {
  readonly namespaceId: string;
}

/**
 * Maps a `policy_<op>` keyword to the RLS operation it authors. The keyword
 * IS the operation (per the project's rejection of a `policy { operation = … }`
 * conditional block).
 */
const POLICY_KEYWORD_OPERATION: Readonly<Record<string, RlsPolicyOperation>> = {
  policy_select: 'select',
  policy_insert: 'insert',
  policy_update: 'update',
  policy_delete: 'delete',
  policy_all: 'all',
};

function readValueParam(block: PslExtensionBlock, key: string): string | undefined {
  const param = block.parameters[key];
  return param?.kind === 'value' ? param.raw : undefined;
}

function readListRefParams(block: PslExtensionBlock, key: string): string[] {
  const param = block.parameters[key];
  if (param?.kind !== 'list') return [];
  return param.items.flatMap((item) => (item.kind === 'ref' ? [item.identifier] : []));
}

/**
 * Unwraps a quoted PSL string argument, inverting the printer's
 * `escapePslString` escapes (`\\`, `\"`, `\n`, `\r`). An unknown escape
 * sequence is kept verbatim, matching the printer-side `unescapePslString`
 * convention.
 */
function unwrapQuotedString(raw: string): string {
  if (!(raw.startsWith('"') && raw.endsWith('"') && raw.length >= 2)) {
    return raw;
  }
  const inner = raw.slice(1, -1);
  let result = '';
  for (let i = 0; i < inner.length; i++) {
    if (inner[i] !== '\\' || i + 1 >= inner.length) {
      result += inner[i];
      continue;
    }
    const next = inner[i + 1];
    if (next === '\\' || next === '"') {
      result += next;
    } else if (next === 'n') {
      result += '\n';
    } else if (next === 'r') {
      result += '\r';
    } else {
      result += '\\';
      result += next;
    }
    i++;
  }
  return result;
}

/**
 * Assembles a {@link PostgresRlsPolicy} from lowered inputs: normalizes the
 * predicates, computes the content-hash wire name, and constructs the frozen
 * entity. The single hash-assembly body shared by the PSL block lowering
 * ({@link lowerRlsPolicyFromBlock}) and the TS entity-handle lowering
 * ({@link postgresLowerEntityHandles}) so the two surfaces cannot drift.
 */
function buildRlsPolicyEntity(input: {
  readonly prefix: string;
  readonly tableName: string;
  readonly namespaceId: string;
  readonly operation: RlsPolicyOperation;
  readonly roles: readonly string[];
  readonly using?: string;
  readonly withCheck?: string;
  /** Defaults to PERMISSIVE — the hash tuple slot already existed. */
  readonly permissive?: boolean;
}): PostgresRlsPolicy {
  const permissive = input.permissive ?? true;
  const wireHash = computeContentHash({
    ...ifDefined('using', input.using !== undefined ? normalizeSqlBody(input.using) : undefined),
    ...ifDefined(
      'withCheck',
      input.withCheck !== undefined ? normalizeSqlBody(input.withCheck) : undefined,
    ),
    roles: input.roles,
    operation: input.operation,
    permissive,
  });

  return new PostgresRlsPolicy({
    naming: { kind: 'wire', prefix: input.prefix, hash: wireHash },
    tableName: input.tableName,
    namespaceId: input.namespaceId,
    operation: input.operation,
    roles: input.roles,
    using: input.using,
    withCheck: input.withCheck,
    permissive,
  });
}

function lowerRlsPolicyFromBlock(
  block: RlsPolicyExtensionBlock,
  ctx: AuthoringEntityContext,
): PostgresRlsPolicy | undefined {
  const prefix = block.name;
  const operation = POLICY_KEYWORD_OPERATION[block.keyword] ?? 'select';
  // The interpreter resolves the descriptor-declared `target` model ref to
  // its storage table name before invoking this factory (an unresolved or
  // missing required ref is the interpreter's diagnostic), so a lookup miss
  // here is structurally impossible.
  const tableName = block.resolvedModelRefs?.['target']?.tableName;
  assertDefined(
    tableName,
    `lowerRlsPolicyFromBlock: policy "${block.name}" reached the factory without a resolved \`target\` ref; the interpreter resolves same-namespace model refs before invoking entity factories.`,
  );
  const roles = [...readListRefParams(block, 'roles')].sort();

  const usingRaw = readValueParam(block, 'using');
  const withCheckRaw = readValueParam(block, 'withCheck');

  // Reject a predicate the operation does not take (e.g. `using` on INSERT, or
  // `withCheck` on SELECT/DELETE). The descriptor's param set already omits it,
  // but the generic descriptor validator is not wired into the SQL-family
  // interpreter, so the lowering enforces the per-operation predicate matrix
  // directly — a wrong predicate is a load-time diagnostic, not a silent drop.
  const support = POLICY_OPERATION_PREDICATES[operation];
  const rejectPredicate = (predicate: 'using' | 'withCheck'): undefined => {
    ctx.diagnostics?.push({
      code: PSL_RLS_PREDICATE_NOT_FOR_OPERATION,
      message: `\`${block.keyword}\` policy "${block.name}" does not take a \`${predicate}\` predicate; the ${operation.toUpperCase()} operation uses ${support.using ? '`using`' : '`withCheck`'}${support.using && support.withCheck ? ' and `withCheck`' : ' only'}.`,
      sourceId: ctx.sourceId ?? 'unknown',
      span: block.parameters[predicate]?.span ?? block.span,
    });
    return undefined;
  };
  if (usingRaw !== undefined && !support.using) return rejectPredicate('using');
  if (withCheckRaw !== undefined && !support.withCheck) return rejectPredicate('withCheck');

  const using = usingRaw !== undefined ? unwrapQuotedString(usingRaw) : undefined;
  const withCheck = withCheckRaw !== undefined ? unwrapQuotedString(withCheckRaw) : undefined;

  const permissiveRaw = readValueParam(block, 'permissive');
  if (permissiveRaw !== undefined && permissiveRaw !== 'true' && permissiveRaw !== 'false') {
    ctx.diagnostics?.push({
      code: PSL_EXTENSION_INVALID_VALUE,
      message: `\`${block.keyword}\` policy "${block.name}" \`permissive\` must be \`true\` or \`false\`, got ${permissiveRaw}.`,
      sourceId: ctx.sourceId ?? 'unknown',
      span: block.parameters['permissive']?.span ?? block.span,
    });
    return undefined;
  }
  const permissive = permissiveRaw !== 'false';

  // `@@map("physical name")` adopts an EXACT-named policy: the lowered
  // entity's name is the map value verbatim — no prefix, no content hash,
  // and no wire-prefix length cap (exact names are verbatim physical names,
  // same stance as index `map:`). The block head stays the source-level
  // logical identifier, so head-keyed duplicate checking is unchanged.
  const mapAttr = block.blockAttributes.find((a) => a.name === 'map');
  if (mapAttr) {
    const rawArg = mapAttr.args[0]?.value;
    const exactName =
      rawArg?.startsWith('"') && rawArg.endsWith('"') && rawArg.length >= 2
        ? unwrapQuotedString(rawArg)
        : undefined;
    if (exactName === undefined || exactName === '') {
      ctx.diagnostics?.push({
        code: PSL_POLICY_INVALID_MAP,
        message: `\`${block.keyword}\` policy "${block.name}" @@map attribute must have a quoted, non-empty policy-name argument`,
        sourceId: ctx.sourceId ?? 'unknown',
        span: mapAttr.span,
      });
      return undefined;
    }
    ctx.warnings?.push(exactNameBodyWarning('policy', exactName));
    return new PostgresRlsPolicy({
      naming: { kind: 'exact', name: exactName },
      tableName,
      namespaceId: block.namespaceId,
      operation,
      roles,
      using,
      withCheck,
      permissive,
    });
  }

  return buildRlsPolicyEntity({
    prefix,
    tableName,
    namespaceId: block.namespaceId,
    operation,
    roles,
    ...ifDefined('using', using),
    ...ifDefined('withCheck', withCheck),
    permissive,
  });
}

/**
 * Lowers a `native_enum { memberName = "value" … @@map("type_name") }` block
 * into a {@link PostgresNativeEnum}. Members must be authored as explicit
 * `key = "value"` pairs — a bare (value-less) member is a diagnostic, not
 * accepted (authoring-design.md §2.1). The parsed `memberName` is only used
 * to duplicate-check and report diagnostics; the lowered entity carries just
 * the member values (a native enum is value-only — the member "name" isn't
 * a separate authoring concept from the value). `typeName` comes from
 * `@@map` or defaults to the block name verbatim.
 */
function lowerNativeEnumFromBlock(
  block: PslExtensionBlock,
  ctx: AuthoringEntityContext,
): PostgresNativeEnum | undefined {
  const sourceId = ctx.sourceId ?? 'unknown';
  const diagnostics = ctx.diagnostics;

  const mapAttr = block.blockAttributes.find((a) => a.name === 'map');
  let typeName = block.name;
  if (mapAttr) {
    const rawArg = mapAttr.args[0]?.value;
    const mapped = rawArg !== undefined ? unwrapQuotedString(rawArg) : undefined;
    if (mapped === undefined) {
      diagnostics?.push({
        code: PSL_NATIVE_ENUM_INVALID_MAP,
        message: `native_enum "${block.name}" @@map attribute must have a quoted type-name argument`,
        sourceId,
        span: mapAttr.span,
      });
      return undefined;
    }
    typeName = mapped;
  }

  let memberError = false;
  const seenValues = new Set<string>();
  const members: string[] = [];
  for (const [memberName, paramValue] of Object.entries(block.parameters)) {
    if (paramValue.kind === 'bare') {
      diagnostics?.push({
        code: PSL_NATIVE_ENUM_BARE_MEMBER,
        message: `native_enum "${block.name}" member "${memberName}" has no value; members must be authored as "${memberName} = \\"value\\""`,
        sourceId,
        span: paramValue.span,
      });
      memberError = true;
      continue;
    }
    if (paramValue.kind !== 'value') continue;

    let jsonValue: unknown;
    try {
      jsonValue = JSON.parse(paramValue.raw);
    } catch {
      diagnostics?.push({
        code: PSL_EXTENSION_INVALID_VALUE,
        message: `native_enum "${block.name}" member "${memberName}" value "${paramValue.raw}" is not valid JSON`,
        sourceId,
        span: paramValue.span,
      });
      memberError = true;
      continue;
    }
    if (typeof jsonValue !== 'string') {
      diagnostics?.push({
        code: PSL_EXTENSION_INVALID_VALUE,
        message: `native_enum "${block.name}" member "${memberName}" value must be a string`,
        sourceId,
        span: paramValue.span,
      });
      memberError = true;
      continue;
    }
    if (seenValues.has(jsonValue)) {
      diagnostics?.push({
        code: PSL_NATIVE_ENUM_DUPLICATE_MEMBER_VALUE,
        message: `native_enum "${block.name}": duplicate member value "${jsonValue}"`,
        sourceId,
        span: paramValue.span,
      });
      memberError = true;
      continue;
    }
    seenValues.add(jsonValue);
    members.push(jsonValue);
  }

  if (memberError) return undefined;

  if (members.length === 0) {
    diagnostics?.push({
      code: PSL_NATIVE_ENUM_MISSING_MEMBERS,
      message: `native_enum "${block.name}" must have at least one member`,
      sourceId,
      span: block.span,
    });
    return undefined;
  }

  // `control` stays unset — the effective grade is resolved at read time via `effectiveControlPolicy`, like `StorageTable`/`StorageColumn`.
  return new PostgresNativeEnum({ typeName, members });
}

/**
 * `native_enum`'s entity-type factory output, checked separately from the assembled
 * `postgresAuthoringEntityTypes` map below: `deriveValueSet` is SQL-family surface
 * ({@link SqlValueSetDerivingEntityTypeOutput}), not part of the framework
 * `AuthoringEntityTypeFactoryOutput` shape, so folding it directly into the map's single
 * `satisfies AuthoringEntityTypeNamespace` check would trip an excess-property error. Checking it
 * here against the intersection of both shapes keeps it structurally valid against each without
 * widening the map's own check.
 */
const nativeEnumEntityTypeOutput = {
  factory: lowerNativeEnumFromBlock,
  deriveValueSet: (entity: PostgresNativeEnum) => ({
    kind: 'valueSet' as const,
    values: [...entity.members],
  }),
} satisfies AuthoringEntityTypeFactoryOutput<PslExtensionBlock, PostgresNativeEnum | undefined> &
  SqlValueSetDerivingEntityTypeOutput;

/**
 * Lowers a `role <name> {}` block into a {@link PostgresRole}. Roles are
 * cluster-scoped in Postgres, so the block must be declared inside
 * `namespace unbound { … }` — any other lexical namespace (a named schema,
 * or the default bucket top-level declarations resolve to) is a load-time
 * diagnostic. The lowered entity carries the unbound coordinate.
 */
function lowerRoleFromBlock(
  block: RoleExtensionBlock,
  ctx: AuthoringEntityContext,
): PostgresRole | undefined {
  if (block.namespaceId !== UNBOUND_NAMESPACE_ID) {
    ctx.diagnostics?.push({
      code: PSL_ROLE_BLOCK_OUTSIDE_UNBOUND_NAMESPACE,
      message: `\`role\` block "${block.name}" must be declared inside \`namespace unbound { }\`, not in namespace "${block.namespaceId}"`,
      sourceId: ctx.sourceId ?? 'unknown',
      span: block.span,
    });
    return undefined;
  }
  return new PostgresRole({ name: block.name, namespaceId: UNBOUND_NAMESPACE_ID });
}

export const postgresAuthoringEntityTypes = {
  role: {
    kind: 'entity',
    discriminator: 'role',
    validatorSchema: PostgresRoleSchema,
    output: {
      factory: lowerRoleFromBlock,
    },
  },
  rls: {
    kind: 'entity',
    discriminator: 'rls',
    validatorSchema: PostgresRlsEnablementSchema,
    output: {
      factory: (input: PostgresRlsEnablementInput): PostgresRlsEnablement =>
        new PostgresRlsEnablement(input),
    },
  },
  policy: {
    kind: 'entity',
    discriminator: 'policy',
    validatorSchema: PostgresRlsPolicySchema,
    output: {
      factory: lowerRlsPolicyFromBlock,
    },
  },
  native_enum: {
    kind: 'entity',
    discriminator: 'native_enum',
    validatorSchema: PostgresNativeEnumSchema,
    output: nativeEnumEntityTypeOutput,
  },
} as const satisfies AuthoringEntityTypeNamespace;

/**
 * Field presets contributed by the Postgres target pack.
 *
 * These mirror the PSL scalar-to-codec mapping used by the Postgres adapter
 * (see `createPostgresPslScalarTypeDescriptors`), so that authoring a field
 * via the TS callback surface (e.g. `field.int()`) and via the PSL scalar
 * surface (e.g. `Int`) lowers to byte-identical contracts.
 *
 * The `uuidNative` / `id.uuidv4Native` / `id.uuidv7Native` presets use the
 * native Postgres `uuid` type (codecId `pg/uuid@1`). For cross-target
 * portability use `uuidString` / `id.uuidv4String` / `id.uuidv7String` from
 * the family pack instead.
 */
/**
 * Shared parameter descriptors for the five `policy_<op>` PSL block
 * keywords. All five share the `policy` discriminator — the parser
 * dispatches by keyword (see the framework's PSL-block SPI), and every
 * keyword's factory lowers to `PostgresRlsPolicy` via `lowerRlsPolicyFromBlock`.
 *
 * The `roles` list uses `scope:'cross-space'` because same-namespace
 * role ref resolution requires PSL namespace entries keyed by `refKind`
 * (i.e. `'role'`), which in turn requires the role block discriminator to
 * equal `'role'`. Aligning discriminator with refKind is tracked for
 * slice 4 (cross-space roles). Until then cross-space passes validation
 * unconditionally and the authored role names flow through unchanged.
 */
const policyTargetParam = {
  kind: 'ref',
  refKind: 'model',
  scope: 'same-namespace',
  required: true,
} as const;
const policyRolesParam = {
  kind: 'list',
  of: { kind: 'ref', refKind: 'role', scope: 'cross-space' },
} as const;
const policyPredicateParam = { kind: 'value', codecId: 'pg/text@1', required: true } as const;
const policyPermissiveParam = { kind: 'value', codecId: 'pg/bool@1' } as const;
// A policy may only target an RLS-controlled model: the model named by
// `target` must declare `@@rls`, or the load fails with a diagnostic naming
// the model and the policy prefix.
const policyRequiresRls = { parameter: 'target', attribute: 'rls' } as const;

export const postgresAuthoringPslBlockDescriptors = {
  // The predicate param set per keyword mirrors Postgres: SELECT/DELETE take
  // USING only; INSERT takes WITH CHECK only; UPDATE/ALL take both. The
  // per-operation predicate matrix is enforced in `lowerRlsPolicyFromBlock`
  // (a wrong predicate for the operation is a load-time diagnostic there),
  // since the generic descriptor validator is not wired into the SQL-family
  // interpreter.
  policy_select: {
    kind: 'pslBlock',
    keyword: 'policy_select',
    discriminator: 'policy',
    name: { required: true },
    parameters: {
      target: policyTargetParam,
      roles: policyRolesParam,
      using: policyPredicateParam,
      permissive: policyPermissiveParam,
    },
    requiresModelAttribute: policyRequiresRls,
  },
  policy_delete: {
    kind: 'pslBlock',
    keyword: 'policy_delete',
    discriminator: 'policy',
    name: { required: true },
    parameters: {
      target: policyTargetParam,
      roles: policyRolesParam,
      using: policyPredicateParam,
      permissive: policyPermissiveParam,
    },
    requiresModelAttribute: policyRequiresRls,
  },
  policy_insert: {
    kind: 'pslBlock',
    keyword: 'policy_insert',
    discriminator: 'policy',
    name: { required: true },
    parameters: {
      target: policyTargetParam,
      roles: policyRolesParam,
      withCheck: policyPredicateParam,
      permissive: policyPermissiveParam,
    },
    requiresModelAttribute: policyRequiresRls,
  },
  policy_update: {
    kind: 'pslBlock',
    keyword: 'policy_update',
    discriminator: 'policy',
    name: { required: true },
    parameters: {
      target: policyTargetParam,
      roles: policyRolesParam,
      using: policyPredicateParam,
      withCheck: policyPredicateParam,
      permissive: policyPermissiveParam,
    },
    requiresModelAttribute: policyRequiresRls,
  },
  policy_all: {
    kind: 'pslBlock',
    keyword: 'policy_all',
    discriminator: 'policy',
    name: { required: true },
    parameters: {
      target: policyTargetParam,
      roles: policyRolesParam,
      using: policyPredicateParam,
      withCheck: policyPredicateParam,
      permissive: policyPermissiveParam,
    },
    requiresModelAttribute: policyRequiresRls,
  },
  /**
   * PSL block descriptor for `native_enum`.
   *
   * Reuses the existing variadic-block mechanism (the same shape the SQL
   * family's `enum` block ships): the body is an open `memberName = "value"`
   * list. `variadicParameters: true` opens the block to arbitrary keys
   * beyond the declared (empty) `parameters` set — the lowering factory
   * (`lowerNativeEnumFromBlock`) turns the variadic entries into ordered
   * members and rejects a bare (value-less) member.
   */
  native_enum: {
    kind: 'pslBlock',
    keyword: 'native_enum',
    discriminator: 'native_enum',
    name: { required: true },
    parameters: {},
    variadicParameters: true,
  },
  /**
   * PSL block descriptor for `role` (e.g. `role anon {}`). Name-only, no
   * parameters and no body content. Declared inside `namespace unbound { }`
   * — see {@link lowerRoleFromBlock} for the placement check and the
   * coordinate the lowered entity carries.
   */
  role: {
    kind: 'pslBlock',
    keyword: 'role',
    discriminator: 'role',
    name: { required: true },
    parameters: {},
  },
} as const satisfies AuthoringPslBlockDescriptorNamespace;

/**
 * `@@` model attributes contributed by the Postgres target pack.
 *
 * `@@rls` is argument-less: presence marks the model's table
 * RLS-controlled. It lowers to a {@link PostgresRlsEnablement} marker in
 * the namespace's `entries.rls`, keyed by the model's table name — the
 * marker (never the policy set) is what drives
 * `ENABLE`/`DISABLE ROW LEVEL SECURITY` planning.
 */
export const postgresAuthoringModelAttributes = {
  rls: {
    kind: 'modelAttribute',
    attribute: 'rls',
    spec: modelAttribute('rls', {}),
    lower: (_parsed: Record<never, never>, ctx: AuthoringModelAttributeContext) => ({
      key: ctx.storageName,
      entity: new PostgresRlsEnablement({
        tableName: ctx.storageName,
        namespaceId: ctx.namespaceId,
      }),
    }),
  },
} as const satisfies AuthoringModelAttributeDescriptorNamespace;

export const postgresAuthoringFieldPresets = {
  text: {
    kind: 'fieldPreset',
    output: {
      codecId: 'pg/text@1',
      nativeType: 'text',
    },
  },
  int: {
    kind: 'fieldPreset',
    output: {
      codecId: 'pg/int4@1',
      nativeType: 'int4',
    },
  },
  bigint: {
    kind: 'fieldPreset',
    output: {
      codecId: 'pg/int8@1',
      nativeType: 'int8',
    },
  },
  float: {
    kind: 'fieldPreset',
    output: {
      codecId: 'pg/float8@1',
      nativeType: 'float8',
    },
  },
  decimal: {
    kind: 'fieldPreset',
    output: {
      codecId: 'pg/numeric@1',
      nativeType: 'numeric',
    },
  },
  boolean: {
    kind: 'fieldPreset',
    output: {
      codecId: 'pg/bool@1',
      nativeType: 'bool',
    },
  },
  json: {
    kind: 'fieldPreset',
    output: {
      codecId: 'pg/jsonb@1',
      nativeType: 'jsonb',
    },
  },
  bytes: {
    kind: 'fieldPreset',
    output: {
      codecId: 'pg/bytea@1',
      nativeType: 'bytea',
    },
  },
  dateTime: {
    kind: 'fieldPreset',
    output: {
      codecId: 'pg/timestamptz-temporal@1',
      nativeType: 'timestamptz',
    },
  },
  /**
   * Each helper names the representation it selects. The unsuffixed four read and write
   * `Temporal.*` values; the `*String` four carry PostgreSQL's own text, which is the escape hatch
   * for the values Temporal has no way to express — `infinity`, BC and expanded years, and any
   * rendering a non-ISO `DateStyle` produces.
   *
   * Both halves lower through the same shared factories, so a pair differs only in the codec it
   * names: same storage default on `createdAt`, same `timestampNow` generator on `updatedAt`, same
   * optional precision.
   */
  temporal: {
    .../* @__PURE__ */ temporalAuthoringPresets({
      codecId: 'pg/timestamptz-temporal@1',
      nativeType: 'timestamptz',
    }),
    .../* @__PURE__ */ temporalStringAuthoringPresets({
      codecId: 'pg/timestamptz-string@1',
      nativeType: 'timestamptz',
    }),
    timestamp: /* @__PURE__ */ temporalCodecPresetWithPrecision({
      codecId: 'pg/timestamp-temporal@1',
      nativeType: 'timestamp',
    }),
    timestamptz: /* @__PURE__ */ temporalCodecPresetWithPrecision({
      codecId: 'pg/timestamptz-temporal@1',
      nativeType: 'timestamptz',
    }),
    timestampString: /* @__PURE__ */ temporalCodecPresetWithPrecision({
      codecId: 'pg/timestamp-string@1',
      nativeType: 'timestamp',
    }),
    timestamptzString: /* @__PURE__ */ temporalCodecPresetWithPrecision({
      codecId: 'pg/timestamptz-string@1',
      nativeType: 'timestamptz',
    }),
  },
  uuidNative: {
    kind: 'fieldPreset',
    output: {
      codecId: 'pg/uuid@1',
      nativeType: 'uuid',
    },
  },
  id: {
    uuidv4Native: {
      kind: 'fieldPreset',
      output: {
        codecId: 'pg/uuid@1',
        nativeType: 'uuid',
        executionDefaults: {
          onCreate: {
            kind: 'generator',
            id: 'uuidv4',
          },
        },
        id: true,
      },
    },
    uuidv7Native: {
      kind: 'fieldPreset',
      output: {
        codecId: 'pg/uuid@1',
        nativeType: 'uuid',
        executionDefaults: {
          onCreate: {
            kind: 'generator',
            id: 'uuidv7',
          },
        },
        id: true,
      },
    },
  },
} as const satisfies AuthoringFieldNamespace;

interface RlsRoleHandleShape {
  readonly entityKind: 'role';
  readonly name: string;
}

interface RlsPolicyHandleShape {
  readonly entityKind: 'policy';
  readonly operation: RlsPolicyOperation;
  readonly name: string;
  readonly roles: readonly { readonly name: string }[];
  readonly using?: string;
  readonly withCheck?: string;
}

interface RlsTargetCoordinate {
  readonly namespaceId: string;
  readonly tableName: string;
}

/**
 * Resolves an entity handle's `target` ref to a table coordinate of this
 * contract, or throws the load-time diagnostic naming the handle: a
 * cross-space target is rejected (you cannot CREATE POLICY on a table
 * another space owns) and an unresolved target names the model.
 */
function requireLocalTarget(
  refs: Readonly<Record<string, ResolvedEntityHandleRef>>,
  subject: string,
): RlsTargetCoordinate {
  const target = refs['target'];
  if (target !== undefined && target.kind === 'resolved') {
    return { namespaceId: target.namespaceId, tableName: target.tableName };
  }
  if (target !== undefined && target.kind === 'cross-space') {
    throw postgresError(
      'CONTRACT.POLICY_INVALID',
      `defineContract: ${subject} targets model "${target.modelName ?? target.tableName}", which lives in another contract space. Policies and rlsEnabled entries must target a model declared in this contract.`,
      { meta: { model: target.modelName ?? target.tableName, reason: 'cross-space-target' } },
    );
  }
  throw postgresError(
    'CONTRACT.MODEL_UNKNOWN',
    `defineContract: ${subject} targets model "${target?.modelName ?? '<anonymous>'}", which is not in the contract's models. Add the model to \`models\`.`,
    { meta: { model: target?.modelName ?? '<anonymous>' } },
  );
}

/**
 * The SQL-family entity-handle batch lowering hook for the Postgres pack
 * (`SqlEntityHandleLoweringContribution`). Receives every `entities` handle
 * whose kind this pack registered — batch, so the cross-entity diagnostics
 * (duplicate prefix, policy without rlsEnabled, duplicate role) can see
 * sibling handles — and lowers them with the same keying and hash assembly
 * as the PSL path: `policy` keyed by prefix (wire name via
 * {@link buildRlsPolicyEntity}), `rls` keyed by table name, `role` keyed by
 * name and filed under the default namespace (roles are declared
 * contract-wide; PSL has no role block to set a precedent).
 */
export function postgresLowerEntityHandles(
  input: EntityHandleLoweringInput,
): readonly LoweredPackEntity[] {
  const enablements = new Map<
    string,
    { coordinate: RlsTargetCoordinate; entity: PostgresRlsEnablement }
  >();
  const roles = new Map<string, PostgresRole>();
  const policies: {
    readonly handle: RlsPolicyHandleShape;
    readonly refs: Readonly<Record<string, ResolvedEntityHandleRef>>;
  }[] = [];
  const coordinateKey = (coordinate: RlsTargetCoordinate): string =>
    `${coordinate.namespaceId} ${coordinate.tableName}`;

  for (const { handle, refs } of input.handles) {
    switch (handle.entityKind) {
      case 'rls': {
        const coordinate = requireLocalTarget(refs, 'an rlsEnabled entry');
        const key = coordinateKey(coordinate);
        if (!enablements.has(key)) {
          enablements.set(key, {
            coordinate,
            entity: new PostgresRlsEnablement({
              tableName: coordinate.tableName,
              namespaceId: coordinate.namespaceId,
            }),
          });
        }
        break;
      }
      case 'role': {
        const roleHandle = blindCast<
          RlsRoleHandleShape,
          'role handles are constructed only by the postgres contract-builder role() constructor, which enforces this shape'
        >(handle);
        if (roles.has(roleHandle.name)) {
          throw postgresError(
            'CONTRACT.ROLE_INVALID',
            `defineContract: role "${roleHandle.name}" is declared more than once in the entities list.`,
            { meta: { role: roleHandle.name, reason: 'duplicate' } },
          );
        }
        // Roles are cluster-scoped in Postgres, so they always land in the
        // `__unbound__` namespace — identical to a PSL `role` block
        // (`lowerRoleFromBlock`) and matching the `PostgresRole` class's own
        // contract. The declaring surface (TS entities vs PSL) does not move
        // the slot.
        roles.set(
          roleHandle.name,
          new PostgresRole({ name: roleHandle.name, namespaceId: UNBOUND_NAMESPACE_ID }),
        );
        break;
      }
      case 'policy': {
        const policyHandle = blindCast<
          RlsPolicyHandleShape,
          'policy handles are constructed only by the postgres contract-builder policy*() constructors, which enforce this shape'
        >(handle);
        policies.push({ handle: policyHandle, refs });
        break;
      }
      default:
        throw postgresError(
          'CONTRACT.ENTITY_KIND_INVALID',
          `defineContract: the postgres pack does not lower "${handle.entityKind}" handles from the entities list.`,
          { meta: { entityKind: handle.entityKind } },
        );
    }
  }

  const rows: LoweredPackEntity[] = [];
  const seenPrefixes = new Set<string>();

  for (const { handle: policy, refs } of policies) {
    const prefix = policy.name;
    assertWireNamePrefixLength(prefix, 'defineContract: policy prefix');
    const coordinate = requireLocalTarget(refs, `policy "${prefix}"`);
    if (!enablements.has(coordinateKey(coordinate))) {
      const target = refs['target'];
      throw postgresError(
        'CONTRACT.POLICY_INVALID',
        `defineContract: policy "${prefix}" targets model "${target?.modelName ?? coordinate.tableName}", whose table is not RLS-enabled. Add rlsEnabled(<model>) to the entities list.`,
        {
          meta: {
            prefix,
            model: target?.modelName ?? coordinate.tableName,
            reason: 'target-not-rls-enabled',
          },
        },
      );
    }
    const prefixKey = `${coordinate.namespaceId} ${prefix}`;
    if (seenPrefixes.has(prefixKey)) {
      throw postgresError(
        'CONTRACT.POLICY_INVALID',
        `defineContract: policy prefix "${prefix}" is declared more than once in namespace "${coordinate.namespaceId}". Policy prefixes must be unique per namespace.`,
        { meta: { prefix, namespaceId: coordinate.namespaceId, reason: 'duplicate-prefix' } },
      );
    }
    seenPrefixes.add(prefixKey);

    const roleNames = [...new Set(policy.roles.map((roleHandle) => roleHandle.name))].sort();
    rows.push({
      namespaceId: coordinate.namespaceId,
      entityKind: 'policy',
      key: prefix,
      entity: buildRlsPolicyEntity({
        prefix,
        tableName: coordinate.tableName,
        namespaceId: coordinate.namespaceId,
        operation: policy.operation,
        roles: roleNames,
        ...ifDefined('using', policy.using),
        ...ifDefined('withCheck', policy.withCheck),
      }),
    });
  }

  for (const { coordinate, entity } of enablements.values()) {
    rows.push({
      namespaceId: coordinate.namespaceId,
      entityKind: 'rls',
      key: coordinate.tableName,
      entity,
    });
  }
  for (const [name, entity] of roles) {
    rows.push({ namespaceId: UNBOUND_NAMESPACE_ID, entityKind: 'role', key: name, entity });
  }
  return rows;
}
