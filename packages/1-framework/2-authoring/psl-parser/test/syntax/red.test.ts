import { describe, expect, it } from 'vitest';
import { parse } from '../../src/parse';
import { FieldDeclarationAst, ModelDeclarationAst } from '../../src/syntax/ast/declarations';
import { GreenNodeBuilder } from '../../src/syntax/green-builder';
import { createSyntaxTree, SyntaxNode, SyntaxToken, TokenAtOffset } from '../../src/syntax/red';
import type { SyntaxKind } from '../../src/syntax/syntax-kind';

/** Source rendered by {@link buildSampleTree}, with token offsets used below. */
const SAMPLE_SOURCE = 'model User {\n  id Int @id\n}';

function firstNodeOfKind(root: SyntaxNode, kind: SyntaxKind): SyntaxNode {
  for (const el of root.descendants()) {
    if (el instanceof SyntaxNode && el.kind === kind) return el;
  }
  throw new Error(`no ${kind} node in tree`);
}

/** Builds a tree for: model User {\n  id Int @id\n} */
function buildSampleTree() {
  const b = new GreenNodeBuilder();
  b.startNode('Document');
  b.startNode('ModelDeclaration');
  b.token('Ident', 'model');
  b.token('Whitespace', ' ');
  b.startNode('Identifier');
  b.token('Ident', 'User');
  b.finishNode();
  b.token('Whitespace', ' ');
  b.token('LBrace', '{');
  b.token('Newline', '\n');
  b.token('Whitespace', '  ');
  b.startNode('FieldDeclaration');
  b.startNode('Identifier');
  b.token('Ident', 'id');
  b.finishNode();
  b.token('Whitespace', ' ');
  b.startNode('TypeAnnotation');
  b.token('Ident', 'Int');
  b.finishNode();
  b.token('Whitespace', ' ');
  b.startNode('FieldAttribute');
  b.token('At', '@');
  b.startNode('Identifier');
  b.token('Ident', 'id');
  b.finishNode();
  b.finishNode();
  b.finishNode();
  b.token('Newline', '\n');
  b.token('RBrace', '}');
  b.finishNode();
  return b.finishNode();
}

describe('createSyntaxTree', () => {
  it('wraps green root with offset 0 and no parent', () => {
    const green = buildSampleTree();
    const root = createSyntaxTree(green);
    expect(root.offset).toBe(0);
    expect(root.parent).toBeUndefined();
    expect(root.kind).toBe('Document');
  });
});

describe('SyntaxNode offset correctness', () => {
  it('computes correct offsets for all tokens', () => {
    const source = 'model User {\n  id Int @id\n}';
    const green = buildSampleTree();
    const root = createSyntaxTree(green);

    const tokens = Array.from(root.tokens());
    let expectedOffset = 0;
    for (const tok of tokens) {
      expect(tok.offset).toBe(expectedOffset);
      expectedOffset += tok.text.length;
    }
    expect(expectedOffset).toBe(source.length);
  });

  it('computes correct offset for nested nodes', () => {
    const green = buildSampleTree();
    const root = createSyntaxTree(green);

    // Document at 0
    expect(root.offset).toBe(0);

    // ModelDeclaration at 0
    const model = root.firstChild;
    expect(model).toBeInstanceOf(SyntaxNode);
    if (model instanceof SyntaxNode) {
      expect(model.offset).toBe(0);
      expect(model.kind).toBe('ModelDeclaration');
    }
  });
});

describe('SyntaxNode.parent', () => {
  it('root has undefined parent', () => {
    const root = createSyntaxTree(buildSampleTree());
    expect(root.parent).toBeUndefined();
  });

  it('child nodes point back to parent', () => {
    const root = createSyntaxTree(buildSampleTree());
    const model = root.firstChild;
    expect(model).toBeInstanceOf(SyntaxNode);
    if (model instanceof SyntaxNode) {
      expect(model.parent).toBe(root);
    }
  });
});

describe('SyntaxNode.firstChild / lastChild', () => {
  it('returns first and last children', () => {
    const root = createSyntaxTree(buildSampleTree());
    const model = root.firstChild;
    expect(model).toBeInstanceOf(SyntaxNode);
    expect(root.lastChild).toBeInstanceOf(SyntaxNode);
    // Document has only one child (ModelDeclaration), so first === last by green identity
    if (model instanceof SyntaxNode) {
      expect(model.kind).toBe('ModelDeclaration');
    }
  });

  it('returns undefined for empty node', () => {
    const b = new GreenNodeBuilder();
    b.startNode('Document');
    const green = b.finishNode();
    const root = createSyntaxTree(green);
    expect(root.firstChild).toBeUndefined();
    expect(root.lastChild).toBeUndefined();
  });
});

