const PSL_RESERVED_WORDS = new Set(['model', 'enum', 'types', 'type', 'generator', 'datasource']);

const IDENTIFIER_PART_PATTERN = /[A-Za-z0-9]+/g;

export type NameResult = {
  readonly name: string;
  readonly map?: string;
};

function hasSeparators(input: string): boolean {
  return /[^A-Za-z0-9]/.test(input);
}

function extractIdentifierParts(input: string): string[] {
  return input.match(IDENTIFIER_PART_PATTERN) ?? [];
}

function createSyntheticIdentifier(input: string): string {
  let hash = 2166136261;

  for (const char of input) {
    hash ^= char.codePointAt(0) ?? 0;
    hash = Math.imul(hash, 16777619);
  }

  return `x${(hash >>> 0).toString(16)}`;
}

function sanitizeIdentifierCharacters(input: string): string {
  const sanitized = input.replace(/[^\w]/g, '');
  return sanitized.length > 0 ? sanitized : createSyntheticIdentifier(input);
}

function capitalize(word: string): string {
  return word.charAt(0).toUpperCase() + word.slice(1);
}

function snakeToPascalCase(input: string): string {
  const parts = extractIdentifierParts(input);
  if (parts.length === 0) {
    return capitalize(sanitizeIdentifierCharacters(input));
  }
  return parts.map(capitalize).join('');
}

function snakeToCamelCase(input: string): string {
  const parts = extractIdentifierParts(input);
  if (parts.length === 0) {
    return sanitizeIdentifierCharacters(input);
  }
  const [firstPart = input, ...rest] = parts;
  return firstPart.charAt(0).toLowerCase() + firstPart.slice(1) + rest.map(capitalize).join('');
}

function needsEscaping(name: string): boolean {
  return PSL_RESERVED_WORDS.has(name.toLowerCase()) || /^\d/.test(name);
}

function escapeName(name: string): string {
  return `_${name}`;
}

function escapeIfNeeded(name: string): string {
  return needsEscaping(name) ? escapeName(name) : name;
}

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

  if (name !== tableName) {
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

const VALID_IDENTIFIER_PATTERN = /^[A-Za-z_]\w*$/;

/**
 * PSL member name for a native-enum value. The value itself always prints
 * explicitly (`member = "value"`), so the returned name never needs a map:
 * a value that already is a valid, non-reserved identifier is kept verbatim
 * (case included); anything else is camelCased/escaped like a field name.
 */
export function toEnumMemberName(value: string): string {
  if (VALID_IDENTIFIER_PATTERN.test(value) && !needsEscaping(value)) {
    return value;
  }
  return escapeIfNeeded(snakeToCamelCase(value));
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

/** A name not in `usedNames`: `desired`, or `desired` followed by the first free number from 2. */
export function createUniqueFieldName(desired: string, usedNames: ReadonlySet<string>): string {
  if (!usedNames.has(desired)) {
    return desired;
  }
  let counter = 2;
  while (usedNames.has(`${desired}${counter}`)) {
    counter++;
  }
  return `${desired}${counter}`;
}

/**
 * A relation field name not in `usedNames`: `desired`, then `desired` followed
 * by the referenced model name, then `desired` followed by the first free
 * number from 2.
 */
export function resolveUniqueRelationFieldName(
  desired: string,
  usedNames: ReadonlySet<string>,
  referencedModelName: string,
): string {
  if (!usedNames.has(desired)) {
    return desired;
  }
  const withModelName = `${desired}${referencedModelName}`;
  if (!usedNames.has(withModelName)) {
    return withModelName;
  }
  return createUniqueFieldName(desired, usedNames);
}

/**
 * The relation field names inferred for the two foreign keys of an implicit
 * many-to-many junction table, whose columns `A` and `B` reference `tableA`
 * and `tableB`. Each foreign key is named as any foreign key is, first against
 * the table's column names and then against the field names its columns get.
 */
export function junctionRelationFieldNames(
  tableA: string,
  tableB: string,
): readonly [string, string] {
  const foreignKeys = [
    { column: 'A', table: tableA },
    { column: 'B', table: tableB },
  ];
  const takenOnTable = new Set(foreignKeys.map((foreignKey) => foreignKey.column));
  const relationNames = foreignKeys.map(({ column, table }) => {
    const name = resolveUniqueRelationFieldName(
      deriveRelationFieldName([column], table),
      takenOnTable,
      toModelName(table).name,
    );
    takenOnTable.add(name);
    return name;
  });
  const takenByFields = new Set<string>();
  for (const { column } of foreignKeys) {
    takenByFields.add(createUniqueFieldName(toFieldName(column).name, takenByFields));
  }
  const [a = '', b = ''] = relationNames.map((name) => {
    const unique = createUniqueFieldName(name, takenByFields);
    takenByFields.add(unique);
    return unique;
  });
  return [a, b];
}
