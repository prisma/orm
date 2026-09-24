import { defaultTableName } from '@internal/sql-contract-psl/default-table-name';
import pluralizeLib from 'pluralize';
import {
  escapeIfNeeded,
  escapeName,
  hasSeparators,
  needsEscaping,
  snakeToCamelCase,
  snakeToPascalCase,
} from '../psl-ast/psl-names';

type NameResult = {
  readonly name: string;
  readonly map?: string;
};

export function toModelName(tableName: string): NameResult {
  let name: string;

  if (hasSeparators(tableName)) {
    name = snakeToPascalCase(tableName);
  } else {
    name = tableName.charAt(0).toUpperCase() + tableName.slice(1);
  }

  if (needsEscaping(name)) {
    const escaped = escapeName(name);
    return { name: escaped, map: tableName };
  }

  if (defaultTableName(name) !== tableName) {
    return { name, map: tableName };
  }

  return { name };
}

export function toFieldName(columnName: string): NameResult {
  let name: string;

  if (hasSeparators(columnName)) {
    name = snakeToCamelCase(columnName);
  } else {
    name = columnName.charAt(0).toLowerCase() + columnName.slice(1);
  }

  if (needsEscaping(name)) {
    const escaped = escapeName(name);
    return { name: escaped, map: columnName };
  }

  if (name !== columnName) {
    return { name, map: columnName };
  }

  return { name };
}

export function toEnumName(pgTypeName: string): NameResult {
  let name: string;

  if (hasSeparators(pgTypeName)) {
    name = snakeToPascalCase(pgTypeName);
  } else {
    name = pgTypeName.charAt(0).toUpperCase() + pgTypeName.slice(1);
  }

  if (needsEscaping(name)) {
    const escaped = escapeName(name);
    return { name: escaped, map: pgTypeName };
  }

  if (name !== pgTypeName) {
    return { name, map: pgTypeName };
  }

  return { name };
}

export function pluralize(word: string): string {
  return pluralizeLib.plural(word);
}

export function deriveRelationFieldName(
  fkColumns: readonly string[],
  referencedTableName: string,
): string {
  if (fkColumns.length === 1) {
    const [col = referencedTableName] = fkColumns;
    const stripped = col.replace(/_id$/i, '').replace(/Id$/, '');

    if (stripped.length > 0 && stripped !== col) {
      return escapeIfNeeded(snakeToCamelCase(stripped));
    }
    return escapeIfNeeded(snakeToCamelCase(referencedTableName));
  }

  return escapeIfNeeded(snakeToCamelCase(referencedTableName));
}

export function deriveBackRelationFieldName(childModelName: string, isOneToOne: boolean): string {
  const base = childModelName.charAt(0).toLowerCase() + childModelName.slice(1);
  return isOneToOne ? base : pluralize(base);
}
