import type {
  ContractEntryNode,
  InitContribution,
  Prisma7QuickReferenceInput,
  QuickReferenceInput,
  ReadmeInput,
} from '@internal/cli/init-contribution';
import { POSTGRES_MIN_SERVER_VERSION } from '@internal/target-postgres/server-version-range';
import { renderImports } from '@internal/ts-render';
import { dirname, isAbsolute } from 'pathe';
import { configModule, moduleBase } from '../config/module-base';
import { contractEntry } from './contract-entry';
import { probePostgres } from './probe';
import { renderTemplate } from './render';
import {
  contractSample,
  databaseFile,
  envExample,
  starterContract,
  starterIdType,
} from './templates';

/** The import block of the config the quick reference shows, as `init` writes it around `entry`. */
function configImports(entry: ContractEntryNode): string {
  return renderImports([
    { moduleSpecifier: '@prisma/cli-engine', symbol: 'definePrismaConfig' },
    { moduleSpecifier: configModule, symbol: 'defineConfig', alias: 'ormConfig' },
    ...entry.importRequirements(),
  ]);
}

/** The contract entry as the quick reference's config shows it, its lines after the first indented to the entry's depth. */
function entrySource(entry: ContractEntryNode): string {
  return entry.renderTypeScript().replaceAll('\n', '\n    ');
}

function quickReference(input: QuickReferenceInput): string {
  const entry = contractEntry({
    kind: 'starter',
    mode: input.mode,
    path: isAbsolute(input.schemaPath) ? input.schemaPath : `./${input.schemaPath}`,
  });
  const schemaDir = dirname(input.schemaPath);
  return renderTemplate('init-quick-reference.md', {
    schemaPath: input.schemaPath,
    schemaDir,
    dbImportPath: `./${schemaDir}/db`,
    pkgRun: input.cliCommand,
    pkg: moduleBase,
    configImports: configImports(entry),
    contractEntry: entrySource(entry),
    schemaSample: contractSample(input.mode),
    idType: starterIdType(input.mode),
    requirements: input.requirements,
  });
}

function prisma7QuickReference(input: Prisma7QuickReferenceInput): string {
  const entry = contractEntry({ kind: 'prisma7-schema', path: input.schemaPath });
  return renderTemplate('init-quick-reference-prisma7.md', {
    schemaPath: input.schemaPath,
    outputDir: input.outputDir,
    dbImportPath: `./${input.outputDir}/db`,
    pkgRun: input.cliCommand,
    pkg: moduleBase,
    configImports: configImports(entry),
    contractEntry: entrySource(entry),
    requirements: input.requirements,
    prisma7ConfigSentence:
      input.prisma7Config === undefined
        ? ''
        : ` Prisma 7 reads its own config from \`${input.prisma7Config}\`.`,
    prisma7ConfigRow:
      input.prisma7Config === undefined
        ? ''
        : `\n| [\`${input.prisma7Config}\`](${input.prisma7Config}) | Prisma 7 CLI configuration |`,
  });
}

function readme(input: ReadmeInput): string {
  const run = input.runScript;
  return renderTemplate('init-readme.md', {
    projectName: input.projectName,
    contractPath: input.contractPath,
    runDev: run('dev'),
    runContractEmit: run('contract:emit'),
    runDbInit: run('db:init'),
    runDbUpdate: run('db:update'),
    runMigrationPlan: run('migration:plan'),
    runMigrate: run('migrate'),
    runDbSeed: run('db:seed'),
  });
}

const contribution: InitContribution = {
  label: 'PostgreSQL',
  configModule,
  peerPackages: ['pg'],
  authoringModes: ['psl', 'typescript'],
  starterContract,
  contractSample,
  databaseFile,
  envExample,
  quickReference,
  readme,
  serverRequirement: { minVersion: POSTGRES_MIN_SERVER_VERSION, checkCommand: 'SELECT version()' },
  probe: (databaseUrl, signal) => probePostgres(databaseUrl, signal),
  prisma7QuickReference,
  contractEntry,
};

export default contribution;
