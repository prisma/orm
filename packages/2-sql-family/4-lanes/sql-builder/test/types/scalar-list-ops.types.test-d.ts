/**
 * Integration type-test: a scalar-list operation surfaced through the REAL
 * sql-builder expression machinery.
 *
 * Exercises the actual types the `.where((f, fns) => …)` callback receives:
 * - `FieldProxy<Scope>` turns a `many: true` scope field into a list expression
 * - `Functions<QC>` surfaces the op via `DeriveExtFunctions` (impl verbatim)
 * - the op's generic `<CodecId>` ties the element argument to the list element
 *
 * The op is declared here with the SAME shape as the postgres registry's `has`
 * (descriptor-meta.ts) because sql-builder can't import the adapter layer. The
 * field-proxy / functions / list-expression types are the real ones.
 */

import type {
  CodecExpression,
  Expression,
  ScalarListExpression,
} from '@internal/sql-relational-core/expression';
import type { Functions } from '@internal/sql-relational-core/functions';
import { expectTypeOf, test } from 'vitest';
import type { FieldProxy } from '../../src/expression';
import type { QueryContext, Scope } from '../../src/scope';

type CT = {
  'pg/int4@1': { input: number; output: number; traits: readonly ['equality', 'order'] };
  'pg/text@1': { input: string; output: string; traits: readonly ['equality', 'textual'] };
  'pg/bool@1': { input: boolean; output: boolean; traits: readonly ['equality'] };
};

type BoolExpr = Expression<{ codecId: 'pg/bool@1'; nullable: false }>;

// Same shape as the real postgres `has` operation entry.
type QueryOps = {
  has: {
    self: { many: true };
    impl: <CodecId extends keyof CT & string>(
      self: ScalarListExpression<CodecId, false>,
      elem: CodecExpression<CodecId, false, CT>,
    ) => BoolExpr;
  };
};

// A scope shaped like a `Post` table: scalar `name`, list `tags String[]`.
type PostColumns = {
  name: { codecId: 'pg/text@1'; nullable: false };
  tags: { codecId: 'pg/text@1'; nullable: false; many: true };
};
type PostScope = Scope & {
  topLevel: PostColumns;
  namespaces: { Post: PostColumns };
};

type QC = QueryContext & {
  codecTypes: CT;
  capabilities: Record<string, Record<string, boolean>>;
  queryOperationTypes: QueryOps;
  resolvedColumnOutputTypes: Record<string, never>;
};

declare const f: FieldProxy<PostScope>;
declare const fns: Functions<QC>;

test('a many field surfaces as a list expression on the field proxy', () => {
  expectTypeOf(f.tags).toEqualTypeOf<ScalarListExpression<'pg/text@1', false>>();
  // a scalar field stays a plain (non-list) expression
  expectTypeOf(f.name).toEqualTypeOf<Expression<{ codecId: 'pg/text@1'; nullable: false }>>();
});

test('the list op resolves in a real where-callback body', () => {
  // exactly what `.where((f, fns) => …)` evaluates:
  expectTypeOf(fns.has(f.tags, 'hello')).toEqualTypeOf<BoolExpr>();
  // a matching element expression is accepted too
  fns.has(f.tags, f.name);
});

test('the list op rejects a scalar receiver and a wrong-typed element', () => {
  // @ts-expect-error -- f.name is scalar (no `many: true`), not a list
  fns.has(f.name, 'hello');
  // @ts-expect-error -- element must be text, not a number
  fns.has(f.tags, 5);
});
