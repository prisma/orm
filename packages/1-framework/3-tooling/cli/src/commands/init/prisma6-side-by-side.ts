import type { NextAction } from '@prisma/cli-engine/protocol';
import { extname } from 'pathe';
import { DB_SIGN_COMMAND, EMIT_COMMAND } from '../../orm/init-diagnostics';
import { formatAddArgs, formatAddDevArgs, type PackageManager } from './detect-package-manager';
import type { TargetId } from './templates/code-templates';

// biome-ignore lint/plugin/no-family-vocabulary: a datasource provider read from the user's schema, and its target; Prisma 7 has no provider of this name, so a schema that names it was written for Prisma 6
const PRISMA6_ONLY_PROVIDERS: ReadonlyMap<string, TargetId> = new Map([['mongodb', 'mongo']]);

/**
 * The target of a `datasource` provider that exists only up to Prisma 6, which makes its schema a Prisma 6 schema; `undefined` for any other provider.
 */
export function prisma6OnlyTarget(provider: string | undefined): TargetId | undefined {
  return provider === undefined ? undefined : PRISMA6_ONLY_PROVIDERS.get(provider);
}

/**
 * What a Prisma 6 project needs to run Prisma 8 beside Prisma 6 with the Prisma 6 schema as the
 * contract source. Both CLIs are published as `prisma`, and the Prisma 6 CLI reads
 * `prisma.config.ts` when it exists, so Prisma 6 moves to an npm alias with its own config file.
 */
export interface Prisma6SideBySideSetup {
  readonly prismaConfig: string;
  /** `null` when the project's own Prisma 6 config is renamed instead of a new one written. */
  readonly prisma6Config: string | null;
  readonly steps: readonly NextAction[];
}

function runPrisma6(packageManager: PackageManager, args: string): string {
  switch (packageManager) {
    case 'npm':
      return `npm run prisma6 -- ${args}`;
    case 'bun':
      return `bun run prisma6 ${args}`;
    case 'deno':
      return `deno task prisma6 ${args}`;
    default:
      return `${packageManager} prisma6 ${args}`;
  }
}

export function prisma6SideBySideSetup(inputs: {
  readonly schemaPath: string;
  /** The variable the schema's `url = env(...)` names; `undefined` when it names none. */
  readonly urlEnv: string | undefined;
  readonly packageManager: PackageManager;
  /** The `prisma` range the project declares or has installed; `undefined` when neither. */
  readonly cliVersion: string | undefined;
  /** The project's own Prisma 6 `prisma.config.*`, when it has one. */
  readonly ownConfigPath: string | undefined;
  readonly targetPackage: string;
  /** The packages the target package declares as required peer dependencies. */
  readonly peerPackages: readonly string[];
  readonly targetConfigEntrypoint: string;
}): Prisma6SideBySideSetup {
  const { schemaPath, packageManager } = inputs;
  const extension =
    inputs.ownConfigPath === undefined ? 'ts' : extname(inputs.ownConfigPath).slice(1);
  const prisma6ConfigFile = `prisma6.config.${extension}`;
  const prisma6Config =
    inputs.ownConfigPath === undefined
      ? [
          "import 'dotenv/config';",
          "import { defineConfig } from 'prisma6/config';",
          '',
          `export default defineConfig({ schema: '${schemaPath}' });`,
          '',
        ].join('\n')
      : null;
  const prismaConfig = [
    "import 'dotenv/config';",
    "import { definePrismaConfig } from 'prisma/config';",
    `import { defineConfig as ormConfig, prisma6Schema } from '${inputs.targetConfigEntrypoint}';`,
    '',
    'export default definePrismaConfig({',
    '  orm: ormConfig({',
    `    contract: prisma6Schema('${schemaPath}'),`,
    `    db: { connection: process.env['${inputs.urlEnv ?? 'DATABASE_URL'}']! },`,
    '  }),',
    '});',
    '',
  ].join('\n');
  const add = (args: readonly string[]) => [packageManager, ...args].join(' ');
  return {
    prismaConfig,
    prisma6Config,
    steps: [
      {
        kind: 'edit-file',
        label: `In package.json, ${
          inputs.cliVersion === undefined
            ? 'install the Prisma 6 CLI under another name: add the dev dependency "prisma6": "npm:prisma@6"'
            : `keep the Prisma 6 CLI under another name: replace the "prisma" dev dependency with "prisma6": "npm:prisma@${inputs.cliVersion}"`
        }, add the script "prisma6": "node node_modules/prisma6/build/index.js --config ${prisma6ConfigFile}", and run every Prisma 6 command through it, as in \`${runPrisma6(packageManager, 'db push')}\` and \`${runPrisma6(packageManager, 'generate')}\`.`,
      },
      prisma6Config === null
        ? {
            kind: 'edit-file',
            label: `Rename ${inputs.ownConfigPath} to ${prisma6ConfigFile} and import defineConfig from 'prisma6/config' in it, so that only the Prisma 6 CLI reads it.`,
          }
        : {
            kind: 'edit-file',
            label: `Write ${prisma6ConfigFile} for the Prisma 6 CLI:\n${prisma6Config.trimEnd()}`,
          },
      {
        kind: 'run-command',
        label: 'Install the Prisma 8 packages',
        command: add(
          formatAddArgs(packageManager, [inputs.targetPackage, 'dotenv', ...inputs.peerPackages]),
        ),
      },
      {
        kind: 'run-command',
        label: 'Install the Prisma 8 CLI, which now takes the name prisma',
        command: add(formatAddDevArgs(packageManager, ['prisma@latest'])),
      },
      {
        kind: 'edit-file',
        label: `Write prisma.config.ts for Prisma 8:\n${prismaConfig.trimEnd()}`,
      },
      {
        kind: 'run-command',
        label: 'Read the Prisma 6 schema into a contract',
        command: EMIT_COMMAND,
      },
      {
        kind: 'run-command',
        label: 'Sign the database the Prisma 6 app uses',
        command: DB_SIGN_COMMAND,
      },
    ],
  };
}
