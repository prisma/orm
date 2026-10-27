import type { DataTypeSupport } from '@internal/framework-components/authoring';
import { createDataTypeLookup } from '@internal/framework-components/codec';
import type { GeneratorFunctionRegistry } from '@internal/framework-components/components';
import type { ControlMutationDefaultRegistry } from '@internal/framework-components/control';
import type { Resolution } from '../binder';
import type { BlockSpecContext } from '../block-spec/types';
import type { ContributedTypeSymbol } from '../contributed-type-scope';
import type { FieldSymbol, MixinSymbol, ModelSymbol, SymbolTable } from '../symbol-table';
import type {
  AttributeSpec,
  BlockAttributeCtx,
  FieldAttributeCtx,
  ModelAttributeCtx,
} from './types';

export interface AttributeSpecContext {
  readonly symbols: SymbolTable;
  readonly model: ModelSymbol | MixinSymbol;
  readonly defaultFunctionRegistry: ControlMutationDefaultRegistry;
  readonly generatorFunctions: GeneratorFunctionRegistry;
  readonly dataTypes: DataTypeSupport;
}

/** The data types of a stack that registers none. */
export const EMPTY_DATA_TYPES: DataTypeSupport = {
  entries: {},
  lookup: createDataTypeLookup([]),
  dataTypeOfCodec: () => undefined,
};

export interface FieldAttributeSpecContext extends AttributeSpecContext {
  readonly field: FieldSymbol;
  readonly typeResolution: Resolution | undefined;
  /** The type constructor the field's type resolves to, through a named type when it is declared with one. */
  readonly typeConstructor: ContributedTypeSymbol | undefined;
}

/** The declaration an attribute that reads its type is written on: a field, or a type alias whose fields take the attribute. */
export interface TypeAttributeSubject {
  readonly kind: 'field' | 'type alias';
  /** `Model.field` for a field; the alias's name for a type alias. */
  readonly name: string;
}

/** How a diagnostic names a subject, as in `Field "Post.slug"` or `Type alias "Slug"`. */
export function typeAttributeSubjectLabel(subject: TypeAttributeSubject): string {
  return `${subject.kind === 'field' ? 'Field' : 'Type alias'} "${subject.name}"`;
}

/** What `@default`, `@onCreate` and `@onUpdate` are checked against: the type of the field or type alias they are written on. */
export interface TypeAttributeSpecContext extends Omit<AttributeSpecContext, 'model'> {
  readonly subject: TypeAttributeSubject;
  readonly list: boolean;
  /** The type as written, such as an enum's name. */
  readonly typeName: string;
  readonly typeResolution: Resolution | undefined;
  /** The type constructor the type resolves to, through a named type when it is declared with one. */
  readonly typeConstructor: ContributedTypeSymbol | undefined;
}

export function typeAttributeSpecContextOfField(
  ctx: FieldAttributeSpecContext,
): TypeAttributeSpecContext {
  return {
    symbols: ctx.symbols,
    defaultFunctionRegistry: ctx.defaultFunctionRegistry,
    generatorFunctions: ctx.generatorFunctions,
    dataTypes: ctx.dataTypes,
    subject: { kind: 'field', name: `${ctx.model.name}.${ctx.field.name}` },
    list: ctx.field.list,
    typeName: ctx.field.typeName,
    typeResolution: ctx.typeResolution,
    typeConstructor: ctx.typeConstructor,
  };
}

export type ModelAttributeSpecFactory = (
  ctx: AttributeSpecContext,
) => AttributeSpec<never, ModelAttributeCtx>;

export type FieldAttributeSpecFactory = (
  ctx: FieldAttributeSpecContext,
) => AttributeSpec<never, FieldAttributeCtx>;

export interface AttributeSpecNamespace {
  readonly model: Readonly<Record<string, ModelAttributeSpecFactory>>;
  readonly field: Readonly<Record<string, FieldAttributeSpecFactory>>;
}

export type BlockAttributeSpecFactory = (
  ctx: BlockSpecContext,
) => AttributeSpec<never, BlockAttributeCtx>;
