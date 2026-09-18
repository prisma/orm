import type { TaggedLiteralCanonicalization } from '@internal/framework-components/control';
import {
  canonicalizeTaggedLiteralBody,
  resolveBacktickEscapes,
} from '@internal/framework-components/control';
import { isTerminatedStringLiteral } from '../../tokenizer';
import type { AstNode } from '../ast-helpers';
import { filterChildren, findChildToken, findFirstChild } from '../ast-helpers';
import { SyntaxNode, type SyntaxToken } from '../red';
import { IdentifierAst } from './identifier';
import { QualifiedNameAst } from './qualified-name';

export class FunctionCallAst implements AstNode {
  readonly syntax: SyntaxNode;

  constructor(syntax: SyntaxNode) {
    this.syntax = syntax;
  }

  /** The qualified-name callee, or `undefined` when identifier segments sit directly under the node. */
  name(): QualifiedNameAst | undefined {
    return findFirstChild(this.syntax, QualifiedNameAst.cast);
  }

  /**
   * The dotted call path, in source order. A bare `Vector(…)` yields
   * `['Vector']`; a namespace-qualified `pgvector.Vector(…)` yields
   * `['pgvector', 'Vector']`. Empty when the call carries no identifier.
   */
  path(): readonly string[] {
    const qualified = this.name();
    const segments: string[] = [];
    for (const segment of filterChildren(qualified?.syntax ?? this.syntax, IdentifierAst.cast)) {
      const text = segment.token()?.text;
      if (text !== undefined) segments.push(text);
    }
    return segments;
  }

  lparen(): SyntaxToken | undefined {
    return findChildToken(this.syntax, 'LParen');
  }

  rparen(): SyntaxToken | undefined {
    return findChildToken(this.syntax, 'RParen');
  }

  *args(): Iterable<AttributeArgAst> {
    yield* filterChildren(this.syntax, AttributeArgAst.cast);
  }

  static cast(node: SyntaxNode): FunctionCallAst | undefined {
    return node.kind === 'FunctionCall' ? new FunctionCallAst(node) : undefined;
  }
}

export class ArrayLiteralAst implements AstNode {
  readonly syntax: SyntaxNode;

  constructor(syntax: SyntaxNode) {
    this.syntax = syntax;
  }

  lbracket(): SyntaxToken | undefined {
    return findChildToken(this.syntax, 'LBracket');
  }

  rbracket(): SyntaxToken | undefined {
    return findChildToken(this.syntax, 'RBracket');
  }

  *elements(): Iterable<ExpressionAst> {
    yield* filterChildren(this.syntax, castExpression);
  }

  static cast(node: SyntaxNode): ArrayLiteralAst | undefined {
    return node.kind === 'ArrayLiteral' ? new ArrayLiteralAst(node) : undefined;
  }
}

const HEX = /^[0-9a-fA-F]+$/;

function decodeFixedHex(raw: string, start: number, width: number): string | undefined {
  if (start + width > raw.length) return undefined;
  const hex = raw.slice(start, start + width);
  if (!HEX.test(hex)) return undefined;
  return String.fromCharCode(Number.parseInt(hex, 16));
}

function decodeStringLiteral(raw: string): string {
  let out = '';
  let i = 0;
  while (i < raw.length) {
    const ch = raw.charAt(i);
    if (ch !== '\\' || i + 1 >= raw.length) {
      out += ch;
      i++;
      continue;
    }
    const next = raw.charAt(i + 1);
    switch (next) {
      case 'n':
        out += '\n';
        i += 2;
        continue;
      case 'r':
        out += '\r';
        i += 2;
        continue;
      case 't':
        out += '\t';
        i += 2;
        continue;
      case '"':
        out += '"';
        i += 2;
        continue;
      case "'":
        out += "'";
        i += 2;
        continue;
      case '\\':
        out += '\\';
        i += 2;
        continue;
      case 'x': {
        const decoded = decodeFixedHex(raw, i + 2, 2);
        if (decoded === undefined) {
          out += '\\x';
          i += 2;
          continue;
        }
        out += decoded;
        i += 4;
        continue;
      }
      case 'u': {
        const decoded = decodeFixedHex(raw, i + 2, 4);
        if (decoded === undefined) {
          out += '\\u';
          i += 2;
          continue;
        }
        out += decoded;
        i += 6;
        continue;
      }
      default:
        out += `\\${next}`;
        i += 2;
        continue;
    }
  }
  return out;
}

