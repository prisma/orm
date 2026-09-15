export type { PrismaNextConfig } from '@internal/config/config-types';
export { finalizeConfig } from '../finalize-config';
export type { ConfigSection, LoadedConfig } from '../load';
export {
  evaluateConfigModule,
  findNearestConfigPathForFile,
  loadConfig,
  loadConfigForFile,
  loadConfigForSections,
  requireConfigSections,
} from '../load';
