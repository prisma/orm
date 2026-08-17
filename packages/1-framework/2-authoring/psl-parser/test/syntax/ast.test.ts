import { describe, expect, it } from 'vitest';
import {
  AttributeArgListAst,
  FieldAttributeAst,
  ModelAttributeAst,
} from '../../src/syntax/ast/attributes';
import {
  CompositeTypeDeclarationAst,
  DocumentAst,
  FieldDeclarationAst,
  GenericBlockDeclarationAst,
  KeyValuePairAst,
  ModelDeclarationAst,
  NamedTypeDeclarationAst,
  NamespaceDeclarationAst,
  TypesBlockAst,
} from '../../src/syntax/ast/declarations';
import {
  ArrayLiteralAst,
  AttributeArgAst,
  BooleanLiteralExprAst,
  FunctionCallAst,
  NumberLiteralExprAst,
  ObjectFieldAst,
  ObjectLiteralExprAst,
  StringLiteralExprAst,
} from '../../src/syntax/ast/expressions';
import { IdentifierAst } from '../../src/syntax/ast/identifier';
import { QualifiedNameAst } from '../../src/syntax/ast/qualified-name';
import { TypeAnnotationAst } from '../../src/syntax/ast/type-annotation';
import { any } from '../../src/syntax/ast-helpers';
import { GreenNodeBuilder } from '../../src/syntax/green-builder';
import { createSyntaxTree, type SyntaxNode } from '../../src/syntax/red';
import type { SyntaxKind } from '../../src/syntax/syntax-kind';

function buildIdentifier(name: string) {
  const b = new GreenNodeBuilder();
  b.startNode('Identifier');
  b.token('Ident', name);
  return b.finishNode();
}

describe('IdentifierAst', () => {
  it('exposes token()', () => {
    const root = createSyntaxTree(buildIdentifier('User'));
    const id = IdentifierAst.cast(root);
    expect(id).toBeDefined();
    expect(id!.token()?.text).toBe('User');
  });

  it('returns syntax property', () => {
    const root = createSyntaxTree(buildIdentifier('User'));
    const id = IdentifierAst.cast(root);
    expect(id!.syntax).toBe(root);
  });

  it('cast returns undefined for non-matching kind', () => {
    const b = new GreenNodeBuilder();
    b.startNode('Document');
    const green = b.finishNode();
    const root = createSyntaxTree(green);
    expect(IdentifierAst.cast(root)).toBeUndefined();
  });
});

describe('any', () => {
  it('returns the result of the first matching cast', () => {
    const b = new GreenNodeBuilder();
    b.startNode('ModelDeclaration');
    const model = createSyntaxTree(b.finishNode());
    const first = (node: SyntaxNode) => node.kind;
    const second = (node: SyntaxNode) => node.offset;
    expect(any(first, second)(model)).toBe('ModelDeclaration');
  });

  it('classifies different node kinds through the combined predicate', () => {
    const classify = any(ModelDeclarationAst.cast, FieldDeclarationAst.cast);

    const modelBuilder = new GreenNodeBuilder();
    modelBuilder.startNode('ModelDeclaration');
    const model = createSyntaxTree(modelBuilder.finishNode());

    const fieldBuilder = new GreenNodeBuilder();
    fieldBuilder.startNode('FieldDeclaration');
    const field = createSyntaxTree(fieldBuilder.finishNode());

    expect(classify(model)).toBeInstanceOf(ModelDeclarationAst);
    expect(classify(field)).toBeInstanceOf(FieldDeclarationAst);
  });

  it('returns undefined when no cast matches', () => {
    const b = new GreenNodeBuilder();
    b.startNode('Document');
    const document = createSyntaxTree(b.finishNode());
    expect(any(ModelDeclarationAst.cast, FieldDeclarationAst.cast)(document)).toBeUndefined();
  });
});

describe('static cast', () => {
  it('DocumentAst.cast matches Document kind', () => {
    const b = new GreenNodeBuilder();
    b.startNode('Document');
    const root = createSyntaxTree(b.finishNode());
    expect(DocumentAst.cast(root)).toBeDefined();
  });

  it('ModelDeclarationAst.cast returns undefined for wrong kind', () => {
    const b = new GreenNodeBuilder();
    b.startNode('Document');
    const root = createSyntaxTree(b.finishNode());
    expect(ModelDeclarationAst.cast(root)).toBeUndefined();
  });

  const castTests: Array<[string, (node: SyntaxNode) => unknown, SyntaxKind]> = [
    ['CompositeTypeDeclarationAst', CompositeTypeDeclarationAst.cast, 'CompositeTypeDeclaration'],
    ['NamespaceDeclarationAst', NamespaceDeclarationAst.cast, 'Namespace'],
    ['TypesBlockAst', TypesBlockAst.cast, 'TypesBlock'],
    ['GenericBlockDeclarationAst', GenericBlockDeclarationAst.cast, 'GenericBlockDeclaration'],
    ['KeyValuePairAst', KeyValuePairAst.cast, 'KeyValuePair'],
    ['FieldDeclarationAst', FieldDeclarationAst.cast, 'FieldDeclaration'],
    ['NamedTypeDeclarationAst', NamedTypeDeclarationAst.cast, 'NamedTypeDeclaration'],
    ['TypeAnnotationAst', TypeAnnotationAst.cast, 'TypeAnnotation'],
    ['QualifiedNameAst', QualifiedNameAst.cast, 'QualifiedName'],
    ['FieldAttributeAst', FieldAttributeAst.cast, 'FieldAttribute'],
    ['ModelAttributeAst', ModelAttributeAst.cast, 'ModelAttribute'],
    ['AttributeArgListAst', AttributeArgListAst.cast, 'AttributeArgList'],
    ['AttributeArgAst', AttributeArgAst.cast, 'AttributeArg'],
    ['FunctionCallAst', FunctionCallAst.cast, 'FunctionCall'],
    ['ArrayLiteralAst', ArrayLiteralAst.cast, 'ArrayLiteral'],
    ['StringLiteralExprAst', StringLiteralExprAst.cast, 'StringLiteralExpr'],
    ['NumberLiteralExprAst', NumberLiteralExprAst.cast, 'NumberLiteralExpr'],
    ['BooleanLiteralExprAst', BooleanLiteralExprAst.cast, 'BooleanLiteralExpr'],
  ];

  for (const [name, castFn, kind] of castTests) {
    it(`${name}.cast matches ${kind}`, () => {
      const b = new GreenNodeBuilder();
      b.startNode(kind);
      const root = createSyntaxTree(b.finishNode());
      expect(castFn(root)).toBeDefined();
    });

    it(`${name}.cast returns undefined for wrong kind`, () => {
      const b = new GreenNodeBuilder();
      b.startNode('Document');
      const root = createSyntaxTree(b.finishNode());
      expect(castFn(root)).toBeUndefined();
    });
  }
});

