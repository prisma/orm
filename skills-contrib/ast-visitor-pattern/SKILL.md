---
name: ast-visitor-pattern
description: >-
  Use the frozen-class/visitor pattern for discriminated unions that have
  multiple dispatch sites. Use when creating a new set of variants
  (commands, IR nodes, factory calls) that will be switched over in 2+
  places, or when refactoring an existing union type that has grown
  multiple switch sites.
---

# AST Class/Visitor Pattern

When a discriminated union has **3+ variants** and **2+ dispatch sites** (renderers, serializers, classifiers, etc.), replace plain union + switch with frozen subclasses and a visitor interface. This makes adding a new variant a compiler error at every consumer, instead of a silent omission.

## Structure

Four pieces, usually in one file — the Mongo DDL set below spreads them over three:

```typescript
// 1. Abstract base (not exported — consumers use the union type)
abstract class FooNode {
  abstract readonly kind: string;
  abstract accept<R>(visitor: FooVisitor<R>): R;
  protected freeze(): void { Object.freeze(this); }
}

// 2. Visitor interface
export interface FooVisitor<R> {
  bar(node: BarNode): R;
  baz(node: BazNode): R;
}

// 3. Concrete subclasses — readonly fields, freeze() in constructor
export class BarNode extends FooNode {
  readonly kind = 'bar' as const;
  readonly value: string;
  constructor(value: string) {
    super();
    this.value = value;
    this.freeze();
  }
  accept<R>(visitor: FooVisitor<R>): R { return visitor.bar(this); }
}

export class BazNode extends FooNode {
  readonly kind = 'baz' as const;
  readonly count: number;
  constructor(count: number) {
    super();
    this.count = count;
    this.freeze();
  }
  accept<R>(visitor: FooVisitor<R>): R { return visitor.baz(this); }
}

// 4. Union type
export type Foo = BarNode | BazNode;
```

## Consuming

Define a visitor object (or class) per concern:

```typescript
const renderVisitor: FooVisitor<string> = {
  bar(node) { return node.value; },
  baz(node) { return String(node.count); },
};

function render(node: Foo): string {
  return node.accept(renderVisitor);
}
```

## Always construct instances, never frozen object literals

This holds everywhere a node is built — tests **and** production construction surfaces (contract-free factories, builders). A factory must return `new BarNode(...)`, never `Object.freeze({ kind: 'bar', value: 'x' })`. A frozen plain object has no prototype, so `instanceof` fails, `accept()` is missing, and a downstream shallow-copy (`{ ...node }`) silently strips the type back to an anonymous bag; constructor-time invariants are skipped too.

```typescript
// ✅
const call = new BarNode('x');
export function bar(value: string): BarNode { return new BarNode(value); }

// ❌
const call: Foo = { kind: 'bar', value: 'x' };
export function bar(value: string): Foo { return Object.freeze({ kind: 'bar', value }); }
```

## When NOT to use

- Single dispatch site → plain union + switch is simpler
- Fewer than 3 variants with no expected growth → not worth the boilerplate

## Codebase examples

- `MongoAstNode` base — `packages/2-mongo-family/4-query/query-ast/src/ast-node.ts`
- `MongoDdlCommandVisitor` interface — `packages/2-mongo-family/4-query/query-ast/src/ddl-visitors.ts`
- Concrete DDL commands and their union — `packages/2-mongo-family/4-query/query-ast/src/ddl-commands.ts`
