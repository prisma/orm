import type { Contract } from '@internal/contract/types';
import type { CodecLookup, DataTypeLookup } from '@internal/framework-components/codec';
import type { CapabilityMatrix } from '@internal/framework-components/components';
import type {
  AssembledAuthoringContributions,
  ControlMutationDefaults,
} from '@internal/framework-components/control';
import type { Result } from '@internal/utils/result';

export interface ContractSourceDiagnosticPosition {
  readonly offset: number;
  readonly line: number;
  readonly column: number;
}

export interface ContractSourceDiagnosticSpan {
  readonly start: ContractSourceDiagnosticPosition;
  readonly end: ContractSourceDiagnosticPosition;
}

export interface ContractSourceDiagnostic {
  readonly code: string;
  readonly message: string;
  readonly sourceId: string;
  readonly span?: ContractSourceDiagnosticSpan;
  /**
   * Optional structured payload for machine-readable consumers (agents,
   * IDE extensions, CLI auto-fix). Human-readable prose lives in `message`;
   * `data` carries the extracted facts (e.g. `{ namespace: 'pgvector' }`).
   */
  readonly data?: Readonly<Record<string, unknown>>;
}

export interface ContractSourceDiagnostics {
  readonly summary: string;
  readonly diagnostics: readonly ContractSourceDiagnostic[];
  readonly meta?: Record<string, unknown>;
}

export interface ContractSourceContext {
  readonly composedExtensions: readonly string[];
  /** Extension contracts keyed by space ID, required for cross-space FK resolution. */
  readonly composedExtensionContracts: ReadonlyMap<string, Contract>;
  readonly authoringContributions: AssembledAuthoringContributions;
  readonly codecLookup: CodecLookup;
  /** The stack's data types, so a written default can be cast into a column's type. ADR 254. */
  readonly dataTypeLookup: DataTypeLookup;
  readonly controlMutationDefaults: ControlMutationDefaults;
  readonly resolvedInputs: readonly string[];
  readonly capabilities: CapabilityMatrix;
}

/**
 * A contract source is PSL or TypeScript: the inputs it reads and the `load`
 * that turns them into a contract. `format` says which language the inputs are
 * written in; a source that declares none is a TypeScript source. A PSL source
 * may also carry the `interpret` capability `@internal/psl-parser` defines;
 * tooling that rewrites PSL in place narrows through `hasPslInterpreter`,
 * because PSL text exists that the Prisma 8 reader does not interpret, such as
 * a Prisma 7 schema.
 */
export type ContractSourceFormat = 'psl' | 'typescript';

export interface ContractSourceProviderBase {
  readonly inputs?: readonly string[];
  readonly load: (
    context: ContractSourceContext,
  ) => Promise<Result<Contract, ContractSourceDiagnostics>>;
}

export interface PslContractSourceProvider extends ContractSourceProviderBase {
  readonly format: 'psl';
}

export interface TypeScriptContractSourceProvider extends ContractSourceProviderBase {
  readonly format?: 'typescript';
}

export type ContractSourceProvider = PslContractSourceProvider | TypeScriptContractSourceProvider;
