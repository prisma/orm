/**
 * DMMFTraverser: DMMF traversal logic for building ParamGraph.
 *
 * This class contains the traversal algorithms that walk DMMF structures
 * and build the param graph. It uses ParamGraphBuilder for allocation
 * and caching.
 */

import type * as DMMF from '@prisma/dmmf'
import { ModelAction } from '@prisma/dmmf'
import type { InputEdgeData, OutputEdgeData } from '@prisma/param-graph'
import { EdgeFlag, scalarTypeToMask } from '@prisma/param-graph'

import type { NodeId, ParamGraphBuilder } from './param-graph-builder'

interface PendingInputNode {
  nodeId: NodeId
  fields: readonly DMMF.SchemaArg[]
}

interface PendingUnionNode {
  nodeId: NodeId
  typeNames: string[]
}

/**
 * Traverses DMMF and populates a ParamGraphBuilder.
 */
export class DMMFTraverser {
  readonly #builder: ParamGraphBuilder
  readonly #inputTypeMap: Map<string, DMMF.InputType>
  readonly #outputTypeMap: Map<string, DMMF.OutputType>

  readonly #pendingInputNodes: PendingInputNode[] = []
  readonly #pendingUnionNodes: PendingUnionNode[] = []

  constructor(builder: ParamGraphBuilder, dmmf: DMMF.Document) {
    this.#builder = builder
    this.#inputTypeMap = new Map()
    this.#outputTypeMap = new Map()

    // Collect all input types
    for (const inputType of dmmf.schema.inputObjectTypes.prisma ?? []) {
      this.#inputTypeMap.set(getTypeName(inputType.name, 'prisma'), inputType)
    }
    for (const inputType of dmmf.schema.inputObjectTypes.model ?? []) {
      this.#inputTypeMap.set(getTypeName(inputType.name, 'model'), inputType)
    }

    // Collect all output types
    for (const outputType of dmmf.schema.outputObjectTypes.prisma ?? []) {
      this.#outputTypeMap.set(getTypeName(outputType.name, 'prisma'), outputType)
    }
    for (const outputType of dmmf.schema.outputObjectTypes.model ?? []) {
      this.#outputTypeMap.set(getTypeName(outputType.name, 'model'), outputType)
    }
  }

