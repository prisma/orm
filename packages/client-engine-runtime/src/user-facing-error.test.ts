import { expect, test } from 'vitest'

import { rethrowAsUserFacing, rethrowAsUserFacingRawError, UserFacingError } from './user-facing-error'

function makeDriverAdapterError(cause: object) {
  // Minimal shape that satisfies isDriverAdapterError + rethrowAsUserFacing
  return {
    name: 'DriverAdapterError',
    message:
      typeof (cause as { message?: unknown }).message === 'string'
        ? (cause as { message: string }).message
        : 'driver adapter error',
    cause,
  }
}

test('rethrowAsUserFacing re-throws the original error for unknown cause kinds', () => {
  // An unknown `kind` value simulates a driver-adapter version that is ahead
  // of the client (new error variant not yet handled by getErrorCode /
  // renderErrorMessage). Before the fix the thrown message contained
  // "[object Object]"; after the fix it contains a JSON-serialised snapshot.
  const error = makeDriverAdapterError({ kind: 'SomeNewUnknownErrorKind', detail: 'more info' })

  expect(() => rethrowAsUserFacing(error)).toThrowError(/Unknown error: .*SomeNewUnknownErrorKind/)

  // Crucially the message must NOT degrade to the useless "[object Object]"
  expect(() => rethrowAsUserFacing(error)).not.toThrowError('[object Object]')
})

test('rethrowAsUserFacing wraps unmapped Postgres errors as P2039 UserFacingError', () => {
  // Simulates a Postgres error code the adapter doesn't have a specific
  // mapping for (here: 42P10, "there is no unique or exclusion constraint
  // matching the ON CONFLICT specification" — raised on a stale-schema
  // upsert). These used to escape as a bare DriverAdapterError, leading to
  // HTTP 500 from the query plan executor (whose body Accelerate strips)
  // and to PrismaClientUnknownRequestError locally.
  const error = makeDriverAdapterError({
    kind: 'postgres',
    code: '42P10',
    severity: 'ERROR',
    message: 'there is no unique or exclusion constraint matching the ON CONFLICT specification',
    detail: undefined,
    column: undefined,
    hint: undefined,
    originalCode: '42P10',
    originalMessage: 'there is no unique or exclusion constraint matching the ON CONFLICT specification',
  })

  expect(() => rethrowAsUserFacing(error)).toThrow(UserFacingError)

  try {
    rethrowAsUserFacing(error)
  } catch (e) {
    expect(e).toBeInstanceOf(UserFacingError)
    const userFacing = e as UserFacingError
    expect(userFacing.code).toBe('P2039')
    expect(userFacing.message).toBe(
      'Database error. Code: `42P10`. Message: `there is no unique or exclusion constraint matching the ON CONFLICT specification`',
    )
    expect(userFacing.meta).toMatchObject({ driverAdapterError: error })
  }
})

test.each([
  {
    label: 'MySQL',
    cause: {
      kind: 'mysql',
      code: 1146,
      message: "Table 'db.Post' doesn't exist",
      state: '42S02',
      originalCode: '1146',
      originalMessage: "Table 'db.Post' doesn't exist",
    },
    expectedMessage: "Database error. Code: `1146`. Message: `Table 'db.Post' doesn't exist`",
  },
  {
    label: 'SQLite',
    cause: {
      kind: 'sqlite',
      extendedCode: 1,
      message: 'SQLITE_ERROR: near "FOO": syntax error',
      originalCode: '1',
      originalMessage: 'SQLITE_ERROR: near "FOO": syntax error',
    },
    expectedMessage: 'Database error. Code: `1`. Message: `SQLITE_ERROR: near "FOO": syntax error`',
  },
  {
    label: 'MSSQL',
    cause: {
      kind: 'mssql',
      code: 208,
      message: "Invalid object name 'Post'.",
      originalCode: '208',
      originalMessage: "Invalid object name 'Post'.",
    },
    expectedMessage: "Database error. Code: `208`. Message: `Invalid object name 'Post'.`",
  },
])('rethrowAsUserFacing wraps unmapped $label errors as P2039 UserFacingError', ({ cause, expectedMessage }) => {
  const error = makeDriverAdapterError(cause)

  try {
    rethrowAsUserFacing(error)
    throw new Error('expected rethrowAsUserFacing to throw')
  } catch (e) {
    expect(e).toBeInstanceOf(UserFacingError)
    const userFacing = e as UserFacingError
    expect(userFacing.code).toBe('P2039')
    expect(userFacing.message).toBe(expectedMessage)
  }
})

