import { describe, test } from 'vitest'

import { env } from '../env'

interface EnvInterface {
  DATABASE_URL: string
}

type EnvType = {
  DATABASE_URL: string
}

describe('env types', () => {
  test('accepts interface and type alias', () => {
    // eslint-disable-next-line no-constant-condition
    if (false) {
      env<EnvInterface>('DATABASE_URL')
      env<EnvType>('DATABASE_URL')
    }
  })
})
