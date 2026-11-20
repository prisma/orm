import type { RuntimeDataModel } from '@prisma/client-common'

import { modelNameForTable } from './modelNameForTable'

type TestModel = { dbName?: string | null; schema?: string | null }

function runtimeDataModel(models: Record<string, TestModel>): RuntimeDataModel {
  const builtModels = Object.fromEntries(
    Object.entries(models).map(([name, { dbName = null, schema = null }]) => [name, { dbName, schema, fields: [] }]),
  )
  return { models: builtModels, enums: {}, types: {} } as unknown as RuntimeDataModel
}

describe('modelNameForTable', () => {
  test('resolves an unmapped model by its bare table name', () => {
    const dataModel = runtimeDataModel({ User: {} })
    expect(modelNameForTable(dataModel, 'User')).toBe('User')
  })

  test('resolves a @@map-ped model to its Prisma model name', () => {
    const dataModel = runtimeDataModel({ AppMajorVersion: { dbName: 'app_major_versions' } })
    expect(modelNameForTable(dataModel, 'app_major_versions')).toBe('AppMajorVersion')
  })

  test('ignores the schema qualifier of the reported table when the match is unambiguous', () => {
    const dataModel = runtimeDataModel({ User: { dbName: 'users', schema: 'public' } })
    expect(modelNameForTable(dataModel, 'public.users')).toBe('User')
  })

  test('disambiguates models sharing a table name across schemas by the reported schema', () => {
    const dataModel = runtimeDataModel({
      User: { dbName: 'some_table', schema: 'base' },
      Post: { dbName: 'some_table', schema: 'transactional' },
    })
    expect(modelNameForTable(dataModel, 'base.some_table')).toBe('User')
    expect(modelNameForTable(dataModel, 'transactional.some_table')).toBe('Post')
  })

  test('returns undefined when a shared table name cannot be disambiguated', () => {
    const dataModel = runtimeDataModel({
      User: { dbName: 'some_table', schema: 'base' },
      Post: { dbName: 'some_table', schema: 'transactional' },
    })
    // Bare table name (no schema reported) -> ambiguous -> caller falls back.
    expect(modelNameForTable(dataModel, 'some_table')).toBeUndefined()
    // Reported schema matches no model.
    expect(modelNameForTable(dataModel, 'other.some_table')).toBeUndefined()
  })

  test('returns undefined when no model maps to the reported table', () => {
    const dataModel = runtimeDataModel({ User: { dbName: 'users' } })
    expect(modelNameForTable(dataModel, 'unknown_table')).toBeUndefined()
  })
})
