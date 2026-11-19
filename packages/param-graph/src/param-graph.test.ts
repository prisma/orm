import { afterEach, describe, expect, test, vi } from 'vitest'

import { EdgeFlag, ParamGraph, ScalarMask } from './param-graph'
import * as serialization from './serialization'
import type { ParamGraphData } from './types'

function createData(fieldName = 'status'): ParamGraphData {
  return {
    strings: ['Item.findMany', 'where', fieldName, 'Status', 'id'],
    inputNodes: [
      { edges: { 1: { flags: EdgeFlag.Object, childNodeId: 1 } } },
      {
        edges: {
          2: { flags: EdgeFlag.ParamEnum, enumNameIndex: 3 },
          4: { flags: EdgeFlag.ParamScalar, scalarMask: ScalarMask.String },
        },
      },
    ],
    outputNodes: [{ edges: { 2: {}, 4: {} } }],
    roots: { 'Item.findMany': { argsNodeId: 0, outputNodeId: 0 } },
  }
}

describe('ParamGraph.deserialize', () => {
  afterEach(() => {
    vi.restoreAllMocks()
  })

  test('decodes the same serialized schema only once while creating separate wrappers', () => {
    const serialized = serialization.serializeParamGraph(createData())
    const decode = vi.spyOn(serialization, 'deserializeParamGraph')
    const first = ParamGraph.deserialize(serialized, () => undefined)
    const second = ParamGraph.deserialize(serialized, () => undefined)

    expect(decode).toHaveBeenCalledTimes(1)
    expect(first).not.toBe(second)
    expect(second.root('Item.findMany')).toEqual({ argsNodeId: 0, outputNodeId: 0 })
    expect(second.inputEdge(second.inputNode(1), 'id')).toEqual({
      flags: EdgeFlag.ParamScalar,
      childNodeId: undefined,
      scalarMask: ScalarMask.String,
      enumNameIndex: undefined,
    })
  })

  test('keys decoded schemas by object identity, even when their contents match', () => {
    const serialized = serialization.serializeParamGraph(createData())
    const copy = { ...serialized }
    const decode = vi.spyOn(serialization, 'deserializeParamGraph')

    ParamGraph.deserialize(serialized, () => undefined)
    ParamGraph.deserialize(copy, () => undefined)
    ParamGraph.deserialize(serialized, () => undefined)
    ParamGraph.deserialize(copy, () => undefined)

    expect(decode).toHaveBeenCalledTimes(2)
  })

  test('does not mix different schemas with the same node and field indices', () => {
    const firstSchema = serialization.serializeParamGraph(createData('status'))
    const secondSchema = serialization.serializeParamGraph(createData('state'))
    ParamGraph.deserialize(firstSchema, () => undefined)
    ParamGraph.deserialize(secondSchema, () => undefined)

    const first = ParamGraph.deserialize(firstSchema, () => undefined)
    const second = ParamGraph.deserialize(secondSchema, () => undefined)

    expect(first.inputEdge(first.inputNode(1), 'status')?.enumNameIndex).toBe(3)
    expect(first.inputEdge(first.inputNode(1), 'state')).toBeUndefined()
    expect(second.inputEdge(second.inputNode(1), 'state')?.enumNameIndex).toBe(3)
    expect(second.inputEdge(second.inputNode(1), 'status')).toBeUndefined()
  })

  test('keeps enum value mappings local to each wrapper', () => {
    const serialized = serialization.serializeParamGraph(createData())
    const firstValues = { ACTIVE: 'active' }
    const secondValues = { ACTIVE: 'enabled' }
    const firstLookup = vi.fn(() => firstValues)
    const secondLookup = vi.fn(() => secondValues)
    const first = ParamGraph.deserialize(serialized, firstLookup)
    const second = ParamGraph.deserialize(serialized, secondLookup)

    expect(first.enumValues(first.inputEdge(first.inputNode(1), 'status'))).toBe(firstValues)
    expect(second.enumValues(second.inputEdge(second.inputNode(1), 'status'))).toBe(secondValues)
    expect(firstLookup).toHaveBeenCalledExactlyOnceWith('Status')
    expect(secondLookup).toHaveBeenCalledExactlyOnceWith('Status')
  })

  test('does not share missing enum lookups with subsequent wrappers', () => {
    const serialized = serialization.serializeParamGraph(createData())
    const first = ParamGraph.deserialize(serialized, () => undefined)
    const values = { ACTIVE: 'active' }
    const second = ParamGraph.deserialize(serialized, () => values)

    expect(first.enumValues(first.inputEdge(first.inputNode(1), 'status'))).toBeUndefined()
    expect(second.enumValues(second.inputEdge(second.inputNode(1), 'status'))).toBe(values)
  })

  test('does not expose shared data through returned root and edge views', () => {
    const serialized = serialization.serializeParamGraph(createData())
    const first = ParamGraph.deserialize(serialized, () => undefined)
    const root = first.root('Item.findMany')!
    const input = first.inputEdge(first.inputNode(1), 'status')!
    const output = first.outputEdge(first.outputNode(0), 'id')!
    Object.assign(root, { argsNodeId: 99 })
    Object.assign(input, { flags: 0, enumNameIndex: 99 })
    Object.assign(output, { argsNodeId: 99, outputNodeId: 99 })

    const second = ParamGraph.deserialize(serialized, () => undefined)

    expect(first.root('Item.findMany')?.argsNodeId).toBe(0)
    expect(second.root('Item.findMany')?.argsNodeId).toBe(0)
    expect(second.inputEdge(second.inputNode(1), 'status')?.flags).toBe(EdgeFlag.ParamEnum)
    expect(second.inputEdge(second.inputNode(1), 'status')?.enumNameIndex).toBe(3)
    expect(second.outputEdge(second.outputNode(0), 'id')).toEqual({
      argsNodeId: undefined,
      outputNodeId: undefined,
    })
  })

  test('does not cache failed decodes', () => {
    const serialized = { strings: [], graph: '' }
    const decode = vi.spyOn(serialization, 'deserializeParamGraph')

    expect(() => ParamGraph.deserialize(serialized, () => undefined)).toThrow()
    expect(() => ParamGraph.deserialize(serialized, () => undefined)).toThrow()
    expect(decode).toHaveBeenCalledTimes(2)
  })

  test('can retry a failed decode after the serialized graph is repaired', () => {
    const serialized = { strings: [], graph: '' }
    expect(() => ParamGraph.deserialize(serialized, () => undefined)).toThrow()
    Object.assign(serialized, serialization.serializeParamGraph(createData()))

    const graph = ParamGraph.deserialize(serialized, () => undefined)

    expect(graph.root('Item.findMany')).toEqual({ argsNodeId: 0, outputNodeId: 0 })
    expect(graph.getString(3)).toBe('Status')
  })
})
