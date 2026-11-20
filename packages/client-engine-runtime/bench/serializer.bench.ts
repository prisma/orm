import { withCodSpeed } from '@codspeed/benchmark.js-plugin'
import type { SqlResultSet } from '@prisma/driver-adapter-utils'
import Benchmark from 'benchmark'

import { serializeSql } from '../src/interpreter/serialize-sql'
import { runSuite, syncBench } from './bench-utils'
import { generateUserRows } from './mock-data'

async function runBenchmarks(): Promise<void> {
  const smallResultSet: SqlResultSet = {
    columnNames: ['id', 'email', 'name'],
    columnTypes: [0, 1, 1],
    rows: generateUserRows(10).map((u) => [u.id, u.email, u.name]),
  }

  const mediumResultSet: SqlResultSet = {
    columnNames: ['id', 'email', 'name', 'bio', 'avatar', 'isActive', 'role', 'createdAt'],
    columnTypes: [0, 1, 1, 1, 1, 2, 1, 1],
    rows: generateUserRows(50).map((u) => [
      u.id,
      u.email,
      u.name,
      u.bio,
      u.avatar,
      u.isActive ? 1 : 0,
      u.role,
      u.createdAt,
    ]),
  }

  const largeResultSet: SqlResultSet = {
    columnNames: ['id', 'email', 'name', 'bio', 'avatar', 'isActive', 'role', 'createdAt'],
    columnTypes: [0, 1, 1, 1, 1, 2, 1, 1],
    rows: generateUserRows(100).map((u) => [
      u.id,
      u.email,
      u.name,
      u.bio,
      u.avatar,
      u.isActive ? 1 : 0,
      u.role,
      u.createdAt,
    ]),
  }

  const suite = withCodSpeed(new Benchmark.Suite('serializer'))

  suite.add(
    'serializer: 10 rows x 3 cols',
    syncBench(() => {
      serializeSql(smallResultSet)
    }),
  )

  suite.add(
    'serializer: 50 rows x 8 cols',
    syncBench(() => {
      serializeSql(mediumResultSet)
    }),
  )

  suite.add(
    'serializer: 100 rows x 8 cols',
    syncBench(() => {
      serializeSql(largeResultSet)
    }),
  )

  await runSuite(suite)
}

void runBenchmarks()
