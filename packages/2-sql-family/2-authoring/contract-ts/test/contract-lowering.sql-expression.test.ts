import type { SqlExpression } from '@internal/sql-contract/sql-expression';
import { describe, expect, it } from 'vitest';
import { check, field, model } from '../src/contract-builder';
import { columnDescriptor } from './helpers/column-descriptor';
import { defineTestContract } from './helpers/define-test-contract';

const int4Column = columnDescriptor('pg/int4@1');
const textColumn = columnDescriptor('pg/text@1');
const fields = { id: field.column(int4Column).id(), email: field.column(textColumn) };

const untyped = (text: string) => text as unknown as SqlExpression;

function refusal(what: string) {
  return expect.objectContaining({
    code: 'CONTRACT.ARGUMENT_INVALID',
    message: `${what} must be a sql\`...\` value.`,
    meta: { what },
  });
}

describe('lowering refuses a raw-SQL field that holds a string at run time', () => {
  it('index where, naming the index', () => {
    const User = model('User', { fields }).sql(({ cols, constraints }) => ({
      indexes: [constraints.index([cols.email], { name: 'a', where: untyped('x') })],
    }));
    expect(() => defineTestContract({ models: { User } })).toThrow(refusal('Index "a" where'));
  });

  it('index where, naming the index by its map', () => {
    const User = model('User', { fields }).sql(({ cols, constraints }) => ({
      indexes: [constraints.index([cols.email], { map: 'user_email', where: untyped('x') })],
    }));
    expect(() => defineTestContract({ models: { User } })).toThrow(
      refusal('Index "user_email" where'),
    );
  });

  it('index where on an unnamed index, naming the model', () => {
    const User = model('User', { fields }).sql(({ cols, constraints }) => ({
      indexes: [constraints.index([cols.email], { where: untyped('x') })],
    }));
    expect(() => defineTestContract({ models: { User } })).toThrow(
      refusal('Index on "User" where'),
    );
  });

  it('index expression', () => {
    const User = model('User', { fields }).sql(({ constraints }) => ({
      indexes: [constraints.index({ expression: untyped('lower(email)'), name: 'a' })],
    }));
    expect(() => defineTestContract({ models: { User } })).toThrow(refusal('Index "a" expression'));
  });

  it('check expression', () => {
    const User = model('User', { fields }).sql({
      checks: [check({ expression: untyped('true'), name: 'a' })],
    });
    expect(() => defineTestContract({ models: { User } })).toThrow(refusal('Check "a" expression'));
  });

  it('check expression on an unnamed check, naming the model', () => {
    const User = model('User', { fields }).sql({
      checks: [check({ expression: untyped('true') })],
    });
    expect(() => defineTestContract({ models: { User } })).toThrow(
      refusal('Check on "User" expression'),
    );
  });
});
