import { describe, expect, it } from 'vitest';
import {
  Cursor,
  parseArrayLiteral,
  parseAttribute,
  parseAttributeArg,
  parseAttributeArgList,
  parseBooleanLiteralExpr,
  parseExpression,
  parseFunctionCall,
  parseIdentifierExpr,
  parseNumberLiteralExpr,
  parseObjectLiteralExpr,
  parseQualifiedName,
  parseStringLiteralExpr,
  parseTypeAnnotation,
} from '../src/parse';
import {
  AttributeArgAst,
  NumberLiteralExprAst,
  ObjectLiteralExprAst,
  StringLiteralExprAst,
} from '../src/syntax/ast/expressions';
import { IdentifierAst } from '../src/syntax/ast/identifier';
import type { GreenElement, GreenNode } from '../src/syntax/green';
import { createSyntaxTree } from '../src/syntax/red';
import { highlight, printTree } from './support';

function greenText(element: GreenElement): string {
  if (element.type === 'token') return element.text;
  return element.children.map(greenText).join('');
}

describe('offset tracking', () => {
  it('maps a diagnostic range through interspersed trivia using the running offset', () => {
    // The second `.` is the offending separator; a newline precedes it, so its
    // start offset is only correct if every consumed token (the leading
    // segments and that trivia) advanced the running offset counter.
    const source = 'a.b\n.c';
    const { diagnostics, cursor } = parseTypeAnnotationTree(source);

    expect(diagnostics).toHaveLength(1);
    expect(diagnostics[0]!.code).toBe('PSL_INVALID_QUALIFIED_NAME');
    expect(highlight(cursor.sourceFile, diagnostics[0]!.range)).toMatchInlineSnapshot(`
      "
      a.b
      .c
      ~
      "
    `);
  });
});

describe('peekKind', () => {
  it('reports upcoming significant kinds without consuming or emitting trivia', () => {
    const cursor = new Cursor('test.psl', '  model User');
    expect(cursor.peekKind()).toBe('Ident');
    expect(cursor.peekKind(1)).toBe('Ident');
    // repeated peeks are stable — nothing was consumed
    expect(cursor.peekKind()).toBe('Ident');
    expect(cursor.diagnostics).toHaveLength(0);

    cursor.startNode('Document');
    cursor.bump();
    const doc = cursor.finishNode();
    // the leading whitespace skipped by peek is still present once we bump
    expect(doc.children[0]).toEqual({ type: 'token', kind: 'Whitespace', text: '  ' });
    expect(doc.children[1]).toEqual({ type: 'token', kind: 'Ident', text: 'model' });
  });
});

describe('recoverToSyncPoint', () => {
  it('appends raw tokens up to the next Newline and stops before it', () => {
    const cursor = new Cursor('test.psl', 'broken stuff\nnext');
    cursor.startNode('Document');
    cursor.recoverToSyncPoint();
    const node = cursor.finishNode();
    expect(greenText(node)).toBe('broken stuff');
    expect(cursor.peekKind()).toBe('Ident');
  });

  it('stops before the enclosing RBrace', () => {
    const cursor = new Cursor('test.psl', 'junk}');
    cursor.startNode('Document');
    cursor.recoverToSyncPoint();
    const node = cursor.finishNode();
    expect(greenText(node)).toBe('junk');
    expect(cursor.peekKind()).toBe('RBrace');
  });

  it('stops at Eof', () => {
    const cursor = new Cursor('test.psl', 'only garbage here');
    cursor.startNode('Document');
    cursor.recoverToSyncPoint();
    const node = cursor.finishNode();
    expect(greenText(node)).toBe('only garbage here');
    expect(cursor.peekKind()).toBe('Eof');
  });
});

function parse(source: string, run: (cursor: Cursor) => GreenNode) {
  const cursor = new Cursor('test.psl', source);
  const node = run(cursor);
  return { node, diagnostics: cursor.diagnostics, cursor };
}