describe('accessors return undefined on missing children', () => {
  it('IdentifierAst.token() returns undefined when empty', () => {
    const b = new GreenNodeBuilder();
    b.startNode('Identifier');
    const root = createSyntaxTree(b.finishNode());
    const id = IdentifierAst.cast(root)!;
    expect(id.token()).toBeUndefined();
  });

  it('ModelDeclarationAst.name() returns undefined when missing', () => {
    const b = new GreenNodeBuilder();
    b.startNode('ModelDeclaration');
    const root = createSyntaxTree(b.finishNode());
    const model = ModelDeclarationAst.cast(root)!;
    expect(model.name()).toBeUndefined();
    expect(model.keyword()).toBeUndefined();
    expect(model.lbrace()).toBeUndefined();
    expect(model.rbrace()).toBeUndefined();
  });

  it('FieldDeclarationAst accessors return undefined when missing', () => {
    const b = new GreenNodeBuilder();
    b.startNode('FieldDeclaration');
    const root = createSyntaxTree(b.finishNode());
    const field = FieldDeclarationAst.cast(root)!;
    expect(field.name()).toBeUndefined();
    expect(field.typeAnnotation()).toBeUndefined();
  });

  it('TypeAnnotationAst accessors return undefined when missing', () => {
    const b = new GreenNodeBuilder();
    b.startNode('TypeAnnotation');
    const root = createSyntaxTree(b.finishNode());
    const ta = TypeAnnotationAst.cast(root)!;
    expect(ta.name()).toBeUndefined();
    expect(ta.lbracket()).toBeUndefined();
    expect(ta.rbracket()).toBeUndefined();
    expect(ta.questionMark()).toBeUndefined();
    expect(ta.isList()).toBe(false);
    expect(ta.isOptional()).toBe(false);
    expect(ta.isElementOptional()).toBe(false);
  });
});

describe('ModelDeclarationAst', () => {
  function buildModel() {
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
    b.finishNode();
    b.token('Newline', '\n');
    b.startNode('ModelAttribute');
    b.token('DoubleAt', '@@');
    b.startNode('QualifiedName');
    b.startNode('Identifier');
    b.token('Ident', 'map');
    b.finishNode();
    b.finishNode();
    b.finishNode();
    b.token('Newline', '\n');
    b.token('RBrace', '}');
    b.finishNode();
    return b.finishNode();
  }

  it('exposes keyword, name, braces', () => {
    const root = createSyntaxTree(buildModel());
    const doc = DocumentAst.cast(root)!;
    const model = Array.from(doc.declarations())[0] as ModelDeclarationAst;
    expect(model.keyword()?.text).toBe('model');
    expect(model.name()?.token()?.text).toBe('User');
    expect(model.lbrace()?.text).toBe('{');
    expect(model.rbrace()?.text).toBe('}');
  });

  it('iterates fields', () => {
    const root = createSyntaxTree(buildModel());
    const doc = DocumentAst.cast(root)!;
    const model = Array.from(doc.declarations())[0] as ModelDeclarationAst;
    const fields = Array.from(model.fields());
    expect(fields).toHaveLength(1);
    expect(fields[0]!.name()?.token()?.text).toBe('id');
  });

  it('iterates model attributes', () => {
    const root = createSyntaxTree(buildModel());
    const doc = DocumentAst.cast(root)!;
    const model = Array.from(doc.declarations())[0] as ModelDeclarationAst;
    const attrs = Array.from(model.attributes());
    expect(attrs).toHaveLength(1);
    expect(attrs[0]!.doubleAt()?.text).toBe('@@');
    expect(attrs[0]!.name()?.identifier()?.token()?.text).toBe('map');
  });
});

describe('TypeAnnotationAst', () => {
  it('detects list type', () => {
    const b = new GreenNodeBuilder();
    b.startNode('TypeAnnotation');
    b.startNode('QualifiedName');
    b.startNode('Identifier');
    b.token('Ident', 'String');
    b.finishNode();
    b.finishNode();
    b.token('LBracket', '[');
    b.token('RBracket', ']');
    const root = createSyntaxTree(b.finishNode());
    const ta = TypeAnnotationAst.cast(root)!;
    expect(ta.isList()).toBe(true);
    expect(ta.isOptional()).toBe(false);
    expect(ta.isElementOptional()).toBe(false);
    expect(ta.name()?.identifier()?.token()?.text).toBe('String');
  });

  it('reads a `?` after `]` as list-optional, not element-optional', () => {
    const b = new GreenNodeBuilder();
    b.startNode('TypeAnnotation');
    b.startNode('QualifiedName');
    b.startNode('Identifier');
    b.token('Ident', 'String');
    b.finishNode();
    b.finishNode();
    b.token('LBracket', '[');
    b.token('RBracket', ']');
    b.token('Question', '?');
    const root = createSyntaxTree(b.finishNode());
    const ta = TypeAnnotationAst.cast(root)!;
    expect(ta.isList()).toBe(true);
    expect(ta.isOptional()).toBe(true);
    expect(ta.isElementOptional()).toBe(false);
  });

  it('reads a `?` before `[` as element-optional, not list-optional', () => {
    const b = new GreenNodeBuilder();
    b.startNode('TypeAnnotation');
    b.startNode('QualifiedName');
    b.startNode('Identifier');
    b.token('Ident', 'String');
    b.finishNode();
    b.finishNode();
    b.token('Question', '?');
    b.token('LBracket', '[');
    b.token('RBracket', ']');
    const root = createSyntaxTree(b.finishNode());
    const ta = TypeAnnotationAst.cast(root)!;
    expect(ta.isList()).toBe(true);
    expect(ta.isOptional()).toBe(false);
    expect(ta.isElementOptional()).toBe(true);
  });

  it('reads a `?` on either side of `[]` as both axes optional', () => {
    const b = new GreenNodeBuilder();
    b.startNode('TypeAnnotation');
    b.startNode('QualifiedName');
    b.startNode('Identifier');
    b.token('Ident', 'String');
    b.finishNode();
    b.finishNode();
    b.token('Question', '?');
    b.token('LBracket', '[');
    b.token('RBracket', ']');
    b.token('Question', '?');
    const root = createSyntaxTree(b.finishNode());
    const ta = TypeAnnotationAst.cast(root)!;
    expect(ta.isList()).toBe(true);
    expect(ta.isOptional()).toBe(true);
    expect(ta.isElementOptional()).toBe(true);
  });

  it('detects optional type', () => {
    const b = new GreenNodeBuilder();
    b.startNode('TypeAnnotation');
    b.startNode('Identifier');
    b.token('Ident', 'Int');
    b.finishNode();
    b.token('Question', '?');
    const root = createSyntaxTree(b.finishNode());
    const ta = TypeAnnotationAst.cast(root)!;
    expect(ta.isList()).toBe(false);
    expect(ta.isOptional()).toBe(true);
    expect(ta.isElementOptional()).toBe(false);
  });
});

