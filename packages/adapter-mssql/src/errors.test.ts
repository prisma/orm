import { describe, expect, test } from 'vitest'

import { convertDriverError } from './errors'

describe('unique constraint violations', () => {
  test('2627 reports the object name as the constraint and derives the table', () => {
    const message =
      "Violation of UNIQUE KEY constraint 'users_email_key'. " +
      "Cannot insert duplicate key in object 'dbo.users'. The duplicate key value is (a@b.c)."
    // For error 2627, the schema-qualified object name is surfaced as the constraint
    // (the historical, pre-existing behaviour); the table is derived from it.
    expect(convertDriverError({ code: 'EREQUEST', number: 2627, message })).toEqual({
      kind: 'UniqueConstraintViolation',
      constraint: { index: 'dbo.users' },
      table: 'users',
      originalCode: 'EREQUEST',
      originalMessage: message,
    })
  })

  test('2601 reports the index name and the table', () => {
    const message =
      "Cannot insert duplicate key row in object 'dbo.users' with unique index 'users_email_key'. " +
      'The duplicate key value is (a@b.c).'
    expect(convertDriverError({ code: 'EREQUEST', number: 2601, message })).toEqual({
      kind: 'UniqueConstraintViolation',
      constraint: { index: 'users_email_key' },
      table: 'users',
      originalCode: 'EREQUEST',
      originalMessage: message,
    })
  })

  test('1505 reports the index name and the table', () => {
    const message =
      'The CREATE UNIQUE INDEX statement terminated because a duplicate key was found for ' +
      "object name 'dbo.users' and index name 'users_email_key'. The duplicate key value is (a@b.c)."
    expect(convertDriverError({ code: 'EREQUEST', number: 1505, message })).toEqual({
      kind: 'UniqueConstraintViolation',
      constraint: { index: 'users_email_key' },
      table: 'users',
      originalCode: 'EREQUEST',
      originalMessage: message,
    })
  })
})

describe('constraint conflicts (547)', () => {
  test('a CHECK constraint conflict is a check constraint violation', () => {
    const message =
      'The INSERT statement conflicted with the CHECK constraint "t_sum_check". ' +
      'The conflict occurred in database "db", table "dbo.t".'
    expect(convertDriverError({ code: 'EREQUEST', number: 547, message })).toEqual({
      kind: 'CheckConstraintViolation',
      constraint: { index: 't_sum_check' },
      originalCode: 'EREQUEST',
      originalMessage: message,
    })
  })

  test('a FOREIGN KEY constraint conflict is still a foreign key violation', () => {
    const message =
      'The INSERT statement conflicted with the FOREIGN KEY constraint "Post_authorId_fkey". ' +
      'The conflict occurred in database "db", table "dbo.User", column \'id\'.'
    expect(convertDriverError({ code: 'EREQUEST', number: 547, message })).toEqual({
      kind: 'ForeignKeyConstraintViolation',
      constraint: { index: 'Post_authorId_fkey' },
      originalCode: 'EREQUEST',
      originalMessage: message,
    })
  })
})
