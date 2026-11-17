/**
 * The premise the retag exists for, executed against a real SQLite.
 *
 * The mechanism's other tests pin its shape — the AST it builds and the SQL it
 * renders. None of them shows that the SQL *works*, and the conformance cases
 * cannot: they project from a base table through one flat `json_object`, which
 * never nests, so the subtype is never crossed.
 *
 * These tests cross it. Each renders a nested query through the adapter's own
 * renderer and runs it, so what is measured is the mechanism's output rather
 * than a hand-written `json(…)`. Both arms are asserted: an untagged document
 * must degrade into a string containing JSON, and a retagged one must survive as
 * a document. Without the negative arm a passing suite would not distinguish
 * "the retag works" from "the subtype was never at risk".
 *
 * No renderer wiring is involved — the nesting is built as an AST here, not
 * produced by a production path.
 */

import { DatabaseSync } from 'node:sqlite';
import type { SqlStorage } from '@internal/sql-contract/types';
import {
  ColumnRef,
  DerivedTableSource,
  JsonArrayAggExpr,
  JsonObjectExpr,
  LiteralExpr,
  NativeJsonValueProjection,
  type ProjectionExpr,
  ProjectionItem,
  SelectAst,
} from '@internal/sql-relational-core/ast';
import { jsonDocumentRetag, sqliteCodecDescriptorRegistry } from '@internal/target-sqlite/codecs';
import { createContract } from '@repo/test-utils';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { renderLoweredSql } from '../src/core/adapter';
import type { SqliteContract } from '../src/core/types';

const contract: SqliteContract = {
  ...createContract<SqlStorage>({ target: 'sqlite', targetFamily: 'sql' }),
  target: 'sqlite',
};

const DOCUMENT = { a: 1 };
const INNER_COLUMN = 'body';

/** `SELECT json_object('a', 1) AS body` — a document, with the subtype still on it. */
function documentSource(): SelectAst {
  return SelectAst.noFrom().withProjection([
    ProjectionItem.of(
      INNER_COLUMN,
      JsonObjectExpr.fromEntries([
        JsonObjectExpr.entry('a', new NativeJsonValueProjection(LiteralExpr.of(1))),
      ]),
    ),
  ]);
}

/** Wraps `inner` in `levels` derived tables, then embeds the named column via `project`. */
function nested(levels: number, project: (expr: ProjectionExpr) => ProjectionExpr): SelectAst {
  let source = documentSource();
  for (let level = 0; level < levels - 1; level += 1) {
    source = SelectAst.from(DerivedTableSource.as(`d${level}`, source)).withProjection([
      ProjectionItem.of(INNER_COLUMN, ColumnRef.of(`d${level}`, INNER_COLUMN)),
    ]);
  }
  const alias = `d${levels - 1}`;
  return SelectAst.from(DerivedTableSource.as(alias, source)).withProjection([
    ProjectionItem.of(
      'doc',
      JsonObjectExpr.fromEntries([
        JsonObjectExpr.entry(
          'outer',
          new NativeJsonValueProjection(project(ColumnRef.of(alias, INNER_COLUMN))),
        ),
      ]),
    ),
  ]);
}

/**
 * The same nesting, but with `json_group_array` as the enclosing constructor
 * rather than `json_object`. Whether an aggregate preserves *element* subtypes
 * the way an object preserves *value* subtypes is a contingent fact about
 * SQLite, not something the premise implies, so it is measured here too.
 */
function nestedAggregate(project: (expr: ProjectionExpr) => ProjectionExpr): SelectAst {
  return SelectAst.from(DerivedTableSource.as('d', documentSource())).withProjection([
    ProjectionItem.of(
      'doc',
      JsonArrayAggExpr.of(
        new NativeJsonValueProjection(project(ColumnRef.of('d', INNER_COLUMN))),
        'emptyArray',
      ),
    ),
  ]);
}

describe('SQLite JSON subtype across a derived table', () => {
  let database: DatabaseSync | undefined;

  beforeAll(() => {
    database = new DatabaseSync(':memory:');
  });

  afterAll(() => {
    database?.close();
    database = undefined;
  });

  function run(select: SelectAst): unknown {
    const { sql } = renderLoweredSql(select, contract, sqliteCodecDescriptorRegistry);
    const row = database!.prepare(sql).get() as { doc: string };
    return JSON.parse(row.doc).outer;
  }

  function runAggregate(select: SelectAst): unknown {
    const { sql } = renderLoweredSql(select, contract, sqliteCodecDescriptorRegistry);
    const row = database!.prepare(sql).get() as { doc: string };
    return JSON.parse(row.doc);
  }

  const identity = (expr: ProjectionExpr): ProjectionExpr => expr;

  it('carries the subtype when nothing intervenes, so it is there to lose', () => {
    const direct = SelectAst.noFrom().withProjection([
      ProjectionItem.of(
        'doc',
        JsonObjectExpr.fromEntries([
          JsonObjectExpr.entry(
            'outer',
            new NativeJsonValueProjection(
              JsonObjectExpr.fromEntries([
                JsonObjectExpr.entry('a', new NativeJsonValueProjection(LiteralExpr.of(1))),
              ]),
            ),
          ),
        ]),
      ),
    ]);
    expect(run(direct)).toEqual(DOCUMENT);
  });

  it('degrades an untagged document into a string containing JSON', () => {
    expect(run(nested(1, identity))).toBe(JSON.stringify(DOCUMENT));
  });

  it('does not degrade further through a second derived table', () => {
    expect(run(nested(2, identity))).toBe(JSON.stringify(DOCUMENT));
  });

  it('restores the document when the retag is applied', () => {
    expect(run(nested(1, jsonDocumentRetag))).toEqual(DOCUMENT);
  });

  it('needs the retag only where the document is consumed', () => {
    expect(run(nested(2, jsonDocumentRetag))).toEqual(DOCUMENT);
  });

  it('degrades an untagged element inside json_group_array too', () => {
    expect(runAggregate(nestedAggregate(identity))).toEqual([JSON.stringify(DOCUMENT)]);
  });

  it('restores a document element inside json_group_array', () => {
    expect(runAggregate(nestedAggregate(jsonDocumentRetag))).toEqual([DOCUMENT]);
  });
});
