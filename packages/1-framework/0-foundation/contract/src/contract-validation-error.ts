export type ContractValidationPhase = 'structural' | 'domain' | 'storage';

export class ContractValidationError extends Error {
  readonly code = 'CONTRACT.VALIDATION_FAILED';
  readonly phase: ContractValidationPhase;
  /** What the refusal is about, for a caller to report, such as the columns whose defaults were refused. */
  readonly meta: Readonly<Record<string, unknown>> | undefined;

  constructor(
    message: string,
    phase: ContractValidationPhase,
    meta?: Readonly<Record<string, unknown>>,
  ) {
    super(message);
    this.name = 'ContractValidationError';
    this.phase = phase;
    this.meta = meta;
  }
}
