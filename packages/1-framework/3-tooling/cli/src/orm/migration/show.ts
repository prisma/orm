import { readFile } from 'node:fs/promises';
import type { Contract } from '@internal/contract/types';
import {
  APP_SPACE_ID,
  createControlStack,
  type MigrationPlanOperation,
} from '@internal/framework-components/control';
import type { MigrationGraph } from '@internal/migration-tools/graph';
import type { OnDiskMigrationPackage } from '@internal/migration-tools/package';
import type { Refs } from '@internal/migration-tools/refs';
import { castAs } from '@internal/utils/casts';
import { ifDefined } from '@internal/utils/defined';
import type { Block, Presentations, TreeNode } from '@prisma/cli-engine';
import { positional } from '@prisma/cli-engine';
import type { CliStructuredError, Result } from '@prisma/cli-engine/protocol';
import { notOk, ok } from '@prisma/cli-engine/protocol';
import { relative } from 'pathe';
import type { MigrationShowResult, ShowMigration } from '../../commands/json/schemas';
import { createControlClient } from '../../control-api/client';
import { loadContractSpaceAggregateForCli } from '../../control-api/operations/contract-space-aggregate-loader';
import { resolveMigrationRef } from '../../control-api/operations/ref-resolution';
import {
  errorConfigValidation,
  errorContractValidationFailed,
  errorFileNotFound,
  errorMigrationPackageNotFound,
  errorNoMigrations,
  errorUnexpected,
} from '../../utils/cli-errors';
import { previewBlockHeader, renderPreviewStatement } from '../../utils/formatters/migrations';
import {
  findPackageByDirPath,
  looksLikePath,
  resolveAppTargetPath,
} from '../../utils/migration-path-target';
import { ormConfigSection } from '../config-section';
import { defineOrmCommand } from '../define-command';
import { normalizeError } from '../normalize-error';
import { appMigrationsDirFor, contractPathFor, displayPath, migrationsDirFor } from './paths';

/** One node per operation, the destructive ones carrying the warning glyph. */
function operationNodes(migration: ShowMigration): readonly TreeNode[] {
  return migration.operations.map((operation) =>
    operation.operationClass === 'destructive'
      ? { label: operation.label, status: 'warn' }
      : { label: operation.label },
  );
}

function operationBlocks(migration: ShowMigration): readonly Block[] {
  if (migration.operations.length === 0) {
    return [{ kind: 'summary', status: 'info', text: 'No operations.' }];
  }
  const destructive = migration.operations.some(
    (operation) => operation.operationClass === 'destructive',
  );
  return [
    {
      kind: 'tree',
      roots: [
        {
          label: `${migration.operations.length} operation(s)`,
          children: operationNodes(migration),
        },
      ],
    },
    ...(destructive
      ? [
          {
            kind: 'summary' as const,
            status: 'warn' as const,
            text: 'This migration contains destructive operations that may cause data loss.',
          },
        ]
      : []),
  ];
}

/**
 * The statement preview: text a database would run, printed verbatim rather
 * than laid out, so nothing is re-wrapped between here and the reader.
 */
function previewBlocks(migration: ShowMigration): readonly Block[] {
  const statements = migration.preview.statements
    .map((statement) => renderPreviewStatement(statement.text, statement.language))
    .filter((text): text is string => text !== undefined);
  if (statements.length === 0) {
    return [];
  }
  return [
    {
      kind: 'summary',
      status: 'info',
      tone: 'muted',
      text: previewBlockHeader(migration.preview),
    },
    { kind: 'drawing', lines: statements },
  ];
}

function showPresentations(inputs: {
  readonly document: MigrationShowResult;
  readonly contractPath: string;
  readonly appMigrationsRelative: string;
  readonly target: string;
}): Presentations {
  const migration = inputs.document.migration;
  return {
    stdout: () => [],
    next: () => [],
    human: (): readonly Block[] => [
      {
        kind: 'fields',
        rail: true,
        rows: [
          { label: 'contract', value: inputs.contractPath },
          { label: 'migrations', value: inputs.appMigrationsRelative },
          { label: 'target', value: inputs.target },
        ],
      },
      { kind: 'summary', status: 'ok', text: [{ text: migration.name, tone: 'emphasis' }] },
      {
        kind: 'fields',
        rows: [
          {
            label: 'from',
            value:
              migration.fromContract === null
                ? [{ text: '(baseline)', tone: 'muted' }]
                : [{ text: migration.fromContract, tone: 'identifier' }],
          },
          { label: 'to', value: [{ text: migration.toContract, tone: 'identifier' }] },
          { label: 'hash', value: [{ text: migration.hash, tone: 'identifier' }] },
          { label: 'created', value: [{ text: migration.createdAt, tone: 'muted' }] },
        ],
      },
      ...operationBlocks(migration),
      ...previewBlocks(migration),
    ],
    json: () => inputs.document,
  };
}

/**
 * A path-looking target must land inside `migrations/app/`; anything else is a
 * migration reference resolved against the app graph and refs. Both routes are
 * app-space only, as they are today.
 */