export type StringLiteralQuote = '"' | "'" | '`';

export class StringLiteralExprAst implements AstNode {
  readonly syntax: SyntaxNode;

  constructor(syntax: SyntaxNode) {
    this.syntax = syntax;
  }

  token(): SyntaxToken | undefined {
    return findChildToken(this.syntax, 'StringLiteral');
  }

  quote(): StringLiteralQuote | undefined {
    const quote = this.token()?.text.charAt(0);
    return quote === '"' || quote === "'" || quote === '`' ? quote : undefined;
  }

  /**
   * The decoded string. A `"` or `'` string resolves the usual escapes; a backtick string resolves
   * only `` \` `` and `\\`, keeping every other backslash sequence as written.
   */
  value(): string | undefined {
    const tok = this.token();
    if (!tok) return undefined;
    const raw = isTerminatedStringLiteral(tok.text) ? tok.text.slice(1, -1) : tok.text.slice(1);
    return this.quote() === '`' ? resolveBacktickEscapes(raw) : decodeStringLiteral(raw);
  }

  static cast(node: SyntaxNode): StringLiteralExprAst | undefined {
    return node.kind === 'StringLiteralExpr' ? new StringLiteralExprAst(node) : undefined;
  }
}

/** `` tag`body` ``, `tag"body"`, or `tag'body'`: a qualified-name tag followed by a string literal. */
export class TaggedLiteralExprAst implements AstNode {
  readonly syntax: SyntaxNode;

  constructor(syntax: SyntaxNode) {
    this.syntax = syntax;
  }

  tag(): QualifiedNameAst | undefined {
    return findFirstChild(this.syntax, QualifiedNameAst.cast);
  }

  /** The tag without trivia, e.g. `pg.sql`. */
  tagName(): string {
    const tag = this.tag();
    const space = tag?.space()?.name();
    const namespace = tag?.namespace()?.name();
    const spacePrefix = space === undefined ? '' : `${space}:`;
    const namespacePrefix = namespace === undefined ? '' : `${namespace}.`;
    return spacePrefix + namespacePrefix + (tag?.identifier()?.name() ?? '');
  }

  literal(): StringLiteralExprAst | undefined {
    return findFirstChild(this.syntax, StringLiteralExprAst.cast);
  }

  canonicalization(): TaggedLiteralCanonicalization {
    return canonicalizeTaggedLiteralBody(this.literal()?.value() ?? '');
  }

  /** The canonical body shared with the TypeScript `sql` tag, or `undefined` when canonicalization fails. */
  body(): string | undefined {
    const result = this.canonicalization();
    return result.ok ? result.body : undefined;
  }

  static cast(node: SyntaxNode): TaggedLiteralExprAst | undefined {
    return node.kind === 'TaggedLiteral' ? new TaggedLiteralExprAst(node) : undefined;
  }
}

export class NumberLiteralExprAst implements AstNode {
  readonly syntax: SyntaxNode;

  constructor(syntax: SyntaxNode) {
    this.syntax = syntax;
  }

  token(): SyntaxToken | undefined {
    return findChildToken(this.syntax, 'NumberLiteral');
  }

  value(): number | undefined {
    const tok = this.token();
    if (!tok) return undefined;
    return Number(tok.text);
  }

  static cast(node: SyntaxNode): NumberLiteralExprAst | undefined {
    return node.kind === 'NumberLiteralExpr' ? new NumberLiteralExprAst(node) : undefined;
  }
}

export class BooleanLiteralExprAst implements AstNode {
  readonly syntax: SyntaxNode;

  constructor(syntax: SyntaxNode) {
    this.syntax = syntax;
  }

  token(): SyntaxToken | undefined {
    return findChildToken(this.syntax, 'Ident');
  }

  value(): boolean | undefined {
    const tok = this.token();
    if (!tok) return undefined;
    if (tok.text === 'true') return true;
    if (tok.text === 'false') return false;
    return undefined;
  }

  static cast(node: SyntaxNode): BooleanLiteralExprAst | undefined {
    return node.kind === 'BooleanLiteralExpr' ? new BooleanLiteralExprAst(node) : undefined;
  }
}

export class ObjectLiteralExprAst implements AstNode {
  readonly syntax: SyntaxNode;