// `parseTypeAnnotation` returns void and emits no node for an empty type, so
// these well-formed cases are wrapped in a synthetic root to recover the
// emitted `TypeAnnotation` subtree.
function parseTypeAnnotationTree(source: string) {
  const cursor = new Cursor('test.psl', source);
  cursor.startNode('Document');
  parseTypeAnnotation(cursor);
  const root = cursor.finishNode();
  const node = root.children[0];
  if (node === undefined || node.type !== 'node') {
    throw new Error('expected parseTypeAnnotation to emit a TypeAnnotation node');
  }
  return { node, diagnostics: cursor.diagnostics, cursor };
}

// `parseAttributeArg` returns void and emits no node for an empty argument, so
// these content-bearing cases are wrapped in a synthetic root to recover the
// emitted `AttributeArg` subtree.
function parseAttributeArgTree(source: string) {
  const cursor = new Cursor('test.psl', source);
  cursor.startNode('Document');
  parseAttributeArg(cursor);
  const root = cursor.finishNode();
  const node = root.children[0];
  if (node === undefined || node.type !== 'node') {
    throw new Error('expected parseAttributeArg to emit an AttributeArg node');
  }
  return { node, diagnostics: cursor.diagnostics, cursor };
}

describe('parseAttribute well-formed', () => {
  it('parses a simple field attribute', () => {
    const source = '@id';
    const { node, diagnostics } = parse(source, parseAttribute);

    expect(printTree(node)).toMatchInlineSnapshot(`
      "FieldAttribute
        At "@"
        QualifiedName
          Identifier
            Ident "id""
    `);
    expect(greenText(node)).toBe(source);
    expect(diagnostics).toHaveLength(0);
  });

  it('parses a namespaced field attribute', () => {
    const source = '@extension.VarChar';
    const { node, diagnostics } = parse(source, parseAttribute);

    expect(printTree(node)).toMatchInlineSnapshot(`
      "FieldAttribute
        At "@"
        QualifiedName
          Identifier
            Ident "extension"
          Dot "."
          Identifier
            Ident "VarChar""
    `);
    expect(greenText(node)).toBe(source);
    expect(diagnostics).toHaveLength(0);
  });

  it('parses a field attribute with an argument list', () => {
    const source = '@default(autoincrement())';
    const { node, diagnostics } = parse(source, parseAttribute);

    expect(printTree(node)).toMatchInlineSnapshot(`
      "FieldAttribute
        At "@"
        QualifiedName
          Identifier
            Ident "default"
        AttributeArgList
          LParen "("
          AttributeArg
            FunctionCall
              QualifiedName
                Identifier
                  Ident "autoincrement"
              LParen "("
              RParen ")"
          RParen ")""
    `);
    expect(greenText(node)).toBe(source);
    expect(diagnostics).toHaveLength(0);
  });

  it('parses a block attribute with a double-at', () => {
    const source = '@@map';
    const { node, diagnostics } = parse(source, parseAttribute);

    expect(printTree(node)).toMatchInlineSnapshot(`
      "ModelAttribute
        DoubleAt "@@"
        QualifiedName
          Identifier
            Ident "map""
    `);
    expect(greenText(node)).toBe(source);
    expect(diagnostics).toHaveLength(0);
  });
});

describe('parseAttributeArg well-formed', () => {
  it('parses a positional identifier argument', () => {
    const source = 'id';
    const { node, diagnostics } = parseAttributeArgTree(source);

    expect(printTree(node)).toMatchInlineSnapshot(`
      "AttributeArg
        Identifier
          Ident "id""
    `);
    expect(greenText(node)).toBe(source);
    expect(diagnostics).toHaveLength(0);
  });

  it('parses a named argument with a colon and array value', () => {
    const source = 'fields: [id]';
    const { node, diagnostics } = parseAttributeArgTree(source);

    expect(printTree(node)).toMatchInlineSnapshot(`
      "AttributeArg
        Identifier
          Ident "fields"
        Colon ":"
        Whitespace " "
        ArrayLiteral
          LBracket "["
          Identifier
            Ident "id"
          RBracket "]""
    `);
    expect(greenText(node)).toBe(source);
    expect(diagnostics).toHaveLength(0);
  });
});

