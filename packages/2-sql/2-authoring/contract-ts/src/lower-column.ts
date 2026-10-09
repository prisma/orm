import type {
  CodecLookupWithDescriptors,
  DataTypeLookup,
} from '@internal/framework-components/codec';
import {
  dataTypeParams,
  type SqlDataType,
  sqlDataTypeOfCodec,
  validateSqlTypeParams,
} from '@internal/sql-contract/data-type';
import {
  type AuthoredStorageTypeInstance,
  CheckConstraint,
  resolvedTypeParams,
  type StorageColumn,
} from '@internal/sql-contract/types';
import {
  type CheckKind,
  composeCheckWirePrefix,
  computeCheckContentHash,
} from '@internal/sql-schema-ir/naming';
import { invariant } from '@internal/utils/assertions';
import { ifDefined } from '@internal/utils/defined';
import { isStructuredError } from '@internal/utils/structured-error';
import { columnCodec, encodeColumnDefault } from './column-defaults';
import { contractError } from './contract-errors';
import { type ColumnSite, columnSiteMeta, columnSiteSubject } from './declaration-sites';
import { checkMemberValues, enumValueSetRefs } from './enum-members';
import { type CollectedColumnEntities, collectEntityFromColumn } from './pack-entities';
import type { ColumnDescription } from './storage-description';
import {
  type CheckExpressionRenderer,
  type ColumnTypeQualifier,
  resolveColumnDescriptor,
} from './target-authoring-hooks';

/**
 * Resolves a field's authored `noCheck` kinds against its column shape:
 * the bare form (`[]`) becomes every kind the shape derives, and a named
 * kind that can never apply to the shape is an authoring error
 * (`CONTRACT.CHECK_OPTOUT_INVALID`). Returns the concrete kinds in
 * canonical ascending order — the only form the contract persists.
 */
function resolveNoCheckKinds(input: {
  readonly site: ColumnSite;
  readonly kinds: readonly CheckKind[];
  readonly many: boolean;
  readonly elementNullable: boolean;
  readonly isDomainEnum: boolean;
}): readonly CheckKind[] {
  const derivable: CheckKind[] = [];
  if (input.many && !input.elementNullable) derivable.push('elementNotNull');
  if (input.isDomainEnum) derivable.push('membership');
  const subject = columnSiteSubject(input.site);
  const meta = columnSiteMeta(input.site);

  if (input.kinds.length === 0) {
    if (derivable.length === 0) {
      throw contractError(
        'CONTRACT.CHECK_OPTOUT_INVALID',
        `${subject}: noCheck() waives nothing — this column's shape derives no generated checks.`,
        { meta: { ...meta, reason: 'no-derivable-checks' } },
      );
    }
    return derivable;
  }

  const seen = new Set<CheckKind>();
  for (const kind of input.kinds) {
    if (seen.has(kind)) {
      throw contractError(
        'CONTRACT.CHECK_OPTOUT_INVALID',
        `${subject}: noCheck("${kind}") names the same kind twice.`,
        { meta: { ...meta, kind, reason: 'duplicate-kind' } },
      );
    }
    seen.add(kind);
    if (!derivable.includes(kind)) {
      const explanation =
        kind === 'membership'
          ? 'membership checks are derived only from enumType() value sets'
          : 'element-non-null checks are derived only for lists whose elements are semantically non-null';
      throw contractError(
        'CONTRACT.CHECK_OPTOUT_INVALID',
        `${subject}: noCheck("${kind}") does not apply — ${explanation}.`,
        { meta: { ...meta, kind, reason: 'inapplicable-kind' } },
      );
    }
  }
  return [...input.kinds].sort();
}

/**
 * Names the target's rendered checks and lowers them into contract entities.
 *
 * Naming is composed family-side ({@link composeCheckWirePrefix}) rather than
 * by the target, and suffixed with the predicate's content hash. Composing
 * family-side is what makes the truncation safe — two prefixes that truncate
 * alike still differ in their hashes, and the family can see that the
 * (table, column, kind) triple they were built from is unique per table,
 * rather than having to assume something about SQL text it declares itself
 * unable to read.
 */
function lowerRenderedChecks(
  tableName: string,
  candidates: ReadonlyArray<{
    readonly kind: 'membership' | 'elementNotNull';
    readonly columnName: string;
    readonly expression: string;
  }>,
): CheckConstraint[] {
  return candidates.map(
    (candidate) =>
      new CheckConstraint({
        naming: {
          kind: 'wire',
          prefix: composeCheckWirePrefix(tableName, candidate.columnName, candidate.kind),
          hash: computeCheckContentHash(candidate.expression),
        },
        expression: candidate.expression,
      }),
  );
}