test('rethrowAsUserFacing falls back to N/A when originalCode/originalMessage are missing', () => {
  // Defensive: some older adapters or transports may not populate the
  // originalCode/originalMessage fields. We should still produce a
  // well-formed P2039 message rather than `Message: \`undefined\``.
  const error = makeDriverAdapterError({
    kind: 'postgres',
    code: '42P10',
    severity: 'ERROR',
    message: 'there is no unique or exclusion constraint matching the ON CONFLICT specification',
    detail: undefined,
    column: undefined,
    hint: undefined,
  })

  try {
    rethrowAsUserFacing(error)
    throw new Error('expected rethrowAsUserFacing to throw')
  } catch (e) {
    expect(e).toBeInstanceOf(UserFacingError)
    const userFacing = e as UserFacingError
    expect(userFacing.code).toBe('P2039')
    // Anchor the full message and require a non-empty payload between the
    // backticks so that a stringified `undefined` (the previous bug) is
    // rejected. The double-checked guard below makes the intent explicit
    // and gives a clearer assertion failure if it ever regresses.
    expect(userFacing.message).toMatch(/^Database error\. Code: `N\/A`\. Message: `[^`]+`$/)
    expect(userFacing.message).not.toMatch(/undefined/)
  }
})

test('rethrowAsUserFacingRawError uses P2010 with the original DB error details', () => {
  // Raw queries ($executeRaw, $queryRaw) keep the historical P2010
  // "Raw query failed." format regardless of whether the underlying kind
  // has a specific mapping, so that clients catching P2010 continue to
  // work as documented.
  const error = makeDriverAdapterError({
    kind: 'postgres',
    code: '23505',
    severity: 'ERROR',
    message: 'duplicate key value violates unique constraint "User_email_key"',
    detail: 'Key (email)=(a@b.c) already exists.',
    column: undefined,
    hint: undefined,
    originalCode: '23505',
    originalMessage: 'duplicate key value violates unique constraint "User_email_key"',
  })

  try {
    rethrowAsUserFacingRawError(error)
    throw new Error('expected rethrowAsUserFacingRawError to throw')
  } catch (e) {
    expect(e).toBeInstanceOf(UserFacingError)
    const userFacing = e as UserFacingError
    expect(userFacing.code).toBe('P2010')
    expect(userFacing.message).toBe(
      'Raw query failed. Code: `23505`. Message: `duplicate key value violates unique constraint "User_email_key"`',
    )
  }
})

test('rethrowAsUserFacing still wraps specifically-mapped kinds with their dedicated code', () => {
  // Regression: make sure the new generic-DB fallback does not shadow the
  // existing specific mappings (e.g. UniqueConstraintViolation -> P2002).
  const error = makeDriverAdapterError({
    kind: 'UniqueConstraintViolation',
    constraint: { fields: ['email'] },
  })

  try {
    rethrowAsUserFacing(error)
    throw new Error('expected rethrowAsUserFacing to throw')
  } catch (e) {
    expect(e).toBeInstanceOf(UserFacingError)
    const userFacing = e as UserFacingError
    expect(userFacing.code).toBe('P2002')
    expect(userFacing.message).toBe('Unique constraint failed on the fields: (`email`)')
    // No table reported by the adapter -> no `table` key in the meta.
    expect(userFacing.meta).not.toHaveProperty('table')
  }
})

test('rethrowAsUserFacing forwards the violated table for unique constraint violations', () => {
  // The client maps `meta.table` back to the Prisma model name (taking
  // `@@map` into account) so that P2002 errors from nested writes report the
  // model where the violation actually occurred instead of the model of the
  // top-level operation.
  const error = makeDriverAdapterError({
    kind: 'UniqueConstraintViolation',
    constraint: { fields: ['appId', 'number'] },
    table: 'app_major_versions',
  })

  expect(() => rethrowAsUserFacing(error)).toThrow(UserFacingError)
  expect(() => rethrowAsUserFacing(error)).toThrow(
    expect.objectContaining({
      code: 'P2002',
      meta: expect.objectContaining({ table: 'app_major_versions', driverAdapterError: error }),
    }),
  )
})
