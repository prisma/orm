import type { Result } from '@internal/utils/result';

/**
 * Options for rendering the `contract.d.ts` text of an already-emitted
 * contract, as read from `contract.json`.
 */
export interface RenderContractDtsOptions {
  /** The parsed `contract.json` to render types for. */
  readonly contract: unknown;
  /** The module the declarations import the framework and family contract types from: the config's `contract.typesModule`. */
  readonly typesModule: string;
}

export interface RenderContractDtsSuccess {
  /** The declarations, rendered through the same emitter as `emit`, importing from the module the caller named. */
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
