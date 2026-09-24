import sqliteAdapter from '@internal/adapter-sqlite/control';
import type { PrismaNextConfig } from '@internal/config/config-types';
import { defineConfig as coreDefineConfig } from '@internal/config/config-types';
import sqliteDriver from '@internal/driver-sqlite/control';
import sql from '@internal/family-sql/control';
import type { ControlExtensionDescriptor } from '@internal/framework-components/control';
import { prismaContract } from '@internal/sql-contract-psl/provider';
import { typescriptContractFromPath } from '@internal/sql-contract-ts/config-types';
import { SQLITE_INTEGER_CODEC_ID, SQLITE_TEXT_CODEC_ID } from '@internal/target-sqlite/codec-ids';
import sqlite, { sqliteCreateNamespace } from '@internal/target-sqlite/control';
import sqlitePackRef from '@internal/target-sqlite/pack';
import { ifDefined } from '@internal/utils/defined';
import { extname, join } from 'pathe';
import { isDynamicPattern } from 'tinyglobby';

export interface SqliteConfigOptions {
  readonly contract: string;
  readonly output?: string;
  readonly db?: {
    readonly connection?: string;
  };
  readonly extensions?: readonly ControlExtensionDescriptor<'sql', 'sqlite'>[];
  readonly migrations?: {
    readonly dir?: string;
  };
}

function staticPrefixDirectory(pattern: string): string {
  const staticSegments: string[] = [];
  for (const segment of pattern.replaceAll('\\', '/').split('/')) {
    if (isDynamicPattern(segment)) break;
    staticSegments.push(segment);
  }
  return staticSegments.join('/');
}

function deriveOutputPath(contractPath: string): string {
  if (isDynamicPattern(contractPath)) {
    const prefix = staticPrefixDirectory(contractPath);
    return prefix.length === 0 ? 'contract.json' : `${prefix}/contract.json`;
  }
  const ext = extname(contractPath);
  if (ext.length === 0) {
    return `${contractPath}.json`;
  }
  return `${contractPath.slice(0, -ext.length)}.json`;
}

export function defineConfig(options: SqliteConfigOptions): PrismaNextConfig<'sql', 'sqlite'> {
  const extensions = options.extensions ?? [];
  const output =
    options.output !== undefined
      ? join(options.output, 'contract.json')
      : deriveOutputPath(options.contract);
  const ext = extname(options.contract);

  const contractConfig =
    ext === '.ts'
      ? typescriptContractFromPath(options.contract, output)
      : prismaContract(options.contract, {
          output,
          target: sqlitePackRef,
          createNamespace: sqliteCreateNamespace,
          enumInferenceCodecs: { text: SQLITE_TEXT_CODEC_ID, int: SQLITE_INTEGER_CODEC_ID },
        });

  return coreDefineConfig({
    family: sql,
    target: sqlite,
    adapter: sqliteAdapter,
    driver: sqliteDriver,
    extensions,
    contract: contractConfig,
    ...ifDefined('db', options.db),
    ...ifDefined('migrations', options.migrations),
  });
}