function resolvePackage(inputs: {
  readonly target: string;
  readonly cwd: string;
  readonly appMigrationsDir: string;
  readonly appMigrationsRelative: string;
  readonly packages: readonly OnDiskMigrationPackage[];
  readonly graph: MigrationGraph;
  readonly refs: Refs;
}): Result<OnDiskMigrationPackage, CliStructuredError> {
  if (looksLikePath(inputs.target)) {
    const path = resolveAppTargetPath(
      inputs.cwd,
      inputs.target,
      inputs.appMigrationsDir,
      inputs.appMigrationsRelative,
    );
    if (!path.ok) {
      return notOk(normalizeError(path.failure));
    }
    const matched = findPackageByDirPath(inputs.packages, path.value);
    return matched === undefined
      ? notOk(
          normalizeError(
            errorMigrationPackageNotFound(
              `No loaded migration package at ${relative(inputs.cwd, path.value)}`,
            ),
          ),
        )
      : ok(matched);
  }

  if (inputs.packages.length === 0) {
    return notOk(normalizeError(errorNoMigrations(inputs.appMigrationsRelative)));
  }
  const ref = resolveMigrationRef(inputs.target, { graph: inputs.graph, refs: inputs.refs });
  if (!ref.ok) {
    return notOk(normalizeError(ref.failure));
  }
  const matched = inputs.packages.find(
    (candidate) => candidate.metadata.migrationHash === ref.value.migrationHash,
  );
  return matched === undefined
    ? notOk(
        normalizeError(
          errorMigrationPackageNotFound(
            `Resolved migration "${ref.value.dirName}" but the package was not loaded`,
          ),
        ),
      )
    : ok(matched);
}

export const migrationShowCommand = defineOrmCommand({
  help: {
    summary: 'Display migration package contents',
    description:
      'Shows the operations, statement preview, and metadata for one app-space\n' +
      'migration. Accepts a directory path, directory name, or hash prefix.\n' +
      'Offline — does not consult the database.',
    examples: [
      'migration show 20260101_100000_add_user',
      'migration show a1b2c3',
      'migration show migrations/app/20260101_100000_add_user',
      'migration show 20260101_100000_add_user --json',
    ],
  },
  args: {
    positionals: {
      target: positional.string({
        brief: 'Migration reference: directory name, hash/prefix, ref, or path',
        placeholder: 'target',
      }),
    },
  },
  needs: { config: ormConfigSection },
  handler: async (args, ctx) => {
    const { target } = args.positionals;
    const contractPath = contractPathFor(ctx.config, ctx.cwd);
    if (contractPath === undefined) {
      return notOk(
        normalizeError(
          errorConfigValidation('contract.output', {
            why: 'migration show reads the emitted contract from config.contract.output; the config has no value to read.',
            section: 'contract',
          }),
        ),
      );
    }
    const migrationsDir = migrationsDirFor(ctx.config, ctx.cwd);
    const appMigrationsDir = appMigrationsDirFor(ctx.config, ctx.cwd);
    const appMigrationsRelative = displayPath(appMigrationsDir, ctx.cwd);

    let contractJson: string;
    try {
      contractJson = await readFile(contractPath, 'utf-8');
    } catch (error) {
      const missing = Reflect.get(Object(error), 'code') === 'ENOENT';
      return notOk(
        normalizeError(
          missing
            ? errorFileNotFound(contractPath, {
                why: `Contract file not found at ${contractPath}`,
                fix: `Run \`{bin} contract emit\` to generate ${relative(ctx.cwd, contractPath)}`,
              })
            : errorUnexpected(error instanceof Error ? error.message : String(error), {
                why: 'Failed to read contract file',
              }),
        ),
      );
    }

    const familyInstance = ctx.config.family.create(createControlStack(ctx.config));
    let appContract: Contract;
    try {
      appContract = familyInstance.deserializeContract(castAs<unknown>(JSON.parse(contractJson)));
    } catch (error) {
      return notOk(
        normalizeError(
          errorContractValidationFailed(
            `Contract at ${contractPath} failed to deserialize: ${error instanceof Error ? error.message : String(error)}`,
            { where: { path: contractPath } },
          ),
        ),
      );
    }

    const loaded = await loadContractSpaceAggregateForCli({
      targetId: ctx.config.target.targetId,
      migrationsDir,
      appContract,
      extensions: [],
      deserializeContract: (json) => familyInstance.deserializeContract(json),
    });
    if (!loaded.ok) {
      return notOk(normalizeError(loaded.failure));
    }
    const aggregate = loaded.value;

    const resolved = resolvePackage({
      target,
      cwd: ctx.cwd,
      appMigrationsDir,
      appMigrationsRelative,
      packages: aggregate.app.packages,
      graph: aggregate.app.graph(),
      refs: aggregate.app.refs,
    });
    if (!resolved.ok) {
      return notOk(resolved.failure);
    }
    const pkg = resolved.value;

    const client = createControlClient({
      family: ctx.config.family,
      target: ctx.config.target,
      adapter: ctx.config.adapter,
      ...ifDefined('driver', ctx.config.driver),
      extensions: ctx.config.extensions ?? [],
    });
    const ops = castAs<readonly MigrationPlanOperation[]>(pkg.ops);
    const preview = client.toOperationPreview(ops) ?? { statements: [] };
    const migration: ShowMigration = {
      space: APP_SPACE_ID,
      name: pkg.dirName,
      hash: pkg.metadata.migrationHash,
      fromContract: pkg.metadata.from,
      toContract: pkg.metadata.to,
      createdAt: pkg.metadata.createdAt,
      operations: ops.map((op) => ({
        id: op.id,
        label: op.label,
        operationClass: op.operationClass,
      })),
      preview: { statements: [...preview.statements] },
    };
    const document: MigrationShowResult = {
      ok: true,
      summary: `Migration ${migration.name} in ${migration.space}: ${migration.operations.length} operation(s)`,
      migration,
    };

    return ok(
      ctx.present(
        { data: document },
        showPresentations({
          document,
          contractPath: displayPath(contractPath, ctx.cwd),
          appMigrationsRelative,
          target,
        }),
      ),
    );
  },
});
