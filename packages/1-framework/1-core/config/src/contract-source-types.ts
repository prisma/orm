import type { Contract } from '@internal/contract/types';
import type { CodecLookup } from '@internal/framework-components/codec';
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
  readonly controlMutationDefaults: ControlMutationDefaults;
  readonly resolvedInputs: readonly string[];
  readonly capabilities: CapabilityMatrix;
}

/** Lets format-aware tooling avoid file-extension sniffing and opaque loader introspection. */
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
  readonly format: 'typescript';
}

/**
 * Third-party or unspecified source formats. Absent (or unrecognized)
 * `format` means format-aware tooling must leave the source untouched.
 * Narrowing to a known format flows only through capability guards owned by
 * the authoring layer.
 */
export interface OpaqueContractSourceProvider extends ContractSourceProviderBase {
  readonly format?: string;
}

export type ContractSourceProvider =
  | PslContractSourceProvider
  | TypeScriptContractSourceProvider
  | OpaqueContractSourceProvider;
