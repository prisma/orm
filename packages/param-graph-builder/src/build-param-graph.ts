/**
 * Entry point for building ParamGraph from DMMF.
 *
 * This module provides the main API for client generators to build
 * parameterization schemas from DMMF at generation time.
 */

import type * as DMMF from '@prisma/dmmf'
import type { ParamGraphData, SerializedParamGraph } from '@prisma/param-graph'

import { DMMFTraverser } from './dmmf-traverser'
import { ParamGraphBuilder } from './param-graph-builder'

/**
 * Builds a ParamGraphData from DMMF schema.
 *
 * @param dmmf - The DMMF document from the schema
 * @returns The param graph data structure
 */
export function buildParamGraph(dmmf: DMMF.Document): ParamGraphData {
  const builder = new ParamGraphBuilder()
  const traverser = new DMMFTraverser(builder, dmmf)
  traverser.processRoots(dmmf.mappings.modelOperations)
  return builder.build()
}

/**
 * Builds and serializes a ParamGraph from DMMF schema.
 *
 * This is the primary API for generators - it returns the compact
 * serialized format ready to be embedded in generated clients.
 *
 * @param dmmf - The DMMF document from the schema
 * @returns The serialized param graph
 */
export function buildAndSerializeParamGraph(dmmf: DMMF.Document): SerializedParamGraph {
  const builder = new ParamGraphBuilder()
  const traverser = new DMMFTraverser(builder, dmmf)
  traverser.processRoots(dmmf.mappings.modelOperations)
  return builder.buildAndSerialize()
}
