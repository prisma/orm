import { readFile } from 'node:fs/promises';
import type { ContractSpaceHeadRef } from '@internal/framework-components/control';
import { join } from 'pathe';
import { errorInvalidJson, errorInvalidRefFile } from './errors';
import { assertValidSpaceId, spaceMigrationDirectory, spaceRefsDirectory } from './space-layout';

export type { ContractSpaceHeadRef };

function hasErrnoCode(error: unknown, code: string): boolean {
  return error instanceof Error && (error as { code?: string }).code === code;
}

/** The file that holds the head ref of contract space `spaceId`. */
export function contractSpaceHeadRefPath(projectMigrationsDir: string, spaceId: string): string {
  assertValidSpaceId(spaceId);
  return join(
    spaceRefsDirectory(spaceMigrationDirectory(projectMigrationsDir, spaceId)),
    'head.json',
  );
}

/**
 * Read the head ref (`hash` + `invariants`) for a contract space from
 * `<projectMigrationsDir>/<spaceId>/refs/head.json`.
 *
 * Returns `null` when the file does not exist (first emit). Surfaces
 * `MIGRATION.INVALID_JSON` / `MIGRATION.INVALID_REF_FILE` on a corrupt
 * `refs/head.json` so callers can distinguish "no head ref on disk"
 * (returns `null`) from "head ref present but unreadable" (throws).
 *
 * Validates the space id against `[a-z][a-z0-9_-]{0,63}` for the same
 * filesystem-safety reasons as the rest of the per-space helpers. The
 * helper is uniform across the app and extension spaces.
 */
export async function readContractSpaceHeadRef(
  projectMigrationsDir: string,
  spaceId: string,
): Promise<ContractSpaceHeadRef | null> {
  const filePath = contractSpaceHeadRefPath(projectMigrationsDir, spaceId);

  let raw: string;
  try {
    raw = await readFile(filePath, 'utf-8');
  } catch (error) {
    if (hasErrnoCode(error, 'ENOENT')) {
      return null;
    }
    throw error;
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch (e) {
    throw errorInvalidJson(filePath, e instanceof Error ? e.message : String(e));
  }

  if (typeof parsed !== 'object' || parsed === null) {
    throw errorInvalidRefFile(filePath, 'expected an object');
  }
  const obj = parsed as { hash?: unknown; invariants?: unknown };
  if (typeof obj.hash !== 'string') {
    throw errorInvalidRefFile(filePath, 'expected an object with a string `hash` field');
  }
  if (!Array.isArray(obj.invariants) || obj.invariants.some((value) => typeof value !== 'string')) {
    throw errorInvalidRefFile(filePath, 'expected an object with an `invariants` array of strings');
  }

  return { hash: obj.hash, invariants: obj.invariants as readonly string[] };
}
