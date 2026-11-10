import type { ColumnDefault } from '@internal/contract/types';

interface SourcePosition {
  readonly offset: number;
  readonly line: number;
  readonly column: number;
}

export interface SourceSpan {
  readonly start: SourcePosition;
  readonly end: SourcePosition;
}

export interface SourceDiagnostic {
  readonly code: string;
  readonly message: string;
  readonly sourceId: string;
  readonly span?: SourceSpan;
  readonly data?: Readonly<Record<string, unknown>>;
}

export interface DefaultFunctionLoweringContext {
  readonly sourceId: string;
  readonly modelName: string;
  readonly fieldName: string;
  readonly columnCodecId?: string;
}

/** What a default function lowers to: always a database default. A value the client generates is a generator function, which `@onCreate(fn())` and `@onUpdate(fn())` call. */
export type LoweredDefaultValue = {
  readonly kind: 'storage';
  readonly defaultValue: ColumnDefault;
};

export type LoweredDefaultResult =
  | { readonly ok: true; readonly value: LoweredDefaultValue }
  | { readonly ok: false; readonly diagnostic: SourceDiagnostic };

export interface MutationDefaultGeneratorDescriptor {
  readonly id: string;
}

// A default-function call whose arguments the function's `funcCall` signature has already parsed
// and validated, so the registry lowering reads them directly instead of re-parsing source text.
export interface TypedDefaultFunctionCall {
  readonly fn: string;
  readonly span: SourceSpan;
  readonly args: Readonly<Record<string, unknown>>;
}

export interface ControlMutationDefaultEntry {
  // The function's argument signature. Typed `unknown` because its concrete type (`FuncCallSig`)
  // lives in the authoring layer, which the core framework cannot import; the family that
  // registers the entry narrows it back.
  readonly signature?: unknown;
  readonly lower: (input: {
    readonly call: TypedDefaultFunctionCall;
    readonly context: DefaultFunctionLoweringContext;
  }) => LoweredDefaultResult;
  readonly usageSignatures?: readonly string[];
}

export type ControlMutationDefaultRegistry = ReadonlyMap<string, ControlMutationDefaultEntry>;

export interface ControlMutationDefaults {
  readonly defaultFunctionRegistry: ControlMutationDefaultRegistry;
  readonly generatorDescriptors: readonly MutationDefaultGeneratorDescriptor[];
}

/** The mutation defaults of a composed stack. */
export interface AssembledControlMutationDefaults extends ControlMutationDefaults {
  /** For each registered generator id, the id of the component that registers it, or `undefined` when that component has no id. */
  readonly componentIdsByGenerator: ReadonlyMap<string, string | undefined>;
}