describe('SyntaxNode.nextSibling / prevSibling', () => {
  it('navigates between siblings', () => {
    // Build a Document with two children: model identifier tokens
    const b = new GreenNodeBuilder();
    b.startNode('Document');
    b.startNode('Identifier');
    b.token('Ident', 'A');
    b.finishNode();
    b.token('Whitespace', ' ');
    b.startNode('Identifier');
    b.token('Ident', 'B');
    b.finishNode();
    const green = b.finishNode();
    const root = createSyntaxTree(green);

    const first = root.firstChild;
    expect(first).toBeInstanceOf(SyntaxNode);
    if (first instanceof SyntaxNode) {
      const next = first.nextSibling;
      // next sibling should be a whitespace token
      expect(next).toBeDefined();
      expect(next).not.toBeInstanceOf(SyntaxNode);
      if (next && !(next instanceof SyntaxNode)) {
        expect(next.kind).toBe('Whitespace');
      }
    }
  });

  it('returns undefined for no sibling', () => {
    const root = createSyntaxTree(buildSampleTree());
    // Root has no parent, so no siblings
    expect(root.nextSibling).toBeUndefined();
    expect(root.prevSibling).toBeUndefined();
  });

  it('navigates prevSibling from last child back', () => {
    const b = new GreenNodeBuilder();
    b.startNode('Document');
    b.startNode('Identifier');
    b.token('Ident', 'A');
    b.finishNode();
    b.token('Whitespace', ' ');
    b.startNode('Identifier');
    b.token('Ident', 'B');
    b.finishNode();
    const green = b.finishNode();
    const root = createSyntaxTree(green);

    // Get the last child node (Identifier "B")
    const children = Array.from(root.children());
    const lastNode = children[2]; // Identifier "B"
    expect(lastNode).toBeInstanceOf(SyntaxNode);
    if (lastNode instanceof SyntaxNode) {
      const prev = lastNode.prevSibling;
      expect(prev).toBeDefined();
      expect(prev).not.toBeInstanceOf(SyntaxNode);
      if (prev && !(prev instanceof SyntaxNode)) {
        expect(prev.kind).toBe('Whitespace');
      }
    }
  });
});

describe('SyntaxElement.index', () => {
  it('assigns 0 to the root and increasing indices along the sibling chain', () => {
    const root = createSyntaxTree(buildSampleTree());
    expect(root.index).toBe(0);

    const model = firstNodeOfKind(root, 'ModelDeclaration');
    const first = model.firstChild;
    expect(first).toBeDefined();
    expect(first?.index).toBe(0);

    const indices: number[] = [];
    for (let el = first; el !== undefined; el = el.nextSiblingOrToken) {
      indices.push(el.index);
    }
    const expected = Array.from(model.children(), (_, i) => i);
    expect(indices).toEqual(expected);
  });

  it('distinguishes a zero-width child from its offset-colliding neighbour', () => {
    const b = new GreenNodeBuilder();
    b.startNode('Document');
    b.startNode('Identifier');
    b.token('Ident', 'A');
    b.finishNode();
    b.startNode('TypeAnnotation'); // empty, zero-width at offset 1
    b.finishNode();
    b.startNode('Identifier');
    b.token('Ident', 'B');
    b.finishNode();
    const root = createSyntaxTree(b.finishNode());

    const children = Array.from(root.children());
    const empty = children[1];
    const second = children[2];
    expect(empty).toBeInstanceOf(SyntaxNode);
    expect(second).toBeInstanceOf(SyntaxNode);
    // The zero-width node and its neighbour share a start offset...
    expect(empty?.offset).toBe(1);
    expect(second?.offset).toBe(1);
    // ...but distinct indices let navigation step between them unambiguously.
    expect(empty?.index).toBe(1);
    expect(second?.index).toBe(2);
    if (empty instanceof SyntaxNode && second instanceof SyntaxNode) {
      expect(empty.nextSibling?.index).toBe(2);
      expect(empty.nextSibling?.kind).toBe('Identifier');
      expect(second.prevSibling?.index).toBe(1);
      expect(second.prevSibling?.kind).toBe('TypeAnnotation');
    }
  });
});

describe('SyntaxNode.textLength', () => {
  it('returns total text length of the subtree', () => {
    const source = 'model User {\n  id Int @id\n}';
    const green = buildSampleTree();
    const root = createSyntaxTree(green);
    expect(root.textLength).toBe(source.length);
  });
});

