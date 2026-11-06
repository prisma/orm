import { ifDefined } from '@internal/utils/defined';
import type { FormatterConfig } from './config-types';

/** The `orm` section settings that a target's `defineConfig` helper copies to the config unchanged. */
export interface ConfigSettings {
  readonly db?: {
    readonly connection?: string;
  };
  readonly migrations?: {
    readonly dir?: string;
  };
  readonly formatter?: FormatterConfig;
}

export function pickConfigSettings(options: ConfigSettings): ConfigSettings {
  return {
    ...ifDefined('db', options.db),
    ...ifDefined('migrations', options.migrations),
    ...ifDefined('formatter', options.formatter),
  };
}
