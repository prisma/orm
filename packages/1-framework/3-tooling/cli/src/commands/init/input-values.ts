import type { ContractSourceFormat } from '@internal/config/config-types';
import { extname, normalize } from 'pathe';
import validatePackageName from 'validate-npm-package-name';
import { errorInitAuthoringSchemaPathMismatch, errorInitInvalidFlagValue } from './errors';
import {
  findTargetByName,
  TARGET_SHORT_NAMES,
  type TargetPackage,
  targetPackageNamed,
} from './target-packages';

const AUTHORING_VALUES: ReadonlyMap<string, ContractSourceFormat> = new Map([
  ['psl', 'psl'],
  ['typescript', 'typescript'],
  ['ts', 'typescript'],
]);

export const PACKAGE_NAME_PLACEHOLDER = '<package name>';

export function resolveTarget(value: string | undefined): TargetPackage | undefined {
  return value === undefined ? undefined : resolveTargetName(value);
}

/** A short name or alias from the list, or the name of a target package that is in no list. */
export function resolveTargetName(value: string): TargetPackage {
  if (findTargetByName(value) !== undefined) {
    return targetPackageNamed(value);
  }
  const validation = validatePackageName(value);
  if (!validation.validForNewPackages) {
    throw errorInitInvalidFlagValue({
      flag: 'target',
      value,
      allowed: [...TARGET_SHORT_NAMES, PACKAGE_NAME_PLACEHOLDER],
      problems: [...(validation.errors ?? []), ...(validation.warnings ?? [])],
    });
  }
  return targetPackageNamed(value);
}

export function resolveAuthoring(value: string | undefined): ContractSourceFormat | undefined {
  if (value === undefined) return undefined;
  const mapped = AUTHORING_VALUES.get(value.toLowerCase());
  if (mapped === undefined) {
    throw errorInitInvalidFlagValue({
      flag: 'authoring',
      value,
      allowed: ['psl', 'typescript'],
    });
  }
  return mapped;
}

/**
 * Refuses a `--schema-path` that no authoring style takes, before `--authoring` is known.
 */
export function rejectSchemaPathNoModeTakes(value: string): void {
  const ext = extname(value.trim()).toLowerCase();
  if (ext !== '.prisma' && ext !== '.ts') {
    throw errorInitInvalidFlagValue({
      flag: 'schema-path',
      value,
      allowed: ['<file path with .prisma or .ts extension>'],
    });
  }
}

/**
 * Validates `--schema-path` against the chosen `--authoring` style: PSL
 * authoring requires a `.prisma` file and TypeScript authoring requires a
 * `.ts` file. Mismatched combinations would silently scaffold PSL content
 * into a `.ts` file (or vice versa); this validator surfaces the mistake
 * as a precondition error naming both flags.
 */
export function validateSchemaPath(value: string, authoring: ContractSourceFormat): string {
  const trimmed = value.trim();
  if (trimmed.length === 0) {
    throw errorInitInvalidFlagValue({
      flag: 'schema-path',
      value,
      allowed: ['<non-empty file path with .prisma or .ts extension>'],
    });
  }
  if (trimmed.endsWith('/') || trimmed.endsWith('\\')) {
    throw errorInitInvalidFlagValue({
      flag: 'schema-path',
      value,
      allowed: ['<file path, not a directory>'],
    });
  }
  const ext = extname(trimmed).toLowerCase();
  const expected = authoring === 'typescript' ? '.ts' : '.prisma';
  if (ext !== expected) {
    throw errorInitAuthoringSchemaPathMismatch({
      authoring,
      schemaPath: trimmed,
      actualExtension: ext.length > 0 ? ext : '(none)',
      expectedExtension: expected,
    });
  }
  return normalize(trimmed);
}
