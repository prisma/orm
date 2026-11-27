import { readFileSync } from 'node:fs';
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
 * Whether running the migration's `migration.ts` writes its `migration.json` again under the same migration hash: it keeps the `createdAt` of a `migration.json` it can read, and writes the current time into one it cannot, which changes the hash.
 */
export function migrationTsKeepsItsHash(packageDir: string): boolean {
  let document: unknown;
  try {
    document = JSON.parse(readFileSync(join(packageDir, 'migration.json'), 'utf-8'));
  } catch {
    return false;
  }
  return typeof Reflect.get(Object(document), 'createdAt') === 'string';
}

/**
 * How a migration package whose files are wrong is put right. It is restored from version control. An application migration's `migration.json` and `ops.json` are written again by its `migration.ts` when that keeps the migration's hash; otherwise a migration no database has applied is planned again. An extension's migration has no `migration.ts`: it comes with the extension, and `contract emit` writes a migration folder that is missing from the installed extension.
 */
export function migrationPackageRepairActions(place: MigrationPackagePlace): NextAction[] {
  const restore = chooseAction('Restore the migration package from version control');
  if (place.spaceId !== APP_SPACE_ID) {
    return [
      restore,
      runCommandAction(
        `Or delete the folder ${relative(place.cwd, place.packageDir)} and run this command, which emits contract.json from the contract source and writes the folder again from the installed extension when that version of the extension ships this migration`,
        '{bin} contract emit',
      ),
      chooseAction('Or install a version of the extension that ships its migrations'),
    ];
  }
  if (!migrationTsKeepsItsHash(place.packageDir)) {
    return [restore, replanAction(relative(place.cwd, place.packageDir))];
  }
  return [
    restore,
    runCommandAction(
      'Or write migration.json and ops.json again from its migration.ts',
      `node "${relative(place.cwd, join(place.packageDir, 'migration.ts'))}"`,
    ),
  ];
}

function replanAction(packageDir: string): NextAction {
  return runCommandAction(
    `Or, if no database has applied this migration, delete the folder ${packageDir} and the folders of the migrations that start where it ends, and plan again`,
    '{bin} migration plan',
  );
}

/** A contract snapshot in the migrations directory, the space it belongs to, and that space's head: the emitted contract's hash for the application, the installed extension's for an extension. */
export interface SnapshotPlace {
  readonly spaceId: string;
  readonly hash: string;
  readonly headHash: string | undefined;
  /** For the application: whether a migration of its graph ends at the head. */
  readonly headReachedByMigration: boolean;
  readonly migrationsDir: string;
  readonly cwd: string;
}

/**
 * The command that writes a snapshot again once its folder is deleted, when there is one. Every command writes a snapshot only where none exists, and only at a space's head. For an extension, `contract emit` writes it from the installed extension. For the application, each command that writes it also changes the configured database or what it records: `db migrate` when a migration ends at the head, and `db sign` when none does, since `db migrate` cannot move the `db` ref to a contract no migration ends at.
 */
export function snapshotRewrite(place: SnapshotPlace): SnapshotRewrite | undefined {
  if (place.hash !== place.headHash) return undefined;
  return snapshotRewriteAt(
    { spaceId: place.spaceId, reachedByMigration: place.headReachedByMigration },
    relative(place.cwd, contractSnapshotDir(place.migrationsDir, place.hash)),
  );
}

/** A snapshot's folder, the command that writes it again once the folder is deleted, and everything that command does, ending with writing the snapshot. */
export interface SnapshotRewrite {
  readonly snapshotDirectory: string;
  readonly command: string;
  readonly effect: string;
}

/** The space a snapshot is the head of, and for the application whether a migration ends at it. */
export interface SnapshotHead {
  readonly spaceId: string;
  readonly reachedByMigration: boolean;
}

/** How the snapshot at the head of a space, in `snapshotDirectory`, is written again once deleted. */
export function snapshotRewriteAt(head: SnapshotHead, snapshotDirectory: string): SnapshotRewrite {
  if (head.spaceId !== APP_SPACE_ID) {
    return {
      snapshotDirectory,
      command: '{bin} contract emit',
      effect:
        'emits contract.json from the contract source and writes the snapshot again from the installed extension',
    };
  }
  return head.reachedByMigration
    ? {
        snapshotDirectory,
        command: '{bin} db migrate --advance-ref db',
        effect:
          'applies any pending migrations to the configured database, then moves the db ref to contract.json and writes the snapshot again from it',
      }
    : {
        snapshotDirectory,
        command: '{bin} db sign',
        effect:
          'checks that the configured database matches contract.json and records that in the database, then moves the db ref to contract.json and writes the snapshot again from it',
      };
}

/** The ref that records which contract the configured database is at; moving it by hand makes the next plan start from a contract the database is not at. */
const DATABASE_REF = 'db';

/**
 * How a contract snapshot this release cannot read is put right: restoring a file edited by hand, the application's upgrade instructions when an earlier release wrote it, writing it again when a command does, and moving each ref that names it other than the `db` ref. An extension's snapshot comes from the extension, so the application's upgrade instructions are not offered for it.
 */
export function snapshotRepairActions(
  place: SnapshotPlace,
  options?: { readonly refNames?: readonly string[] },
): NextAction[] {
  const rewrite = snapshotRewrite(place);
  const isApp = place.spaceId === APP_SPACE_ID;
  return [
    chooseAction('If the file was edited by hand, restore it from version control'),
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
            `Or delete ${rewrite.snapshotDirectory} and run this command, which ${rewrite.effect}`,
            rewrite.command,
          ),
        ]),
    ...(options?.refNames ?? [])
      .filter((name) => name !== DATABASE_REF)
      .map((name) =>
        runCommandAction(
          `Or point the ref "${name}" at a migration whose snapshot this release reads`,
          `{bin} migration ref set ${name} <hash>`,
        ),
      ),
  ];
}
