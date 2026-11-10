import type { AnyExpression as AstExpression, CodecRef } from '@internal/sql-relational-core/ast';
import { PreparedParamRef } from '@internal/sql-relational-core/ast';
import type { Expression, ScopeField } from '@internal/sql-relational-core/expression';
import { blindCast } from '@internal/utils/casts';
import type { BindSiteParams, Declaration, ParamSpec } from './types';

function normalizeSpec(spec: ParamSpec): { codec: CodecRef; nullable: boolean } {
  if (typeof spec === 'string') return { codec: { codecId: spec }, nullable: false };
  const codec: CodecRef =
    spec.typeParams !== undefined
      ? { codecId: spec.codecId, typeParams: spec.typeParams }
      : { codecId: spec.codecId };
  return { codec, nullable: spec.nullable === true };
}

class BindSiteExpression implements Expression<ScopeField> {
  readonly returnType: ScopeField;
  readonly #ast: AstExpression;
  constructor(ref: PreparedParamRef, returnType: ScopeField) {
    this.#ast = ref;
    this.returnType = returnType;
  }
  buildAst(): AstExpression {
    return this.#ast;
  }
}

export function buildBindSiteParams<D extends Declaration>(declaration: D): BindSiteParams<D> {
  const params: Record<string, Expression<ScopeField>> = {};
  for (const [name, spec] of Object.entries(declaration)) {
    const { codec, nullable } = normalizeSpec(spec);
    const ref = PreparedParamRef.of(name, codec, nullable);
    params[name] = new BindSiteExpression(ref, { codecId: codec.codecId, nullable });
  }
  return blindCast<
    BindSiteParams<D>,
    'Each declaration key is mapped to its declared codec identity and nullability above'
  >(Object.freeze(params));
}