  constructor(syntax: SyntaxNode) {
    this.syntax = syntax;
  }

  lbrace(): SyntaxToken | undefined {
    return findChildToken(this.syntax, 'LBrace');
  }

  rbrace(): SyntaxToken | undefined {
    return findChildToken(this.syntax, 'RBrace');
  }

  *fields(): Iterable<ObjectFieldAst> {
    yield* filterChildren(this.syntax, ObjectFieldAst.cast);
  }

  static cast(node: SyntaxNode): ObjectLiteralExprAst | undefined {
    return node.kind === 'ObjectLiteralExpr' ? new ObjectLiteralExprAst(node) : undefined;
  }
}

export class ObjectFieldAst implements AstNode {
  readonly syntax: SyntaxNode;

  constructor(syntax: SyntaxNode) {
    this.syntax = syntax;
  }

  key(): IdentifierAst | undefined {
    for (const child of this.syntax.children()) {
      if (!(child instanceof SyntaxNode)) {
        if (child.kind === 'Colon') break;
        continue;
      }
      return IdentifierAst.cast(child);
    }
    return undefined;
  }

  /**
   * The field's logical key name, unquoted. An identifier key (`length:`) yields
   * its text; a string-literal key (`"length":`) yields the decoded string.
   * `undefined` when the field carries no key node.
   */
  keyName(): string | undefined {
    for (const child of this.syntax.children()) {
      if (!(child instanceof SyntaxNode)) {
        if (child.kind === 'Colon') break;
        continue;
      }
      const identifier = IdentifierAst.cast(child);
      if (identifier) return identifier.token()?.text;
      const stringKey = StringLiteralExprAst.cast(child);
      if (stringKey) return stringKey.value();
      return undefined;
    }
    return undefined;
  }

  colon(): SyntaxToken | undefined {
    return findChildToken(this.syntax, 'Colon');
  }

  value(): ExpressionAst | undefined {
    if (this.colon()) {
      let pastColon = false;
      for (const child of this.syntax.children()) {
        if (!(child instanceof SyntaxNode)) {
          if (child.kind === 'Colon') pastColon = true;
          continue;
        }
        if (pastColon) {
          const expr = castExpression(child);
          if (expr) return expr;
        }
      }
      return undefined;
    }
    return findFirstChild(this.syntax, castExpression);
  }

  static cast(node: SyntaxNode): ObjectFieldAst | undefined {
    return node.kind === 'ObjectField' ? new ObjectFieldAst(node) : undefined;
  }
}

export type ExpressionAst =
  | FunctionCallAst
  | ArrayLiteralAst
  | StringLiteralExprAst
  | TaggedLiteralExprAst
  | NumberLiteralExprAst
  | BooleanLiteralExprAst
  | ObjectLiteralExprAst
  | IdentifierAst;

export function castExpression(node: SyntaxNode): ExpressionAst | undefined {
  return (
    FunctionCallAst.cast(node) ??
    ArrayLiteralAst.cast(node) ??
    StringLiteralExprAst.cast(node) ??
    TaggedLiteralExprAst.cast(node) ??
    NumberLiteralExprAst.cast(node) ??
    BooleanLiteralExprAst.cast(node) ??
    ObjectLiteralExprAst.cast(node) ??
    IdentifierAst.cast(node)
  );
}

export class AttributeArgAst implements AstNode {
  readonly syntax: SyntaxNode;

  constructor(syntax: SyntaxNode) {
    this.syntax = syntax;
  }

  name(): IdentifierAst | undefined {
    if (!this.colon()) return undefined;
    return findFirstChild(this.syntax, IdentifierAst.cast);
  }

  colon(): SyntaxToken | undefined {
    return findChildToken(this.syntax, 'Colon');
  }

  value(): ExpressionAst | undefined {
    if (this.colon()) {
      let pastColon = false;
      for (const child of this.syntax.children()) {
        if (!(child instanceof SyntaxNode)) {
          if (child.kind === 'Colon') pastColon = true;
          continue;
        }
        if (pastColon) {
          const expr = castExpression(child);
          if (expr) return expr;
        }
      }
      return undefined;
    }
    return findFirstChild(this.syntax, castExpression);
  }

  static cast(node: SyntaxNode): AttributeArgAst | undefined {
    return node.kind === 'AttributeArg' ? new AttributeArgAst(node) : undefined;
  }
}
