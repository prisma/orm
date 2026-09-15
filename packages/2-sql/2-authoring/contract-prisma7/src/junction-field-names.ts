const PSL_RESERVED_WORDS: ReadonlySet<string> = new Set([
  'model',
  'enum',
  'types',
  'type',
  'generator',
  'datasource',
]);

function identifierParts(name: string): readonly string[] {
  return name.match(/[A-Za-z0-9]+/g) ?? [name];
}

function capitalize(word: string): string {
  return word.charAt(0).toUpperCase() + word.slice(1);
}

function escaped(name: string): string {
  return PSL_RESERVED_WORDS.has(name.toLowerCase()) || /^\d/.test(name) ? `_${name}` : name;
}

function camelCase(name: string): string {
  const [first = name, ...rest] = identifierParts(name);
  return first.charAt(0).toLowerCase() + first.slice(1) + rest.map(capitalize).join('');
}

function modelName(tableName: string): string {
  const pascal = /[^A-Za-z0-9]/.test(tableName)
    ? identifierParts(tableName).map(capitalize).join('')
    : capitalize(tableName);
  return escaped(pascal);
}

/**
 * The relation field names `contract infer` gives the foreign keys of an
 * implicit many-to-many junction table, from column `A` and then column `B`:
 * the referenced table name in camelCase; a name the table already uses gets
 * the referenced model name appended, and then a number. Kept in step with
 * `inferRelations` in `@internal/family-sql/psl-infer`, which an integration
 * test runs against the tables Prisma 7 creates.
 */
export function junctionRelationFieldNames(
  tableA: string,
  tableB: string,
): readonly [string, string] {
  const used = new Set(['A', 'B']);
  const name = (tableName: string): string => {
    const desired = escaped(camelCase(tableName));
    let chosen = desired;
    if (used.has(chosen)) chosen = `${desired}${modelName(tableName)}`;
    for (let counter = 2; used.has(chosen); counter += 1) chosen = `${desired}${counter}`;
    used.add(chosen);
    return chosen;
  };
  return [name(tableA), name(tableB)];
}
