import {
  canonicalizeTaggedLiteralBody,
  type TaggedLiteralCanonicalization,
} from '@internal/framework-components/authoring';
import { resolvePslBacktickEscapes } from '@internal/framework-components/control';
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

  /** The callee when it is a bare name, such as `now` in `now()`; `undefined` when the callee is dotted. */
  name(): QualifiedNameAst | undefined {
    return findFirstChild(this.syntax, QualifiedNameAst.cast);
  }

  /**
   * The callee's segments, in source order. A bare `Vector(…)` yields
   * `['Vector']`; `pgvector.Vector(…)` yields `['pgvector', 'Vector']`;
   * `address.geo.lat(…)` yields `['address', 'geo', 'lat']`. Empty when the
   * call carries no identifier.
   */
  path(): readonly string[] {
    const callee = this.name() ?? this.memberPath();
    return segmentNames(callee?.syntax ?? this.syntax);
  }

  /** The callee when it is dotted, such as `address.city` in `address.city(sort: Asc)`; `undefined` for a bare callee. */
  memberPath(): PathExprAst | undefined {
    return findFirstChild(this.syntax, PathExprAst.cast);
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

function segmentNames(node: SyntaxNode): readonly string[] {
  const segments: string[] = [];
  for (const segment of filterChildren(node, IdentifierAst.cast)) {
    const text = segment.token()?.text;
    if (text !== undefined) segments.push(text);
  }
  return segments;
}

/** A dotted member path in expression position, such as `address.city` in `@@index([address.city])`. */
export class PathExprAst implements AstNode {
  readonly syntax: SyntaxNode;

  constructor(syntax: SyntaxNode) {
    this.syntax = syntax;
  }

  *segments(): Iterable<IdentifierAst> {
    yield* filterChildren(this.syntax, IdentifierAst.cast);
  }

  /**
   * The segment names, in source order: `['address', 'city']` for `address.city`. A path that ends
   * in a `.` with no name after it, as in `address.`, ends in an empty name.
   */
  path(): readonly string[] {
    const segments = segmentNames(this.syntax);
    return this.syntax.lastToken?.kind === 'Dot' ? [...segments, ''] : segments;
  }

  static cast(node: SyntaxNode): PathExprAst | undefined {
    return node.kind === 'PathExpr' ? new PathExprAst(node) : undefined;
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
      case '/':
        out += '/';
        i += 2;
        continue;
      case 'b':
        out += '\b';
        i += 2;
        continue;
      case 'f':
        out += '\f';
        i += 2;
        continue;
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
    return this.quote() === '`' ? resolvePslBacktickEscapes(raw) : decodeStringLiteral(raw);
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

  /** The tag without trivia, e.g. `postgis.geometry`. */
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

  /** The canonical text shared with the TypeScript `sql` tag, or `undefined` when canonicalization fails. */
  text(): string | undefined {
    const result = this.canonicalization();
    return result.ok ? result.text : undefined;
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
  | PathExprAst
  | IdentifierAst;

/** Every dotted path in an expression: the expression itself, a dotted callee, or a path inside a list, record or call argument. */
export function dottedPathsIn(expression: ExpressionAst): readonly PathExprAst[] {
  const paths: PathExprAst[] = [];
  for (const element of expression.syntax.descendants()) {
    const path = element instanceof SyntaxNode ? PathExprAst.cast(element) : undefined;
    if (path !== undefined) paths.push(path);
  }
  return paths;
}

export function castExpression(node: SyntaxNode): ExpressionAst | undefined {
  return (
    FunctionCallAst.cast(node) ??
    ArrayLiteralAst.cast(node) ??
    StringLiteralExprAst.cast(node) ??
    TaggedLiteralExprAst.cast(node) ??
    NumberLiteralExprAst.cast(node) ??
    BooleanLiteralExprAst.cast(node) ??
    ObjectLiteralExprAst.cast(node) ??
    PathExprAst.cast(node) ??
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