  /**
   * Process all root operations from model mappings.
   */
  processRoots(mappings: readonly DMMF.ModelMapping[]): void {
    for (const mapping of mappings) {
      const modelName = mapping.model
      const actions = Object.keys(ModelAction) as `${ModelAction}`[]

      for (const action of actions) {
        const fieldName = mapping[action]
        if (!fieldName) continue

        const rootField = this.#findRootField(fieldName)
        if (!rootField) continue

        const argsNodeId = this.buildInputNodeFromArgs(rootField.args)

        let outputNodeId: NodeId | undefined
        if (rootField.outputType.location === 'outputObjectTypes') {
          outputNodeId = this.buildOutputTypeNode(
            getTypeName(rootField.outputType.type, rootField.outputType.namespace),
          )
        }

        const dmmfActionToJsonAction: Partial<Record<ModelAction, string>> = {
          create: 'createOne',
          update: 'updateOne',
          delete: 'deleteOne',
          upsert: 'upsertOne',
        }

        const jsonAction = dmmfActionToJsonAction[action] ?? action
        const rootKey = `${modelName}.${jsonAction}`

        this.#builder.setRoot(rootKey, {
          argsNodeId,
          outputNodeId,
        })
      }
    }

    // Process all queued work iteratively to avoid stack overflow
    this.#drainPendingWork()
  }

  /**
   * Iteratively processes all pending input and union nodes.
   * This avoids deep recursion that can cause stack overflow on complex schemas.
   */
  #drainPendingWork(): void {
    while (this.#pendingInputNodes.length > 0 || this.#pendingUnionNodes.length > 0) {
      // Process pending input nodes
      while (this.#pendingInputNodes.length > 0) {
        const pending = this.#pendingInputNodes.pop()!
        this.#processInputNodeFields(pending.nodeId, pending.fields)
      }

      // Process pending union nodes
      while (this.#pendingUnionNodes.length > 0) {
        const pending = this.#pendingUnionNodes.pop()!
        this.#processUnionNodeFields(pending.nodeId, pending.typeNames)
      }
    }
  }

  #findRootField(fieldName: string): DMMF.SchemaField | undefined {
    const queryType = this.#outputTypeMap.get('prisma.Query')
    if (queryType) {
      const field = queryType.fields.find((f) => f.name === fieldName)
      if (field) return field
    }

    const mutationType = this.#outputTypeMap.get('prisma.Mutation')
    if (mutationType) {
      const field = mutationType.fields.find((f) => f.name === fieldName)
      if (field) return field
    }

    return undefined
  }

  /**
   * Builds an input node from schema arguments.
   */
  buildInputNodeFromArgs(args: readonly DMMF.SchemaArg[]): NodeId | undefined {
    const edges: Record<number, InputEdgeData> = {}
    let hasAnyEdge = false

    for (const arg of args) {
      const edge = this.#mergeFieldVariants([arg])
      if (edge) {
        const stringIndex = this.#builder.internString(arg.name)
        edges[stringIndex] = edge
        hasAnyEdge = true
      }
    }

    if (!hasAnyEdge) {
      return undefined
    }

    const nodeId = this.#builder.allocateInputNode()
    this.#builder.setInputNodeEdges(nodeId, edges)
    return nodeId
  }

  /**
   * Builds an input node for a named input type.
   * Node allocation happens immediately, but field processing is deferred
   * to avoid deep recursion.
   */
  buildInputTypeNode(typeName: string): NodeId | undefined {
    if (this.#builder.hasInputTypeNode(typeName)) {
      return this.#builder.getInputTypeNode(typeName)
    }

    const inputType = this.#inputTypeMap.get(typeName)
    if (!inputType) {
      this.#builder.setInputTypeNode(typeName, undefined)
      return undefined
    }

    // Pre-allocate node to handle cycles
    const nodeId = this.#builder.allocateInputNode()
    this.#builder.setInputTypeNode(typeName, nodeId)

    // Queue field processing for later to avoid deep recursion
    this.#pendingInputNodes.push({ nodeId, fields: inputType.fields })

    return nodeId
  }

  /**
   * Process fields for an input node (called from drainPendingWork).
   */
  #processInputNodeFields(nodeId: NodeId, fields: readonly DMMF.SchemaArg[]): void {
    const edges: Record<number, InputEdgeData> = {}
    let hasAnyEdge = false

    for (const field of fields) {
      const edge = this.#mergeFieldVariants([field])
      if (edge) {
        const stringIndex = this.#builder.internString(field.name)
        edges[stringIndex] = edge
        hasAnyEdge = true
      }
    }

    if (hasAnyEdge) {
      this.#builder.setInputNodeEdges(nodeId, edges)
    }
  }

  /**
   * Builds a union node for multiple input types.
   * Node allocation happens immediately, but field processing is deferred
   * to avoid deep recursion.
   */
  buildUnionNode(typeNames: string[]): NodeId | undefined {
    // Sort type names for stable cache key
    const sortedNames = [...typeNames].sort()
    const cacheKey = sortedNames.join('|')

    if (this.#builder.hasUnionNode(cacheKey)) {
      return this.#builder.getUnionNode(cacheKey)
    }

    // Pre-allocate node
    const nodeId = this.#builder.allocateInputNode()
    this.#builder.setUnionNode(cacheKey, nodeId)

    // Queue field processing for later to avoid deep recursion
    this.#pendingUnionNodes.push({ nodeId, typeNames })

    return nodeId
  }

  /**
   * Process fields for a union node (called from drainPendingWork).
   */
  #processUnionNodeFields(nodeId: NodeId, typeNames: string[]): void {
    // Collect all fields from all variants
    const fieldsByName = new Map<string, DMMF.SchemaArg[]>()

    for (const typeName of typeNames) {
      const inputType = this.#inputTypeMap.get(typeName)
      if (!inputType) continue

      for (const field of inputType.fields) {
        let fieldsForName = fieldsByName.get(field.name)
        if (!fieldsForName) {
          fieldsForName = []
          fieldsByName.set(field.name, fieldsForName)
        }
        fieldsForName.push(field)
      }
    }

    // Merge fields conservatively
    const mergedEdges: Record<number, InputEdgeData> = {}
    let hasAnyEdge = false

    for (const [fieldName, variantFields] of fieldsByName) {
      const mergedEdge = this.#mergeFieldVariants(variantFields)
      if (mergedEdge) {
        const stringIndex = this.#builder.internString(fieldName)
        mergedEdges[stringIndex] = mergedEdge
        hasAnyEdge = true
      }
    }

    if (hasAnyEdge) {
      this.#builder.setInputNodeEdges(nodeId, mergedEdges)
    }
  }

  /**
   * Merges field variants to produce a single edge descriptor.
   * This is the most complex part of the traversal - it handles
   * union types and determines what kinds of values a field accepts.
   */
  #mergeFieldVariants(variants: readonly DMMF.SchemaArg[]): InputEdgeData | undefined {
    let flags = 0
    let scalarMask = 0
    let childNodeId: NodeId | undefined
    let enumNameIndex: number | undefined

    const scalarTypes: DMMF.InputTypeRef[] = []
    const enumTypes: DMMF.InputTypeRef[] = []
    const inputObjectTypes: DMMF.InputTypeRef[] = []

    for (const variant of variants) {
      for (const inputType of variant.inputTypes) {
        switch (inputType.location) {
          case 'scalar':
            if (variant.isParameterizable) {
              scalarTypes.push(inputType)
            }
            break
          case 'enumTypes':
            if (variant.isParameterizable) {
              enumTypes.push(inputType)
            }
            break
          case 'inputObjectTypes':
            if (
              !inputObjectTypes.some(
                (ot) =>
                  ot.type === inputType.type && ot.namespace === inputType.namespace && ot.isList === inputType.isList,
              )
            ) {
              inputObjectTypes.push(inputType)
            }
            break
          case 'fieldRefTypes':
            break
          default:
            throw new Error(`Invalid location ${inputType.location satisfies never}`)
        }
      }
    }

    // Process scalar types
    for (const st of scalarTypes) {
      scalarMask |= scalarTypeToMask(st.type)
      if (st.isList) {
        flags |= EdgeFlag.ParamListScalar
      } else {
        flags |= EdgeFlag.ParamScalar
      }
    }

    // Process enum types
    for (const et of enumTypes) {
      if (et.namespace === 'model') {
        // Enum names are now stored in the main string table
        enumNameIndex = this.#builder.internString(et.type)
        if (et.isList) {
          flags |= EdgeFlag.ParamListEnum
        } else {
          flags |= EdgeFlag.ParamEnum
        }
        break
      }
    }

    // Process input object types
    if (inputObjectTypes.length > 0) {
      const hasObjectList = inputObjectTypes.some((iot) => iot.isList)
      const hasSingleObject = inputObjectTypes.some((iot) => !iot.isList)

      if (hasObjectList) {
        flags |= EdgeFlag.ListObject
      }
      if (hasSingleObject) {
        flags |= EdgeFlag.Object
      }

      if (inputObjectTypes.length === 1) {
        childNodeId = this.buildInputTypeNode(getTypeName(inputObjectTypes[0].type, inputObjectTypes[0].namespace))
      } else {
        childNodeId = this.buildUnionNode(inputObjectTypes.map((iot) => getTypeName(iot.type, iot.namespace)))
      }
    }

    // If no flags are set, this field is not parameterizable
    if (flags === 0) {
      return undefined
    }

    const edge: InputEdgeData = { flags }
    if (childNodeId !== undefined) {
      edge.childNodeId = childNodeId
    }
    if (scalarMask !== 0) {
      edge.scalarMask = scalarMask
    }
    if (enumNameIndex !== undefined) {
      edge.enumNameIndex = enumNameIndex
    }

    return edge
  }

  /**
   * Builds an output node for a named output type.
   */
  buildOutputTypeNode(typeName: string): NodeId | undefined {
    if (this.#builder.hasOutputTypeNode(typeName)) {
      return this.#builder.getOutputTypeNode(typeName)
    }

    const outputType = this.#outputTypeMap.get(typeName)
    if (!outputType) {
      this.#builder.setOutputTypeNode(typeName, undefined)
      return undefined
    }

    // Pre-allocate to handle cycles
    const nodeId = this.#builder.allocateOutputNode()
    this.#builder.setOutputTypeNode(typeName, nodeId)

    const edges: Record<number, OutputEdgeData> = {}
    let hasAnyEdge = false

    for (const field of outputType.fields) {
      const edge = this.#buildOutputEdge(field)
      if (edge) {
        const stringIndex = this.#builder.internString(field.name)
        edges[stringIndex] = edge
        hasAnyEdge = true
      }
    }

    if (hasAnyEdge) {
      this.#builder.setOutputNodeEdges(nodeId, edges)
    }

    return nodeId
  }

  #buildOutputEdge(field: DMMF.SchemaField): OutputEdgeData | undefined {
    let argsNodeId: NodeId | undefined
    let outputNodeId: NodeId | undefined

    if (field.args.length > 0) {
      argsNodeId = this.buildInputNodeFromArgs(field.args)
    }

    if (field.outputType.location === 'outputObjectTypes') {
      outputNodeId = this.buildOutputTypeNode(getTypeName(field.outputType.type, field.outputType.namespace))
    }

    if (argsNodeId === undefined && outputNodeId === undefined) {
      return undefined
    }

    const edge: OutputEdgeData = {}
    if (argsNodeId !== undefined) {
      edge.argsNodeId = argsNodeId
    }
    if (outputNodeId !== undefined) {
      edge.outputNodeId = outputNodeId
    }

    return edge
  }
}

function getTypeName(name: string, namespace: string | undefined): string {
  if (namespace === undefined) {
    return name
  }
  return `${namespace}.${name}`
}
