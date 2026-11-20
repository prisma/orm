/**
 * Binary serialization for ParamGraph.
 *
 * This module handles compact binary encoding/decoding of the param graph structure.
 * The format uses a hybrid approach: JSON string array for field names + binary blob
 * for structural data (nodes, edges, roots).
 *
 * ## Serialized Representation
 *
 * ```
 * SerializedParamGraph {
 *   strings: string[]   // String table (field names, enum names, root keys)
 *   graph: string       // Base64url-encoded binary blob
 * }
 * ```
 *
 * ## Why Hybrid?
 *
 * - **Strings stay as JSON**: V8's JSON.parse is highly optimized for string arrays
 * - **Structure goes binary**: Indices, flags, masks benefit from compact encoding
 * - **Best of both**: Fast parsing + compact size where it matters
 *
 * ## Variable-Length Encoding
 *
 * All integer values (except fixed-size fields like `scalarMask` and `flags`) use
 * unsigned LEB128 (Little Endian Base 128) variable-length encoding:
 *
 * - Values 0-127: 1 byte
 * - Values 128-16383: 2 bytes
 * - Values 16384-2097151: 3 bytes
 * - And so on...
 *
 * Optional values use value+1 encoding: 0 means "none/undefined", N+1 means actual value N.
 *
 * ## Binary Blob Layout
 *
 * ```
 * ┌───────────────────────────────────────────────────────────────────┐
 * │ HEADER                                                            │
 * ├───────────────────────────────────────────────────────────────────┤
 * │ inputNodeCount: varuint                                           │
 * │ outputNodeCount: varuint                                          │
 * │ rootCount: varuint                                                │
 * └───────────────────────────────────────────────────────────────────┘
 *
 * ┌───────────────────────────────────────────────────────────────────┐
 * │ INPUT NODES (repeated inputNodeCount times)                       │
 * ├───────────────────────────────────────────────────────────────────┤
 * │ edgeCount: varuint                                                │
 * │ edges[]                                                           │
 * └───────────────────────────────────────────────────────────────────┘
 *
 * ┌───────────────────────────────────────────────────────────────────┐
 * │ INPUT EDGE                                                        │
 * ├───────────────────────────────────────────────────────────────────┤
 * │ fieldIndex: varuint                                               │
 * │ scalarMask: u16                                                   │
 * │ childNodeId: varuint (0=none, N+1=actual)                         │
 * │ enumNameIndex: varuint (0=none, N+1=actual)                       │
 * │ flags: u8                                                         │
 * └───────────────────────────────────────────────────────────────────┘
 *
 * ┌───────────────────────────────────────────────────────────────────┐
 * │ OUTPUT NODES (repeated outputNodeCount times)                     │
 * ├───────────────────────────────────────────────────────────────────┤
 * │ edgeCount: varuint                                                │
 * │ edges[]                                                           │
 * └───────────────────────────────────────────────────────────────────┘
 *
 * ┌───────────────────────────────────────────────────────────────────┐
 * │ OUTPUT EDGE                                                       │
 * ├───────────────────────────────────────────────────────────────────┤
 * │ fieldIndex: varuint                                               │
 * │ argsNodeId: varuint (0=none, N+1=actual)                          │
 * │ outputNodeId: varuint (0=none, N+1=actual)                        │
 * └───────────────────────────────────────────────────────────────────┘
 *
 * ┌───────────────────────────────────────────────────────────────────┐
 * │ ROOTS (repeated rootCount times)                                  │
 * ├───────────────────────────────────────────────────────────────────┤
 * │ keyIndex: varuint                                                 │
 * │ argsNodeId: varuint (0=none, N+1=actual)                          │
 * │ outputNodeId: varuint (0=none, N+1=actual)                        │
 * └───────────────────────────────────────────────────────────────────┘
 * ```
 *
 * ## Embedding in Generated Client
 *
 * ```js
 * config.parameterizationSchema = {
 *   strings: JSON.parse('["where","id","email",...]'),
 *   graph: "base64url_encoded_binary_blob..."
 * }
 * ```
 */

import type {
  InputEdgeData,
  InputNodeData,
  OutputEdgeData,
  OutputNodeData,
  ParamGraphData,
  RootEntryData,
} from './types'

/**
 * Serialized format stored in the generated client.
 */
export interface SerializedParamGraph {
  /** String table (field names, enum names, root keys) */
  strings: string[]
  /** Base64url-encoded binary blob for structural data */
  graph: string
}

/**
 * Serializes a ParamGraphData to the compact binary format.
 */
export function serializeParamGraph(data: ParamGraphData): SerializedParamGraph {
  return new Serializer(data).serialize()
}

/**
 * Deserializes a binary-encoded ParamGraph.
 */
