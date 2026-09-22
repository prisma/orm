/**
 * An enumerated-value parameter: the author supplies one of `values`, spelled
 * as a bare token in PSL and a string literal in TypeScript. Part of the
 * helper argument vocabulary (`AuthoringArgumentDescriptor`). See ADR 246.
 */
export interface AuthoringOption {
  readonly kind: 'option';
  readonly values: readonly string[];
}
