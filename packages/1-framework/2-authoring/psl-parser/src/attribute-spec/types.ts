import type { PslDiagnostic } from '@internal/framework-components/psl-ast';
import type { Result } from '@internal/utils/result';
import type { Simplify, UnionToIntersection } from '@internal/utils/types';
import type { SourceFile } from '../source-file';
import type { FieldSymbol, ModelSymbol } from '../symbol-table';
import type { ExpressionAst } from '../syntax/ast/expressions';
import type { AstNode } from '../syntax/ast-helpers';

export type AttributeLevel = 'field' | 'model' | 'block';

export interface BlockInterpretCtx {
  readonly level: AttributeLevel;
  readonly sourceId: string;
  readonly sourceFile: SourceFile;
}

export interface InterpretCtx extends BlockInterpretCtx {
  readonly selfModel: ModelSymbol;
  resolveReferencedModel(): ModelSymbol | undefined;
  readonly field?: FieldSymbol;
}

export interface ArgType<T, Ctx extends BlockInterpretCtx = InterpretCtx> {
  readonly kind: string;
  readonly label: string;
  // phantom carrier for `T`; never read at runtime.
  readonly _out?: T;
  readonly parse: (arg: ExpressionAst, ctx: Ctx) => Result<T, readonly PslDiagnostic[]>;
}

export interface OptionalArgType<T, Ctx extends BlockInterpretCtx = InterpretCtx>
  extends ArgType<T, Ctx> {
  // the engine detects optionality by checking for this marker (`'optional' in param`).
  readonly optional: true;
  readonly hasDefault: boolean;
  readonly defaultValue?: T;
}

export type Param<T, Ctx extends BlockInterpretCtx = InterpretCtx> = ArgType<T, Ctx>;

export interface PositionalParam<T = unknown, Ctx extends BlockInterpretCtx = InterpretCtx> {
  readonly key: string;
  readonly type: Param<T, Ctx>;
}

export interface AttributeSpec<Out, Ctx extends BlockInterpretCtx = InterpretCtx> {
  readonly level: AttributeLevel;
  readonly name: string;
  readonly positional: readonly PositionalParam<unknown, Ctx>[];
  readonly named: Readonly<Record<string, Param<unknown, Ctx>>>;
  /**
   * Cross-argument validation after all arguments parse. `attributeNode` is
   * the attribute's own AST node so refines can span-anchor their
   * diagnostics at the attribute rather than the enclosing model.
   */
  readonly refine?: (parsed: Out, ctx: Ctx, attributeNode: AstNode) => readonly PslDiagnostic[];
}

export type OutOf<P> = P extends ArgType<infer T, never> ? T : never;

export type NamedOut<N extends Record<string, Param<unknown, never>>> = Simplify<
  { [K in keyof N as N[K] extends OptionalArgType<unknown, never> ? never : K]: OutOf<N[K]> } & {
    [K in keyof N as N[K] extends OptionalArgType<unknown, never> ? K : never]?: OutOf<N[K]>;
  }
>;

type PosEntryObject<E extends PositionalParam<unknown, never>> =
  E['type'] extends OptionalArgType<unknown, never>
    ? { [K in E['key']]?: OutOf<E['type']> }
    : { [K in E['key']]: OutOf<E['type']> };

export type PosOut<Pos extends readonly PositionalParam<unknown, never>[]> = Simplify<
  UnionToIntersection<{ [I in keyof Pos]: PosEntryObject<Pos[I]> }[number]>
>;

export type AttributeOut<
  Pos extends readonly PositionalParam<unknown, never>[],
  Named extends Record<string, Param<unknown, never>>,
> = Simplify<PosOut<Pos> & NamedOut<Named>>;

// `S` is unconstrained on purpose: `refine` makes `Out` contravariant, so a bound like `S extends AttributeSpec<unknown>` would reject every spec that uses `refine`.
export type InferAttr<S> = S extends AttributeSpec<infer Out, never> ? Out : never;
