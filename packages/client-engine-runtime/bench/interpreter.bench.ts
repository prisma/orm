/**
 * Query Interpreter Benchmarks
 *
 * Measures the raw overhead of the query interpreter
 * using a mock driver adapter that returns pre-defined results.
 */
import { withCodSpeed } from '@codspeed/benchmark.js-plugin'
import Benchmark from 'benchmark'

import { QueryInterpreter } from '../src/interpreter/query-interpreter'
import { createConfiguredMockAdapter, createInterpreterOptions, deferredBench, runSuite } from './bench-utils'
import { DEEP_JOIN_PLAN, FIND_UNIQUE_PLAN, JOIN_PLAN, SEQUENCE_PLAN, SIMPLE_SELECT_PLAN } from './sample-query-plans'

async function runBenchmarks(): Promise<void> {
  const mockAdapter = createConfiguredMockAdapter()
  const interpreterOptions = createInterpreterOptions()
  const runtimeOptions = {
    queryable: mockAdapter,
    scope: {},
    transactionManager: { enabled: false },
  } as const

  const suite = withCodSpeed(new Benchmark.Suite('query-interpreter'))

  suite.add(
    'interpreter: simple select',
    deferredBench(async () => {
      const interpreter = QueryInterpreter.forSql(interpreterOptions)
      await interpreter.run(SIMPLE_SELECT_PLAN, runtimeOptions)
    }),
  )

  suite.add(
    'interpreter: findUnique',
    deferredBench(async () => {
      const interpreter = QueryInterpreter.forSql(interpreterOptions)
      await interpreter.run(FIND_UNIQUE_PLAN, runtimeOptions)
    }),
  )

  suite.add(
    'interpreter: join (1:N)',
    deferredBench(async () => {
      const interpreter = QueryInterpreter.forSql(interpreterOptions)
      await interpreter.run(JOIN_PLAN, runtimeOptions)
    }),
  )

  suite.add(
    'interpreter: sequence',
    deferredBench(async () => {
      const interpreter = QueryInterpreter.forSql(interpreterOptions)
      await interpreter.run(SEQUENCE_PLAN, runtimeOptions)
    }),
  )

  suite.add(
    'interpreter: deep nested join',
    deferredBench(async () => {
      const interpreter = QueryInterpreter.forSql(interpreterOptions)
      await interpreter.run(DEEP_JOIN_PLAN, runtimeOptions)
    }),
  )

  await runSuite(suite)
}

void runBenchmarks()
