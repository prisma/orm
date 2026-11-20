import { PrismaClientKnownRequestError } from '@prisma/client-runtime-utils'

import { waitForBatch } from './waitForBatch'

test('resolves when all promises successfully resolve', async () => {
  const result = await waitForBatch([Promise.resolve(1), Promise.resolve(2), Promise.resolve(3)])

  expect(result).toEqual([1, 2, 3])
})

test('works with empty array', async () => {
  const result = await waitForBatch([])

  expect(result).toEqual([])
})

test('returns results in order even if they resolve out of order', async () => {
  const result = await waitForBatch([
    Promise.resolve(1),
    new Promise((resolve) => setTimeout(() => resolve(2), 200)),
    Promise.resolve(3),
  ])

  expect(result).toEqual([1, 2, 3])
})

test('rejects with error, which batchRequestIdx matches its position in batch', async () => {
  const err1 = new PrismaClientKnownRequestError('one', { code: 'P1', clientVersion: '0.0.0', batchRequestIdx: 2 })
  const err2 = new PrismaClientKnownRequestError('two', { code: 'P1', clientVersion: '0.0.0', batchRequestIdx: 1 })
  const err3 = new PrismaClientKnownRequestError('three', { code: 'P1', clientVersion: '0.0.0', batchRequestIdx: 0 })
  const result = waitForBatch([Promise.reject(err1), Promise.reject(err2), Promise.reject(err3)])

  await expect(result).rejects.toBe(err2)
})

test('rejects with error, which batchRequestIdx matches its position in batch, even if it rejects later', async () => {
  const err1 = new PrismaClientKnownRequestError('one', { code: 'P1', clientVersion: '0.0.0', batchRequestIdx: 2 })
  const err2 = new PrismaClientKnownRequestError('two', { code: 'P1', clientVersion: '0.0.0', batchRequestIdx: 1 })
  const err3 = new PrismaClientKnownRequestError('three', { code: 'P1', clientVersion: '0.0.0', batchRequestIdx: 0 })
  const result = waitForBatch([
    Promise.reject(err1),
    new Promise((_, reject) => setTimeout(() => reject(err2), 200)),
    Promise.reject(err3),
  ])

  await expect(result).rejects.toBe(err2)
})

test('rejects with the first error if no batchRequestIdxes match position', async () => {
  const err1 = new PrismaClientKnownRequestError('one', { code: 'P1', clientVersion: '0.0.0', batchRequestIdx: 1 })
  const err2 = new PrismaClientKnownRequestError('two', { code: 'P1', clientVersion: '0.0.0', batchRequestIdx: 2 })
  const err3 = new PrismaClientKnownRequestError('three', { code: 'P1', clientVersion: '0.0.0', batchRequestIdx: 0 })
  const result = waitForBatch([
    Promise.reject(err1),
    new Promise((_, reject) => setTimeout(() => reject(err2), 200)),
    Promise.reject(err3),
  ])

  await expect(result).rejects.toBe(err1)
})

test('rejects with error if one of the promises rejects with non-batch error', async () => {
  const error = new Error('nope')
  const result = waitForBatch([Promise.resolve(1), Promise.reject(error), Promise.resolve(3)])

  await expect(result).rejects.toBe(error)
})

test('rejects with error if one of the promises rejects with non-batch error, even if other promises never resolve', async () => {
  const error = new Error('nope')
  const result = waitForBatch([new Promise(() => {}), Promise.reject(error)])

  await expect(result).rejects.toBe(error)
})
