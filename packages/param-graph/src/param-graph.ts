/**
 * ParamGraph: Runtime class for schema-aware parameterization.
 *
 * This class provides a readable API for navigating the param graph structure
 * at runtime. It's created once per PrismaClient instance from the serialized
 * format embedded in the generated client.
 */

import type { SerializedParamGraph } from './serialization'
import { deserializeParamGraph } from './serialization'
import type {
  InputEdgeData,
  InputNodeData,
  OutputEdgeData,
  OutputNodeData,
  ParamGraphData,
  RootEntryData,
} from './types'

/**
 * Map of enum names to their respective values.
 */
export type EnumNameToValueMap = Record<string, string>

/**
 * Function type for looking up enum values by name.
 * This allows ParamGraph to remain decoupled from RuntimeDataModel.
 */
export type EnumLookup = (enumName: string) => Readonly<EnumNameToValueMap> | undefined

/**
 * Readable view of root entry.
 */
export interface RootEntry {
  readonly argsNodeId: number | undefined
  readonly outputNodeId: number | undefined
}

/**
 * Readable view of input node.
 */
export interface InputNode {
  readonly id: number
}

/**
 * Readable view of output node.
 */
export interface OutputNode {
  readonly id: number
}

/**
 * Readable view of input edge.
 */
export interface InputEdge {
  readonly flags: number
  readonly childNodeId: number | undefined
  readonly scalarMask: number
  readonly enumNameIndex: number | undefined
}

/**
 * Readable view of output edge.
 */
export interface OutputEdge {
  readonly argsNodeId: number | undefined
  readonly outputNodeId: number | undefined
}

/**
 * ParamGraph provides runtime access to the schema information
 * needed for parameterization decisions.
 */
export class ParamGraph {
  static readonly #decodedGraphs = new WeakMap<SerializedParamGraph, ParamGraphData>()
  readonly #data: ParamGraphData
  readonly #stringIndex: Map<string, number>
  readonly #enumLookup: EnumLookup

  private constructor(data: ParamGraphData, enumLookup: EnumLookup) {
    this.#data = data
    this.#enumLookup = enumLookup

    // Build string-to-index map for O(1) lookups
    this.#stringIndex = new Map<string, number>()
    for (let i = 0; i < data.strings.length; i++) {
      this.#stringIndex.set(data.strings[i], i)
    }
  }

  /**
   * Creates a ParamGraph from serialized format.
   * This is the primary factory method for runtime use.
   * Serialized schemas must not be mutated after successful deserialization.
   */
  static deserialize(serialized: SerializedParamGraph, enumLookup: EnumLookup): ParamGraph {
    let data = ParamGraph.#decodedGraphs.get(serialized)
    if (data === undefined) {
      data = deserializeParamGraph(serialized)
      ParamGraph.#decodedGraphs.set(serialized, data)
    }
    return new ParamGraph(data, enumLookup)
  }

  /**
   * Creates a ParamGraph from builder data.
   * Used by the builder for testing and direct construction.
   */
  static fromData(data: ParamGraphData, enumLookup: EnumLookup): ParamGraph {
    return new ParamGraph(data, enumLookup)
  }

  /**
   * Look up a root entry by "Model.action" or "action".
   */
  root(key: string): RootEntry | undefined {
    const entry = this.#data.roots[key]
    if (!entry) {
      return undefined
    }
    return {
      argsNodeId: entry.argsNodeId,
      outputNodeId: entry.outputNodeId,
    }
  }

  /**
   * Get an input node by ID.
   */
  inputNode(id: number | undefined): InputNode | undefined {
    if (id === undefined || id < 0 || id >= this.#data.inputNodes.length) {
      return undefined
    }
    return { id }
  }

  /**
   * Get an output node by ID.
   */
  outputNode(id: number | undefined): OutputNode | undefined {
    if (id === undefined || id < 0 || id >= this.#data.outputNodes.length) {
      return undefined
    }
    return { id }
  }

