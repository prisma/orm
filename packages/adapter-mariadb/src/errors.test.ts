import { describe, expect, test } from 'vitest'

import { convertDriverError } from './errors'

describe('MariaDB adapter error handling', () => {
  test('mysql error mapping includes nested driver cause when available', () => {
    const nestedCause = {
      errno: 45044,
      sqlMessage:
        'RSA public key is not available client side. Either set option `cachingRsaPublicKey` to indicate public key path, or allow public key retrieval with option `allowPublicKeyRetrieval`',
      sqlState: '08S01',
      message:
        'RSA public key is not available client side. Either set option `cachingRsaPublicKey` to indicate public key path, or allow public key retrieval with option `allowPublicKeyRetrieval`',
    }

    const err = {
      errno: 45028,
      sqlMessage:
        'pool timeout: failed to retrieve a connection from pool after 10005ms\n    (pool connections: active=0 idle=0 limit=5)',
      sqlState: 'HY000',
      cause: nestedCause,
    }

    const mapped = convertDriverError(err)

    expect(mapped).toMatchObject({
      kind: 'mysql',
      code: 45028,
      state: 'HY000',
      message:
        'pool timeout: failed to retrieve a connection from pool after 10005ms\n    (pool connections: active=0 idle=0 limit=5)',
      cause:
        'RSA public key is not available client side. Either set option `cachingRsaPublicKey` to indicate public key path, or allow public key retrieval with option `allowPublicKeyRetrieval`',
      originalCode: '45028',
      originalMessage:
        'pool timeout: failed to retrieve a connection from pool after 10005ms\n    (pool connections: active=0 idle=0 limit=5)',
    })
  })

  test('mysql error mapping omits cause when not available', () => {
    const err = {
      errno: 45028,
      sqlMessage: 'An error occurred',
      sqlState: 'HY000',
    }

    const mapped = convertDriverError(err)

    expect(mapped).toMatchObject({
      kind: 'mysql',
      code: 45028,
      state: 'HY000',
      message: 'An error occurred',
    })
    // important: we want `cause` to be truly absent/undefined to keep payload minimal/stable
    expect((mapped as any).cause).toBeUndefined()
  })
})
