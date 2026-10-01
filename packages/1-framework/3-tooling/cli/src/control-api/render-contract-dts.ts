import type { ImportSpecifierResolver } from '@internal/framework-components/emission';
import type { Result } from '@internal/utils/result';

/**
 * Options for rendering the `contract.d.ts` text of an already-emitted
 * contract, as read from `contract.json`.
 */
export interface RenderContractDtsOptions {
  /** The parsed `contract.json` to render types for. */
  readonly contract: unknown;
  /**
   * Rewrites the package names the declarations import from, for the import
   * root of the project that keeps them. Defaults to leaving every specifier
   * as authored.
   */
  readonly resolveImportSpecifier?: ImportSpecifierResolver;
}

export interface RenderContractDtsSuccess {
  /** The declarations, rendered through the same emitter as `emit`, with the import specifiers the caller asked for. */
  readonly contractDts: string;
}

export type RenderContractDtsFailureCode = 'CONTRACT_VALIDATION_FAILED' | 'RENDER_FAILED';

export interface RenderContractDtsFailure {
  readonly code: RenderContractDtsFailureCode;
  readonly summary: string;
  readonly why: string | undefined;
  /** Underlying error for diagnostics; never serialized into envelopes. */
  readonly cause?: unknown;
}

export type RenderContractDtsResult = Result<RenderContractDtsSuccess, RenderContractDtsFailure>;