function validateColumnTypeParams(
  dataType: SqlDataType,
  typeParams: Record<string, unknown> | undefined,
  site: ColumnSite,
): void {
  try {
    validateSqlTypeParams(dataType, dataTypeParams(dataType, typeParams));
  } catch (cause) {
    if (!isStructuredError(cause) || cause.code !== 'CONTRACT.TYPE_PARAMS_INVALID') throw cause;
    throw contractError(
      'CONTRACT.TYPE_PARAMS_INVALID',
      `${columnSiteSubject(site)} has type parameters that its data type does not accept: ${cause.message}`,
      { cause, meta: { ...cause.meta, ...columnSiteMeta(site) } },
    );
  }
}

export interface TypeLookups {
  readonly codecLookup: CodecLookupWithDescriptors;
  readonly dataTypeLookup: DataTypeLookup;
}

export interface ColumnLoweringContext {
  readonly lookups: TypeLookups;
  readonly storageTypes: Record<string, AuthoredStorageTypeInstance>;
  readonly defaultNamespaceId: string;
  readonly qualifyColumnType: ColumnTypeQualifier | undefined;
  readonly renderCheckExpressions: CheckExpressionRenderer | undefined;
  /** Receives the pack entity a column's type constructor refers to. */
  readonly collectedColumnEntities: CollectedColumnEntities;
}

/** Where a column is lowered: its table, and whether that table derives enforcement checks. */
export interface ColumnPlacement {
  readonly namespaceId: string;
  readonly tableName: string;
  readonly derivesChecks: boolean;
}

export interface LoweredColumn {
  readonly column: StorageColumn;
  readonly derivedChecks: readonly CheckConstraint[];
}

/**
 * Lowers one column into its storage column and the enforcement checks its shape derives.
 *
 * A column whose type constructor refers to a pack entity (e.g. `pg.enum(handle)`) records that entity, and its descriptor is resolved against the column's namespace and handed to the target's `qualifyColumnType` hook. An opt-out from derived checks on a table that derives none is dropped, never persisted: the policy may also be stamped after the build by a specifier.
 *
 * Member values reach the check renderer only for a column typed by an `enumType()` handle: that column is a plain scalar with no native type of its own to enforce membership. A value set resolved by a type constructor binds the column to a native type that already enforces it.
 */
export function lowerColumn(
  description: ColumnDescription,
  placement: ColumnPlacement,
  context: ColumnLoweringContext,
): LoweredColumn {
  const { site, many } = description;
  const { codecLookup } = context.lookups;
  const entityRef = description.descriptor.entityRef;
  if (entityRef !== undefined) {
    collectEntityFromColumn(context.collectedColumnEntities, placement.namespaceId, entityRef);
  }
  const descriptor = resolveColumnDescriptor(
    description.descriptor,
    placement.namespaceId,
    context.qualifyColumnType,
  );
  const elementNullable = many !== false && many.elementNullable;
  const noCheck =
    description.noCheck !== undefined && placement.derivesChecks
      ? resolveNoCheckKinds({
          site,
          kinds: description.noCheck,
          many: many !== false,
          elementNullable,
          isDomainEnum: description.enumTypeHandle !== undefined,
        })
      : undefined;

  const codecId = descriptor.codecId;
  const typeParams = resolvedTypeParams(descriptor, context.storageTypes);
  const dataType = sqlDataTypeOfCodec(codecId, context.lookups);
  validateColumnTypeParams(dataType, typeParams, site);
  const encodedDefault =
    description.default !== undefined
      ? encodeColumnDefault(
          description.default,
          codecLookup,
          (lookup) => columnCodec(codecId, typeParams, lookup),
          { ...site, codecId },
          many !== false,
          elementNullable,
        )
      : undefined;

  const enumRefs = enumValueSetRefs(description.enumTypeHandle, context.defaultNamespaceId);
  invariant(
    enumRefs === undefined || descriptor.valueSet === undefined,
    `${columnSiteSubject(site)} is typed by a domain enum and also carries a storage value set from its type constructor.`,
  );
  const valueSet = enumRefs?.storage ?? descriptor.valueSet;

  const column: StorageColumn = {
    dataType: dataType.id,
    codecId,
    nullable: description.nullable,
    many,
    ...ifDefined('noCheck', noCheck && [...noCheck].sort()),
    ...ifDefined('typeParams', descriptor.typeParams),
    ...ifDefined('default', encodedDefault),
    ...ifDefined('typeRef', descriptor.typeRef),
    ...ifDefined('valueSet', valueSet),
  };

  const render = context.renderCheckExpressions;
  if (render === undefined || !placement.derivesChecks) {
    return { column, derivedChecks: [] };
  }
  const { enumTypeHandle } = description;
  const candidates = render({
    tableName: placement.tableName,
    columnName: description.columnName,
    many: many !== false,
    elementNullable,
    memberValues:
      enumTypeHandle !== undefined ? checkMemberValues(enumTypeHandle, codecLookup) : undefined,
  }).filter((candidate) => !(noCheck?.includes(candidate.kind) ?? false));
  return { column, derivedChecks: lowerRenderedChecks(placement.tableName, candidates) };
}