describe('KeyValuePairAst', () => {
  it('exposes key, equals, and value', () => {
    const b = new GreenNodeBuilder();
    b.startNode('KeyValuePair');
    b.startNode('Identifier');
    b.token('Ident', 'provider');
    b.finishNode();
    b.token('Whitespace', ' ');
    b.token('Equals', '=');
    b.token('Whitespace', ' ');
    b.startNode('StringLiteralExpr');
    b.token('StringLiteral', '"postgresql"');
    b.finishNode();
    const root = createSyntaxTree(b.finishNode());
    const kv = KeyValuePairAst.cast(root)!;
    expect(kv.key()?.token()?.text).toBe('provider');
    expect(kv.equals()?.text).toBe('=');
    const val = kv.value();
    expect(val).toBeInstanceOf(StringLiteralExprAst);
  });
});

describe('FieldAttributeAst', () => {
  it('exposes at and name for simple attribute', () => {
    const b = new GreenNodeBuilder();
    b.startNode('FieldAttribute');
    b.token('At', '@');
    b.startNode('QualifiedName');
    b.startNode('Identifier');
    b.token('Ident', 'id');
    b.finishNode();
    b.finishNode();
    const root = createSyntaxTree(b.finishNode());
    const attr = FieldAttributeAst.cast(root)!;
    const name = attr.name()!;
    expect(attr.at()?.text).toBe('@');
    expect(name.identifier()?.token()?.text).toBe('id');
    expect(name.dot()).toBeUndefined();
    expect(name.namespace()).toBeUndefined();
    expect(attr.argList()).toBeUndefined();
  });

  it('exposes namespaced attribute parts', () => {
    const b = new GreenNodeBuilder();
    b.startNode('FieldAttribute');
    b.token('At', '@');
    b.startNode('QualifiedName');
    b.startNode('Identifier');
    b.token('Ident', 'extension');
    b.finishNode();
    b.token('Dot', '.');
    b.startNode('Identifier');
    b.token('Ident', 'VarChar');
    b.finishNode();
    b.finishNode();
    const root = createSyntaxTree(b.finishNode());
    const attr = FieldAttributeAst.cast(root)!;
    const name = attr.name()!;
    expect(name.dot()?.text).toBe('.');
    expect(name.namespace()?.token()?.text).toBe('extension');
    expect(name.identifier()?.token()?.text).toBe('VarChar');
  });

  it('exposes argList', () => {
    // @default(autoincrement())
    const b = new GreenNodeBuilder();
    b.startNode('FieldAttribute');
    b.token('At', '@');
    b.startNode('Identifier');
    b.token('Ident', 'default');
    b.finishNode();
    b.startNode('AttributeArgList');
    b.token('LParen', '(');
    b.startNode('AttributeArg');
    b.startNode('FunctionCall');
    b.startNode('Identifier');
    b.token('Ident', 'autoincrement');
    b.finishNode();
    b.token('LParen', '(');
    b.token('RParen', ')');
    b.finishNode();
    b.finishNode();
    b.token('RParen', ')');
    b.finishNode();
    const root = createSyntaxTree(b.finishNode());
    const attr = FieldAttributeAst.cast(root)!;
    const argList = attr.argList();
    expect(argList).toBeDefined();
    expect(argList!.lparen()?.text).toBe('(');
    expect(argList!.rparen()?.text).toBe(')');
    const args = Array.from(argList!.args());
    expect(args).toHaveLength(1);
    const val = args[0]!.value();
    expect(val).toBeInstanceOf(FunctionCallAst);
  });
});

describe('StringLiteralExprAst', () => {
  it('returns unquoted string value', () => {
    const b = new GreenNodeBuilder();
    b.startNode('StringLiteralExpr');
    b.token('StringLiteral', '"hello world"');
    const root = createSyntaxTree(b.finishNode());
    const expr = StringLiteralExprAst.cast(root)!;
    expect(expr.value()).toBe('hello world');
  });

  it('unescapes escape sequences', () => {
    const b = new GreenNodeBuilder();
    b.startNode('StringLiteralExpr');
    b.token('StringLiteral', '"line1\\nline2\\ttab"');
    const root = createSyntaxTree(b.finishNode());
    const expr = StringLiteralExprAst.cast(root)!;
    expect(expr.value()).toBe('line1\nline2\ttab');
  });

  it('decodes an escaped backslash as a literal backslash, not the following escape', () => {
    const b = new GreenNodeBuilder();
    b.startNode('StringLiteralExpr');
    // PSL source: "test\\n" — a literal backslash followed by 'n', not a newline
    b.token('StringLiteral', '"test\\\\n"');
    const root = createSyntaxTree(b.finishNode());
    const expr = StringLiteralExprAst.cast(root)!;
    expect(expr.value()).toBe('test\\n');
  });

  it('unescapes escaped quotes', () => {
    const b = new GreenNodeBuilder();
    b.startNode('StringLiteralExpr');
    // PSL source: "a\"b"
    b.token('StringLiteral', '"a\\"b"');
    const root = createSyntaxTree(b.finishNode());
    const expr = StringLiteralExprAst.cast(root)!;
    expect(expr.value()).toBe('a"b');
  });

  it('returns undefined when token missing', () => {
    const b = new GreenNodeBuilder();
    b.startNode('StringLiteralExpr');
    const root = createSyntaxTree(b.finishNode());
    const expr = StringLiteralExprAst.cast(root)!;
    expect(expr.token()).toBeUndefined();
    expect(expr.value()).toBeUndefined();
  });
});

