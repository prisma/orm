/**
 * Polymorphic TypeScript emitter for the Postgres migration IR.
 *
 * Each `OpFactoryCall` renders itself via `renderTypeScript()` and
 * declares its own `importRequirements()`; this file just composes the module
 * source around those contributions. The design mirrors the Mongo target's
 * `render-typescript.ts` deliberately — byte-for-byte alignment isn't required
 * (different factory module specifiers, different base-class name) but the
 * shape is, so future consolidation to a framework-level helper is mechanical.
 */

import {
  contractSnapshotJsonSpecifier,
  contractSnapshotTypesSpecifier,
  type OpFactoryCall,
} from '@internal/framework-components/control';
import { detectScaffoldRuntime, shebangLineFor } from '@internal/migration-tools/migration-ts';
import { type ImportRequirement, renderImports } from '@internal/ts-render';
import { MIGRATION_MODULE } from './op-factory-call';

export interface RenderMigrationMeta {
  readonly from: string | null;
  readonly to: string;
  /** POSIX-relative path from the migration package dir to `migrations/snapshots`, e.g. '../../snapshots'. */
  readonly snapshotsImportPath: string;
  readonly migrationModule: string;
}

const BASE_IMPORTS: readonly ImportRequirement[] = [
  { moduleSpecifier: MIGRATION_MODULE, symbol: 'Migration' },
  { moduleSpecifier: MIGRATION_MODULE, symbol: 'MigrationCLI' },
];

export function renderCallsToTypeScript(
  calls: ReadonlyArray<OpFactoryCall>,
  meta: RenderMigrationMeta,
): string {
  const imports = buildImports(calls, meta);
  const operationsBody = calls.map((c) => renderCall(c)).join(',\n');
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

function renderCall(call: OpFactoryCall): string {
  return call.renderTypeScript();
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