describe('parseAttributeArgList well-formed', () => {
  it('parses an empty argument list', () => {
    const source = '()';
    const { node, diagnostics } = parse(source, parseAttributeArgList);

    expect(printTree(node)).toMatchInlineSnapshot(`
      "AttributeArgList
        LParen "("
        RParen ")""
    `);
    expect(greenText(node)).toBe(source);
    expect(diagnostics).toHaveLength(0);
  });

  it('parses a comma-separated positional list, attaching inter-arg trivia to the list', () => {
    const source = '(id, name)';
    const { node, diagnostics } = parse(source, parseAttributeArgList);

    expect(printTree(node)).toMatchInlineSnapshot(`
      "AttributeArgList
        LParen "("
        AttributeArg
          Identifier
            Ident "id"
        Comma ","
        Whitespace " "
        AttributeArg
          Identifier
            Ident "name"
        RParen ")""
    `);
    expect(greenText(node)).toBe(source);
    expect(diagnostics).toHaveLength(0);
  });
});

describe('parseExpression well-formed', () => {
  it('parses an array literal with inter-element trivia attached to the array', () => {
    const source = '[id, name]';
    const { node, diagnostics } = parse(source, (c) => parseExpression(c) as GreenNode);

    expect(printTree(node)).toMatchInlineSnapshot(`
      "ArrayLiteral
        LBracket "["
        Identifier
          Ident "id"
        Comma ","
        Whitespace " "
        Identifier
          Ident "name"
        RBracket "]""
    `);
    expect(greenText(node)).toBe(source);
    expect(diagnostics).toHaveLength(0);
  });

  it('parses a function call with empty parens', () => {
    const source = 'autoincrement()';
    const { node, diagnostics } = parse(source, (c) => parseExpression(c) as GreenNode);

    expect(printTree(node)).toMatchInlineSnapshot(`
      "FunctionCall
        QualifiedName
          Identifier
            Ident "autoincrement"
        LParen "("
        RParen ")""
    `);
    expect(greenText(node)).toBe(source);
    expect(diagnostics).toHaveLength(0);
  });

  it('parses a string literal', () => {
    const source = '"hello"';
    const { node } = parse(source, (c) => parseExpression(c) as GreenNode);
    expect(node.kind).toBe('StringLiteralExpr');
    expect(greenText(node)).toBe(source);
  });

  it('parses a number literal', () => {
    const source = '42';
    const { node } = parse(source, (c) => parseExpression(c) as GreenNode);
    expect(node.kind).toBe('NumberLiteralExpr');
    expect(greenText(node)).toBe(source);
  });

  it('parses boolean idents as boolean literal expressions', () => {
    const source = 'true';
    const { node } = parse(source, (c) => parseExpression(c) as GreenNode);
    expect(node.kind).toBe('BooleanLiteralExpr');
    expect(greenText(node)).toBe(source);
  });
});

