import type { TaggedLiteralCanonicalization } from '@internal/framework-components/control';
import type { PslSpan } from '@internal/framework-components/psl-ast';
import type { Result } from '@internal/utils/result';
import type { Simplify, UnionToIntersection } from '@internal/utils/types';
import type { PslDiagnostic } from '../diagnostic';
import type { PslSources } from '../source-file';
import type { FieldSymbol, ModelSymbol } from '../symbol-table';
import type { ExpressionAst } from '../syntax/ast/expressions';
import type { AstNode } from '../syntax/ast-helpers';

export type AttributeLevel = 'field' | 'model' | 'block';

export interface AttributeCtx {
  readonly sources: PslSources;
}

export interface ModelAttributeCtx extends AttributeCtx {
  readonly selfModel: ModelSymbol;
}

export interface FieldAttributeCtx extends ModelAttributeCtx {
  readonly field: FieldSymbol;
  resolveReferencedModel(): ModelSymbol | undefined;
}

export type ArgTypeKind =
  | 'bool'
  | 'entityRef'
  | 'fieldRef'
  | 'funcCall'
  | 'identifier'
  | 'int'
  | 'json'
  | 'list'
  | 'num'
  | 'oneOf'
  | 'record'
  | 'referencedFieldRef'
  | 'rejecting'
  | 'str'
  | 'taggedLiteral';

export type ArgTypeContext = 'attribute' | 'field' | 'model';

export interface ArgTypeOutput<T, Ctx extends AttributeCtx> {
  readonly label: string;
  readonly _out?: T;
  readonly parse: (arg: ExpressionAst, ctx: Ctx) => Result<T, readonly PslDiagnostic[]>;
}

export interface BoolArgType<Ctx extends AttributeCtx = AttributeCtx>
  extends ArgTypeOutput<boolean, Ctx> {
  readonly kind: 'bool';
}

export interface EntityRefArgType<Ctx extends AttributeCtx = AttributeCtx>
  extends ArgTypeOutput<string, Ctx> {
  readonly kind: 'entityRef';
}

export interface FieldRefArgType<Ctx extends ModelAttributeCtx = ModelAttributeCtx>
  extends ArgTypeOutput<string, Ctx> {
  readonly kind: 'fieldRef';
}

export interface ReferencedFieldRefArgType<Ctx extends FieldAttributeCtx = FieldAttributeCtx>
  extends ArgTypeOutput<string, Ctx> {
  readonly kind: 'referencedFieldRef';
}

export interface FuncCallSig {
  readonly documentation: string;
  readonly positional?: readonly PositionalParam<unknown, AttributeCtx>[];
  readonly named?: Readonly<Record<string, Param<unknown, AttributeCtx>>>;
}

export interface TypedFuncCall {
  readonly fn: string;
  readonly span: PslSpan;
  readonly args: Readonly<Record<string, unknown>>;
}

export interface FuncCallArgType<
  Name extends string = string,
  Ctx extends AttributeCtx = AttributeCtx,
  Signature extends FuncCallSig = FuncCallSig,
> extends ArgTypeOutput<TypedFuncCall, Ctx> {
  readonly kind: 'funcCall';
  readonly name: Name;
  readonly signature: Signature;
}

export interface IdentifierArgType<
  Name extends string = string,
  Ctx extends AttributeCtx = AttributeCtx,
> extends ArgTypeOutput<Name, Ctx> {
  readonly kind: 'identifier';
  readonly name: Name;
  readonly documentation: string;
}

export interface IntArgType<Ctx extends AttributeCtx = AttributeCtx>
  extends ArgTypeOutput<number, Ctx> {
  readonly kind: 'int';
  readonly min?: number;
  readonly max?: number;
}

export interface JsonArgType<Ctx extends AttributeCtx = AttributeCtx>
  extends ArgTypeOutput<Record<string, unknown>, Ctx> {
  readonly kind: 'json';
}

export interface ListArgType<T = unknown, Ctx extends AttributeCtx = AttributeCtx>
  extends ArgTypeOutput<T[], Ctx> {
  readonly kind: 'list';
  readonly of: ArgType<T, Ctx>;
  readonly allowEmpty: boolean;
  readonly unique: boolean;
}

export interface UnrestrictedNumArgType<Ctx extends AttributeCtx = AttributeCtx>
  extends ArgTypeOutput<number, Ctx> {
  readonly kind: 'num';
  readonly value: undefined;
}

export interface FixedNumArgType<T extends number = number, Ctx extends AttributeCtx = AttributeCtx>
  extends ArgTypeOutput<T, Ctx> {
  readonly kind: 'num';
  readonly value: T;
}

export interface NumLiteral {
  readonly text: string;
}

export interface NumLiteralArgType<Ctx extends AttributeCtx = AttributeCtx>
  extends ArgTypeOutput<NumLiteral, Ctx> {
  readonly kind: 'num';
  readonly value: undefined;
}

export type NumArgType<
  T extends number = number,
  Ctx extends AttributeCtx = AttributeCtx,
> = number extends T ? UnrestrictedNumArgType<Ctx> : FixedNumArgType<T, Ctx>;

export interface OneOfArgType<
  Alts extends readonly [AnyArgType, ...AnyArgType[]],
  Ctx extends AttributeCtx = ContextForRequirement<RequiredContextFor<CtxOf<Alts[number]>>>,
