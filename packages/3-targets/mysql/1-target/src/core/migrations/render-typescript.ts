import {
  contractSnapshotJsonSpecifier,
  contractSnapshotTypesSpecifier,
  type OpFactoryCall,
} from '@internal/framework-components/control';
import {
  type ImportSpecifierResolver,
  keepInternalSpecifiers,
  resolveRequirementSpecifiers,
} from '@internal/framework-components/emission';
import { detectScaffoldRuntime, shebangLineFor } from '@internal/migration-tools/migration-ts';
import { type ImportRequirement, renderImports } from '@internal/ts-render';
import { MYSQL_MIGRATION_MODULE } from './op-factory-call';

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
  /** The facade `migration` module of the target the scaffold is for, which every import of MySQL's `migration` module names instead. */
  readonly migrationModule: string;
}

/** The base class and the CLI entrypoint every scaffold imports, both from the facade's `migration` module. */
const BASE_IMPORTS: readonly ImportRequirement[] = [
  { moduleSpecifier: MYSQL_MIGRATION_MODULE, symbol: 'Migration' },
  { moduleSpecifier: MYSQL_MIGRATION_MODULE, symbol: 'MigrationCLI' },
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
  const resolve = meta.resolveImportSpecifier ?? keepInternalSpecifiers;
  return renderImports(
    resolveRequirementSpecifiers(requirements, (specifier) =>
      resolve(specifier === MYSQL_MIGRATION_MODULE ? meta.migrationModule : specifier),
    ),
  );
}

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
