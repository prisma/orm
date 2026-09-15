import { toModelName } from '@internal/family-sql/psl-infer';
import { flatPslModels } from '@internal/framework-components/psl-ast';
import { SqlSchemaIR, SqlTableIR } from '@internal/sql-schema-ir/types';
import { parsePostgresDefault } from '../default-normalizer';
import { buildPslDocumentAst } from './infer-psl-contract';
import { createPostgresDefaultMapping } from './postgres-default-mapping';
import { createPostgresTypeMap } from './postgres-type-map';

const EMPTY_FOREIGN_KEY_EXTRAS = {
  extraRelationsByTable: new Map(),
  crossSpaceFieldNamesByTable: new Map(),
  danglingForeignKeysByTable: new Map(),
};

function idTable(name: string): SqlTableIR {
  return new SqlTableIR({
    name,
    columns: { id: { name: 'id', nativeType: 'int4', nullable: false } },
    foreignKeys: [],
    uniques: [],
    indexes: [],
    primaryKey: { columns: ['id'] },
  });
}

/**
 * The relation field names `contract infer` prints for an implicit
 * many-to-many junction table whose columns `A` and `B` reference `tableA`
 * and `tableB`, found by running infer's PSL construction on that table.
 */
export function junctionRelationFieldNames(
  tableA: string,
  tableB: string,
): readonly [string, string] {
  let junctionName = '_junction';
  while (
    [tableA, tableB].some((table) => toModelName(table).name === toModelName(junctionName).name)
  ) {
    junctionName = `${junctionName}x`;
  }
  const column = (name: string) => ({ name, nativeType: 'int4', nullable: false });
  const foreignKey = (columnName: string, referencedTable: string) => ({
    columns: [columnName],
    referencedTable,
    referencedColumns: ['id'],
  });
  const junction = new SqlTableIR({
    name: junctionName,
    columns: { A: column('A'), B: column('B') },
    foreignKeys: [foreignKey('A', tableA), foreignKey('B', tableB)],
    uniques: [],
    indexes: [],
    primaryKey: { columns: ['A', 'B'] },
  });
  const document = buildPslDocumentAst(
    new SqlSchemaIR({
      tables: { [tableA]: idTable(tableA), [tableB]: idTable(tableB), [junctionName]: junction },
    }),
    {
      typeMap: createPostgresTypeMap(),
      defaultMapping: createPostgresDefaultMapping(),
      parseRawDefault: parsePostgresDefault,
    },
    EMPTY_FOREIGN_KEY_EXTRAS,
  );
  const junctionModelName = toModelName(junctionName).name;
  const fields = flatPslModels(document).find((model) => model.name === junctionModelName)?.fields;
  const scalarFieldCount = Object.keys(junction.columns).length;
  const [a = '', b = ''] = (fields ?? []).slice(scalarFieldCount).map((field) => field.name);
  return [a, b];
}