> extends ArgTypeOutput<OutOf<Alts[number]>, Ctx> {
  readonly kind: 'oneOf';
  readonly alternatives: Alts;
}

export interface RecordArgType<T = unknown, Ctx extends AttributeCtx = AttributeCtx>
  extends ArgTypeOutput<Record<string, T>, Ctx> {
  readonly kind: 'record';
  readonly of: ArgType<T, Ctx>;
}

export interface RejectingArgType<T = never, Ctx extends AttributeCtx = AttributeCtx>
  extends ArgTypeOutput<T, Ctx> {
  readonly kind: 'rejecting';
  readonly message: string;
}

export interface UnrestrictedStrArgType<Ctx extends AttributeCtx = AttributeCtx>
  extends ArgTypeOutput<string, Ctx> {
  readonly kind: 'str';
  readonly value: undefined;
}

export interface FixedStrArgType<T extends string = string, Ctx extends AttributeCtx = AttributeCtx>
  extends ArgTypeOutput<T, Ctx> {
  readonly kind: 'str';
  readonly value: T;
}

export type StrArgType<
  T extends string = string,
  Ctx extends AttributeCtx = AttributeCtx,
> = string extends T ? UnrestrictedStrArgType<Ctx> : FixedStrArgType<T, Ctx>;

/**
 * A tagged literal argument as parsed: its tag, the canonicalization of its string literal, and its
 * span. Neither the tag nor the canonicalization has been checked; lowering does both.
 */
export interface ParsedTaggedLiteral {
  readonly tag: string;
  readonly canonicalization: TaggedLiteralCanonicalization;
  readonly span: PslSpan;
}

export interface TaggedLiteralArgType<Ctx extends AttributeCtx = AttributeCtx>
  extends ArgTypeOutput<ParsedTaggedLiteral, Ctx> {
  readonly kind: 'taggedLiteral';
  readonly tags: readonly string[];
  readonly documentation: string;
}

export interface ArgType<T, Ctx extends AttributeCtx> extends ArgTypeOutput<T, Ctx> {
  readonly kind: ArgTypeKind;
}

export type AnyArgType =
  | ArgType<unknown, AttributeCtx>
  | ArgType<unknown, ModelAttributeCtx>
  | ArgType<unknown, FieldAttributeCtx>;

export type CtxOf<P> = P extends ArgTypeOutput<unknown, infer Ctx> ? Ctx : never;

export type RequiredContextFor<Ctx extends AttributeCtx> = [
  Extract<Ctx, FieldAttributeCtx>,
] extends [never]
  ? [Extract<Ctx, ModelAttributeCtx>] extends [never]
    ? 'attribute'
    : 'model'
  : 'field';

export type ContextForRequirement<Req extends ArgTypeContext> = Req extends 'field'
  ? FieldAttributeCtx
  : Req extends 'model'
    ? ModelAttributeCtx
    : AttributeCtx;

export type InspectableArgType<Ctx extends AttributeCtx> =
  | BoolArgType<Ctx>
  | EntityRefArgType<Ctx>
  | FieldRefArgType<ModelAttributeCtx & Ctx>
  | FuncCallArgType<string, Ctx>
  | IdentifierArgType<string, Ctx>
  | IntArgType<Ctx>
  | JsonArgType<Ctx>
  | ListArgType<unknown, Ctx>
  | FixedNumArgType<number, Ctx>
  | UnrestrictedNumArgType<Ctx>
  | NumLiteralArgType<Ctx>
  | OneOfArgType<readonly [AnyArgType, ...AnyArgType[]], Ctx>
  | RecordArgType<unknown, Ctx>
  | ReferencedFieldRefArgType<FieldAttributeCtx & Ctx>
  | RejectingArgType<never, Ctx>
  | FixedStrArgType<string, Ctx>
  | UnrestrictedStrArgType<Ctx>
  | TaggedLiteralArgType<Ctx>;

export type OptionalArgType<
  T,
  Ctx extends AttributeCtx,
  Type extends object = ArgType<T, Ctx>,
  HasDefault extends boolean = boolean,
> = Type & {
  readonly optional: true;
  readonly hasDefault: HasDefault;
  readonly defaultValue?: T | undefined;
};

export interface Param<T, Ctx extends AttributeCtx> {
  readonly type: ArgType<T, Ctx>;
  readonly documentation: string;
}

export interface PositionalParam<T, Ctx extends AttributeCtx> extends Param<T, Ctx> {
  readonly key: string;
}

export interface AttributeSpec<Out, Ctx extends AttributeCtx> {
  readonly documentation: string;
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

export type OutOf<P> = P extends { readonly _out?: infer T } ? T : never;

type OptionalMarker = { readonly optional: true };

export type NamedOut<N extends Record<string, Param<unknown, never>>> = Simplify<
  { [K in keyof N as N[K]['type'] extends OptionalMarker ? never : K]: OutOf<N[K]['type']> } & {
    [K in keyof N as N[K]['type'] extends OptionalMarker ? K : never]?: OutOf<N[K]['type']>;
  }
>;

type PosEntryObject<E extends PositionalParam<unknown, never>> = E['type'] extends OptionalMarker
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
