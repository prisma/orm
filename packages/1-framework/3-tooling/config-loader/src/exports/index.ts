export type { PrismaNextConfig } from '@internal/config/config-types';
export { withBaseDir } from '../base-dir';
export type { ConfigSection, LoadedConfig } from '../load';
export {
  findNearestConfigPathForFile,
  loadConfig,
  loadConfigForFile,
  loadConfigForSections,
  requireConfigSections,
} from '../load';