describe('NumberLiteralExprAst', () => {
  it('returns parsed integer', () => {
    const b = new GreenNodeBuilder();
    b.startNode('NumberLiteralExpr');
    b.token('NumberLiteral', '42');
    const root = createSyntaxTree(b.finishNode());
    const expr = NumberLiteralExprAst.cast(root)!;
    expect(expr.value()).toBe(42);
  });

  it('returns parsed float', () => {
    const b = new GreenNodeBuilder();
    b.startNode('NumberLiteralExpr');
    b.token('NumberLiteral', '3.14');
    const root = createSyntaxTree(b.finishNode());
    const expr = NumberLiteralExprAst.cast(root)!;
    expect(expr.value()).toBe(3.14);
  });

  it('returns undefined when token missing', () => {
    const b = new GreenNodeBuilder();
    b.startNode('NumberLiteralExpr');
    const root = createSyntaxTree(b.finishNode());
    const expr = NumberLiteralExprAst.cast(root)!;
    expect(expr.value()).toBeUndefined();
  });
});

describe('BooleanLiteralExprAst', () => {
  it('returns true', () => {
    const b = new GreenNodeBuilder();
    b.startNode('BooleanLiteralExpr');
    b.token('Ident', 'true');
    const root = createSyntaxTree(b.finishNode());
    const expr = BooleanLiteralExprAst.cast(root)!;
    expect(expr.value()).toBe(true);
  });

  it('returns false', () => {
    const b = new GreenNodeBuilder();
    b.startNode('BooleanLiteralExpr');
    b.token('Ident', 'false');
    const root = createSyntaxTree(b.finishNode());
    const expr = BooleanLiteralExprAst.cast(root)!;
    expect(expr.value()).toBe(false);
  });

  it('returns undefined for non-boolean ident', () => {
    const b = new GreenNodeBuilder();
    b.startNode('BooleanLiteralExpr');
    b.token('Ident', 'maybe');
    const root = createSyntaxTree(b.finishNode());
    const expr = BooleanLiteralExprAst.cast(root)!;
    expect(expr.value()).toBeUndefined();
  });

  it('returns undefined when token missing', () => {
    const b = new GreenNodeBuilder();
    b.startNode('BooleanLiteralExpr');
    const root = createSyntaxTree(b.finishNode());
    const expr = BooleanLiteralExprAst.cast(root)!;
    expect(expr.value()).toBeUndefined();
  });
});

describe('AttributeArgAst', () => {
  it('exposes positional arg value', () => {
    const b = new GreenNodeBuilder();
    b.startNode('AttributeArg');
    b.startNode('Identifier');
    b.token('Ident', 'id');
    b.finishNode();
    const root = createSyntaxTree(b.finishNode());
    const arg = AttributeArgAst.cast(root)!;
    expect(arg.name()).toBeUndefined(); // positional - no colon
    expect(arg.colon()).toBeUndefined();
    const val = arg.value();
    expect(val).toBeInstanceOf(IdentifierAst);
  });

  it('exposes named arg with colon', () => {
    const b = new GreenNodeBuilder();
    b.startNode('AttributeArg');
    b.startNode('Identifier');
    b.token('Ident', 'fields');
    b.finishNode();
    b.token('Colon', ':');
    b.token('Whitespace', ' ');
    b.startNode('ArrayLiteral');
    b.token('LBracket', '[');
    b.startNode('Identifier');
    b.token('Ident', 'id');
    b.finishNode();
    b.token('RBracket', ']');
    b.finishNode();
    const root = createSyntaxTree(b.finishNode());
    const arg = AttributeArgAst.cast(root)!;
    expect(arg.name()?.token()?.text).toBe('fields');
    expect(arg.colon()?.text).toBe(':');
    const val = arg.value();
    expect(val).toBeInstanceOf(ArrayLiteralAst);
  });
});

describe('ArrayLiteralAst', () => {
  it('exposes brackets and elements', () => {
    const b = new GreenNodeBuilder();
    b.startNode('ArrayLiteral');
    b.token('LBracket', '[');
    b.startNode('Identifier');
    b.token('Ident', 'id');
    b.finishNode();
    b.token('Comma', ',');
    b.token('Whitespace', ' ');
    b.startNode('Identifier');
    b.token('Ident', 'name');
    b.finishNode();
    b.token('RBracket', ']');
    const root = createSyntaxTree(b.finishNode());
    const arr = ArrayLiteralAst.cast(root)!;
    expect(arr.lbracket()?.text).toBe('[');
    expect(arr.rbracket()?.text).toBe(']');
    const elements = Array.from(arr.elements());
    expect(elements).toHaveLength(2);
  });
});

