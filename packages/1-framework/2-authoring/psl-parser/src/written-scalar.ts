import type { WrittenScalar } from '@internal/framework-components/authoring';
import {
  ArrayLiteralAst,
  BooleanLiteralExprAst,
  type ExpressionAst,
  FunctionCallAst,
  NumberLiteralExprAst,
  ObjectLiteralExprAst,
  StringLiteralExprAst,
  TaggedLiteralExprAst,
} from './syntax/ast/expressions';
import { IdentifierAst } from './syntax/ast/identifier';

/** The written scalar a PSL literal expression is, or why it is not one. */
export type WrittenScalarResult =
  | { readonly ok: true; readonly written: WrittenScalar }
  | { readonly ok: false; readonly reason: 'nul' | 'too-large' }
  | {
      readonly ok: false;
      readonly reason: 'not-a-literal';
      readonly found:
        | 'an identifier'
        | 'a function call'
        | 'a list'
        | 'an object'
        | 'an expression';
    };

const AN_EXPRESSION: WrittenScalarResult = {
  ok: false,
  reason: 'not-a-literal',
  found: 'an expression',
};

function written(value: WrittenScalar): WrittenScalarResult {
  return { ok: true, written: value };
}

/** Reads a PSL literal expression as a `WrittenScalar`, for a position that takes a value of a data type. ADR 254. */
export function readWrittenScalar(expression: ExpressionAst): WrittenScalarResult {
  const syntax = expression.syntax;

  const string = StringLiteralExprAst.cast(syntax)?.value();
  if (string !== undefined) return written({ kind: 'string', text: string });

  const number = NumberLiteralExprAst.cast(syntax);
  if (number !== undefined) {
    const text = number.token()?.text;
    return text === undefined ? AN_EXPRESSION : written({ kind: 'number', text });
  }

  const boolean = BooleanLiteralExprAst.cast(syntax)?.value();
  if (boolean !== undefined) return written({ kind: 'boolean', value: boolean });

  const tagged = TaggedLiteralExprAst.cast(syntax);
  if (tagged !== undefined) {
    const canonicalization = tagged.canonicalization();
    return canonicalization.ok
      ? written({ kind: 'tag', tag: tagged.tagName(), text: canonicalization.text })
      : { ok: false, reason: canonicalization.reason };
  }

  if (IdentifierAst.cast(syntax) !== undefined) {
    return { ok: false, reason: 'not-a-literal', found: 'an identifier' };
  }
  if (FunctionCallAst.cast(syntax) !== undefined) {
    return { ok: false, reason: 'not-a-literal', found: 'a function call' };
  }
  if (ArrayLiteralAst.cast(syntax) !== undefined) {
    return { ok: false, reason: 'not-a-literal', found: 'a list' };
  }
  if (ObjectLiteralExprAst.cast(syntax) !== undefined) {
    return { ok: false, reason: 'not-a-literal', found: 'an object' };
  }
  return AN_EXPRESSION;
}
