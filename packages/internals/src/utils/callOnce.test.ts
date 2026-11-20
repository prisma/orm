import { expect, test, vi } from 'vitest'

import { callOnceOnSuccess } from './callOnce'

test('returns the result correctly', async () => {
  const wrapper = callOnceOnSuccess(vi.fn().mockResolvedValue('hello'))
  await expect(wrapper()).resolves.toBe('hello')
})

test('forwards the arguments correctly', async () => {
  const wrapper = callOnceOnSuccess((x: number) => Promise.resolve(x + 1))
  await expect(wrapper(2)).resolves.toBe(3)
})

test('сalls wrapped function only once before promise resolves', async () => {
  const wrapped = vi.fn().mockResolvedValue('hello')
  const wrapper = callOnceOnSuccess(wrapped)
  void wrapper()
  void wrapper()
  await wrapper()

  expect(wrapped).toHaveBeenCalledTimes(1)
})

test('caches the result when it succeeds', async () => {
  const wrapped = vi.fn().mockResolvedValue('hello')
  const wrapper = callOnceOnSuccess(wrapped)
  await wrapper()
  await wrapper()
  const result = await wrapper()

  expect(wrapped).toHaveBeenCalledTimes(1)
  expect(result).toBe('hello')
})

test('does not cache the result when it fails', async () => {
  const wrapped = vi.fn().mockRejectedValue(new Error('hello'))
  const wrapper = callOnceOnSuccess(wrapped)

  await Promise.allSettled([wrapper(), wrapper()])

  await expect(wrapper()).rejects.toThrow('hello')

  expect(wrapped).toHaveBeenCalledTimes(2)
})