describe('parseTypeAnnotation well-formed', () => {
  it('parses a bare reference', () => {
    const source = 'String';
    const { node, diagnostics } = parseTypeAnnotationTree(source);

    expect(printTree(node)).toMatchInlineSnapshot(`
      "TypeAnnotation
        QualifiedName
          Identifier
            Ident "String""
    `);
    expect(greenText(node)).toBe(source);
    expect(diagnostics).toHaveLength(0);
  });

  it('parses a dot-qualified reference', () => {
    const source = 'auth.User';
    const { node, diagnostics } = parseTypeAnnotationTree(source);

    expect(printTree(node)).toMatchInlineSnapshot(`
      "TypeAnnotation
        QualifiedName
          Identifier
            Ident "auth"
          Dot "."
          Identifier
            Ident "User""
    `);
    expect(greenText(node)).toBe(source);
    expect(diagnostics).toHaveLength(0);
  });

  it('parses a colon-prefixed cross-space reference with namespace and optional suffix', () => {
    const source = 'supabase:auth.User?';
    const { node, diagnostics } = parseTypeAnnotationTree(source);

    expect(printTree(node)).toMatchInlineSnapshot(`
      "TypeAnnotation
        QualifiedName
          Identifier
            Ident "supabase"
          Colon ":"
          Identifier
            Ident "auth"
          Dot "."
          Identifier
            Ident "User"
        Question "?""
    `);
    expect(greenText(node)).toBe(source);
    expect(diagnostics).toHaveLength(0);
  });

  it('parses a colon-prefixed reference without namespace', () => {
    const source = 'supabase:User';
    const { node, diagnostics } = parseTypeAnnotationTree(source);

    expect(printTree(node)).toMatchInlineSnapshot(`
      "TypeAnnotation
        QualifiedName
          Identifier
            Ident "supabase"
          Colon ":"
          Identifier
            Ident "User""
    `);
    expect(greenText(node)).toBe(source);
    expect(diagnostics).toHaveLength(0);
  });

  it('parses an inline constructor call', () => {
    const source = 'Vector(1536)';
    const { node, diagnostics } = parseTypeAnnotationTree(source);

    expect(printTree(node)).toMatchInlineSnapshot(`
      "TypeAnnotation
        QualifiedName
          Identifier
            Ident "Vector"
        AttributeArgList
          LParen "("
          AttributeArg
            NumberLiteralExpr
              NumberLiteral "1536"
          RParen ")""
    `);
    expect(greenText(node)).toBe(source);
    expect(diagnostics).toHaveLength(0);
  });

  it('parses a namespace-qualified constructor call into a single FunctionCall chain', () => {
    const source = 'pgvector.Vector(1536)';
    const { node, diagnostics } = parseTypeAnnotationTree(source);

    expect(printTree(node)).toMatchInlineSnapshot(`
      "TypeAnnotation
        QualifiedName
          Identifier
            Ident "pgvector"
          Dot "."
          Identifier
            Ident "Vector"
        AttributeArgList
          LParen "("
          AttributeArg
            NumberLiteralExpr
              NumberLiteral "1536"
          RParen ")""
    `);
    expect(greenText(node)).toBe(source);
    expect(diagnostics).toHaveLength(0);
  });

  it('parses a qualified constructor with a named argument and an optional suffix', () => {
    const source = 'pgvector.Vector(length: 1536)?';
    const { node, diagnostics } = parseTypeAnnotationTree(source);

    expect(printTree(node)).toMatchInlineSnapshot(`
      "TypeAnnotation
        QualifiedName
          Identifier
            Ident "pgvector"
          Dot "."
          Identifier
            Ident "Vector"
        AttributeArgList
          LParen "("
          AttributeArg
            Identifier
              Ident "length"
            Colon ":"
            Whitespace " "
            NumberLiteralExpr
              NumberLiteral "1536"
          RParen ")"
        Question "?""
    `);
    expect(greenText(node)).toBe(source);
    expect(diagnostics).toHaveLength(0);
  });

  it('parses a list suffix', () => {
    const source = 'String[]';
    const { node, diagnostics } = parseTypeAnnotationTree(source);

    expect(printTree(node)).toMatchInlineSnapshot(`
      "TypeAnnotation
        QualifiedName
          Identifier
            Ident "String"
        LBracket "["
        RBracket "]""
    `);
    expect(greenText(node)).toBe(source);
    expect(diagnostics).toHaveLength(0);
  });
});

