import type {
  InitContribution,
  Prisma7QuickReferenceInput,
  QuickReferenceInput,
  ReadmeInput,
} from '@internal/cli/init-contribution';
import { POSTGRES_MIN_SERVER_VERSION } from '@internal/target-postgres/server-version-range';
import { dirname, isAbsolute } from 'pathe';
import { moduleBase } from '../config/module-base';
import { probePostgres } from './probe';
import { renderTemplate } from './render';
import {
  configModule,
  contractEntry,
  contractEntrySample,
  contractSample,
  databaseFile,
  envExample,
  starterContract,
  starterIdType,
} from './templates';

function quickReference(input: QuickReferenceInput): string {
  const schemaDir = dirname(input.schemaPath);
  return renderTemplate('init-quick-reference.md', {
    schemaPath: input.schemaPath,
    schemaDir,
    dbImportPath: `./${schemaDir}/db`,
    pkgRun: input.cliCommand,
    pkg: moduleBase,
    configEntrypoint: configModule,
    contractEntry: contractEntrySample({
      kind: 'starter',
      mode: input.mode,
      path: isAbsolute(input.schemaPath) ? input.schemaPath : `./${input.schemaPath}`,
    }),
    schemaSample: contractSample(input.mode),
    idType: starterIdType(input.mode),
    requirements: input.requirements,
  });
}

function prisma7QuickReference(input: Prisma7QuickReferenceInput): string {
  return renderTemplate('init-quick-reference-prisma7.md', {
    schemaPath: input.schemaPath,
    outputDir: input.outputDir,
    dbImportPath: `./${input.outputDir}/db`,
    pkgRun: input.cliCommand,
    pkg: moduleBase,
    configEntrypoint: configModule,
    contractEntry: contractEntrySample({ kind: 'prisma7-schema', path: input.schemaPath }),
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
