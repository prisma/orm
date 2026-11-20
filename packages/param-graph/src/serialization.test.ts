import { describe, expect, test } from 'vitest'

import { deserializeParamGraph, serializeParamGraph } from './serialization'
import type { ParamGraphData } from './types'

describe('param-graph serialization', () => {
  test('roundtrip with empty data', () => {
    const data: ParamGraphData = {
      strings: ['root1'],
      inputNodes: [],
      outputNodes: [],
      roots: { root1: {} },
    }

    const serialized = serializeParamGraph(data)
    const deserialized = deserializeParamGraph(serialized)

    expect(deserialized.strings).toEqual(data.strings)
    expect(deserialized.inputNodes).toEqual(data.inputNodes)
    expect(deserialized.outputNodes).toEqual(data.outputNodes)
    expect(deserialized.roots).toEqual(data.roots)
  })

  test('roundtrip with small data', () => {
    const data: ParamGraphData = {
      strings: ['findMany', 'where', 'id'],
      inputNodes: [{ edges: { 1: { flags: 0, scalarMask: 1 } } }],
      outputNodes: [{ edges: { 2: { argsNodeId: 0 } } }],
      roots: { findMany: { argsNodeId: 0, outputNodeId: 0 } },
    }

    const serialized = serializeParamGraph(data)
    const deserialized = deserializeParamGraph(serialized)

    expect(deserialized.strings).toEqual(data.strings)
    expect(deserialized.inputNodes.length).toBe(data.inputNodes.length)
    expect(deserialized.outputNodes.length).toBe(data.outputNodes.length)
    expect(Object.keys(deserialized.roots)).toEqual(Object.keys(data.roots))
  })

  test('roundtrip with multiple nodes and edges', () => {
    const data: ParamGraphData = {
      strings: ['findMany', 'create', 'update', 'where', 'data', 'id', 'name', 'Status'],
      inputNodes: [
        { edges: { 3: { flags: 1, scalarMask: 1, childNodeId: 1 }, 4: { flags: 0, scalarMask: 2 } } },
        { edges: { 5: { flags: 2, enumNameIndex: 7 } } },
      ],
      outputNodes: [{ edges: { 6: { argsNodeId: 0, outputNodeId: 1 } } }, { edges: {} }],
      roots: {
        findMany: { argsNodeId: 0, outputNodeId: 0 },
        create: { argsNodeId: 1, outputNodeId: 1 },
        update: { argsNodeId: 0 },
      },
    }

    const serialized = serializeParamGraph(data)
    const deserialized = deserializeParamGraph(serialized)

    expect(deserialized.inputNodes.length).toBe(2)
    expect(deserialized.outputNodes.length).toBe(2)
    expect(Object.keys(deserialized.roots).length).toBe(3)

    // Verify edge data is preserved
    const inputEdge = deserialized.inputNodes[0].edges[3]
    expect(inputEdge.flags).toBe(1)
    expect(inputEdge.scalarMask).toBe(1)
    expect(inputEdge.childNodeId).toBe(1)

    const enumEdge = deserialized.inputNodes[1].edges[5]
    expect(enumEdge.flags).toBe(2)
    expect(enumEdge.enumNameIndex).toBe(7)
  })

  test('handles undefined values correctly', () => {
    const data: ParamGraphData = {
      strings: ['root'],
      inputNodes: [{ edges: { 0: { flags: 0 } } }],
      outputNodes: [{ edges: { 0: {} } }],
      roots: { root: { argsNodeId: 0 } },
    }

    const serialized = serializeParamGraph(data)
    const deserialized = deserializeParamGraph(serialized)

    // Undefined values should not be present in deserialized data
    expect(deserialized.inputNodes[0].edges[0].childNodeId).toBeUndefined()
    expect(deserialized.inputNodes[0].edges[0].scalarMask).toBeUndefined()
    expect(deserialized.inputNodes[0].edges[0].enumNameIndex).toBeUndefined()
    expect(deserialized.outputNodes[0].edges[0].argsNodeId).toBeUndefined()
    expect(deserialized.outputNodes[0].edges[0].outputNodeId).toBeUndefined()
    expect(deserialized.roots['root'].outputNodeId).toBeUndefined()
  })

  test('base64url encoding produces URL-safe output', () => {
    const data: ParamGraphData = {
      strings: ['test'],
      inputNodes: [{ edges: { 255: { flags: 255, scalarMask: 65535, childNodeId: 0, enumNameIndex: 0 } } }],
      outputNodes: [],
      roots: { test: { argsNodeId: 0 } },
    }

    const serialized = serializeParamGraph(data)

    // Should only contain URL-safe characters
    expect(serialized.graph).toMatch(/^[A-Za-z0-9_-]+$/)
  })

  test('handles large indices requiring multi-byte varints (128-16383)', () => {
    // Generate enough strings to require 2-byte varints (>127)
    const strings = Array.from({ length: 200 }, (_, i) => `field${i}`)
    const data: ParamGraphData = {
      strings,
      inputNodes: [
        {
          edges: {
            // Use indices that require 2-byte encoding (128+)
            128: { flags: 1, childNodeId: 150 },
            150: { flags: 2, enumNameIndex: 180 },
          },
        },
      ],
      outputNodes: [{ edges: { 199: { argsNodeId: 0, outputNodeId: 0 } } }],
      roots: { field0: { argsNodeId: 0, outputNodeId: 0 } },
    }

    const serialized = serializeParamGraph(data)
    const deserialized = deserializeParamGraph(serialized)

    expect(deserialized.inputNodes[0].edges[128].flags).toBe(1)
    expect(deserialized.inputNodes[0].edges[128].childNodeId).toBe(150)
    expect(deserialized.inputNodes[0].edges[150].flags).toBe(2)
    expect(deserialized.inputNodes[0].edges[150].enumNameIndex).toBe(180)
    expect(deserialized.outputNodes[0].edges[199].argsNodeId).toBe(0)
    expect(deserialized.outputNodes[0].edges[199].outputNodeId).toBe(0)
  })

  test('handles very large indices requiring 3-byte varints (16384+)', () => {
    // Generate enough strings to require 3-byte varints (>16383)
    const strings = Array.from({ length: 17000 }, (_, i) => `f${i}`)
    const data: ParamGraphData = {
      strings,
      inputNodes: [
        {
          edges: {
            16384: { flags: 1, childNodeId: 16500 },
          },
        },
      ],
      outputNodes: [{ edges: { 16999: { argsNodeId: 0, outputNodeId: 0 } } }],
      roots: { f0: { argsNodeId: 0, outputNodeId: 0 } },
    }

    const serialized = serializeParamGraph(data)
    const deserialized = deserializeParamGraph(serialized)

    expect(deserialized.inputNodes[0].edges[16384].flags).toBe(1)
    expect(deserialized.inputNodes[0].edges[16384].childNodeId).toBe(16500)
    expect(deserialized.outputNodes[0].edges[16999].argsNodeId).toBe(0)
  })

  test('varint boundary values encode and decode correctly', () => {
    // Test values at varint encoding boundaries
    const boundaryValues = [0, 1, 127, 128, 16383, 16384]

    for (const value of boundaryValues) {
      // Create strings to make the index value valid
      const strings = Array.from({ length: Math.max(value + 1, 2) }, (_, i) => `s${i}`)

      const data: ParamGraphData = {
        strings,
        inputNodes: [{ edges: { [value]: { flags: 0 } } }],
        outputNodes: [],
        roots: { s0: {} },
      }

      const serialized = serializeParamGraph(data)
      const deserialized = deserializeParamGraph(serialized)

      expect(deserialized.inputNodes[0].edges[value]).toBeDefined()
      expect(deserialized.inputNodes[0].edges[value].flags).toBe(0)
    }
  })

  test('optional value 0 is correctly distinguished from undefined', () => {
    const data: ParamGraphData = {
      strings: ['root', 'field'],
      inputNodes: [
        { edges: { 1: { flags: 0, childNodeId: 0 } } }, // childNodeId = 0 (not undefined)
      ],
      outputNodes: [
        { edges: { 1: { argsNodeId: 0, outputNodeId: 0 } } }, // both are 0 (not undefined)
      ],
      roots: { root: { argsNodeId: 0, outputNodeId: 0 } }, // both are 0 (not undefined)
    }

    const serialized = serializeParamGraph(data)
    const deserialized = deserializeParamGraph(serialized)

    // Value 0 should be preserved, not converted to undefined
    expect(deserialized.inputNodes[0].edges[1].childNodeId).toBe(0)
    expect(deserialized.outputNodes[0].edges[1].argsNodeId).toBe(0)
    expect(deserialized.outputNodes[0].edges[1].outputNodeId).toBe(0)
    expect(deserialized.roots['root'].argsNodeId).toBe(0)
    expect(deserialized.roots['root'].outputNodeId).toBe(0)
  })
})
