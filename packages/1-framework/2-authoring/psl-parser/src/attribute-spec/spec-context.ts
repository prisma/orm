import type { ControlMutationDefaultRegistry } from '@internal/framework-components/control';
import type { FieldSymbol, ModelSymbol, SymbolTable } from '../symbol-table';
import type { AttributeSpec } from './types';

/**
 * The uniform context every attribute-spec factory is called with: the whole
 * symbol table, the model the attribute is declared on, and the composed
 * stack's mutation-default functions. One context shape for every built-in
 * means a family registers its specs without each one declaring its own
 * bespoke inputs.
 *
 * Distinct from `InterpretCtx`, which is the parse-time context an
 * already-built spec's arguments are interpreted against.
 */
export interface AttributeSpecContext {
  readonly symbols: SymbolTable;
  readonly model: ModelSymbol;
  readonly controlMutationDefaults: ControlMutationDefaultRegistry;
}

/** {@link AttributeSpecContext} plus the field a `@` attribute is declared on. */
export interface FieldAttributeSpecContext extends AttributeSpecContext {
  readonly field: FieldSymbol;
}

/**
 * `AttributeSpec`'s parameter is erased to `never`, not `unknown`, for the
 * same contravariance reason documented on
 * `AuthoringModelAttributeDescriptor`: `refine` puts `Out` in a parameter
 * position, so a concrete spec is assignable to this erased shape only when
 * the erased parameter is the bottom type. Registrations keep their precise
 * types through `as const satisfies AttributeSpecNamespace`, so `InferAttr`
 * stays intact at every access site that knows which attribute it wants.
 */
export type ModelAttributeSpecFactory = (ctx: AttributeSpecContext) => AttributeSpec<never>;

/** Field-level counterpart of {@link ModelAttributeSpecFactory}. */
export type FieldAttributeSpecFactory = (ctx: FieldAttributeSpecContext) => AttributeSpec<never>;

/**
 * The shape a family registers its built-in specs in, keyed by bare attribute
 * name within each level.
 */
export interface AttributeSpecNamespace {
  readonly model: Readonly<Record<string, ModelAttributeSpecFactory>>;
  readonly field: Readonly<Record<string, FieldAttributeSpecFactory>>;
}
