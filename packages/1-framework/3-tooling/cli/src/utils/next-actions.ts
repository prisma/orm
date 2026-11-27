import { APP_SPACE_ID } from '@internal/framework-components/control';
import { contractSnapshotDir } from '@internal/migration-tools/contract-snapshot-store';
import { APP_UPGRADE_GUIDES_URL } from '@internal/utils/upgrade-guides';
import type { NextAction } from '@prisma/cli-engine/protocol';
import { join, relative } from 'pathe';

/**
 * The typed remediation the CLI attaches to its own errors and findings.
 * Constructors live here rather than in any library the CLI calls: naming a
 * runnable invocation is something only the CLI can do.
 */
export function runCommandAction(label: string, command: string): NextAction {
  return { kind: 'run-command', label, command };
}

/** Advice the user carries out or decides on themselves, such as changing data in the database or choosing between plans; it has no command to run and edits no file. */
export function chooseAction(label: string): NextAction {
  return { kind: 'user-choice', label };
}

/** Advice that changes a file before anything runs again. */
export function editFileAction(label: string): NextAction {
  return { kind: 'edit-file', label };
}

export interface MigrationPackagePlace {
  readonly spaceId: string;
  readonly packageDir: string;
  readonly cwd: string;
}

/**
 * How a migration package whose files are wrong is put right. An application migration is restored, or its `migration.json` and `ops.json` are written again by running its `migration.ts`. An extension's migration has no `migration.ts`: it comes with the extension, and `contract emit` writes a migration folder that is missing from the installed extension.
 */
export function migrationPackageRepairActions(place: MigrationPackagePlace): NextAction[] {
  const restore = chooseAction('Restore the migration package from version control');
  if (place.spaceId !== APP_SPACE_ID) {
    return [
      restore,
      runCommandAction(
        `Or delete the folder ${relative(place.cwd, place.packageDir)} and write it again from the installed extension, when that version of the extension ships this migration`,
        '{bin} contract emit',
      ),
      chooseAction('Or install a version of the extension that ships its migrations'),
    ];
  }
  return [
    restore,
    runCommandAction(
      'Or write migration.json and ops.json again from its migration.ts',
      `node "${relative(place.cwd, join(place.packageDir, 'migration.ts'))}"`,
    ),
  ];
}

/** A contract snapshot in the migrations directory, the space it belongs to, and that space's head: the emitted contract's hash for the application, the installed extension's for an extension. */
export interface SnapshotPlace {
  readonly spaceId: string;
  readonly hash: string;
  readonly headHash: string | undefined;
  readonly migrationsDir: string;
  readonly cwd: string;
}

/**
 * The command that writes a snapshot again once its folder is deleted, when there is one. Every command writes a snapshot only where none exists, and only at a space's head: `db migrate` writes the application's from `contract.json` when it moves a ref there, and `contract emit` writes an extension's from the installed extension.
 */
export function snapshotRewrite(place: SnapshotPlace): SnapshotRewrite | undefined {
  if (place.hash !== place.headHash) return undefined;
  return snapshotRewriteAt(
    place.spaceId,
    relative(place.cwd, contractSnapshotDir(place.migrationsDir, place.hash)),
  );
}

/** A snapshot's folder, the command that writes it again once the folder is deleted, and what that command writes it from. */
export interface SnapshotRewrite {
  readonly snapshotDirectory: string;
  readonly command: string;
  readonly source: string;
}

/** How the snapshot at the head of a space, in `snapshotDirectory`, is written again once deleted. */
export function snapshotRewriteAt(spaceId: string, snapshotDirectory: string): SnapshotRewrite {
  return spaceId === APP_SPACE_ID
    ? { snapshotDirectory, command: '{bin} db migrate --advance-ref db', source: 'contract.json' }
    : { snapshotDirectory, command: '{bin} contract emit', source: 'the installed extension' };
}

/**
 * How a contract snapshot this release cannot read is put right: the application's upgrade instructions when an earlier release wrote it, writing it again when a command does, moving each ref that names it, and restoring a file edited by hand. An extension's snapshot comes from the extension, so the application's upgrade instructions are not offered for it.
 */
export function snapshotRepairActions(
  place: SnapshotPlace,
  options?: { readonly refNames?: readonly string[] },
): NextAction[] {
  const rewrite = snapshotRewrite(place);
  const isApp = place.spaceId === APP_SPACE_ID;
  return [
    ...(isApp
      ? [
          {
            kind: 'open-url' as const,
            label: 'If an earlier release wrote the snapshot, follow the app upgrade instructions',
            url: APP_UPGRADE_GUIDES_URL,
          },
        ]
      : []),
    ...(rewrite === undefined
      ? []
      : [
          runCommandAction(
            `${isApp ? 'Or delete' : 'Delete'} ${rewrite.snapshotDirectory} and write it again from ${rewrite.source}`,
            rewrite.command,
          ),
        ]),
    ...(options?.refNames ?? []).map((name) =>
      runCommandAction(
        `Or point the ref "${name}" at a migration whose snapshot this release reads`,
        `{bin} migration ref set ${name} <hash>`,
      ),
    ),
    chooseAction('If the file was edited by hand, restore it from version control'),
  ];
}
