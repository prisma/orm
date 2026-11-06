/**
 * Polymorphic TypeScript emitter for the SQLite migration IR. Mirrors the
 * Postgres `render-typescript.ts` — different base-class + factory module
 * specifier, same overall shape.
 */

import {
  contractSnapshotJsonSpecifier,
  contractSnapshotTypesSpecifier,
  type OpFactoryCall,
} from '@internal/framework-components/control';
import {
  type ImportSpecifierResolver,
  resolveRequirementSpecifiers,
} from '@internal/framework-components/emission';
import { detectScaffoldRuntime, shebangLineFor } from '@internal/migration-tools/migration-ts';
import { type ImportRequirement, renderImports } from '@internal/ts-render';

export interface RenderMigrationMeta {
  readonly from: string | null;
  readonly to: string;
  /** POSIX-relative path from the migration package dir to `migrations/snapshots`, e.g. '../../snapshots'. */
  readonly snapshotsImportPath: string;
  /**
   * Rewrites the package names the scaffold imports from, for the import root
   * the consuming application installed. Applied once to the assembled
   * requirement list rather than at each `OpFactoryCall`, so a new operation
   * cannot forget it. Defaults to leaving specifiers as authored.
   */
  readonly resolveImportSpecifier?: ImportSpecifierResolver;
}

/**
 * Always-present base imports for the rendered scaffold. Both come from
 * `@internal/sqlite/migration` so an authored SQLite
 * `migration.ts` only needs a single dependency for its base class and
 * its CLI entrypoint. Mirrors Postgres's `BASE_IMPORTS`.
 *
 * - `Migration` — the facade re-export fixes the `SqlMigration`
 *   generic to `SqlitePlanTargetDetails` and the abstract `targetId` to
 *   `'sqlite'`.
 * - `MigrationCLI` — the migration-file CLI entrypoint, re-exported from
 *   `@internal/cli/migration-cli`. Loads `prisma.config.ts`,
 *   assembles a `ControlStack`, and instantiates the migration class.
 */
const BASE_IMPORTS: readonly ImportRequirement[] = [
  { moduleSpecifier: '@internal/sqlite/migration', symbol: 'Migration' },
  { moduleSpecifier: '@internal/sqlite/migration', symbol: 'MigrationCLI' },
];

export function renderCallsToTypeScript(
  calls: ReadonlyArray<OpFactoryCall>,
  meta: RenderMigrationMeta,
): string {
  const imports = buildImports(calls, meta);
  const operationsBody = calls.map((c) => c.renderTypeScript()).join(',\n');
  const hasStart = meta.from !== null;
  const startField = hasStart ? ['  override readonly startContractJson = startContract;'] : [];

  return [
    shebangLineFor(detectScaffoldRuntime()),
    imports,
    '',
    `export default class M extends Migration<${hasStart ? 'Start' : 'never'}, End> {`,
    ...startField,
    '  override readonly endContractJson = endContract;',
    '',
    '  override get operations() {',
    '    return [',
    indent(operationsBody, 6),
    '    ];',
    '  }',
    '}',
    '',
    'MigrationCLI.run(import.meta.url, M);',
    '',
  ].join('\n');
}

function buildImports(calls: ReadonlyArray<OpFactoryCall>, meta: RenderMigrationMeta): string {
  const requirements: ImportRequirement[] = [...BASE_IMPORTS, ...contractImports(meta)];
  for (const call of calls) {
    for (const req of call.importRequirements()) {
      requirements.push(req);
    }
  }
  return renderImports(resolveRequirementSpecifiers(requirements, meta.resolveImportSpecifier));
}

/**
 * The committed contract-JSON imports the scaffold reads its from/to identity
 * from, resolved to the deduplicated snapshot store under
 * `meta.snapshotsImportPath`. The end snapshot is always present; the start
 * snapshot is added only for a non-baseline migration (`meta.from !== null`).
 * The matching `Contract` type imports (aliased `Start`/`End`) feed the
 * `Migration<Start, End>` generics. Baseline emits `Migration<never, End>` with
 * no start imports — `never` is the honest "no prior contract" Start.
 */
function contractImports(meta: RenderMigrationMeta): readonly ImportRequirement[] {
  const reqs: ImportRequirement[] = [
    {
      moduleSpecifier: contractSnapshotJsonSpecifier(meta.snapshotsImportPath, meta.to),
      symbol: 'endContract',
      kind: 'default',
      attributes: { type: 'json' },
    },
    {
      moduleSpecifier: contractSnapshotTypesSpecifier(meta.snapshotsImportPath, meta.to),
      symbol: 'Contract',
      alias: 'End',
      typeOnly: true,
    },
  ];
  if (meta.from !== null) {
    reqs.push({
      moduleSpecifier: contractSnapshotJsonSpecifier(meta.snapshotsImportPath, meta.from),
      symbol: 'startContract',
      kind: 'default',
      attributes: { type: 'json' },
    });
    reqs.push({
      moduleSpecifier: contractSnapshotTypesSpecifier(meta.snapshotsImportPath, meta.from),
      symbol: 'Contract',
      alias: 'Start',
      typeOnly: true,
    });
  }
  return reqs;
}

function indent(text: string, spaces: number): string {
  const pad = ' '.repeat(spaces);
  return text
    .split('\n')
    .map((line) => (line.trim() ? `${pad}${line}` : line))
    .join('\n');
}
