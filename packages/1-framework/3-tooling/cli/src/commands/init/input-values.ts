import { extname, normalize } from 'pathe';
import { errorInitAuthoringSchemaPathMismatch, errorInitInvalidFlagValue } from './errors';
import type { AuthoringMode } from './init-contribution';
import { findTargetByName, type KnownTarget, TARGET_SHORT_NAMES } from './target-packages';

const AUTHORING_VALUES: ReadonlyMap<string, AuthoringMode> = new Map([
  ['psl', 'psl'],
  ['typescript', 'typescript'],
  ['ts', 'typescript'],
]);

export function resolveTarget(value: string | undefined): KnownTarget | undefined {
  if (value === undefined) return undefined;
  const mapped = findTargetByName(value);
  if (mapped === undefined) {
    throw errorInitInvalidFlagValue({
      flag: 'target',
      value,
      allowed: TARGET_SHORT_NAMES,
    });
  }
  return mapped;
}

export function resolveAuthoring(value: string | undefined): AuthoringMode | undefined {
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
 * Validates `--schema-path` against the chosen `--authoring` style: PSL
 * authoring requires a `.prisma` file and TypeScript authoring requires a
 * `.ts` file. Mismatched combinations would silently scaffold PSL content
 * into a `.ts` file (or vice versa); this validator surfaces the mistake
 * as a precondition error naming both flags.
 */
export function validateSchemaPath(value: string, authoring: AuthoringMode): string {
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