describe('SyntaxNode.endOffset', () => {
  it('is the sum of offset and textLength', () => {
    const root = createSyntaxTree(buildSampleTree());
    const node = firstNodeOfKind(root, 'FieldDeclaration');
    expect(node.endOffset).toBe(node.offset + node.textLength);
  });
});

describe('SyntaxToken.endOffset', () => {
  it('is the sum of offset and text length', () => {
    const root = createSyntaxTree(buildSampleTree());
    const token = root.tokenAtOffset(19).leftBiased();
    expect(token).toBeInstanceOf(SyntaxToken);
    if (token instanceof SyntaxToken) {
      expect(token.endOffset).toBe(token.offset + token.text.length);
    }
  });
});

describe('SyntaxNode.isInside / isOutside', () => {
  it('is inclusive at start, interior, and end, exclusive just outside', () => {
    const root = createSyntaxTree(buildSampleTree());
    const field = firstNodeOfKind(root, 'FieldDeclaration');
    const start = field.offset;
    const end = field.endOffset;
    expect(field.isInside(start)).toBe(true);
    expect(field.isInside(start + 1)).toBe(true);
    expect(field.isInside(end)).toBe(true);
    expect(field.isInside(start - 1)).toBe(false);
    expect(field.isInside(end + 1)).toBe(false);
  });

  it('isOutside is the negation of isInside', () => {
    const root = createSyntaxTree(buildSampleTree());
    const field = firstNodeOfKind(root, 'FieldDeclaration');
    expect(field.isOutside(field.offset)).toBe(false);
    expect(field.isOutside(field.endOffset + 1)).toBe(true);
  });
});

describe('SyntaxToken.isInside / isOutside', () => {
  it('is inclusive at start, interior, and end, exclusive just outside', () => {
    const root = createSyntaxTree(buildSampleTree());
    const token = root.tokenAtOffset(19).leftBiased();
    expect(token).toBeInstanceOf(SyntaxToken);
    if (token instanceof SyntaxToken) {
      const start = token.offset;
      const end = token.offset + token.text.length;
      expect(token.isInside(start)).toBe(true);
      expect(token.isInside(start + 1)).toBe(true);
      expect(token.isInside(end)).toBe(true);
      expect(token.isInside(start - 1)).toBe(false);
      expect(token.isInside(end + 1)).toBe(false);
    }
  });

  it('isOutside is the negation of isInside', () => {
    const root = createSyntaxTree(buildSampleTree());
    const token = root.tokenAtOffset(19).leftBiased();
    expect(token).toBeInstanceOf(SyntaxToken);
    if (token instanceof SyntaxToken) {
      expect(token.isOutside(token.offset)).toBe(false);
      expect(token.isOutside(token.offset + token.text.length + 1)).toBe(true);
    }
  });
});

describe('SyntaxNode.ancestors', () => {
  it('walks from node to root', () => {
    const root = createSyntaxTree(buildSampleTree());
    // Navigate: Document > ModelDeclaration > first child node
    const model = root.firstChild;
    expect(model).toBeInstanceOf(SyntaxNode);
    if (model instanceof SyntaxNode) {
      const ancestors = Array.from(model.ancestors());
      expect(ancestors).toHaveLength(1);
      expect(ancestors[0]).toBe(root);
    }
  });

  it('yields nothing for root', () => {
    const root = createSyntaxTree(buildSampleTree());
    const ancestors = Array.from(root.ancestors());
    expect(ancestors).toHaveLength(0);
  });
});

describe('SyntaxNode.root', () => {
  it('returns the root itself', () => {
    const root = createSyntaxTree(buildSampleTree());
    expect(root.root()).toBe(root);
  });

  it('returns the original root from a nested node', () => {
    const root = createSyntaxTree(buildSampleTree());
    const field = firstNodeOfKind(root, 'FieldDeclaration');
    const identifier = firstNodeOfKind(field, 'Identifier');
    expect(identifier.root()).toBe(root);
  });
});

describe('SyntaxNode.findAncestor', () => {
  it('returns the node itself when it satisfies the cast', () => {
    const root = createSyntaxTree(buildSampleTree());
    const model = firstNodeOfKind(root, 'ModelDeclaration');
    const found = model.findAncestor(ModelDeclarationAst.cast);
    expect(found?.syntax).toBe(model);
  });

  it('returns the nearest matching ancestor of a descendant', () => {
    const root = createSyntaxTree(buildSampleTree());
    const field = firstNodeOfKind(root, 'FieldDeclaration');
    const identifier = firstNodeOfKind(field, 'Identifier');
    const found = identifier.findAncestor(FieldDeclarationAst.cast);
    expect(found?.syntax).toBe(field);
  });

  it('returns undefined when neither the node nor its ancestors match', () => {
    const root = createSyntaxTree(buildSampleTree());
    expect(root.findAncestor(FieldDeclarationAst.cast)).toBeUndefined();
  });
});

