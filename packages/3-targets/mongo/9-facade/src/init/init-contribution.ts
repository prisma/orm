import type {
  InitContribution,
  QuickReferenceInput,
  ReadmeInput,
} from '@internal/cli/init-contribution';
import { MONGO_MIN_SERVER_VERSION } from '@internal/target-mongo/server-version';
import { dirname } from 'pathe';
import { moduleBase } from '../config/module-base';
import { probeMongo } from './probe';
import { renderTemplate } from './render';
import {
  configModule,
  contractSample,
  databaseFile,
  envExample,
  starterContract,
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
    schemaSample: contractSample(input.mode),
    requirements: input.requirements,
  });
}

function readme(input: ReadmeInput): string {
  const run = input.runScript;
  return renderTemplate('init-readme.md', {
    projectName: input.projectName,
    contractPath: input.contractPath,
    runDev: run('dev'),
    runContractEmit: run('contract:emit'),
    runDbUp: run('db:up'),
    runDbDown: run('db:down'),
    runDbReset: run('db:reset'),
    runMigrationPlan: run('migration:plan'),
    runMigrate: run('migrate'),
    runDbSeed: run('db:seed'),
  });
}

const contribution: InitContribution = {
  label: 'MongoDB',
  configModule,
  peerPackages: ['mongodb'],
  authoringModes: ['psl', 'typescript'],
  starterContract,
  contractSample,
  databaseFile,
  envExample,
  quickReference,
  readme,
  serverRequirement: {
    minVersion: MONGO_MIN_SERVER_VERSION,
    checkCommand: 'db.runCommand({ buildInfo: 1 })',
  },
  probe: probeMongo,
};

export default contribution;
