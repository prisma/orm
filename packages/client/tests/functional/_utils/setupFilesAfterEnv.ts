// add all jest-extended matchers
// see https://jest-extended.jestcommunity.dev/docs/matchers/
import { stripVTControlCharacters } from 'node:util'

import * as matchers from 'jest-extended'
import { toMatchInlineSnapshot, toMatchSnapshot } from 'jest-snapshot'

import { EnabledCallSite } from '../../../src/runtime/utils/CallSite'
import { getTemplateParameters } from '../../../src/runtime/utils/createErrorMessageWithContext'

process.env.PRISMA_HIDE_PREVIEW_FLAG_WARNINGS = 'true'
expect.extend(matchers)

expect.extend({
  toMatchPrismaErrorSnapshot(received: unknown) {
    if (!(received instanceof Error)) {
      return {
        message: () => 'Expected instance of error',
        pass: false,
      }
    }
    // @ts-expect-error: jest-snapshot and jest typings are incompatible,
    // even though custom snapshot matchers supposed to work this way
    return toMatchSnapshot.call(this, sanitizeLineNumbers(received.message))
  },

  toMatchPrismaErrorInlineSnapshot(received: unknown, ...rest: unknown[]) {
    if (!(received instanceof Error)) {
      return {
        message: () => 'Expected instance of error',
        pass: false,
      }
    }

    // @ts-expect-error: jest-snapshot and jest typings are incompatible,
    // even though custom snapshot matchers supposed to work this way
    return toMatchInlineSnapshot.call(this, sanitizeLineNumbers(received.message), ...rest)
  },
})

function sanitizeLineNumbers(message: string) {
  return stripVTControlCharacters(message).replace(/^(\s*→?\s+)\d+/gm, '$1XX')
}

/**
 * Utility that busts test flakiness by running the same test multiple times.
 * This is especially useful for tests that fail locally but not on CI.
 * @param n Number of times to repeat the test
 * @returns
 */
function testRepeat(n: number) {
  const getRepeatProxy = (jestCall: jest.It) => {
    return new Proxy(jestCall, {
      // re-wrap the jest call to be repeated
      apply(target, thisArg, [name, cb, timeout]) {
        for (let i = 0; i < n; i++) {
          target(`${name} #${i}`, cb, timeout)
        }
      },
      // if not a call but eg. jest.concurrent
      get(target, prop) {
        return getRepeatProxy(target[prop])
      },
    })
  }

  return getRepeatProxy(test)
}

// allows to .skip.skip.skip... a test
const skip = new Proxy(it.skip, {
  get(target, prop) {
    if (prop === 'skip') return it.skip
    return target[prop]
  },
})

globalThis.beforeAll = process.env.TEST_GENERATE_ONLY === 'true' ? () => {} : beforeAll
globalThis.afterAll = process.env.TEST_GENERATE_ONLY === 'true' ? () => {} : afterAll
globalThis.beforeEach = process.env.TEST_GENERATE_ONLY === 'true' ? () => {} : beforeEach
globalThis.afterEach = process.env.TEST_GENERATE_ONLY === 'true' ? () => {} : afterEach
globalThis.test = process.env.TEST_GENERATE_ONLY === 'true' ? skip : test
globalThis.testIf = (condition: boolean) => (condition && process.env.TEST_GENERATE_ONLY !== 'true' ? test : skip)
globalThis.skipTestIf = (condition: boolean) => (condition || process.env.TEST_GENERATE_ONLY === 'true' ? skip : test)
globalThis.describeIf = (condition: boolean) => (condition ? describe : describe.skip)
globalThis.testRepeat = testRepeat

// @ts-ignore, a global variable that is injected by us to make our snapshots
// work in clients that cannot read from disk (e.g. wasm or edge clients)
globalThis.$getTemplateParameters = getTemplateParameters

// @ts-ignore, a global variable that is injected by us to make our snapshots
// work in clients that cannot read from disk (e.g. wasm or edge clients)
globalThis.$EnabledCallSite = EnabledCallSite

export {}