describe('SyntaxToken navigation', () => {
  it('exposes the parent node', () => {
    const root = createSyntaxTree(buildSampleTree());
    const intToken = root.tokenAtOffset(19).leftBiased();
    expect(intToken).toBeInstanceOf(SyntaxToken);
    expect(intToken?.text).toBe('Int');
    expect(intToken?.parent.kind).toBe('TypeAnnotation');
  });

  it('walks nextToken across node boundaries in document order', () => {
    const root = createSyntaxTree(buildSampleTree());
    const expected = Array.from(root.tokens());

    const walked: SyntaxToken[] = [];
    let token = root.firstToken;
    while (token !== undefined) {
      walked.push(token);
      token = token.nextToken;
    }

    expect(walked.map((t) => t.text)).toEqual(expected.map((t) => t.text));
    expect(walked.map((t) => t.offset)).toEqual(expected.map((t) => t.offset));
  });

  it('walks prevToken back to the first token', () => {
    const root = createSyntaxTree(buildSampleTree());
    const expected = Array.from(root.tokens()).reverse();

    const walked: SyntaxToken[] = [];
    let token = root.lastToken;
    while (token !== undefined) {
      walked.push(token);
      token = token.prevToken;
    }

    expect(walked.map((t) => t.text)).toEqual(expected.map((t) => t.text));
  });

  it('returns undefined past the tree edges', () => {
    const root = createSyntaxTree(buildSampleTree());
    expect(root.firstToken?.prevToken).toBeUndefined();
    expect(root.lastToken?.nextToken).toBeUndefined();
  });

  it('navigates sibling-or-token within a node', () => {
    const root = createSyntaxTree(buildSampleTree());
    const field = firstNodeOfKind(root, 'FieldDeclaration');
    const name = field.firstChild;
    expect(name).toBeInstanceOf(SyntaxNode);
    const afterName = name?.nextSiblingOrToken;
    expect(afterName).toBeInstanceOf(SyntaxToken);
    if (afterName instanceof SyntaxToken) {
      expect(afterName.kind).toBe('Whitespace');
      const back = afterName.prevSiblingOrToken;
      expect(back).toBeInstanceOf(SyntaxNode);
      if (back instanceof SyntaxNode) {
        expect(back.kind).toBe('Identifier');
        expect(back.offset).toBe(name?.offset);
      }
    }
  });
});

describe('SyntaxNode.tokenAtOffset', () => {
  it('returns a single token for an offset strictly inside it', () => {
    const root = createSyntaxTree(buildSampleTree());
    const at = root.tokenAtOffset(19);
    expect(at.isBetween).toBe(false);
    expect(at.isEmpty).toBe(false);
    expect(at.leftBiased()?.text).toBe('Int');
    expect(at.rightBiased()).toBe(at.leftBiased());
  });

  it('represents the between-two-tokens seam with left/right bias', () => {
    const root = createSyntaxTree(buildSampleTree());
    // offset 5 sits exactly on the seam between `model` and the following space.
    const at = root.tokenAtOffset(5);
    expect(at.isBetween).toBe(true);
    expect(at.leftBiased()?.text).toBe('model');
    expect(at.leftBiased()?.kind).toBe('Ident');
    expect(at.rightBiased()?.kind).toBe('Whitespace');
  });

  it('left-biases to the final significant token at EOF', () => {
    const root = createSyntaxTree(buildSampleTree());
    const at = root.tokenAtOffset(SAMPLE_SOURCE.length);
    expect(at.leftBiased()?.kind).toBe('RBrace');
    expect(at.leftBiased()?.text).toBe('}');
  });

  it('returns none for an offset outside the tree', () => {
    const root = createSyntaxTree(buildSampleTree());
    const at = root.tokenAtOffset(SAMPLE_SOURCE.length + 50);
    expect(at.isEmpty).toBe(true);
    expect(at.leftBiased()).toBeUndefined();
    expect(at.rightBiased()).toBeUndefined();
  });

  it('returns none for an empty document', () => {
    const b = new GreenNodeBuilder();
    b.startNode('Document');
    const root = createSyntaxTree(b.finishNode());
    expect(root.tokenAtOffset(0).isEmpty).toBe(true);
  });
});

