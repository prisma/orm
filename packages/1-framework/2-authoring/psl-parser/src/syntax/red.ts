import type { Token, TokenKind } from '../tokenizer';
import type { GreenElement, GreenNode, GreenToken } from './green';
import type { SyntaxKind } from './syntax-kind';

/**
 * A token in the red tree. Unlike the green-layer {@link Token} (kind + text
 * only), a red token also carries its absolute `offset` within the source and a
 * link back to its `parent` {@link SyntaxNode}, so a cursor anchored on a token
 * can walk outward (parent, previous/next token, siblings) without re-scanning
 * from the document root.
 */
export class SyntaxToken implements Token {
  readonly green: GreenToken;
  readonly kind: TokenKind;
  readonly text: string;
  readonly offset: number;
  readonly parent: SyntaxNode;
  /** Position within the parent's children, enabling O(1) sibling navigation without rescanning the green layer. */
  readonly index: number;

  constructor(green: GreenToken, offset: number, parent: SyntaxNode, index: number) {
    this.green = green;
    this.kind = green.kind;
    this.text = green.text;
    this.offset = offset;
    this.parent = parent;
    this.index = index;
  }

  get textLength(): number {
    return this.text.length;
  }

  get endOffset(): number {
    return this.offset + this.textLength;
  }

  /** Whether `offset` falls within this token, inclusive of both ends. */
  isInside(offset: number): boolean {
    return offset >= this.offset && offset <= this.endOffset;
  }

  isOutside(offset: number): boolean {
    return !this.isInside(offset);
  }

  /** The sibling element immediately after this token within its parent. */
  get nextSiblingOrToken(): SyntaxElement | undefined {
    return childAt(this.parent, this.index + 1);
  }

  /** The sibling element immediately before this token within its parent. */
  get prevSiblingOrToken(): SyntaxElement | undefined {
    return childAt(this.parent, this.index - 1);
  }

  /** The next token in document order, crossing node boundaries. */
  get nextToken(): SyntaxToken | undefined {
    for (let el = climbingNext(this); el !== undefined; el = climbingNext(el)) {
      const token = firstToken(el);
      if (token !== undefined) return token;
    }
    return undefined;
  }

  /** The previous token in document order, crossing node boundaries. */
  get prevToken(): SyntaxToken | undefined {
    for (let el = climbingPrev(this); el !== undefined; el = climbingPrev(el)) {
      const token = lastToken(el);
      if (token !== undefined) return token;
    }
    return undefined;
  }
}

export type SyntaxElement = SyntaxNode | SyntaxToken;

/**
 * The result of {@link SyntaxNode.tokenAtOffset}: an offset can fall outside
 * every token (`none`), strictly inside a single token (`single`), or exactly on
 * the seam between two adjacent tokens (`between`). `leftBiased` / `rightBiased`
 * collapse the seam case to one side; for `single` both return the same token,
 * for `none` both return `undefined`.
 */
type TokenAtOffsetState =
  | { readonly kind: 'none' }
  | { readonly kind: 'single'; readonly token: SyntaxToken }
  | { readonly kind: 'between'; readonly left: SyntaxToken; readonly right: SyntaxToken };

export class TokenAtOffset {
  readonly #state: TokenAtOffsetState;

  private constructor(state: TokenAtOffsetState) {
    this.#state = state;
  }

  static none(): TokenAtOffset {
    return new TokenAtOffset({ kind: 'none' });
  }

  static single(token: SyntaxToken): TokenAtOffset {
    return new TokenAtOffset({ kind: 'single', token });
  }

  static between(left: SyntaxToken, right: SyntaxToken): TokenAtOffset {
    return new TokenAtOffset({ kind: 'between', left, right });
  }

  get isEmpty(): boolean {
    return this.#state.kind === 'none';
  }

  get isBetween(): boolean {
    return this.#state.kind === 'between';
  }

  leftBiased(): SyntaxToken | undefined {
    switch (this.#state.kind) {
      case 'none':
        return undefined;
      case 'single':
        return this.#state.token;
      case 'between':
        return this.#state.left;
    }
  }

  rightBiased(): SyntaxToken | undefined {
    switch (this.#state.kind) {
      case 'none':
        return undefined;
      case 'single':
        return this.#state.token;
      case 'between':
        return this.#state.right;
    }
  }
}

