import { isAllRawBatch } from './is-all-raw-batch'

describe('isAllRawBatch', () => {
  it('is true for an empty batch', () => {
    expect(isAllRawBatch([])).toBe(true)
  })

  it('is true when every item is raw', () => {
    expect(isAllRawBatch([{ action: 'executeRaw' }, { action: 'queryRaw' }])).toBe(true)
  })

  it('is false when a raw item is followed by a model query', () => {
    expect(isAllRawBatch([{ action: 'executeRaw' }, { action: 'updateMany', modelName: 'Item' }])).toBe(false)
  })

  it('is false when a model query is first', () => {
    expect(isAllRawBatch([{ action: 'updateMany', modelName: 'Item' }, { action: 'executeRaw' }])).toBe(false)
  })
})
