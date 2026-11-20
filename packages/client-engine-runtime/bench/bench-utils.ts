import Benchmark from 'benchmark'

import type { QueryInterpreterOptions } from '../src/interpreter/query-interpreter'
import { serializeSql } from '../src/interpreter/serialize-sql'
import { MockDriverAdapter, mockTracingHelper } from './mock-adapter'
import { generateUserRows } from './mock-data'

export function deferredBench(fn: () => Promise<void>): Benchmark.Options {
  return {
    defer: true,
    fn: function (deferred: Benchmark.Deferred) {
      fn()
        .then(() => deferred.resolve())
        .catch((err) => {
          console.error('Benchmark error:', err)
          process.exit(1)
        })
    },
  }
}

export function syncBench(fn: () => void): Benchmark.Options {
  return { fn }
}

export function createConfiguredMockAdapter(): MockDriverAdapter {
  const mockAdapter = new MockDriverAdapter()

  mockAdapter.setQueryResult('SELECT id, email, name FROM User LIMIT 10', {
    columnNames: ['id', 'email', 'name'],
    columnTypes: [0, 1, 1],
    rows: generateUserRows(10).map((u) => [u.id, u.email, u.name]),
  })

  mockAdapter.setQueryResult('SELECT id, email, name, bio, avatar, isActive, role, createdAt FROM User WHERE id', {
    columnNames: ['id', 'email', 'name', 'bio', 'avatar', 'isActive', 'role', 'createdAt'],
    columnTypes: [0, 1, 1, 1, 1, 2, 1, 1],
    rows: [
      [1, 'user1@example.com', 'User 1', 'Bio text', 'https://example.com/1.jpg', 1, 'user', '2024-01-15T12:00:00Z'],
    ],
  })

  mockAdapter.setQueryResult('SELECT id, email, name FROM User WHERE id = ?', {
    columnNames: ['id', 'email', 'name'],
    columnTypes: [0, 1, 1],
    rows: [[1, 'user1@example.com', 'User 1']],
  })

  mockAdapter.setQueryResult('SELECT id, title, content, authorId FROM Post WHERE authorId', {
    columnNames: ['id', 'title', 'content', 'authorId'],
    columnTypes: [0, 1, 1, 0],
    rows: [
      [1, 'Post 1', 'Content of post 1', 1],
      [2, 'Post 2', 'Content of post 2', 1],
      [3, 'Post 3', 'Content of post 3', 1],
    ],
  })

  mockAdapter.setQueryResult('SELECT id, name FROM User WHERE id', {
    columnNames: ['id', 'name'],
    columnTypes: [0, 1],
    rows: [[1, 'Updated Name']],
  })

  mockAdapter.setQueryResult('SELECT id, email, name FROM User LIMIT 5', {
    columnNames: ['id', 'email', 'name'],
    columnTypes: [0, 1, 1],
    rows: [
      [1, 'user1@example.com', 'User 1'],
      [2, 'user2@example.com', 'User 2'],
      [3, 'user3@example.com', 'User 3'],
      [4, 'user4@example.com', 'User 4'],
      [5, 'user5@example.com', 'User 5'],
    ],
  })

  mockAdapter.setQueryResult('SELECT id, userId, firstName, lastName FROM Profile', {
    columnNames: ['id', 'userId', 'firstName', 'lastName'],
    columnTypes: [0, 0, 1, 1],
    rows: [
      [1, 1, 'First1', 'Last1'],
      [2, 2, 'First2', 'Last2'],
      [3, 3, 'First3', 'Last3'],
      [4, 4, 'First4', 'Last4'],
      [5, 5, 'First5', 'Last5'],
    ],
  })

  mockAdapter.setQueryResult('SELECT id, title, authorId FROM Post WHERE authorId IN', {
    columnNames: ['id', 'title', 'authorId'],
    columnTypes: [0, 1, 0],
    rows: [
      [1, 'Post 1', 1],
      [2, 'Post 2', 1],
      [3, 'Post 3', 2],
      [4, 'Post 4', 2],
      [5, 'Post 5', 3],
      [6, 'Post 6', 3],
      [7, 'Post 7', 4],
      [8, 'Post 8', 4],
      [9, 'Post 9', 5],
      [10, 'Post 10', 5],
    ],
  })

  mockAdapter.setQueryResult('SELECT id, content, postId, authorId FROM Comment', {
    columnNames: ['id', 'content', 'postId', 'authorId'],
    columnTypes: [0, 1, 0, 0],
    rows: Array.from({ length: 30 }, (_, i) => [i + 1, `Comment ${i + 1} content`, (i % 10) + 1, (i % 5) + 1]),
  })

  mockAdapter.setDefaultResult({
    columnNames: [],
    columnTypes: [],
    rows: [],
  })

  return mockAdapter
}

export function createInterpreterOptions(): QueryInterpreterOptions {
  return {
    tracingHelper: mockTracingHelper,
    serializer: serializeSql,
    provider: 'sqlite',
    connectionInfo: { supportsRelationJoins: false },
  }
}

interface RunnableSuite {
  on(type: string, callback: (event: Benchmark.Event) => void): this
  run(options?: { async?: boolean }): unknown
}

export function runSuite(suite: RunnableSuite): Promise<void> {
  return new Promise<void>((resolve) => {
    void suite
      .on('cycle', (event: Benchmark.Event) => {
        console.log(String(event.target))
      })
      .on('complete', () => {
        resolve()
      })
      .on('error', (event: Benchmark.Event) => {
        console.error('Benchmark error:', event.target)
      })
      .run({ async: true })
  })
}
