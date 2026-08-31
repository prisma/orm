export type { PrismaNextConfig } from '@internal/config/config-types';
export {
  finalizeConfig,
  finalizeContractConfig,
  finalizeMigrationsConfig,
} from '../finalize-config';
export type { ConfigSection, LoadedConfig } from '../load';
export {
  findNearestConfigPathForFile,
  loadConfig,
  loadConfigForFile,
  loadConfigForSections,
  requireConfigSections,
} from '../load';
