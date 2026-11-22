import { BetterAuthError } from '@better-auth/core/error';

const pslIdentifier = /^[A-Za-z_][A-Za-z0-9_]*$/;

const invalidNameErrors = new WeakSet<object>();

function invalidNameError(message: string): BetterAuthError {
  const error = new BetterAuthError(message);
  invalidNameErrors.add(error);
  return error;
}

/** Whether an error is the one a model or field name that is not an identifier raises. */
export function isInvalidNameError(error: unknown): error is BetterAuthError {
  return typeof error === 'object' && error !== null && invalidNameErrors.has(error);
}

export function isPslIdentifier(name: string): boolean {
  return pslIdentifier.test(name);
}

export function assertModelName(name: string): void {
  if (isPslIdentifier(name)) return;
  throw invalidNameError(
    `Better Auth's model name "${name}" is not a valid Prisma model name: use letters, digits and "_", not starting with a digit. Rename the model with Better Auth's "modelName" option.`,
  );
}

export function assertFieldName(model: string, field: string): void {
  if (isPslIdentifier(field)) return;
  throw invalidNameError(
    `Better Auth's field name "${field}" of model "${model}" is not a valid Prisma field name: use letters, digits and "_", not starting with a digit. Rename the field with Better Auth's "fields" option.`,
  );
}

export function upperFirst(name: string): string {
  return name.charAt(0).toUpperCase() + name.slice(1);
}

export function lowerFirst(name: string): string {
  return name.charAt(0).toLowerCase() + name.slice(1);
}
