import { BetterAuthError } from '@better-auth/core/error';

const pslIdentifier = /^[A-Za-z_][A-Za-z0-9_]*$/;

export function isPslIdentifier(name: string): boolean {
  return pslIdentifier.test(name);
}

/** The message for a Better Auth model name that is not a Prisma identifier, or `undefined` when it is one. */
export function invalidModelNameMessage(name: string): string | undefined {
  if (isPslIdentifier(name)) return undefined;
  return `Better Auth's model name "${name}" is not a valid Prisma model name: use letters, digits and "_", not starting with a digit. Rename the model with Better Auth's "modelName" option.`;
}

/** The message for a Better Auth field name that is not a Prisma identifier, or `undefined` when it is one. */
export function invalidFieldNameMessage(model: string, field: string): string | undefined {
  if (isPslIdentifier(field)) return undefined;
  return `Better Auth's field name "${field}" of model "${model}" is not a valid Prisma field name: use letters, digits and "_", not starting with a digit. Rename the field with Better Auth's "fields" option.`;
}

/** The message for Better Auth models whose names differ only in the case of the first letter. */
export function caseOnlyNameCollisionMessage(names: readonly string[]): string {
  const quoted = names.map((name) => `"${name}"`);
  const listed = `${quoted.slice(0, -1).join(', ')} and ${quoted.at(-1)}`;
  return `Better Auth's models ${listed} have names that differ only in the case of the first letter, which this adapter does not support. Set a different "modelName" on all but one of them in your Better Auth configuration.`;
}

export function assertModelName(name: string): void {
  const message = invalidModelNameMessage(name);
  if (message !== undefined) throw new BetterAuthError(message);
}

export function assertFieldName(model: string, field: string): void {
  const message = invalidFieldNameMessage(model, field);
  if (message !== undefined) throw new BetterAuthError(message);
}

export function upperFirst(name: string): string {
  return name.charAt(0).toUpperCase() + name.slice(1);
}

export function lowerFirst(name: string): string {
  return name.charAt(0).toLowerCase() + name.slice(1);
}
