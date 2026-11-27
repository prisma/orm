import { APP_SPACE_ID } from '@internal/framework-components/control';
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

/** A migration's folder, the contract space it belongs to, and the directory the command was invoked from, which the advice's paths are relative to. */
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
