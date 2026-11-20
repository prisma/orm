import type * as DMMF from '@prisma/dmmf'
import { SqlQueryOutput } from '@prisma/generator'

import { FileMap } from '../generateClient'
import { buildDbEnums, DbEnumsList } from './buildDbEnums'
import { buildIndexCjs, buildIndexEsm, buildIndexTs } from './buildIndex'
import { buildTypedQueryCjs, buildTypedQueryEsm, buildTypedQueryTs } from './buildTypedQuery'

type TypeSqlBuildOptions = {
  runtimeBase: string
  mainRuntimeName: string
  edgeRuntimeName: 'wasm-compiler-edge'
  dmmf: DMMF.Document
  queries: SqlQueryOutput[]
}

export function buildTypedSql({
  queries,
  runtimeBase,
  edgeRuntimeName,
  mainRuntimeName,
  dmmf,
}: TypeSqlBuildOptions): FileMap {
  const fileMap = {}

  const enums = new DbEnumsList(dmmf.datamodel.enums)
  if (!enums.isEmpty()) {
    fileMap['$DbEnums.d.ts'] = buildDbEnums(enums)
  }
  for (const query of queries) {
    const options = { query, runtimeBase, runtimeName: mainRuntimeName, enums }
    const edgeOptions = { ...options, runtimeName: `${edgeRuntimeName}.js` }
    fileMap[`${query.name}.d.ts`] = buildTypedQueryTs(options)
    fileMap[`${query.name}.js`] = buildTypedQueryCjs(options)
    fileMap[`${query.name}.${edgeRuntimeName}.js`] = buildTypedQueryCjs(edgeOptions)
    fileMap[`${query.name}.mjs`] = buildTypedQueryEsm(options)
    fileMap[`${query.name}.${edgeRuntimeName}.mjs`] = buildTypedQueryEsm(edgeOptions)
  }
  fileMap['index.d.ts'] = buildIndexTs(queries, enums)
  fileMap['index.js'] = buildIndexCjs(queries)
  fileMap['index.mjs'] = buildIndexEsm(queries)
  fileMap[`index.${edgeRuntimeName}.mjs`] = buildIndexEsm(queries, edgeRuntimeName)
  fileMap[`index.${edgeRuntimeName}.js`] = buildIndexCjs(queries, edgeRuntimeName)
  return fileMap
}
