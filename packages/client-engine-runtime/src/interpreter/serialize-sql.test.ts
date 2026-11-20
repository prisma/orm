import { ColumnTypeEnum } from '@prisma/driver-adapter-utils'
import { expect, test } from 'vitest'

import { serializeSql } from './serialize-sql'

test('should serialize empty rows', () => {
  const result = serializeSql({
    columnTypes: [ColumnTypeEnum.Int32, ColumnTypeEnum.Text],
    columnNames: ['id', 'name'],
    rows: [],
  })
  expect(result).toEqual([])
})

test('should serialize a flat list of rows', () => {
  const result = serializeSql({
    columnTypes: [ColumnTypeEnum.Int32, ColumnTypeEnum.Text],
    columnNames: ['id', 'name'],
    rows: [
      [1, 'Alice'],
      [2, 'Bob'],
    ],
  })
  expect(result).toEqual([
    { id: 1, name: 'Alice' },
    { id: 2, name: 'Bob' },
  ])
})