describe('ObjectLiteralExprAst', () => {
  function buildObjectLiteral() {
    // { name: "x", count: 1 }
    const b = new GreenNodeBuilder();
    b.startNode('ObjectLiteralExpr');
    b.token('LBrace', '{');
    b.token('Whitespace', ' ');
    b.startNode('ObjectField');
    b.startNode('Identifier');
    b.token('Ident', 'name');
    b.finishNode();
    b.token('Colon', ':');
    b.token('Whitespace', ' ');
    b.startNode('StringLiteralExpr');
    b.token('StringLiteral', '"x"');
    b.finishNode();
    b.finishNode();
    b.token('Comma', ',');
    b.token('Whitespace', ' ');
    b.startNode('ObjectField');
    b.startNode('Identifier');
    b.token('Ident', 'count');
    b.finishNode();
    b.token('Colon', ':');
    b.token('Whitespace', ' ');
    b.startNode('NumberLiteralExpr');
    b.token('NumberLiteral', '1');
    b.finishNode();
    b.finishNode();
    b.token('Whitespace', ' ');
    b.token('RBrace', '}');
    return b.finishNode();
  }

  it('exposes braces and iterates fields', () => {
    const root = createSyntaxTree(buildObjectLiteral());
    const obj = ObjectLiteralExprAst.cast(root)!;
    expect(obj.lbrace()?.text).toBe('{');
    expect(obj.rbrace()?.text).toBe('}');
    expect(Array.from(obj.fields())).toHaveLength(2);
  });

  it('exposes identifier key, colon, and value per field', () => {
    const root = createSyntaxTree(buildObjectLiteral());
    const obj = ObjectLiteralExprAst.cast(root)!;
    const [first, second] = Array.from(obj.fields());
    expect(first!.key()).toBeInstanceOf(IdentifierAst);
    expect(first!.key()?.token()?.text).toBe('name');
    expect(first!.colon()?.text).toBe(':');
    expect(first!.value()).toBeInstanceOf(StringLiteralExprAst);
    expect(second!.key()?.token()?.text).toBe('count');
    expect(second!.value()).toBeInstanceOf(NumberLiteralExprAst);
  });

  it('exposes a nested object literal as a field value', () => {
    // { a: { b: 1 } }
    const b = new GreenNodeBuilder();
    b.startNode('ObjectLiteralExpr');
    b.token('LBrace', '{');
    b.token('Whitespace', ' ');
    b.startNode('ObjectField');
    b.startNode('Identifier');
    b.token('Ident', 'a');
    b.finishNode();
    b.token('Colon', ':');
    b.token('Whitespace', ' ');
    b.startNode('ObjectLiteralExpr');
    b.token('LBrace', '{');
    b.token('Whitespace', ' ');
    b.startNode('ObjectField');
    b.startNode('Identifier');
    b.token('Ident', 'b');
    b.finishNode();
    b.token('Colon', ':');
    b.token('Whitespace', ' ');
    b.startNode('NumberLiteralExpr');
    b.token('NumberLiteral', '1');
    b.finishNode();
    b.finishNode(); // inner ObjectField
    b.token('Whitespace', ' ');
    b.token('RBrace', '}');
    b.finishNode(); // inner ObjectLiteralExpr
    b.finishNode(); // outer ObjectField
    b.token('Whitespace', ' ');
    b.token('RBrace', '}');
    const root = createSyntaxTree(b.finishNode());
    const outer = ObjectLiteralExprAst.cast(root)!;
    const [field] = Array.from(outer.fields());
    const inner = field!.value();
    expect(inner).toBeInstanceOf(ObjectLiteralExprAst);
    if (inner instanceof ObjectLiteralExprAst) {
      const [innerField] = Array.from(inner.fields());
      expect(innerField!.key()?.token()?.text).toBe('b');
      expect(innerField!.value()).toBeInstanceOf(NumberLiteralExprAst);
    }
  });

  it('cast returns undefined for non-matching kind', () => {
    const b = new GreenNodeBuilder();
    b.startNode('Identifier');
    b.token('Ident', 'x');
    const root = createSyntaxTree(b.finishNode());
    expect(ObjectLiteralExprAst.cast(root)).toBeUndefined();
    expect(ObjectFieldAst.cast(root)).toBeUndefined();
  });
});

describe('DocumentAst', () => {
  it('iterates mixed declarations', () => {
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
    b.token('RBrace', '}');
    b.finishNode();
    b.token('Newline', '\n');
    b.startNode('GenericBlockDeclaration');
    b.token('Ident', 'datasource');
    b.token('Whitespace', ' ');
    b.startNode('Identifier');
    b.token('Ident', 'extension');
    b.finishNode();
    b.token('Whitespace', ' ');
    b.token('LBrace', '{');
    b.token('RBrace', '}');
    b.finishNode();
    const root = createSyntaxTree(b.finishNode());
    const doc = DocumentAst.cast(root)!;
    const decls = Array.from(doc.declarations());
    expect(decls).toHaveLength(2);
    expect(decls[0]).toBeInstanceOf(ModelDeclarationAst);
    expect(decls[1]).toBeInstanceOf(GenericBlockDeclarationAst);
  });
});

describe('TypesBlockAst', () => {
  function buildTypesBlock() {
    const b = new GreenNodeBuilder();
    b.startNode('TypesBlock');
    b.token('Ident', 'types');
    b.token('Whitespace', ' ');
    b.token('LBrace', '{');
    b.token('Newline', '\n');
    b.token('Whitespace', '  ');
    b.startNode('NamedTypeDeclaration');
    b.startNode('Identifier');
    b.token('Ident', 'UserId');
    b.finishNode();
    b.token('Whitespace', ' ');
    b.token('Equals', '=');
    b.token('Whitespace', ' ');
    b.startNode('TypeAnnotation');
    b.token('Ident', 'Int');
    b.finishNode();
    b.finishNode();
    b.token('Newline', '\n');
    b.token('RBrace', '}');
    return b.finishNode();
  }

  it('exposes keyword, braces', () => {
    const root = createSyntaxTree(buildTypesBlock());
    const decl = TypesBlockAst.cast(root)!;
    expect(decl.keyword()?.text).toBe('types');
    expect(decl.lbrace()?.text).toBe('{');
    expect(decl.rbrace()?.text).toBe('}');
  });

  it('iterates declarations', () => {
    const root = createSyntaxTree(buildTypesBlock());
    const decl = TypesBlockAst.cast(root)!;
    const namedTypes = Array.from(decl.declarations());
    expect(namedTypes).toHaveLength(1);
    expect(namedTypes[0]!.name()?.token()?.text).toBe('UserId');
  });
});

describe('NamedTypeDeclarationAst', () => {
  function buildNamedType() {
    const b = new GreenNodeBuilder();
    b.startNode('NamedTypeDeclaration');
    b.startNode('Identifier');
    b.token('Ident', 'UserId');
    b.finishNode();
    b.token('Whitespace', ' ');
    b.token('Equals', '=');
    b.token('Whitespace', ' ');
    b.startNode('TypeAnnotation');
    b.startNode('QualifiedName');
    b.startNode('Identifier');
    b.token('Ident', 'Int');
    b.finishNode();
    b.finishNode();
    b.finishNode();
    b.token('Whitespace', ' ');
    b.startNode('FieldAttribute');
    b.token('At', '@');
    b.startNode('QualifiedName');
    b.startNode('Identifier');
    b.token('Ident', 'extension');
    b.finishNode();
    b.finishNode();
    b.finishNode();
    return b.finishNode();
  }

  it('exposes name, equals, typeAnnotation, attributes', () => {
    const root = createSyntaxTree(buildNamedType());
    const decl = NamedTypeDeclarationAst.cast(root)!;
    expect(decl.name()?.token()?.text).toBe('UserId');
    expect(decl.equals()?.text).toBe('=');
    expect(decl.typeAnnotation()?.name()?.identifier()?.token()?.text).toBe('Int');
    const attrs = Array.from(decl.attributes());
    expect(attrs).toHaveLength(1);
    expect(attrs[0]!.name()?.identifier()?.token()?.text).toBe('extension');
  });
});