  /**
   * Get an input edge for a field name within a node.
   */
  inputEdge(node: InputNode | undefined, fieldName: string): InputEdge | undefined {
    if (!node) {
      return undefined
    }

    const nodeData = this.#data.inputNodes[node.id]
    if (!nodeData) {
      return undefined
    }

    const fieldIndex = this.#stringIndex.get(fieldName)
    if (fieldIndex === undefined) {
      return undefined
    }

    const edge = nodeData.edges[fieldIndex]
    if (!edge) {
      return undefined
    }

    return {
      flags: edge.flags,
      childNodeId: edge.childNodeId,
      scalarMask: edge.scalarMask ?? 0,
      enumNameIndex: edge.enumNameIndex,
    }
  }

  /**
   * Get an output edge for a field name within a node.
   */
  outputEdge(node: OutputNode | undefined, fieldName: string): OutputEdge | undefined {
    if (!node) {
      return undefined
    }

    const nodeData = this.#data.outputNodes[node.id]
    if (!nodeData) {
      return undefined
    }

    const fieldIndex = this.#stringIndex.get(fieldName)
    if (fieldIndex === undefined) {
      return undefined
    }

    const edge = nodeData.edges[fieldIndex]
    if (!edge) {
      return undefined
    }

    return {
      argsNodeId: edge.argsNodeId,
      outputNodeId: edge.outputNodeId,
    }
  }

  /**
   * Get enum values for an edge that references a user enum.
   * Returns undefined if the edge doesn't reference an enum.
   */
  enumValues(edge: InputEdge | undefined): Readonly<EnumNameToValueMap> | undefined {
    if (edge?.enumNameIndex === undefined) {
      return undefined
    }

    const enumName = this.#data.strings[edge.enumNameIndex]
    if (!enumName) {
      return undefined
    }

    return this.#enumLookup(enumName)
  }

  /**
   * Get a string from the string table by index.
   */
  getString(index: number): string | undefined {
    return this.#data.strings[index]
  }
}

/**
 * Bit flags for InputEdge.flags describing what the field accepts.
 */
export const EdgeFlag = {
  /**
   * Field may be parameterized as a scalar value.
   * Check ScalarMask to validate the value type.
   */
  ParamScalar: 1,

  /**
   * Field may be parameterized as an enum.
   * Check enum ID to validate the value type.
   */
  ParamEnum: 2,

  /**
   * Field accepts list-of-scalar values.
   * Parameterize the whole list if all elements match ScalarMask.
   */
  ParamListScalar: 4,

  /**
   * Field accepts list-of-enum values.
   * Parameterize the whole list if all elements match enum ID.
   */
  ParamListEnum: 8,

  /**
   * Field accepts list-of-object values.
   * Recurse into each element using the child node.
   */
  ListObject: 16,

  /**
   * Field accepts object values.
   * Recurse into child input node.
   */
  Object: 32,
} as const

export type EdgeFlagValue = (typeof EdgeFlag)[keyof typeof EdgeFlag]

/**
 * Bit mask for scalar type categories.
 * Used in InputEdge.scalarMask to validate runtime value types.
 */
export const ScalarMask = {
  String: 1,
  Int: 2,
  BigInt: 4,
  Float: 8,
  Decimal: 16,
  Boolean: 32,
  DateTime: 64,
  Json: 128,
  Bytes: 256,
} as const

export type ScalarMaskValue = (typeof ScalarMask)[keyof typeof ScalarMask]

/**
 * Helper function to check if an edge has a specific flag.
 */
export function hasFlag(edge: InputEdge, flag: number): boolean {
  return (edge.flags & flag) !== 0
}

/**
 * Helper function to get the scalar mask from an edge.
 */
export function getScalarMask(edge: InputEdge): number {
  return edge.scalarMask
}

/**
 * Maps DMMF scalar type names to ScalarMask values.
 */
export function scalarTypeToMask(typeName: string): number {
  switch (typeName) {
    case 'String':
    case 'UUID':
      return ScalarMask.String
    case 'Int':
      return ScalarMask.Int
    case 'BigInt':
      return ScalarMask.BigInt
    case 'Float':
      return ScalarMask.Float
    case 'Decimal':
      return ScalarMask.Decimal
    case 'Boolean':
      return ScalarMask.Boolean
    case 'DateTime':
      return ScalarMask.DateTime
    case 'Json':
      return ScalarMask.Json
    case 'Bytes':
      return ScalarMask.Bytes
    default:
      return 0
  }
}

// Re-export data types for builder use
export type { InputEdgeData, InputNodeData, OutputEdgeData, OutputNodeData, ParamGraphData, RootEntryData }
