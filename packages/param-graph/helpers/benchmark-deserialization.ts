import assert from 'node:assert/strict'
import { performance } from 'node:perf_hooks'

import { EdgeFlag, ParamGraph, ScalarMask } from '../src/param-graph'
import { serializeParamGraph } from '../src/serialization'
import type { ParamGraphData } from '../src/types'

const instances = Number(process.argv[2] ?? 32)
const nodes = Number(process.argv[3] ?? 4096)
assert(Number.isSafeInteger(instances) && instances > 1, 'instances must be an integer greater than 1')
assert(Number.isSafeInteger(nodes) && nodes > 0, 'nodes must be a positive integer')
assert(global.gc, 'Run with node --expose-gc --import tsx')

const fields = 16
const strings = Array.from({ length: fields }, (_, index) => `field${index}`)
const data: ParamGraphData = {
  strings,
  inputNodes: Array.from({ length: nodes }, () => ({
    edges: Object.fromEntries(
      strings.map((_, index) => [index, { flags: EdgeFlag.ParamScalar, scalarMask: ScalarMask.String }]),
    ),
  })),
  outputNodes: Array.from({ length: nodes }, () => ({
    edges: Object.fromEntries(strings.map((_, index) => [index, {}])),
  })),
  roots: { field0: { argsNodeId: 0, outputNodeId: 0 } },
}
const serialized = serializeParamGraph(data)
const graphs: ParamGraph[] = []
const firstStart = performance.now()
graphs.push(ParamGraph.deserialize(serialized, () => undefined))
const firstMs = performance.now() - firstStart
global.gc()
const heapAfterFirst = process.memoryUsage().heapUsed

const repeatedStart = performance.now()
for (let index = 1; index < instances; index++) {
  graphs.push(ParamGraph.deserialize(serialized, () => undefined))
}
const repeatedMs = performance.now() - repeatedStart
global.gc()
const additionalHeapBytes = process.memoryUsage().heapUsed - heapAfterFirst

for (const graph of graphs) {
  assert.equal(graph.inputEdge(graph.inputNode(nodes - 1), 'field15')?.scalarMask, ScalarMask.String)
  assert.deepEqual(graph.outputEdge(graph.outputNode(nodes - 1), 'field15'), {
    argsNodeId: undefined,
    outputNodeId: undefined,
  })
}

console.log(
  JSON.stringify({
    instances: graphs.length,
    inputNodes: nodes,
    outputNodes: nodes,
    fieldsPerNode: fields,
    serializedBytes: Buffer.byteLength(serialized.graph),
    firstMs,
    repeatedMs,
    additionalHeapBytes,
  }),
)