describe('GenericBlockDeclarationAst', () => {
  function buildBlock() {
    const b = new GreenNodeBuilder();
    b.startNode('GenericBlockDeclaration');
    b.token('Ident', 'datasource');
    b.token('Whitespace', ' ');
    b.startNode('Identifier');
    b.token('Ident', 'extension');
    b.finishNode();
    b.token('Whitespace', ' ');
    b.token('LBrace', '{');
    b.token('Newline', '\n');
    b.token('Whitespace', '  ');
    b.startNode('KeyValuePair');
    b.startNode('Identifier');
    b.token('Ident', 'provider');
    b.finishNode();
    b.token('Whitespace', ' ');
    b.token('Equals', '=');
    b.token('Whitespace', ' ');
    b.startNode('StringLiteralExpr');
    b.token('StringLiteral', '"postgresql"');
    b.finishNode();
    b.finishNode();
    b.token('Newline', '\n');
    b.token('RBrace', '}');
    return b.finishNode();
  }

  it('exposes keyword, name, braces', () => {
    const root = createSyntaxTree(buildBlock());
    const decl = GenericBlockDeclarationAst.cast(root)!;
    expect(decl.keyword()?.text).toBe('datasource');
    expect(decl.name()?.token()?.text).toBe('extension');
    expect(decl.lbrace()?.text).toBe('{');
    expect(decl.rbrace()?.text).toBe('}');
  });

  it('iterates entries', () => {
    const root = createSyntaxTree(buildBlock());
    const decl = GenericBlockDeclarationAst.cast(root)!;
    const entries = Array.from(decl.entries());
    expect(entries).toHaveLength(1);
    expect(entries[0]!.key()?.token()?.text).toBe('provider');
  });
});

describe('FieldDeclarationAst.attributes', () => {
  it('iterates field attributes', () => {
    const b = new GreenNodeBuilder();
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
    b.startNode('QualifiedName');
    b.startNode('Identifier');
    b.token('Ident', 'id');
    b.finishNode();
    b.finishNode();
    b.finishNode();
    const root = createSyntaxTree(b.finishNode());
    const field = FieldDeclarationAst.cast(root)!;
    const attrs = Array.from(field.attributes());
    expect(attrs).toHaveLength(1);
    expect(attrs[0]!.name()?.identifier()?.token()?.text).toBe('id');
  });
});

describe('FunctionCallAst', () => {
  it('exposes name, parens, and args', () => {
    const b = new GreenNodeBuilder();
    b.startNode('FunctionCall');
    b.startNode('QualifiedName');
    b.startNode('Identifier');
    b.token('Ident', 'autoincrement');
    b.finishNode();
    b.finishNode();
    b.token('LParen', '(');
    b.token('RParen', ')');
    const root = createSyntaxTree(b.finishNode());
    const fn = FunctionCallAst.cast(root)!;
    expect(fn.name()?.identifier()?.token()?.text).toBe('autoincrement');
    expect(fn.lparen()?.text).toBe('(');
    expect(fn.rparen()?.text).toBe(')');
    expect(Array.from(fn.args())).toHaveLength(0);
  });
});

describe('ModelAttributeAst.argList', () => {
  it('exposes argList with args', () => {
    // @@unique([email])
    const b = new GreenNodeBuilder();
    b.startNode('ModelAttribute');
    b.token('DoubleAt', '@@');
    b.startNode('Identifier');
    b.token('Ident', 'unique');
    b.finishNode();
    b.startNode('AttributeArgList');
    b.token('LParen', '(');
    b.startNode('AttributeArg');
    b.startNode('ArrayLiteral');
    b.token('LBracket', '[');
    b.startNode('Identifier');
    b.token('Ident', 'email');
    b.finishNode();
    b.token('RBracket', ']');
    b.finishNode();
    b.finishNode();
    b.token('RParen', ')');
    b.finishNode();
    const root = createSyntaxTree(b.finishNode());
    const attr = ModelAttributeAst.cast(root)!;
    const argList = attr.argList();
    expect(argList).toBeDefined();
    expect(argList!.lparen()?.text).toBe('(');
    const args = Array.from(argList!.args());
    expect(args).toHaveLength(1);
  });
});

describe('CompositeTypeDeclarationAst', () => {
  function buildCompositeType() {
    // type Address { street String\n @@map("addresses") }
    const b = new GreenNodeBuilder();
    b.startNode('Document');
    b.startNode('CompositeTypeDeclaration');
    b.token('Ident', 'type');
    b.token('Whitespace', ' ');
    b.startNode('Identifier');
    b.token('Ident', 'Address');
    b.finishNode();
    b.token('Whitespace', ' ');
    b.token('LBrace', '{');
    b.startNode('FieldDeclaration');
    b.startNode('Identifier');
    b.token('Ident', 'street');
    b.finishNode();
    b.token('Whitespace', ' ');
    b.startNode('TypeAnnotation');
    b.startNode('Identifier');
    b.token('Ident', 'String');
    b.finishNode();
    b.finishNode();
    b.finishNode();
    b.startNode('ModelAttribute');
    b.token('DoubleAt', '@@');
    b.startNode('QualifiedName');
    b.startNode('Identifier');
    b.token('Ident', 'map');
    b.finishNode();
    b.finishNode();
    b.finishNode();
    b.token('RBrace', '}');
    b.finishNode();
    return b.finishNode();
  }

  it('exposes keyword, name, braces', () => {
    const root = createSyntaxTree(buildCompositeType());
    const doc = DocumentAst.cast(root)!;
    const ct = Array.from(doc.declarations())[0] as CompositeTypeDeclarationAst;
    expect(ct).toBeInstanceOf(CompositeTypeDeclarationAst);
    expect(ct.keyword()?.text).toBe('type');
    expect(ct.name()?.token()?.text).toBe('Address');
    expect(ct.lbrace()?.text).toBe('{');
    expect(ct.rbrace()?.text).toBe('}');
  });

  it('iterates fields and attributes', () => {
    const root = createSyntaxTree(buildCompositeType());
    const doc = DocumentAst.cast(root)!;
    const ct = Array.from(doc.declarations())[0] as CompositeTypeDeclarationAst;
    const fields = Array.from(ct.fields());
    expect(fields).toHaveLength(1);
    expect(fields[0]!.name()?.token()?.text).toBe('street');
    const attrs = Array.from(ct.attributes());
    expect(attrs).toHaveLength(1);
    expect(attrs[0]!.name()?.identifier()?.token()?.text).toBe('map');
  });
});

