import type { PslModelAttribute } from '@internal/framework-components/psl-ast';
import type { StorageTable } from '@internal/sql-contract/types';
import { pslModelMapName } from '@internal/sql-contract-psl/resolution';
import { escapePslString } from '@internal/sql-relational-core/ast';
import {
  composeCheckWirePrefix,
  computeCheckContentHash,
  computeIndexContentHash,
  formatWireName,
} from '@internal/sql-schema-ir/naming';
import { postgresRenderCheckExpressions } from '../check-expressions';
import { PG_ENUM_CODEC_ID } from '../codec-ids';
import {
  type AttributeNaming,
  buildCheckAttribute,
  buildIndexAttribute,
  buildModelConstraintAttribute,
} from '../psl-ast/index-attributes';
import { buildAttribute, buildMapAttribute, positionalArg } from '../psl-ast/psl-literals';
import type { ModelWithTable, VariantInfo } from './contract-model-index';
import { refuseUnwritableIndexOptions, refuseUnwritableObjectName } from './refusals';

/** A check the PSL source derives for a table, which the printer does not write. */
export interface DerivedCheck {
  readonly prefix: string;
  readonly expression: string;
}

/**
 * The checks the PSL source derives itself for a table, keyed by name, so
 * they are not also written as `@@check`. A table that is not managed derives
 * none. A managed one derives a membership check for each column typed by a
 * domain enum and an element-not-null check for each list column, less the
 * kinds a column waives with `@noCheck`.
 */
export function derivedChecks(input: {
  readonly table: StorageTable;
  readonly tableName: string;
  readonly managed: boolean;
  readonly domainEnumValues: ReadonlyMap<string, readonly unknown[]>;
}): ReadonlyMap<string, DerivedCheck> {
  const checks = new Map<string, DerivedCheck>();
  if (!input.managed) return checks;
  for (const [columnName, column] of Object.entries(input.table.columns)) {
    const enumValues =
      column.codecId === PG_ENUM_CODEC_ID || column.valueSet === undefined
        ? undefined
        : input.domainEnumValues.get(column.valueSet.entityName);
    const memberValues = enumValues?.filter(
      (value): value is string | number => typeof value === 'string' || typeof value === 'number',
    );
    const waived = new Set(column.noCheck ?? []);
    for (const candidate of postgresRenderCheckExpressions({
      tableName: input.tableName,
      columnName,
      many: column.many === true,
      memberValues: memberValues?.length === enumValues?.length ? memberValues : undefined,
    })) {
      if (waived.has(candidate.kind)) continue;
      const prefix = composeCheckWirePrefix(input.tableName, columnName, candidate.kind);
      checks.set(formatWireName(prefix, computeCheckContentHash(candidate.expression)), {
        prefix,
        expression: candidate.expression,
      });
    }
  }
  return checks;
}

/**
 * Whether a table object belongs to this model when several models share the
 * table: a single-table variant owns what lies within its own columns, and the
 * base owns the rest.
 */
function ownsTableObject(
  entry: ModelWithTable,
  variant: VariantInfo | undefined,
  singleTableVariants: readonly ModelWithTable[],
  columns: readonly string[] | undefined,
): boolean {
  if (variant?.singleTable === true) {
    return columns?.every((column) => entry.ownColumns.has(column)) === true;
  }
  return !singleTableVariants.some(
    (other) => columns?.every((column) => other.ownColumns.has(column)) === true,
  );
}

/**
 * How a check or index is named in PSL: `name:` with its prefix when the name
 * is that prefix and the hash of its content, which the PSL source derives
 * again; `map:` when it has no prefix. A prefix whose name is anything else is
 * refused, because neither form reads back as it.
 */
function attributeNaming(input: {
  readonly kind: 'check' | 'index';
  readonly entry: ModelWithTable;
  readonly name: string;
  readonly prefix: string | undefined;
  readonly contentHash: () => string;
}): AttributeNaming {
  const { kind, entry, name, prefix } = input;
  if (prefix === undefined) return { kind: 'exact' };
  if (formatWireName(prefix, input.contentHash()) === name) return { kind: 'wire', prefix };
  refuseUnwritableObjectName({ kind, entry, name, prefix });
}

/**
 * The `@@` attributes of one model: its polymorphism, its keys, checks and indexes, its control
 * policy, `@@rls` and `@@map`. A table object several models share goes on the model that owns it.
 */
export function buildModelAttributes(input: {
  readonly entry: ModelWithTable;
  readonly variant: VariantInfo | undefined;
  readonly singleTableVariants: readonly ModelWithTable[];
  readonly derivedChecksByName: ReadonlyMap<string, DerivedCheck>;
  readonly rlsEnabled: boolean;
}): readonly PslModelAttribute[] {
  const { entry, variant, singleTableVariants, derivedChecksByName } = input;
  const attributes: PslModelAttribute[] = [];
  const fieldNameOf = (column: string): string => entry.fieldNamesByColumn.get(column) ?? column;
  const owns = (columns: readonly string[] | undefined): boolean =>
    ownsTableObject(entry, variant, singleTableVariants, columns);

  if (entry.model.discriminator !== undefined) {
    attributes.push(
      buildAttribute('model', 'discriminator', [positionalArg(entry.model.discriminator.field)]),
    );
  }
  if (variant !== undefined) {
    attributes.push(
      buildAttribute('model', 'base', [
        positionalArg(variant.base.name),
        positionalArg(`"${escapePslString(variant.value)}"`),
      ]),
    );
  }

  const primaryKeyColumns = variant === undefined ? (entry.table.primaryKey?.columns ?? []) : [];
  if (primaryKeyColumns.length > 1) {
    attributes.push(
      buildModelConstraintAttribute(
        'id',
        primaryKeyColumns.map(fieldNameOf),
        entry.table.primaryKey?.name,
      ),
    );
  }
  for (const unique of entry.table.uniques) {
    if (!owns(unique.columns)) continue;
    attributes.push(
      buildModelConstraintAttribute('unique', unique.columns.map(fieldNameOf), unique.name),
    );
  }
  for (const check of entry.table.checks ?? []) {
    if (derivedChecksByName.has(check.name) || !owns(undefined)) continue;
    attributes.push(
      buildCheckAttribute(
        check,
        attributeNaming({
          kind: 'check',
          entry,
          name: check.name,
          prefix: check.prefix,
          contentHash: () => computeCheckContentHash(check.expression),
        }),
      ),
    );
  }
  for (const index of entry.table.indexes) {
    if (!owns(index.columns)) continue;
    refuseUnwritableIndexOptions(entry, index);
    attributes.push(
      buildIndexAttribute(
        index,
        index.columns?.map(fieldNameOf),
        attributeNaming({
          kind: 'index',
          entry,
          name: index.name,
          prefix: index.prefix,
          contentHash: () => computeIndexContentHash(index),
        }),
      ),
    );
  }
  if (entry.table.control !== undefined && variant?.singleTable !== true) {
    attributes.push(buildAttribute('model', 'control', [positionalArg(entry.table.control)]));
  }
  if (input.rlsEnabled && variant?.singleTable !== true) {
    attributes.push(buildAttribute('model', 'rls', []));
  }
  const mapName = pslModelMapName(entry.name, entry.tableName);
  if (mapName !== undefined && variant?.singleTable !== true) {
    attributes.push(buildMapAttribute('model', mapName));
  }
  return attributes;
}
