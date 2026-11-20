/**
 * Internal data types for ParamGraph.
 *
 * These types represent the in-memory structure of the param graph,
 * used both during building and after deserialization.
 */

/**
 * Complete param graph data structure.
 * This is the internal representation, not the serialized format.
 */
export interface ParamGraphData {
  /** String table containing field names and enum names */
  strings: string[]

  /** Input nodes for argument objects and input types */
  inputNodes: InputNodeData[]

  /** Output nodes for selection traversal */
  outputNodes: OutputNodeData[]

  /** Root mapping: "Model.action" -> entry */
  roots: Record<string, RootEntryData>
}

/**
 * Input node data: describes parameterizable fields in an input object.
 */
export interface InputNodeData {
  /** Map from string-table index to edge descriptor */
  edges: Record<number, InputEdgeData>
}

/**
 * Output node data: describes fields in a selection set.
 */
export interface OutputNodeData {
  /** Map from string-table index to edge descriptor */
  edges: Record<number, OutputEdgeData>
}

/**
 * Input edge data: describes what a field accepts.
 */
export interface InputEdgeData {
  /** Bit flags describing field capabilities (see EdgeFlag) */
  flags: number

  /** Child input node id (for object values) */
  childNodeId?: number

  /** Scalar type mask (see ScalarMask) */
  scalarMask?: number

  /** Enum name index into string table */
  enumNameIndex?: number
}

/**
 * Output edge data: describes a field in a selection set.
 */
export interface OutputEdgeData {
  /** Args node id for this field */
  argsNodeId?: number

  /** Next output node id for nested selection */
  outputNodeId?: number
}

/**
 * Root entry data: entry point for an operation.
 */
export interface RootEntryData {
  /** Args node id */
  argsNodeId?: number

  /** Output node id */
  outputNodeId?: number
}
