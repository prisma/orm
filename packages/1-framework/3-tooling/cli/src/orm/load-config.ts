import { loadConfigFiles } from '@internal/config-loader';
import type { LoadedConfig } from '@prisma/cli-engine';
import { toEngineDiagnostic } from './normalize-error';

export interface LoadOrmConfigOptions {
  /** Where the CLI was invoked. Config discovery starts and ends here. */
  readonly cwd: string;
  /** A non-default config file, resolved against `cwd` when relative. */
  readonly configPath?: string;
}

/**
 * Builds the engine's `Runtime.config` from `prisma.config.ts`.
 *
 * The engine ships its own loader, but the bin owns the load: the ORM's c12
 * loader evaluates the module asynchronously and follows `extends`. It hands
 * the engine each file on the chain with its sections as written; the engine
 * validates the `orm` section against its schema with that provenance,
 * resolving every path against the file that declared it.
 *
 * Only failures that prevent evaluation entirely are diagnostics here, and
 * they carry `section: null` so they fail exactly the commands that read
 * config. Structural verdicts belong to the section schema.
 */
export async function loadOrmConfig(options: LoadOrmConfigOptions): Promise<LoadedConfig> {
  const loaded = await loadConfigFiles(options.configPath, { cwd: options.cwd });
  if (!loaded.ok) {
    return {
      files: [],
      diagnostics: [{ section: null, diagnostic: toEngineDiagnostic(loaded.failure) }],
    };
  }
  return { files: loaded.value.files, diagnostics: [] };
}
