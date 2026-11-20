/**
 * ParamGraphBuilder: Data holder for building ParamGraph.
 *
 * This class manages allocation and caching during graph construction.
 * The actual traversal logic is in DMMFTraverser.
 */

import type {
  InputEdgeData,
  InputNodeData,
  OutputEdgeData,
  OutputNodeData,
  ParamGraphData,
  RootEntryData,
  SerializedParamGraph,
} from '@prisma/param-graph'
import { serializeParamGraph } from '@prisma/param-graph'

export type NodeId = number

/**
 * Builder class that accumulates graph data during construction.
 */
export class ParamGraphBuilder {
  readonly #stringTable: string[] = []
  readonly #stringToIndex = new Map<string, number>()
  readonly #inputNodes: InputNodeData[] = []
  readonly #outputNodes: OutputNodeData[] = []
  readonly #roots: Record<string, RootEntryData> = {}

  readonly #inputTypeNodeCache = new Map<string, NodeId | undefined>()
  readonly #unionNodeCache = new Map<string, NodeId | undefined>()
  readonly #outputTypeNodeCache = new Map<string, NodeId | undefined>()

  /**
   * Interns a string into the string table, returning its index.
   * Both field names and enum names go through this method.
   */
  internString(str: string): number {
    let index = this.#stringToIndex.get(str)
    if (index === undefined) {
      index = this.#stringTable.length
      this.#stringTable.push(str)
      this.#stringToIndex.set(str, index)
    }
    return index
  }

  /**
   * Allocates a new input node and returns its ID.
   */
  allocateInputNode(): NodeId {
    const id = this.#inputNodes.length
    this.#inputNodes.push({ edges: {} })
    return id
  }

  /**
   * Sets edges on an input node.
   */
  setInputNodeEdges(nodeId: NodeId, edges: Record<number, InputEdgeData>): void {
    if (Object.keys(edges).length > 0) {
      this.#inputNodes[nodeId].edges = edges
    }
  }

  /**
   * Allocates a new output node and returns its ID.
   */
  allocateOutputNode(): NodeId {
    const id = this.#outputNodes.length
    this.#outputNodes.push({ edges: {} })
    return id
  }

  /**
   * Sets edges on an output node.
   */
  setOutputNodeEdges(nodeId: NodeId, edges: Record<number, OutputEdgeData>): void {
    if (Object.keys(edges).length > 0) {
      this.#outputNodes[nodeId].edges = edges
    }
  }

  /**
   * Records a root entry for an operation.
   */
  setRoot(key: string, entry: RootEntryData): void {
    if (entry.argsNodeId !== undefined || entry.outputNodeId !== undefined) {
      // Intern the root key into the string table for binary serialization
      this.internString(key)
      this.#roots[key] = entry
    }
  }

  // Cache methods for input type nodes

  getInputTypeNode(typeName: string): NodeId | undefined {
    return this.#inputTypeNodeCache.get(typeName)
  }

  setInputTypeNode(typeName: string, nodeId: NodeId | undefined): void {
    this.#inputTypeNodeCache.set(typeName, nodeId)
  }

  hasInputTypeNode(typeName: string): boolean {
    return this.#inputTypeNodeCache.has(typeName)
  }

  // Cache methods for union nodes

  getUnionNode(key: string): NodeId | undefined {
    return this.#unionNodeCache.get(key)
  }

  setUnionNode(key: string, nodeId: NodeId | undefined): void {
    this.#unionNodeCache.set(key, nodeId)
  }

  hasUnionNode(key: string): boolean {
    return this.#unionNodeCache.has(key)
  }

  // Cache methods for output type nodes

  getOutputTypeNode(typeName: string): NodeId | undefined {
    return this.#outputTypeNodeCache.get(typeName)
  }

  setOutputTypeNode(typeName: string, nodeId: NodeId | undefined): void {
    this.#outputTypeNodeCache.set(typeName, nodeId)
  }

  hasOutputTypeNode(typeName: string): boolean {
    return this.#outputTypeNodeCache.has(typeName)
  }

  /**
   * Builds the final ParamGraphData structure.
   */
  build(): ParamGraphData {
    return {
      strings: this.#stringTable,
      inputNodes: this.#inputNodes,
      outputNodes: this.#outputNodes,
      roots: this.#roots,
    }
  }

  /**
   * Builds and serializes to the compact binary format.
   */
  buildAndSerialize(): SerializedParamGraph {
    return serializeParamGraph(this.build())
  }
}
