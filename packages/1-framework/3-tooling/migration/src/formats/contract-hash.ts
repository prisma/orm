import { isStorageHashHex } from '@internal/framework-components/control';

/** Why `value`, the `field` of a stored file, is not a contract hash; undefined when it is one. */
export function notContractHashText(field: string, value: string): string | undefined {
  return isStorageHashHex(value)
    ? undefined
    : `${field} must be a contract hash of 64 lowercase hex characters (got "${value}")`;
}
