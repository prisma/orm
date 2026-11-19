import type { InitContribution, QuickReferenceInput } from '@internal/cli/init-contribution';
import { dirname } from 'pathe';
import { moduleBase } from '../config/module-base';
import { renderTemplate } from './render';
import {
  configModule,
  contractSample,
  DATABASE_PATH,
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
    databasePath: DATABASE_PATH,
  });
}

const contribution: InitContribution = {
  label: 'SQLite',
  configModule,
  peerPackages: [],
  authoringModes: ['psl', 'typescript'],
  starterContract,
  contractSample,
  databaseFile,
  envExample,
  quickReference,
};

export default contribution;
