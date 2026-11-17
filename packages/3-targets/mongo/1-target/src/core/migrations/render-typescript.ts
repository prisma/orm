import {
  contractSnapshotJsonSpecifier,
  contractSnapshotTypesSpecifier,
} from '@internal/framework-components/control';
import { detectScaffoldRuntime, shebangLineFor } from '@internal/migration-tools/migration-ts';
import { type ImportRequirement, renderImports } from '@internal/ts-render';
import { MIGRATION_MODULE, type OpFactoryCall } from './op-factory-call';

export interface RenderMigrationMeta {
  readonly from: string | null;
  readonly to: string;
  /** POSIX-relative path from the migration package dir to `migrations/snapshots`, e.g. '../../snapshots'. */
  readonly snapshotsImportPath: string;
  /** The module the rendered file imports its base class, its CLI entrypoint and every operation helper from: the config's `migrations.module`. */
  readonly migrationModule: string;
}

/** The base class and the CLI entrypoint every scaffold imports. */
const BASE_IMPORTS: readonly ImportRequirement[] = [
  { moduleSpecifier: MIGRATION_MODULE, symbol: 'Migration' },
  { moduleSpecifier: MIGRATION_MODULE, symbol: 'MigrationCLI' },
];

/**
 * Render a list of Mongo `OpFactoryCall`s as a `migration.ts` source string.
 * The result is shebanged, imports the contract JSON from the shared
 * snapshot store (the destination contract, plus the source contract for a
 * non-baseline migration), extends `Migration<Start, End>` (or
 * `Migration<never, End>` for a baseline) from the config's migration module,
 * assigns the JSON to `endContractJson` / `startContractJson`, and implements
 * `operations`. The `Migration` base derives `describe()` from those fields.
 *
 * The walk is polymorphic: each call node contributes its own
 * `renderTypeScript()` expression and declares its own `importRequirements()`.
 * The top-level renderer aggregates imports across all nodes and emits one
 * `import { … } from "…"` line per module. The `Migration` / `MigrationCLI`
 * base imports and the contract-JSON imports are always emitted, independent
 * of the call nodes.
 */
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
    `class M extends Migration<${hasStart ? 'Start' : 'never'}, End> {`,
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
    'export default M;',
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
  return renderImports(
    requirements.map((requirement) =>
      requirement.moduleSpecifier === MIGRATION_MODULE
        ? { ...requirement, moduleSpecifier: meta.migrationModule }
        : requirement,
    ),
  );
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
