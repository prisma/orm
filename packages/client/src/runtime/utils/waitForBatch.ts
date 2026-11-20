import { hasBatchIndex } from '@prisma/client-runtime-utils'

/**
 * Waits for result of batch $transaction and picks the best possible error to report if any
 * of the request fails. Best error is determined as follows:
 *
 * - if engine have reported an error without batch request index, then the batch is immediately rejected
 * with this error without waiting for other promises
 * - if engine have reported and index of failed request in the batch and that index matches the position of the
 * particular request in the batch, batch is rejected with that error
 * - if batch request index is reported and it does not match current request position, wait for other requests. If no indices
 * match request positions, reject with the earliest error in the batch
 *
 * @param promises
 * @returns
 */
export function waitForBatch<T extends PromiseLike<unknown>[]>(
  promises: T,
): Promise<{ [K in keyof T]: Awaited<T[K]> }> {
  if (promises.length === 0) {
    return Promise.resolve([] as { [K in keyof T]: Awaited<T[K]> })
  }
  return new Promise((resolve, reject) => {
    const successfulResults = new Array(promises.length) as { [K in keyof T]: Awaited<T[K]> }
    let bestError: unknown = null
    let done = false
    let settledPromisesCount = 0

    const settleOnePromise = () => {
      if (done) {
        return
      }
      settledPromisesCount++
      if (settledPromisesCount === promises.length) {
        done = true
        if (bestError) {
          reject(bestError)
        } else {
          resolve(successfulResults)
        }
      }
    }

    const immediatelyReject = (error: unknown) => {
      if (!done) {
        done = true
        reject(error)
      }
    }

    for (let i = 0; i < promises.length; i++) {
      promises[i].then(
        (result) => {
          successfulResults[i] = result
          settleOnePromise()
        },
        (error) => {
          if (!hasBatchIndex(error)) {
            immediatelyReject(error)
            return
          }

          if (error.batchRequestIdx === i) {
            immediatelyReject(error)
          } else {
            if (!bestError) {
              bestError = error
            }
            settleOnePromise()
          }
        },
      )
    }
  })
}