describe('parseTypeAnnotation fault tolerance', () => {
  it('flags triple-dot over-qualification but still yields a subtree that round-trips', () => {
    const source = 'a.b.c';
    const { node, diagnostics, cursor } = parseTypeAnnotationTree(source);

    expect(node.kind).toBe('TypeAnnotation');
    expect(greenText(node)).toBe(source);
    expect(diagnostics).toHaveLength(1);
    expect(diagnostics[0]!.code).toBe('PSL_INVALID_QUALIFIED_NAME');
    expect(diagnostics[0]!.message).toBe('Qualified name has too many segments');
    expect(highlight(cursor.sourceFile, diagnostics[0]!.range)).toMatchInlineSnapshot(`
      "
      a.b.c
         ~
      "
    `);
  });

  it('flags double-colon over-qualification but still yields a subtree', () => {
    const source = 'a:b:c';
    const { node, diagnostics, cursor } = parseTypeAnnotationTree(source);

    expect(node.kind).toBe('TypeAnnotation');
    expect(greenText(node)).toBe(source);
    expect(diagnostics).toHaveLength(1);
    expect(diagnostics[0]!.code).toBe('PSL_INVALID_QUALIFIED_NAME');
    expect(diagnostics[0]!.message).toBe('Qualified name has too many segments');
    expect(highlight(cursor.sourceFile, diagnostics[0]!.range)).toMatchInlineSnapshot(`
      "
      a:b:c
         ~
      "
    `);
  });

  it('flags a trailing dot with no following segment', () => {
    const source = 'Int.';
    const { node, diagnostics } = parseTypeAnnotationTree(source);

    expect(node.kind).toBe('TypeAnnotation');
    expect(greenText(node)).toBe(source);
    expect(diagnostics).toHaveLength(1);
    expect(diagnostics[0]!.code).toBe('PSL_INVALID_QUALIFIED_NAME');
    expect(diagnostics[0]!.message).toBe('Qualified name is missing a name after the separator');
  });

  it('flags a trailing colon with no following segment', () => {
    const source = 'supabase:';
    const { node, diagnostics } = parseTypeAnnotationTree(source);

    expect(node.kind).toBe('TypeAnnotation');
    expect(greenText(node)).toBe(source);
    expect(diagnostics).toHaveLength(1);
    expect(diagnostics[0]!.code).toBe('PSL_INVALID_QUALIFIED_NAME');
  });
});

describe('parseQualifiedName', () => {
  const run = (cursor: Cursor): GreenNode => {
    parseQualifiedName(cursor);
    cursor.startNode('Document');
    while (cursor.peekKind() !== 'Eof') cursor.bump();
    cursor.flushTrivia();
    return cursor.finishNode();
  };

  it('consumes a space:namespace.name chain into one QualifiedName, round-tripping', () => {
    const source = 'supabase:auth.User';
    const cursor = new Cursor('test.psl', source);
    parseQualifiedName(cursor);
    cursor.startNode('Document');
    cursor.flushTrivia();
    const trailing = cursor.finishNode();
    expect(cursor.diagnostics).toEqual([]);
    expect(cursor.peekKind()).toBe('Eof');
    expect(greenText(trailing)).toBe('');
  });

  it('stops at the first non-segment token, leaving it for the caller to peek', () => {
    // The `(` is left unconsumed: the caller decides constructor-vs-reference.
    const cursor = new Cursor('test.psl', 'pgvector.Vector(1536)');
    parseQualifiedName(cursor);
    expect(cursor.peekKind()).toBe('LParen');
    expect(cursor.diagnostics).toEqual([]);
  });

  it('emits PSL_INVALID_QUALIFIED_NAME for over-qualification, uniformly in every position', () => {
    const { diagnostics } = parse('a.b.c', run);
    expect(diagnostics).toHaveLength(1);
    expect(diagnostics[0]!.code).toBe('PSL_INVALID_QUALIFIED_NAME');
    expect(diagnostics[0]!.message).toBe('Qualified name has too many segments');
  });
});

describe('parseAttribute fault tolerance', () => {
  it('flags a bare at with no name but still yields an attribute subtree', () => {
    const source = '@';
    const { node, diagnostics, cursor } = parse(source, parseAttribute);

    expect(node.kind).toBe('FieldAttribute');
    expect(greenText(node)).toBe(source);
    expect(diagnostics).toHaveLength(1);
    expect(diagnostics[0]!.code).toBe('PSL_INVALID_ATTRIBUTE_SYNTAX');
    expect(diagnostics[0]!.message).toBe('Attribute name expected');
    expect(highlight(cursor.sourceFile, diagnostics[0]!.range)).toMatchInlineSnapshot(`
      "
      @
      ~
      "
    `);
  });

  it('flags a missing name after a dotted attribute segment', () => {
    const source = '@ns.';
    const { node, diagnostics, cursor } = parse(source, parseAttribute);

    expect(node.kind).toBe('FieldAttribute');
    expect(greenText(node)).toBe(source);
    expect(diagnostics).toHaveLength(1);
    expect(diagnostics[0]!.code).toBe('PSL_INVALID_QUALIFIED_NAME');
    expect(diagnostics[0]!.message).toBe('Qualified name is missing a name after the separator');
    expect(highlight(cursor.sourceFile, diagnostics[0]!.range)).toMatchInlineSnapshot(`
      "
      @ns.
          ~
      "
    `);
  });
});