describe('TokenAtOffset public surface', () => {
  it('none exposes no token on either bias', () => {
    const none = TokenAtOffset.none();
    expect(none.isEmpty).toBe(true);
    expect(none.isBetween).toBe(false);
    expect(none.leftBiased()).toBeUndefined();
    expect(none.rightBiased()).toBeUndefined();
  });

  it('single collapses both biases to the same token and is never between', () => {
    const root = createSyntaxTree(buildSampleTree());
    const token = root.tokenAtOffset(19).leftBiased();
    expect(token).toBeInstanceOf(SyntaxToken);
    if (token instanceof SyntaxToken) {
      const single = TokenAtOffset.single(token);
      expect(single.isEmpty).toBe(false);
      expect(single.isBetween).toBe(false);
      expect(single.leftBiased()).toBe(token);
      expect(single.rightBiased()).toBe(token);
    }
  });

  it('between exposes both tokens and is never empty', () => {
    const root = createSyntaxTree(buildSampleTree());
    const seam = root.tokenAtOffset(5);
    const left = seam.leftBiased();
    const right = seam.rightBiased();
    expect(left).toBeInstanceOf(SyntaxToken);
    expect(right).toBeInstanceOf(SyntaxToken);
    if (left instanceof SyntaxToken && right instanceof SyntaxToken) {
      const between = TokenAtOffset.between(left, right);
      expect(between.isEmpty).toBe(false);
      expect(between.isBetween).toBe(true);
      expect(between.leftBiased()).toBe(left);
      expect(between.rightBiased()).toBe(right);
    }
  });
});

describe('SyntaxNode.coveringElement', () => {
  it('descends to the smallest element covering a range', () => {
    const root = createSyntaxTree(buildSampleTree());
    // `Int` token spans [18, 21).
    const covering = root.coveringElement(18, 21);
    expect(covering).toBeInstanceOf(SyntaxToken);
    if (covering instanceof SyntaxToken) {
      expect(covering.text).toBe('Int');
    }
  });

  it('left-biases an empty range at a seam', () => {
    const b = new GreenNodeBuilder();
    b.startNode('Document');
    b.startNode('Identifier');
    b.token('Ident', 'A');
    b.finishNode();
    b.startNode('Identifier');
    b.token('Ident', 'B');
    b.finishNode();
    const root = createSyntaxTree(b.finishNode());

    const covering = root.coveringElement(1, 1);
    expect(covering).toBeInstanceOf(SyntaxToken);
    if (covering instanceof SyntaxToken) {
      expect(covering.text).toBe('A');
    }
  });

  it('returns the root when no child covers the range', () => {
    const b = new GreenNodeBuilder();
    b.startNode('Document');
    const root = createSyntaxTree(b.finishNode());
    expect(root.coveringElement(0, 0)).toBe(root);
  });
});

describe('SyntaxNode.descendants', () => {
  it('yields elements in depth-first pre-order', () => {
    const b = new GreenNodeBuilder();
    b.startNode('Document');
    b.startNode('Identifier');
    b.token('Ident', 'A');
    b.finishNode();
    b.token('Whitespace', ' ');
    b.startNode('Identifier');
    b.token('Ident', 'B');
    b.finishNode();
    const green = b.finishNode();
    const root = createSyntaxTree(green);

    const kinds: string[] = [];
    for (const el of root.descendants()) {
      if (el instanceof SyntaxNode) {
        kinds.push(`node:${el.kind}`);
      } else {
        kinds.push(`token:${el.kind}`);
      }
    }

    expect(kinds).toEqual([
      'node:Document',
      'node:Identifier',
      'token:Ident', // A
      'token:Whitespace',
      'node:Identifier',
      'token:Ident', // B
    ]);
  });
});

describe('zero-width node precondition', () => {
  // The red-tree navigation relies on no non-root node ever being zero-width:
  // the only legitimately empty node is the root `Document` of an empty file,
  // and a root is never reached as a child during descent. Malformed inputs
  // are the cases historically prone to materializing empty placeholder nodes.
  const sources = [
    '',
    'model User { id Int @id }',
    'model A {',
    'model A { id }',
    'model A { id Int @default(,) }',
    'model A { id Int @default() }',
    'model A { id Int @foo(@) }',
    'model A { vec Vector( }',
    'model A { id @id }',
    'type T = Vector(',
    'enum E { A B',
    'model A { id Int @default(autoincrement()) @',
    'model A { name String @extension. }',
  ];

  for (const source of sources) {
    it(`emits no zero-width non-root node for ${JSON.stringify(source)}`, () => {
      const { document } = parse(source, 'test.psl');
      for (const el of document.syntax.descendants()) {
        if (el instanceof SyntaxNode && el.parent !== undefined) {
          expect(el.textLength).toBeGreaterThan(0);
        }
      }
    });
  }
});
