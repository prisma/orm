import { dataPathToGetPath } from './RequestHandler'

describe('dataPathToGetPath', () => {
  test('returns the relation field names from a fluent dataPath', () => {
    expect(dataPathToGetPath(['select', 'posts'])).toEqual(['posts'])
    expect(dataPathToGetPath(['select', 'posts', 'include', 'comments'])).toEqual(['posts', 'comments'])
  })

  test('keeps a relation field named "select" or "include"', () => {
    expect(dataPathToGetPath(['select', 'select'])).toEqual(['select'])
    expect(dataPathToGetPath(['select', 'include'])).toEqual(['include'])
    expect(dataPathToGetPath(['select', 'posts', 'select', 'select'])).toEqual(['posts', 'select'])
  })

  test('returns an empty path for the root result', () => {
    expect(dataPathToGetPath([])).toEqual([])
  })
})