describe('argument-position object literal', () => {
  it('parses an object literal argument into an ObjectLiteralExpr queryable via fields()', () => {
    const source = '{ a: 1, b: "x" }';
    const { node, diagnostics } = parseAttributeArgTree(source);

    expect(node.kind).toBe('AttributeArg');
    expect(greenText(node)).toBe(source);
    expect(diagnostics).toHaveLength(0);

    const obj = AttributeArgAst.cast(createSyntaxTree(node))!.value();
    expect(obj).toBeInstanceOf(ObjectLiteralExprAst);
    if (obj instanceof ObjectLiteralExprAst) {
      const fields = Array.from(obj.fields());
      expect(fields).toHaveLength(2);
      expect(fields[0]!.key()?.token()?.text).toBe('a');
      expect(fields[0]!.value()).toBeInstanceOf(NumberLiteralExprAst);
      expect(fields[1]!.key()?.token()?.text).toBe('b');
      expect(fields[1]!.value()).toBeInstanceOf(StringLiteralExprAst);
    }
  });

  it('parses a nested object literal recursively, round-tripping losslessly', () => {
    const source = '{ a: { b: 1 } }';
    const { node, diagnostics } = parseAttributeArgTree(source);
    expect(greenText(node)).toBe(source);
    expect(diagnostics).toHaveLength(0);

    const obj = AttributeArgAst.cast(createSyntaxTree(node))!.value();
    expect(obj).toBeInstanceOf(ObjectLiteralExprAst);
    if (obj instanceof ObjectLiteralExprAst) {
      const [field] = Array.from(obj.fields());
      expect(field!.value()).toBeInstanceOf(ObjectLiteralExprAst);
    }
  });

  it('allows a trailing comma', () => {
    const source = '{ a: 1, }';
    const { node, diagnostics } = parseAttributeArgTree(source);
    expect(greenText(node)).toBe(source);
    expect(diagnostics).toHaveLength(0);

    const obj = AttributeArgAst.cast(createSyntaxTree(node))!.value();
    expect(obj).toBeInstanceOf(ObjectLiteralExprAst);
    if (obj instanceof ObjectLiteralExprAst) {
      expect(Array.from(obj.fields())).toHaveLength(1);
    }
  });

  it('reports a missing colon but still yields a best-effort node and round-trips', () => {
    const source = '{ a 1 }';
    const { node, diagnostics } = parseAttributeArgTree(source);
    expect(greenText(node)).toBe(source);
    expect(diagnostics).toHaveLength(1);
    expect(diagnostics[0]!.code).toBe('PSL_INVALID_OBJECT_LITERAL');
    expect(diagnostics[0]!.message).toBe('Expected ":" after "a"');
    expect(AttributeArgAst.cast(createSyntaxTree(node))!.value()).toBeInstanceOf(
      ObjectLiteralExprAst,
    );
  });

  it('reports a missing value but still yields a best-effort node and round-trips', () => {
    const source = '{ a: }';
    const { node, diagnostics } = parseAttributeArgTree(source);
    expect(greenText(node)).toBe(source);
    expect(diagnostics).toHaveLength(1);
    expect(diagnostics[0]!.code).toBe('PSL_INVALID_OBJECT_LITERAL');
    expect(diagnostics[0]!.message).toBe('Expected a value after ":"');
  });

  it('reports an unterminated object literal anchored on the opening brace', () => {
    const source = '{ a: 1';
    const { node, diagnostics, cursor } = parseAttributeArgTree(source);
    expect(greenText(node)).toBe(source);
    expect(diagnostics).toHaveLength(1);
    expect(diagnostics[0]!.code).toBe('PSL_INVALID_OBJECT_LITERAL');
    expect(diagnostics[0]!.message).toBe('Unterminated object literal');
    expect(highlight(cursor.sourceFile, diagnostics[0]!.range)).toMatchInlineSnapshot(`
      "
      { a: 1
      ~
      "
    `);
  });

  it('accepts a string-literal key, exposing the unquoted name', () => {
    const source = '{ "k": 1 }';
    const { node, diagnostics } = parseAttributeArgTree(source);
    expect(greenText(node)).toBe(source); // round-trip holds, object terminated
    expect(diagnostics).toEqual([]);

    const obj = AttributeArgAst.cast(createSyntaxTree(node))!.value();
    expect(obj).toBeInstanceOf(ObjectLiteralExprAst);
    if (obj instanceof ObjectLiteralExprAst) {
      const field = Array.from(obj.fields())[0];
      expect(field!.keyName()).toBe('k');
      expect(field!.value()).toBeInstanceOf(NumberLiteralExprAst);
    }
  });

  it('accepts a mix of identifier and string-literal keys with no diagnostics', () => {
    const source = '{ a: 1, "k": 2 }';
    const { node, diagnostics } = parseAttributeArgTree(source);
    expect(greenText(node)).toBe(source); // round-trip holds
    expect(diagnostics).toEqual([]);

    const obj = AttributeArgAst.cast(createSyntaxTree(node))!.value();
    expect(obj).toBeInstanceOf(ObjectLiteralExprAst);
    if (obj instanceof ObjectLiteralExprAst) {
      const fields = Array.from(obj.fields());
      expect(fields).toHaveLength(2);
      expect(fields[0]!.keyName()).toBe('a');
      expect(fields[1]!.keyName()).toBe('k');
      expect(fields[0]!.value()).toBeInstanceOf(NumberLiteralExprAst);
      expect(fields[1]!.value()).toBeInstanceOf(NumberLiteralExprAst);
    }
  });
});