export class SyntaxNode {
  readonly green: GreenNode;
  readonly offset: number;
  readonly parent: SyntaxNode | undefined;
  /** Position within the parent's children, enabling O(1) sibling navigation without rescanning the green layer. */
  readonly index: number;

  constructor(green: GreenNode, offset: number, parent: SyntaxNode | undefined, index: number) {
    this.green = green;
    this.offset = offset;
    this.parent = parent;
    this.index = index;
  }

  get kind(): SyntaxKind {
    return this.green.kind;
  }

  get textLength(): number {
    return this.green.textLength;
  }

  get endOffset(): number {
    return this.offset + this.textLength;
  }

  /** Whether `offset` falls within this node, inclusive of both ends. */
  isInside(offset: number): boolean {
    return offset >= this.offset && offset <= this.endOffset;
  }

  isOutside(offset: number): boolean {
    return !this.isInside(offset);
  }

  get firstChild(): SyntaxElement | undefined {
    return childAt(this, 0);
  }

  get lastChild(): SyntaxElement | undefined {
    const len = this.green.children.length;
    if (len === 0) return undefined;
    return childAt(this, len - 1);
  }

  get nextSibling(): SyntaxElement | undefined {
    return this.parent === undefined ? undefined : childAt(this.parent, this.index + 1);
  }

  get prevSibling(): SyntaxElement | undefined {
    return this.parent === undefined ? undefined : childAt(this.parent, this.index - 1);
  }

  /** The sibling element immediately after this node within its parent. */
  get nextSiblingOrToken(): SyntaxElement | undefined {
    return this.nextSibling;
  }

  /** The sibling element immediately before this node within its parent. */
  get prevSiblingOrToken(): SyntaxElement | undefined {
    return this.prevSibling;
  }

  /** The first token in this subtree (depth-first), or `undefined` if empty. */
  get firstToken(): SyntaxToken | undefined {
    return firstToken(this);
  }

  /** The last token in this subtree (depth-first), or `undefined` if empty. */
  get lastToken(): SyntaxToken | undefined {
    return lastToken(this);
  }

  *children(): Iterable<SyntaxElement> {
    let offset = this.offset;
    let index = 0;
    for (const child of this.green.children) {
      yield wrapElement(child, offset, this, index);
      offset += elementTextLength(child);
      index++;
    }
  }

  *childNodes(): Iterable<SyntaxNode> {
    for (const child of this.children()) {
      if (child instanceof SyntaxNode) yield child;
    }
  }

  root(): SyntaxNode {
    let current: SyntaxNode = this;
    for (const parent of this.ancestors()) {
      current = parent;
    }
    return current;
  }

  *ancestors(): Iterable<SyntaxNode> {
    let current: SyntaxNode | undefined = this.parent;
    while (current) {
      yield current;
      current = current.parent;
    }
  }

  /** The nearest match, testing this node itself before walking its ancestors. */
  findAncestor<T>(cast: (node: SyntaxNode) => T | undefined): T | undefined {
    const self = cast(this);
    if (self !== undefined) {
      return self;
    }
    for (const ancestor of this.ancestors()) {
      const result = cast(ancestor);
      if (result !== undefined) {
        return result;
      }
    }
    return undefined;
  }

  *descendants(): Iterable<SyntaxElement> {
    const stack: SyntaxElement[] = [this];
    for (let el = stack.pop(); el !== undefined; el = stack.pop()) {
      yield el;
      if (el instanceof SyntaxNode) {
        const children = Array.from(el.children());
        for (let i = children.length - 1; i >= 0; i--) {
          const child = children[i];
          if (child !== undefined) {
            stack.push(child);
          }
        }
      }
    }
  }

  *tokens(): Iterable<SyntaxToken> {
    for (const el of this.descendants()) {
      if (el instanceof SyntaxToken) {
        yield el;
      }
    }
  }

  /**
   * The token(s) at `offset`. The between-two-tokens case (offset exactly on a
   * token seam) is represented explicitly so callers can left/right bias.
   */
  tokenAtOffset(offset: number): TokenAtOffset {
    return tokenAtOffsetOf(this, offset);
  }

