/**
 * The JSON-document retag, tested at both ends: the AST it builds and the SQL
 * that AST renders to.
 *
 * Nothing calls the retag from a production render path yet, so these tests are
 * the only thing holding its shape. They assert the two properties a caller will
 * depend on when one does — that applying it twice is the same as applying it
 * once, and that it renders as SQLite's `json()`.
 *
 * Why it exists at all: SQLite carries "this text is JSON" as a value subtype,
 * and the subtype does not survive a derived table. A document that reaches an
 * enclosing constructor without it is embedded as a string containing JSON
 * rather than as a document.
 */

import type { SqlStorage } from '@internal/sql-contract/types';
import {
  ColumnRef,
  FunctionCallExpr,
  JsonObjectExpr,
  NativeJsonValueProjection,
  ProjectionItem,
  SelectAst,
  TableSource,
} from '@internal/sql-relational-core/ast';
import { jsonDocumentRetag, sqliteCodecDescriptorRegistry } from '@internal/target-sqlite/codecs';
import { createContract } from '@repo/test-utils';
import { describe, expect, it } from 'vitest';
import { renderLoweredSql } from '../src/core/adapter';
import type { SqliteContract } from '../src/core/types';

const contract: SqliteContract = {
  ...createContract<SqlStorage>({ target: 'sqlite', targetFamily: 'sql' }),
  target: 'sqlite',
};

const column = ColumnRef.of('documents', 'body');

function renderProjected(expression: ReturnType<typeof jsonDocumentRetag>): string {
  const document = JsonObjectExpr.fromEntries([
    JsonObjectExpr.entry('value', new NativeJsonValueProjection(expression)),
  ]);
  const select = SelectAst.from(TableSource.named('documents')).withProjection([
    ProjectionItem.of('doc', document),
  ]);
  return renderLoweredSql(select, contract, sqliteCodecDescriptorRegistry).sql;
}

describe('SQLite JSON-document retag', () => {
  it('wraps a document-valued expression in a subtype re-application', () => {
    expect(jsonDocumentRetag(column)).toEqual(FunctionCallExpr.of('json', [column]));
  });

  it('collapses rather than nesting when applied again', () => {
    const once = jsonDocumentRetag(column);
    expect(jsonDocumentRetag(once)).toBe(once);
    expect(jsonDocumentRetag(jsonDocumentRetag(jsonDocumentRetag(column)))).toEqual(
      FunctionCallExpr.of('json', [column]),
    );
  });

  it('leaves its own output alone and wraps everything else', () => {
    const retagged = jsonDocumentRetag(column);
    expect(jsonDocumentRetag(retagged)).toBe(retagged);

    // A different JSON function, and a `json` call of the wrong arity, are not
    // retags: each has to be wrapped rather than mistaken for one.
    for (const other of [
      column,
      FunctionCallExpr.of('json_object', [column]),
      FunctionCallExpr.of('json', [column, column]),
    ]) {
      expect(jsonDocumentRetag(other)).toEqual(FunctionCallExpr.of('json', [other]));
    }
  });

  it('renders as json() inside the enclosing JSON constructor', () => {
    expect(renderProjected(jsonDocumentRetag(column))).toBe(
      `SELECT json_object('value', json("documents"."body")) AS "doc" FROM "documents"`,
    );
  });

  it('renders the untagged expression as a bare column, which is the defect it prevents', () => {
    expect(renderProjected(column)).toBe(
      `SELECT json_object('value', "documents"."body") AS "doc" FROM "documents"`,
    );
  });

  it('is not applied by the sqlite/json@1 descriptor, whose canonical form is the stored text', () => {
    const descriptor = sqliteCodecDescriptorRegistry.descriptorFor('sqlite/json@1');
    expect(descriptor?.projectJson(column, { codecId: 'sqlite/json@1' })).toBe(column);
  });
});
