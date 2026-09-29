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
  /** `'warning'` for a finding that does not stop the source from producing a contract; absent means `'error'`. */
  readonly severity?: 'error' | 'warning';
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
  /**
   * The flat, expanded, deduped, sorted member file list — every
   * `source.inputs` glob resolved to the files it currently matches. A glob
   * can expand to many files or none, so this list's length and order do
   * not mirror `source.inputs` entry-for-entry.
   */
  readonly resolvedInputs: readonly string[];
  readonly capabilities: CapabilityMatrix;
  /**
   * Receives a warning the source reports while it still produces a contract, such as a deprecated name. Callers that show diagnostics supply it; a source reports through it when present and otherwise drops the warning.
   */
  readonly reportWarning?: (diagnostic: ContractSourceDiagnostic) => void;
}

/**
 * The language a contract source's inputs are written in. Every source states
 * one. Tooling that reads the inputs itself, such as `contract format` and the
 * language server, checks this instead of guessing from file extensions.
 */
export type ContractSourceFormat = 'psl' | 'typescript';

/**
 * A tool other than Prisma 8 that applies schema changes to the database a contract source describes. Prisma 8 then only signs and verifies that database: `db init`, `db update`, `db migrate`, `migration plan` and `migration new` refuse to run.
 */
export interface ContractSourceSchemaOwner {
  /** Advice text, worded as a next action: what the user does in that tool to apply a schema change. */
  readonly applySchemaChangeAdvice: string;
}

export interface ContractSourceProviderBase {
  /**
   * Glob patterns naming the contract source's member files. A wildcard-free
   * entry is the degenerate glob (a literal path). Directories are not
   * auto-expanded.
   */
  readonly inputs?: readonly string[];
  /**
   * Set when another tool applies schema changes to the database this source describes. When `db verify` or `db sign` finds the app's schema behind the contract, it points at that tool and then at `db sign`, instead of at a Prisma 8 migration, and `db init`, `db update`, `db migrate`, `migration plan` and `migration new` refuse to run.
   */
  readonly schemaOwner?: ContractSourceSchemaOwner;
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

export type ContractSourceProvider = PslContractSourceProvider | TypeScriptContractSourceProvider;