describe('NamespaceDeclarationAst', () => {
  function buildNamespace() {
    // namespace auth { model User {} datasource extension {} extend Something {} }
    const b = new GreenNodeBuilder();
    b.startNode('Document');
    b.startNode('Namespace');
    b.token('Ident', 'namespace');
    b.token('Whitespace', ' ');
    b.startNode('Identifier');
    b.token('Ident', 'auth');
    b.finishNode();
    b.token('Whitespace', ' ');
    b.token('LBrace', '{');
    b.startNode('ModelDeclaration');
    b.token('Ident', 'model');
    b.token('Whitespace', ' ');
    b.startNode('Identifier');
    b.token('Ident', 'User');
    b.finishNode();
    b.token('LBrace', '{');
    b.token('RBrace', '}');
    b.finishNode();
    b.startNode('GenericBlockDeclaration');
    b.token('Ident', 'datasource');
    b.token('Whitespace', ' ');
    b.startNode('Identifier');
    b.token('Ident', 'extension');
    b.finishNode();
    b.token('LBrace', '{');
    b.token('RBrace', '}');
    b.finishNode();
    b.startNode('GenericBlockDeclaration');
    b.token('Ident', 'extend');
    b.token('Whitespace', ' ');
    b.startNode('Identifier');
    b.token('Ident', 'Something');
    b.finishNode();
    b.token('LBrace', '{');
    b.token('RBrace', '}');
    b.finishNode();
    b.token('RBrace', '}');
    b.finishNode();
    return b.finishNode();
  }

  it('exposes keyword, name, braces', () => {
    const root = createSyntaxTree(buildNamespace());
    const doc = DocumentAst.cast(root)!;
    const ns = Array.from(doc.declarations())[0] as NamespaceDeclarationAst;
    expect(ns).toBeInstanceOf(NamespaceDeclarationAst);
    expect(ns.keyword()?.text).toBe('namespace');
    expect(ns.name()?.token()?.text).toBe('auth');
    expect(ns.lbrace()?.text).toBe('{');
    expect(ns.rbrace()?.text).toBe('}');
  });

  it('iterates nested declarations, including block declarations', () => {
    const root = createSyntaxTree(buildNamespace());
    const doc = DocumentAst.cast(root)!;
    const ns = Array.from(doc.declarations())[0] as NamespaceDeclarationAst;
    const decls = Array.from(ns.declarations());
    expect(decls).toHaveLength(3);
    expect(decls[0]).toBeInstanceOf(ModelDeclarationAst);
    expect(decls[1]).toBeInstanceOf(GenericBlockDeclarationAst);
    expect(decls[2]).toBeInstanceOf(GenericBlockDeclarationAst);
  });
});

describe('TypeAnnotationAst qualified references', () => {
  it('exposes dot-qualified namespace and name', () => {
    // auth.User
    const b = new GreenNodeBuilder();
    b.startNode('TypeAnnotation');
    b.startNode('QualifiedName');
    b.startNode('Identifier');
    b.token('Ident', 'auth');
    b.finishNode();
    b.token('Dot', '.');
    b.startNode('Identifier');
    b.token('Ident', 'User');
    b.finishNode();
    b.finishNode();
    const root = createSyntaxTree(b.finishNode());
    const ta = TypeAnnotationAst.cast(root)!;
    expect(ta.name()?.dot()?.text).toBe('.');
    expect(ta.name()?.namespace()?.token()?.text).toBe('auth');
    expect(ta.name()?.identifier()?.token()?.text).toBe('User');
    expect(ta.name()?.space()).toBeUndefined();
    expect(ta.argList()).toBeUndefined();
    expect(ta.isConstructor()).toBe(false);
    expect(ta.isList()).toBe(false);
    expect(ta.isOptional()).toBe(false);
  });

  it('exposes colon-prefixed cross-space reference', () => {
    // supabase:auth.User?
    const b = new GreenNodeBuilder();
    b.startNode('TypeAnnotation');
    b.startNode('QualifiedName');
    b.startNode('Identifier');
    b.token('Ident', 'supabase');
    b.finishNode();
    b.token('Colon', ':');
    b.startNode('Identifier');
    b.token('Ident', 'auth');
    b.finishNode();
    b.token('Dot', '.');
    b.startNode('Identifier');
    b.token('Ident', 'User');
    b.finishNode();
    b.finishNode();
    b.token('Question', '?');
    const root = createSyntaxTree(b.finishNode());
    const ta = TypeAnnotationAst.cast(root)!;
    expect(ta.name()?.colon()?.text).toBe(':');
    expect(ta.name()?.space()?.token()?.text).toBe('supabase');
    expect(ta.name()?.namespace()?.token()?.text).toBe('auth');
    expect(ta.name()?.identifier()?.token()?.text).toBe('User');
    expect(ta.isOptional()).toBe(true);
  });

  it('exposes colon-prefixed cross-space reference without namespace', () => {
    // supabase:User
    const b = new GreenNodeBuilder();
    b.startNode('TypeAnnotation');
    b.startNode('QualifiedName');
    b.startNode('Identifier');
    b.token('Ident', 'supabase');
    b.finishNode();
    b.token('Colon', ':');
    b.startNode('Identifier');
    b.token('Ident', 'User');
    b.finishNode();
    b.finishNode();
    const root = createSyntaxTree(b.finishNode());
    const ta = TypeAnnotationAst.cast(root)!;
    expect(ta.name()?.space()?.token()?.text).toBe('supabase');
    expect(ta.name()?.namespace()).toBeUndefined();
    expect(ta.name()?.identifier()?.token()?.text).toBe('User');
  });

  it('exposes inline constructor call', () => {
    // Vector(1536)
    const b = new GreenNodeBuilder();
    b.startNode('TypeAnnotation');
    b.startNode('QualifiedName');
    b.startNode('Identifier');
    b.token('Ident', 'Vector');
    b.finishNode();
    b.finishNode();
    b.startNode('AttributeArgList');
    b.token('LParen', '(');
    b.startNode('AttributeArg');
    b.startNode('NumberLiteralExpr');
    b.token('NumberLiteral', '1536');
    b.finishNode();
    b.finishNode();
    b.token('RParen', ')');
    b.finishNode();
    const root = createSyntaxTree(b.finishNode());
    const ta = TypeAnnotationAst.cast(root)!;
    expect(ta.isConstructor()).toBe(true);
    expect(ta.name()?.path()).toEqual(['Vector']);
    expect(ta.name()?.identifier()?.token()?.text).toBe('Vector');
    const argList = ta.argList();
    expect(argList).toBeInstanceOf(AttributeArgListAst);
    expect(Array.from(argList!.args())).toHaveLength(1);
    expect(ta.name()?.namespace()).toBeUndefined();
    expect(ta.name()?.space()).toBeUndefined();
  });

  it('returns base name for bare reference', () => {
    const b = new GreenNodeBuilder();
    b.startNode('TypeAnnotation');
    b.startNode('QualifiedName');
    b.startNode('Identifier');
    b.token('Ident', 'String');
    b.finishNode();
    b.finishNode();
    const root = createSyntaxTree(b.finishNode());
    const ta = TypeAnnotationAst.cast(root)!;
    expect(ta.name()?.identifier()?.token()?.text).toBe('String');
    expect(ta.name()?.namespace()).toBeUndefined();
    expect(ta.name()?.space()).toBeUndefined();
    expect(ta.argList()).toBeUndefined();
    expect(ta.isConstructor()).toBe(false);
  });
});

