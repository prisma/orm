import timers from 'node:timers/promises'

export async function retry<A>(fn: () => Promise<A>, max: number, delay: number = 1000): Promise<A> {
  for (let i = 0; i < max; i++) {
    try {
      return await fn()
    } catch (e) {
      if (i === max - 1) throw e
    }
    await timers.setTimeout(delay)
  }
  throw 'Unreachable'
}