export function deserializeParamGraph(serialized: SerializedParamGraph): ParamGraphData {
  return new Deserializer(serialized).deserialize()
}

function encodeBase64url(bytes: Uint8Array): string {
  return Buffer.from(bytes.buffer, bytes.byteOffset, bytes.byteLength).toString('base64url')
}

function decodeBase64url(str: string): Uint8Array {
  return Buffer.from(str, 'base64url')
}

/**
 * Calculates the number of bytes needed to encode a value as an unsigned LEB128 varint.
 */
function varuintSize(value: number): number {
  let size = 1
  while (value >= 0x80) {
    size++
    value >>>= 7
  }
  return size
}

class Serializer {
  #data: ParamGraphData
  #buffer: ArrayBuffer
  #view: DataView
  #offset: number = 0
  #rootKeys: string[]

  constructor(data: ParamGraphData) {
    this.#data = data
    this.#rootKeys = Object.keys(data.roots)

    const size = this.#calculateBufferSize()
    this.#buffer = new ArrayBuffer(size)
    this.#view = new DataView(this.#buffer)
  }

  serialize(): SerializedParamGraph {
    this.#writeHeader()
    this.#writeInputNodes()
    this.#writeOutputNodes()
    this.#writeRoots()

    return {
      strings: this.#data.strings,
      graph: encodeBase64url(new Uint8Array(this.#buffer, 0, this.#offset)),
    }
  }

  #writeVaruint(value: number): void {
    while (value >= 0x80) {
      this.#view.setUint8(this.#offset++, (value & 0x7f) | 0x80)
      value >>>= 7
    }
    this.#view.setUint8(this.#offset++, value)
  }

  #writeOptionalVaruint(value: number | undefined): void {
    this.#writeVaruint(value === undefined ? 0 : value + 1)
  }

  #writeByte(value: number): void {
    this.#view.setUint8(this.#offset, value)
    this.#offset += 1
  }

  #writeU16(value: number): void {
    this.#view.setUint16(this.#offset, value, true)
    this.#offset += 2
  }

  #calculateBufferSize(): number {
    let size = 0

    // Header: 3 varints
    size += varuintSize(this.#data.inputNodes.length)
    size += varuintSize(this.#data.outputNodes.length)
    size += varuintSize(this.#rootKeys.length)

    for (const node of this.#data.inputNodes) {
      const fieldIndices = Object.keys(node.edges).map(Number)
      size += varuintSize(fieldIndices.length)

      for (const fieldIndex of fieldIndices) {
        const edge = node.edges[fieldIndex]
        size += varuintSize(fieldIndex)
        size += 2 // scalarMask: u16
        size += varuintSize(edge.childNodeId === undefined ? 0 : edge.childNodeId + 1)
        size += varuintSize(edge.enumNameIndex === undefined ? 0 : edge.enumNameIndex + 1)
        size += 1 // flags: u8
      }
    }

    for (const node of this.#data.outputNodes) {
      const fieldIndices = Object.keys(node.edges).map(Number)
      size += varuintSize(fieldIndices.length)

      for (const fieldIndex of fieldIndices) {
        const edge = node.edges[fieldIndex]
        size += varuintSize(fieldIndex)
        size += varuintSize(edge.argsNodeId === undefined ? 0 : edge.argsNodeId + 1)
        size += varuintSize(edge.outputNodeId === undefined ? 0 : edge.outputNodeId + 1)
      }
    }

    for (const key of this.#rootKeys) {
      const root = this.#data.roots[key]
      const keyIndex = this.#data.strings.indexOf(key)
      size += varuintSize(keyIndex)
      size += varuintSize(root.argsNodeId === undefined ? 0 : root.argsNodeId + 1)
      size += varuintSize(root.outputNodeId === undefined ? 0 : root.outputNodeId + 1)
    }

    return size
  }

  #writeHeader(): void {
    this.#writeVaruint(this.#data.inputNodes.length)
    this.#writeVaruint(this.#data.outputNodes.length)
    this.#writeVaruint(this.#rootKeys.length)
  }

  #writeInputNodes(): void {
    for (const node of this.#data.inputNodes) {
      const fieldIndices = Object.keys(node.edges).map(Number)
      this.#writeVaruint(fieldIndices.length)

      for (const fieldIndex of fieldIndices) {
        const edge = node.edges[fieldIndex]

        this.#writeVaruint(fieldIndex)
        this.#writeU16(edge.scalarMask ?? 0)
        this.#writeOptionalVaruint(edge.childNodeId)
        this.#writeOptionalVaruint(edge.enumNameIndex)
        this.#writeByte(edge.flags)
      }
    }
  }

  #writeOutputNodes(): void {
    for (const node of this.#data.outputNodes) {
      const fieldIndices = Object.keys(node.edges).map(Number)
      this.#writeVaruint(fieldIndices.length)

      for (const fieldIndex of fieldIndices) {
        const edge = node.edges[fieldIndex]

        this.#writeVaruint(fieldIndex)
        this.#writeOptionalVaruint(edge.argsNodeId)
        this.#writeOptionalVaruint(edge.outputNodeId)
      }
    }
  }

  #writeRoots(): void {
    for (const key of this.#rootKeys) {
      const root = this.#data.roots[key]
      const keyIndex = this.#data.strings.indexOf(key)
      if (keyIndex === -1) {
        throw new Error(`Root key "${key}" not found in strings table`)
      }

      this.#writeVaruint(keyIndex)
      this.#writeOptionalVaruint(root.argsNodeId)
      this.#writeOptionalVaruint(root.outputNodeId)
    }
  }
}