describe('QualifiedNameAst', () => {
  function ident(b: GreenNodeBuilder, text: string): void {
    b.startNode('Identifier');
    b.token('Ident', text);
    b.finishNode();
  }

  it('reads a bare name as its only segment', () => {
    const b = new GreenNodeBuilder();
    b.startNode('QualifiedName');
    ident(b, 'Vector');
    const qn = QualifiedNameAst.cast(createSyntaxTree(b.finishNode()))!;
    expect(qn.path()).toEqual(['Vector']);
    expect(qn.identifier()?.token()?.text).toBe('Vector');
    expect(qn.namespace()).toBeUndefined();
    expect(qn.space()).toBeUndefined();
    expect(qn.isOverQualified()).toBe(false);
  });

  it('reads a dot-qualified namespace.name', () => {
    const b = new GreenNodeBuilder();
    b.startNode('QualifiedName');
    ident(b, 'pgvector');
    b.token('Dot', '.');
    ident(b, 'Vector');
    const qn = QualifiedNameAst.cast(createSyntaxTree(b.finishNode()))!;
    expect(qn.path()).toEqual(['pgvector', 'Vector']);
    expect(qn.namespace()?.token()?.text).toBe('pgvector');
    expect(qn.identifier()?.token()?.text).toBe('Vector');
    expect(qn.space()).toBeUndefined();
  });

  it('reads a colon-prefixed space:namespace.name', () => {
    const b = new GreenNodeBuilder();
    b.startNode('QualifiedName');
    ident(b, 'supabase');
    b.token('Colon', ':');
    ident(b, 'auth');
    b.token('Dot', '.');
    ident(b, 'User');
    const qn = QualifiedNameAst.cast(createSyntaxTree(b.finishNode()))!;
    expect(qn.space()?.token()?.text).toBe('supabase');
    expect(qn.namespace()?.token()?.text).toBe('auth');
    expect(qn.identifier()?.token()?.text).toBe('User');
    expect(qn.path()).toEqual(['supabase', 'auth', 'User']);
  });

  it('reads a colon-prefixed space:name without a namespace', () => {
    const b = new GreenNodeBuilder();
    b.startNode('QualifiedName');
    ident(b, 'supabase');
    b.token('Colon', ':');
    ident(b, 'User');
    const qn = QualifiedNameAst.cast(createSyntaxTree(b.finishNode()))!;
    expect(qn.space()?.token()?.text).toBe('supabase');
    expect(qn.namespace()).toBeUndefined();
    expect(qn.identifier()?.token()?.text).toBe('User');
  });

  it('reads a trailing dot as a namespace with no name', () => {
    const b = new GreenNodeBuilder();
    b.startNode('QualifiedName');
    ident(b, 'auth');
    b.token('Dot', '.');
    const qn = QualifiedNameAst.cast(createSyntaxTree(b.finishNode()))!;
    expect(qn.space()).toBeUndefined();
    expect(qn.namespace()?.token()?.text).toBe('auth');
    expect(qn.identifier()).toBeUndefined();
  });

  it('reads a trailing dot after a space as namespace with no name', () => {
    const b = new GreenNodeBuilder();
    b.startNode('QualifiedName');
    ident(b, 'supabase');
    b.token('Colon', ':');
    ident(b, 'auth');
    b.token('Dot', '.');
    const qn = QualifiedNameAst.cast(createSyntaxTree(b.finishNode()))!;
    expect(qn.space()?.token()?.text).toBe('supabase');
    expect(qn.namespace()?.token()?.text).toBe('auth');
    expect(qn.identifier()).toBeUndefined();
  });

  it('reads a trailing colon as a space with no name', () => {
    const b = new GreenNodeBuilder();
    b.startNode('QualifiedName');
    ident(b, 'supabase');
    b.token('Colon', ':');
    const qn = QualifiedNameAst.cast(createSyntaxTree(b.finishNode()))!;
    expect(qn.space()?.token()?.text).toBe('supabase');
    expect(qn.namespace()).toBeUndefined();
    expect(qn.identifier()).toBeUndefined();
  });

  it('flags a second dot or colon as over-qualified', () => {
    const b = new GreenNodeBuilder();
    b.startNode('QualifiedName');
    ident(b, 'a');
    b.token('Dot', '.');
    ident(b, 'b');
    b.token('Dot', '.');
    ident(b, 'c');
    const qn = QualifiedNameAst.cast(createSyntaxTree(b.finishNode()))!;
    expect(qn.isOverQualified()).toBe(true);
  });

  it('matches a bare name with isSimpleName', () => {
    const b = new GreenNodeBuilder();
    b.startNode('QualifiedName');
    ident(b, 'Foo');
    const qn = QualifiedNameAst.cast(createSyntaxTree(b.finishNode()))!;
    expect(qn.isSimpleName('Foo')).toBe(true);
    expect(qn.isSimpleName('Bar')).toBe(false);
  });

  it('never matches a qualified name with isSimpleName', () => {
    const b = new GreenNodeBuilder();
    b.startNode('QualifiedName');
    ident(b, 'extension');
    b.token('Dot', '.');
    ident(b, 'VarChar');
    const qn = QualifiedNameAst.cast(createSyntaxTree(b.finishNode()))!;
    expect(qn.isSimpleName('VarChar')).toBe(false);
    expect(qn.isSimpleName('extension.VarChar')).toBe(false);
  });
});
