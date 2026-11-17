import type { IntegrityViolation } from '@internal/migration-tools/aggregate';
import { join, relative } from 'pathe';
import type { CheckFailure } from '../commands/json/schemas';
import { chooseAction, runCommandAction } from './next-actions';

export type { CheckFailure } from '../commands/json/schemas';

function migrationPathRelative(dirPath: string): string {
  return relative(process.cwd(), dirPath);
}

function migrationFileRelative(dirPath: string, fileName: string): string {
  return join(migrationPathRelative(dirPath), fileName);
}

/**
 * Map one {@link IntegrityViolation} onto a `migration check` failure row.
 * Sole catalogue mapping from integrity violations to `MIGRATION.CHECK_*` codes.
 */
export function integrityViolationToCheckFailure(
  violation: IntegrityViolation,
  migrationsDir: string,
): CheckFailure {
  const spaceRelative = (spaceId: string): string =>
    migrationPathRelative(join(migrationsDir, spaceId));
  const packageRelative = (spaceId: string, dirName: string): string =>
    migrationPathRelative(join(migrationsDir, spaceId, dirName));
  const refRelative = (spaceId: string, refName: string): string =>
    migrationPathRelative(join(migrationsDir, spaceId, 'refs', `${refName}.json`));

  switch (violation.kind) {
    case 'hashMismatch':
      return {
        space: violation.spaceId,
        code: 'MIGRATION.CHECK_HASH_MISMATCH',
        where: migrationFileRelative(
          join(migrationsDir, violation.spaceId, violation.dirName),
          'migration.json',
        ),
        why: `Stored hash ${violation.stored} does not match recomputed hash ${violation.computed}`,
        nextActions: [
          chooseAction('Re-emit the migration package, or restore it from version control'),
        ],
      };
    case 'providedInvariantsMismatch':
      return {
        space: violation.spaceId,
        code: 'MIGRATION.CHECK_PROVIDED_INVARIANTS_MISMATCH',
        where: packageRelative(violation.spaceId, violation.dirName),
        why: `Migration "${violation.dirName}" providedInvariants in migration.json disagrees with ops.json.`,
        nextActions: [
          chooseAction('Re-emit the migration package so migration.json and ops.json agree'),
        ],
      };
    case 'packageUnloadable':
      return {
        space: violation.spaceId,
        code: 'MIGRATION.CHECK_PACKAGE_UNLOADABLE',
        where: packageRelative(violation.spaceId, violation.dirName),
        why: `Migration "${violation.dirName}" could not be loaded: ${violation.detail}`,
        nextActions: [
          chooseAction('Re-emit the migration package, or restore it from version control'),
        ],
      };
    case 'sameSourceAndTarget':
      return {
        space: violation.spaceId,
        code: 'MIGRATION.CHECK_NOOP_SELF_EDGE',
        where: packageRelative(violation.spaceId, violation.dirName),
        why: `Migration "${violation.dirName}" in space "${violation.spaceId}" has source equal to target (${violation.hash}) with no data invariant — a true no-op self-edge.`,
        nextActions: [
          chooseAction(
            'Add a data operation if this self-edge was meant to carry a data invariant',
          ),
          chooseAction('Or delete the migration if it is a true no-op'),
        ],
      };
    case 'orphanSpaceDir':
      return {
        space: violation.spaceId,
        code: 'MIGRATION.CHECK_ORPHAN_SPACE_DIR',
        where: spaceRelative(violation.spaceId),
        why: `Contract-space directory "${violation.spaceId}" exists on disk but no extension declares it.`,
        nextActions: [
          chooseAction('Remove the orphan directory'),
          chooseAction('Or declare the extension in `extensions`'),
        ],
      };
    case 'declaredButUnmigrated':
      return {
        space: violation.spaceId,
        code: 'MIGRATION.CHECK_DECLARED_BUT_UNMIGRATED',
        where: spaceRelative(violation.spaceId),
        why: `Extension "${violation.spaceId}" is declared in \`extensions\` but has no on-disk migrations directory.`,
        nextActions: [
          runCommandAction(
            'Re-emit the extension contract-space artefacts, then plan its migrations',
            '{bin} contract emit',
          ),
          chooseAction('Or remove the extension from `extensions` if it is unused'),
        ],
      };
    case 'headRefMissing':
      return {
        space: violation.spaceId,
        code: 'MIGRATION.CHECK_HEAD_REF_MISSING',
        where: refRelative(violation.spaceId, 'head'),
        why: `Head ref \`refs/head.json\` is missing for contract space "${violation.spaceId}".`,
        nextActions: [
          chooseAction('Re-emit the contract-space migrations and head ref artefacts'),
          chooseAction('Or restore `refs/head.json` from version control'),
        ],
      };
    case 'headRefNotInGraph':
      return {
        space: violation.spaceId,
        code: 'MIGRATION.CHECK_HEAD_REF_NOT_IN_GRAPH',
        where: refRelative(violation.spaceId, 'head'),
        why: `Head ref ${violation.hash} for contract space "${violation.spaceId}" is not present in its migration graph.`,
        nextActions: [
          chooseAction('Re-emit the contract-space migrations'),
          chooseAction('Or restore the missing migration package'),
        ],
      };
    case 'refUnreadable':
      return {
        space: violation.spaceId,
        code: 'MIGRATION.CHECK_REF_UNREADABLE',
        where: refRelative(violation.spaceId, violation.refName),
        why: `Ref "${violation.refName}" for contract space "${violation.spaceId}" is unreadable: ${violation.detail}`,
        nextActions: [chooseAction('Repair or remove the corrupt ref file')],
      };
    case 'targetMismatch':
      return {
        space: violation.spaceId,
        code: 'MIGRATION.CHECK_TARGET_MISMATCH',
        where: spaceRelative(violation.spaceId),
        why: `Contract space "${violation.spaceId}" targets "${violation.actual}" but the project targets "${violation.expected}".`,
        nextActions: [
          chooseAction('Update the extension to target the configured database'),
          chooseAction('Or change the project target'),
        ],
      };
    case 'disjointness':
      return {
        space: 'app',
        code: 'MIGRATION.CHECK_SPACE_DISJOINTNESS_VIOLATION',
        where: migrationPathRelative(migrationsDir),
        why: `Storage element "${violation.element}" is claimed by multiple contract spaces: ${violation.claimedBy.join(', ')}.`,
        nextActions: [
          chooseAction(
            'Update the contracts so each storage element is owned by exactly one contract space',
          ),
        ],
      };
    case 'contractUnreadable':
      return {
        space: violation.spaceId,
        code: 'MIGRATION.CHECK_CONTRACT_UNREADABLE',
        where: migrationFileRelative(join(migrationsDir, violation.spaceId), 'contract.json'),
        why: `Contract for space "${violation.spaceId}" is unreadable: ${violation.detail}`,
        nextActions: [
          runCommandAction('Re-emit the extension contract artefacts', '{bin} contract emit'),
          chooseAction('Or fix the descriptor producing the invalid contract'),
        ],
      };
    case 'duplicateMigrationHash':
      return {
        space: violation.spaceId,
        code: 'MIGRATION.CHECK_DUPLICATE_MIGRATION_HASH',
        where: spaceRelative(violation.spaceId),
        why: `Multiple migrations in space "${violation.spaceId}" share migrationHash "${violation.migrationHash}" (${violation.dirNames.join(', ')}).`,
        nextActions: [
          chooseAction('Re-emit one of the conflicting packages so each migrationHash is unique'),
        ],
      };
  }
}