class Deserializer {
  #serialized: SerializedParamGraph
  #view: DataView
  #offset: number = 0

  constructor(serialized: SerializedParamGraph) {
    this.#serialized = serialized
    const bytes = decodeBase64url(serialized.graph)
    this.#view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength)
  }

  deserialize(): ParamGraphData {
    const { inputNodeCount, outputNodeCount, rootCount } = this.#readHeader()
    const inputNodes = this.#readInputNodes(inputNodeCount)
    const outputNodes = this.#readOutputNodes(outputNodeCount)
    const roots = this.#readRoots(rootCount)

    return {
      strings: this.#serialized.strings,
      inputNodes,
      outputNodes,
      roots,
    }
  }

  #readVaruint(): number {
    let value = 0
    let shift = 0
    let byte: number
    do {
      byte = this.#view.getUint8(this.#offset++)
      value |= (byte & 0x7f) << shift
      shift += 7
    } while (byte >= 0x80)
    return value
  }

  #readOptionalVaruint(): number | undefined {
    const value = this.#readVaruint()
    return value === 0 ? undefined : value - 1
  }

  #readByte(): number {
    const value = this.#view.getUint8(this.#offset)
    this.#offset += 1
    return value
  }

  #readU16(): number {
    const value = this.#view.getUint16(this.#offset, true)
    this.#offset += 2
    return value
  }

  #readHeader(): { inputNodeCount: number; outputNodeCount: number; rootCount: number } {
    const inputNodeCount = this.#readVaruint()
    const outputNodeCount = this.#readVaruint()
    const rootCount = this.#readVaruint()

    return { inputNodeCount, outputNodeCount, rootCount }
  }

  #readInputNodes(count: number): InputNodeData[] {
    const inputNodes: InputNodeData[] = []

    for (let i = 0; i < count; i++) {
      const edgeCount = this.#readVaruint()
      const edges: Record<number, InputEdgeData> = {}

      for (let j = 0; j < edgeCount; j++) {
        const fieldIndex = this.#readVaruint()
        const scalarMask = this.#readU16()
        const childNodeId = this.#readOptionalVaruint()
        const enumNameIndex = this.#readOptionalVaruint()
        const flags = this.#readByte()

        const edge: InputEdgeData = { flags }
        if (scalarMask !== 0) edge.scalarMask = scalarMask
        if (childNodeId !== undefined) edge.childNodeId = childNodeId
        if (enumNameIndex !== undefined) edge.enumNameIndex = enumNameIndex

        edges[fieldIndex] = edge
      }

      inputNodes.push({ edges })
    }

    return inputNodes
  }

  #readOutputNodes(count: number): OutputNodeData[] {
    const outputNodes: OutputNodeData[] = []

    for (let i = 0; i < count; i++) {
      const edgeCount = this.#readVaruint()
      const edges: Record<number, OutputEdgeData> = {}

      for (let j = 0; j < edgeCount; j++) {
        const fieldIndex = this.#readVaruint()
        const argsNodeId = this.#readOptionalVaruint()
        const outputNodeId = this.#readOptionalVaruint()

        const edge: OutputEdgeData = {}
        if (argsNodeId !== undefined) edge.argsNodeId = argsNodeId
        if (outputNodeId !== undefined) edge.outputNodeId = outputNodeId

        edges[fieldIndex] = edge
      }

      outputNodes.push({ edges })
    }

    return outputNodes
  }

  #readRoots(count: number): Record<string, RootEntryData> {
    const roots: Record<string, RootEntryData> = {}

    for (let i = 0; i < count; i++) {
      const keyIndex = this.#readVaruint()
      const argsNodeId = this.#readOptionalVaruint()
      const outputNodeId = this.#readOptionalVaruint()

      const key = this.#serialized.strings[keyIndex]
      const root: RootEntryData = {}
      if (argsNodeId !== undefined) root.argsNodeId = argsNodeId
      if (outputNodeId !== undefined) root.outputNodeId = outputNodeId

      roots[key] = root
    }

    return roots
  }
}