  /**
   * The smallest element fully containing the range `[start, end]`. At a seam
   * (and for empty ranges) the left-hand element is preferred, matching
   * {@link containsOffset}'s inclusive span.
   */
  coveringElement(start: number, end: number): SyntaxElement {
    let result: SyntaxElement = this;
    for (;;) {
      if (result instanceof SyntaxToken) return result;
      let next: SyntaxElement | undefined;
      for (const child of result.children()) {
        if (containsRange(child, start, end)) {
          next = child;
          break;
        }
      }
      if (next === undefined) return result;
      result = next;
    }
  }
}

function elementTextLength(el: GreenElement): number {
  return el.type === 'token' ? el.text.length : el.textLength;
}

function elementLength(el: SyntaxElement): number {
  return el instanceof SyntaxToken ? el.text.length : el.textLength;
}

/**
 * Whether `el` contains `offset`. The span is inclusive on both ends so a seam
 * offset touches both neighbours.
 */
function containsOffset(el: SyntaxElement, offset: number): boolean {
  const start = el.offset;
  const len = elementLength(el);
  return offset >= start && offset <= start + len;
}

function containsRange(el: SyntaxElement, start: number, end: number): boolean {
  const elStart = el.offset;
  const len = elementLength(el);
  return elStart <= start && end <= elStart + len;
}

function tokenAtOffsetOf(el: SyntaxElement, offset: number): TokenAtOffset {
  if (el instanceof SyntaxToken) {
    return TokenAtOffset.single(el);
  }
  let left: SyntaxElement | undefined;
  let right: SyntaxElement | undefined;
  for (const child of el.children()) {
    if (!containsOffset(child, offset)) continue;
    if (left === undefined) {
      left = child;
    } else {
      right = child;
      break;
    }
  }
  if (left === undefined) return TokenAtOffset.none();
  if (right === undefined) return tokenAtOffsetOf(left, offset);
  const leftToken = tokenAtOffsetOf(left, offset).rightBiased();
  const rightToken = tokenAtOffsetOf(right, offset).leftBiased();
  if (leftToken !== undefined && rightToken !== undefined) {
    return TokenAtOffset.between(leftToken, rightToken);
  }
  if (leftToken !== undefined) return TokenAtOffset.single(leftToken);
  if (rightToken !== undefined) return TokenAtOffset.single(rightToken);
  return TokenAtOffset.none();
}

function firstToken(el: SyntaxElement): SyntaxToken | undefined {
  if (el instanceof SyntaxToken) return el;
  for (const child of el.children()) {
    const token = firstToken(child);
    if (token !== undefined) return token;
  }
  return undefined;
}

function lastToken(el: SyntaxElement): SyntaxToken | undefined {
  if (el instanceof SyntaxToken) return el;
  const children = Array.from(el.children());
  for (let i = children.length - 1; i >= 0; i--) {
    const child = children[i];
    if (child !== undefined) {
      const token = lastToken(child);
      if (token !== undefined) return token;
    }
  }
  return undefined;
}

function climbingNext(el: SyntaxElement): SyntaxElement | undefined {
  let current: SyntaxElement = el;
  for (;;) {
    const parent = current.parent;
    if (parent === undefined) return undefined;
    const sibling = childAt(parent, current.index + 1);
    if (sibling !== undefined) return sibling;
    current = parent;
  }
}

function climbingPrev(el: SyntaxElement): SyntaxElement | undefined {
  let current: SyntaxElement = el;
  for (;;) {
    const parent = current.parent;
    if (parent === undefined) return undefined;
    const sibling = childAt(parent, current.index - 1);
    if (sibling !== undefined) return sibling;
    current = parent;
  }
}

function wrapElement(
  green: GreenElement,
  offset: number,
  parent: SyntaxNode,
  index: number,
): SyntaxElement {
  if (green.type === 'token') {
    return new SyntaxToken(green, offset, parent, index);
  }
  return new SyntaxNode(green, offset, parent, index);
}

function childAt(node: SyntaxNode, index: number): SyntaxElement | undefined {
  const children = node.green.children;
  const target = children[index];
  if (target === undefined) return undefined;
  let offset = node.offset;
  for (let i = 0; i < index; i++) {
    const child = children[i];
    if (child !== undefined) {
      offset += elementTextLength(child);
    }
  }
  return wrapElement(target, offset, node, index);
}

export function createSyntaxTree(green: GreenNode): SyntaxNode {
  return new SyntaxNode(green, 0, undefined, 0);
}