function expectNoOpReject(source: string, run: (cursor: Cursor) => GreenNode | undefined): void {
  const cursor = new Cursor('test.psl', source);
  expect(run(cursor)).toBeUndefined();
  expect(cursor.diagnostics).toEqual([]);
  cursor.startNode('Document');
  while (cursor.peekKind() !== 'Eof') {
    cursor.bump();
  }
  cursor.flushTrivia();
  expect(greenText(cursor.finishNode())).toBe(source);
}

describe('expression alternatives are no-ops on non-match', () => {
  it('parseStringLiteralExpr rejects a non-string token without consuming', () => {
    expectNoOpReject('42', parseStringLiteralExpr);
  });

  it('parseNumberLiteralExpr rejects a non-number token without consuming', () => {
    expectNoOpReject('"hi"', parseNumberLiteralExpr);
  });

  it('parseArrayLiteral rejects a non-bracket token without consuming', () => {
    expectNoOpReject('foo', parseArrayLiteral);
  });

  it('parseFunctionCall rejects an identifier with no following paren without consuming', () => {
    expectNoOpReject('foo', parseFunctionCall);
  });

  it('parseFunctionCall rejects a dotted reference with no following paren without consuming', () => {
    // `a.b` (no parens) must not be committed as a paren-less FunctionCall — the
    // lookahead requires the trailing `(` before the node is started.
    expectNoOpReject('a.b', parseFunctionCall);
  });

  it('parseBooleanLiteralExpr rejects a non-boolean identifier without consuming', () => {
    expectNoOpReject('foo', parseBooleanLiteralExpr);
  });

  it('parseIdentifierExpr rejects a non-identifier token without consuming', () => {
    expectNoOpReject('42', parseIdentifierExpr);
  });

  it('parseObjectLiteralExpr rejects a non-brace token without consuming', () => {
    expectNoOpReject('foo', parseObjectLiteralExpr);
  });
});

function parseStringValue(literal: string): string | undefined {
  const { node } = parse(literal, (c) => parseExpression(c) as GreenNode);
  const expr = StringLiteralExprAst.cast(createSyntaxTree(node));
  return expr?.value();
}

