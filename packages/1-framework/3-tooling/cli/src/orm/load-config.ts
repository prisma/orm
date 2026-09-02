import { loadConfig } from '@internal/config-loader';
import type { LoadedConfig } from '@prisma/cli-engine';
import { resolve } from 'pathe';
import { ORM_CONFIG_SECTION_NAME } from './config-section';
import { toEngineDiagnostic } from './normalize-error';

/** The file the ORM's loader reads when `--config` names none. */
const ORM_CONFIG_FILENAME = 'prisma.config.ts';

export interface LoadOrmConfigOptions {
  /** Where the CLI was invoked. Config discovery starts and ends here. */
  readonly cwd: string;
  /** A non-default config file, resolved against `cwd` when relative. */
  readonly configPath?: string;
}

/**
 * Builds the engine's `Runtime.config` from `prisma.config.ts`.
 *
 * The engine ships its own synchronous loader, but the bin owns the load: the
 * ORM's c12 loader evaluates the module asynchronously and finalizes paths
 * against the config file's own directory. It reads the same shape the engine
 * does — defineConfig from `@prisma/cli-engine` with the whole Prisma ORM
 * configuration nested as the single `orm` section.
 *
 * Only failures that prevent evaluation entirely are diagnostics here, and
 * they carry `section: null` so they fail exactly the commands that read
 * config. Structural verdicts belong to the section validator.
 */
export async function loadOrmConfig(options: LoadOrmConfigOptions): Promise<LoadedConfig> {
  const path = resolve(options.cwd, options.configPath ?? ORM_CONFIG_FILENAME);
  const loaded = await loadConfig(options.configPath, { cwd: options.cwd });
  if (!loaded.ok) {
    return {
      path,
      sections: {},
      diagnostics: [{ section: null, diagnostic: toEngineDiagnostic(loaded.failure) }],
    };
  }
  return {
    path,
    sections: { [ORM_CONFIG_SECTION_NAME]: loaded.value.config },
    diagnostics: [],
  };
}
