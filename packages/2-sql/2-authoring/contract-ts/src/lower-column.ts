import {
  type CodecLookupWithDescriptors,
  canonicalFormOf,
  type DataTypeLookup,
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
import { composeCheckWirePrefix, computeCheckContentHash } from '@internal/sql-schema-ir/naming';
import { invariant } from '@internal/utils/assertions';
import { ifDefined } from '@internal/utils/defined';
import { isStructuredError } from '@internal/utils/structured-error';
import { columnCodec, type DefaultCanonicalForm, encodeColumnDefault } from './column-defaults';
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

/** The canonical form of the values of the codec `codecId`, from the codec or its data type, with the data type's id. */
function canonicalFormOfCodec(
  codecId: string,
  lookups: TypeLookups,
): DefaultCanonicalForm | undefined {
  const descriptor = lookups.codecLookup.descriptorFor(codecId);
  if (descriptor === undefined) return undefined;
  const toCanonicalForm = canonicalFormOf(descriptor, lookups.dataTypeLookup);
  return toCanonicalForm === undefined
    ? undefined
    : { dataTypeId: descriptor.dataType, toCanonicalForm };
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
          canonicalFormOfCodec(codecId, context.lookups),
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
  });
  return { column, derivedChecks: lowerRenderedChecks(placement.tableName, candidates) };
}