describe('StringLiteralExprAst.value() escape decoding', () => {
  it('decodes \\xHH to the matching code unit', () => {
    expect(parseStringValue('"\\x41"')).toBe('A');
  });

  it('decodes \\uHHHH to the matching code unit', () => {
    expect(parseStringValue('"\\u0041"')).toBe('A');
  });

  it('passes a non-ASCII literal character through unchanged', () => {
    expect(parseStringValue('"é"')).toBe('é');
  });

  it('keeps decoding the existing C-style escapes', () => {
    expect(parseStringValue('"a\\nb"')).toBe('a\nb');
    expect(parseStringValue('"a\\tb"')).toBe('a\tb');
    expect(parseStringValue('"a\\"b"')).toBe('a"b');
    expect(parseStringValue('"a\\\\b"')).toBe('a\\b');
    expect(parseStringValue('"a\\rb"')).toBe('a\rb');
  });

  it('emits a malformed \\x escape literally and keeps scanning', () => {
    expect(parseStringValue('"\\x4"')).toBe('\\x4');
    expect(parseStringValue('"\\xZZ"')).toBe('\\xZZ');
  });

  it('emits a malformed \\u escape literally and keeps scanning', () => {
    expect(parseStringValue('"\\u12"')).toBe('\\u12');
    expect(parseStringValue('"\\uZZZZ"')).toBe('\\uZZZZ');
  });

  it('decodes \\x adjacent to following plain text', () => {
    expect(parseStringValue('"\\x41B"')).toBe('AB');
  });

  it('keeps an unknown escape as a literal backslash + char', () => {
    expect(parseStringValue('"\\q"')).toBe('\\q');
  });

  it('round-trips the green text regardless of escape decoding', () => {
    const source = '"\\x41\\u0041\\xZZ"';
    const { node } = parse(source, (c) => parseExpression(c) as GreenNode);
    expect(greenText(node)).toBe(source);
  });
});

function parseNumberExpr(source: string) {
  const { node } = parse(source, (c) => parseExpression(c) as GreenNode);
  return { node, expr: NumberLiteralExprAst.cast(createSyntaxTree(node)) };
}

describe('NumberLiteralExprAst.value() for NaN / Infinity', () => {
  it('parses Infinity as a NumberLiteralExpr whose value() is Infinity', () => {
    const { node, expr } = parseNumberExpr('Infinity');
    expect(node.kind).toBe('NumberLiteralExpr');
    expect(expr?.value()).toBe(Number.POSITIVE_INFINITY);
    expect(greenText(node)).toBe('Infinity');
  });

  it('parses -Infinity as a NumberLiteralExpr whose value() is -Infinity', () => {
    const { node, expr } = parseNumberExpr('-Infinity');
    expect(node.kind).toBe('NumberLiteralExpr');
    expect(expr?.value()).toBe(Number.NEGATIVE_INFINITY);
    expect(greenText(node)).toBe('-Infinity');
  });

  it('parses NaN as a NumberLiteralExpr whose value() is NaN', () => {
    const { node, expr } = parseNumberExpr('NaN');
    expect(node.kind).toBe('NumberLiteralExpr');
    expect(Number.isNaN(expr?.value())).toBe(true);
    expect(greenText(node)).toBe('NaN');
  });

  it('keeps Infinityx as an identifier expression', () => {
    const { node } = parse('Infinityx', (c) => parseExpression(c) as GreenNode);
    expect(node.kind).toBe('Identifier');
    expect(IdentifierAst.cast(createSyntaxTree(node))?.token()?.text).toBe('Infinityx');
    expect(greenText(node)).toBe('Infinityx');
  });

  it('keeps NaNxyz as an identifier expression', () => {
    const { node } = parse('NaNxyz', (c) => parseExpression(c) as GreenNode);
    expect(node.kind).toBe('Identifier');
    expect(IdentifierAst.cast(createSyntaxTree(node))?.token()?.text).toBe('NaNxyz');
    expect(greenText(node)).toBe('NaNxyz');
  });

  it('still parses ordinary numeric literals', () => {
    expect(parseNumberExpr('-5').expr?.value()).toBe(-5);
    expect(parseNumberExpr('3.14').expr?.value()).toBe(3.14);
  });
});
