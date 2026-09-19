import { existsSync, unlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { pathToFileURL } from 'node:url';
import type { Contract } from '@internal/contract/types';
import { CliStructuredError } from '@internal/errors/control';
import { InternalError } from '@internal/utils/internal-error';
import type { Plugin } from 'esbuild';
import { build } from 'esbuild';
import { join, resolve as resolvePath } from 'pathe';

export interface LoadTsContractOptions {
  readonly allowlist?: ReadonlyArray<string>;
}

type ContractSourceErrorCode =
  | 'CONTRACT.EXPORT_INVALID'
  | 'CONTRACT.SOURCE_LOAD_FAILED'
  | 'CONTRACT.SOURCE_IMPORT_DISALLOWED';

function contractSourceError(
  code: ContractSourceErrorCode,
  message: string,
  options?: {
    readonly meta?: Record<string, unknown>;
    readonly cause?: unknown;
  },
): CliStructuredError {
  const error = new CliStructuredError(
    code,
    message,
    options?.meta !== undefined ? { meta: options.meta } : undefined,
  );
  if (options?.cause !== undefined) {
    error.cause = options.cause;
  }
  return error;
}

// Both naming schemes: a contract authored against the workspace names and one
// authored against the published `@prisma/orm-*` entrypoints (ADR 242) are the
// same code under two roots, and the CLI has to load either.
const DEFAULT_ALLOWLIST = ['@internal/*', '@prisma/orm-*', 'node:crypto'];

function isAllowedImport(importPath: string, allowlist: ReadonlyArray<string>): boolean {
  for (const pattern of allowlist) {
    if (pattern.endsWith('/*')) {
      const prefix = pattern.slice(0, -2);
      if (importPath === prefix || importPath.startsWith(`${prefix}/`)) {
        return true;
      }
    } else if (pattern.endsWith('*')) {
      const prefix = pattern.slice(0, -1);
      if (importPath.startsWith(prefix)) {
        return true;
      }
    } else if (importPath === pattern) {
      return true;
    }
  }
  return false;
}

function validatePurity(value: unknown, entryPath: string): void {
  if (typeof value !== 'object' || value === null) {
    return;
  }

  const path = new WeakSet();

  function check(value: unknown): void {
    if (value === null || typeof value !== 'object') {
      return;
    }

    if (path.has(value)) {
      throw contractSourceError(
        'CONTRACT.EXPORT_INVALID',
        'Contract export contains circular references',
        { meta: { path: entryPath, reason: 'circular' } },
      );
    }
    path.add(value);

    try {
      for (const key in value) {
        const descriptor = Object.getOwnPropertyDescriptor(value, key);
        if (descriptor && (descriptor.get || descriptor.set)) {
          throw contractSourceError(
            'CONTRACT.EXPORT_INVALID',
            `Contract export contains getter/setter at key "${key}"`,
            { meta: { path: entryPath, reason: 'getter', key } },
          );
        }
        if (descriptor && typeof descriptor.value === 'function') {
          throw contractSourceError(
            'CONTRACT.EXPORT_INVALID',
            `Contract export contains function at key "${key}"`,
            { meta: { path: entryPath, reason: 'function', key } },
          );
        }
        check((value as Record<string, unknown>)[key]);
      }
    } finally {
      path.delete(value);
    }
  }

  try {
    check(value);
    JSON.stringify(value);
  } catch (error) {
    if (error instanceof Error) {
      if (error.message.includes('getter') || error.message.includes('circular')) {
        throw error;
      }
      throw contractSourceError(
        'CONTRACT.EXPORT_INVALID',
        `Contract export is not JSON-serializable: ${error.message}`,
        { meta: { path: entryPath, reason: 'not-json-serializable' }, cause: error },
      );
    }
    throw contractSourceError(
      'CONTRACT.EXPORT_INVALID',
      'Contract export is not JSON-serializable',
      { meta: { path: entryPath, reason: 'not-json-serializable' } },
    );
  }
}

function createImportAllowlistPlugin(
  allowlist: ReadonlyArray<string>,
  entryPath: string,
  collected: Set<string>,
): Plugin {
  // Match against several path forms that esbuild may use as the importer:
  // the absolute resolved entry, the value the caller passed (which may be
  // relative), and the conventional `<stdin>` placeholder. This is more
  // forgiving than `===` against a single form, which broke when esbuild
  // resolved the entry to an absolute path while the caller passed a
  // relative one (or vice versa).
  const entryAbs = resolvePath(entryPath);
  function isFromEntry(importer: string): boolean {
    return importer === entryAbs || importer === entryPath || importer === '<stdin>';
  }
  return {
    name: 'import-allowlist',
    setup(build) {
      build.onResolve({ filter: /.*/ }, (args) => {
        if (args.kind === 'entry-point') {
          return undefined;
        }
        if (args.path.startsWith('.') || args.path.startsWith('/')) {
          return undefined;
        }
        if (isFromEntry(args.importer) && !isAllowedImport(args.path, allowlist)) {
          collected.add(args.path);
          return {
            path: args.path,
            external: true,
          };
        }
        return undefined;
      });
    },
  };
}

/**
 * Loads a contract from a TypeScript file and returns it as Contract.
 *
 * **Responsibility: Parsing Only**
 * This function loads and parses a TypeScript contract file. It does NOT normalize the contract.
 * The contract should already be normalized if it was built using the contract builder.
 *
 * Normalization must happen in the contract builder when the contract is created.
 * This function only validates that the contract is JSON-serializable and returns it as-is.
 *
 * @param entryPath - Path to the TypeScript contract file
 * @param options - Optional configuration (import allowlist)
 * @returns The contract as Contract (should already be normalized)
 * @throws structured errors: `CLI.FILE_NOT_FOUND`, `CONTRACT.SOURCE_LOAD_FAILED`,
 *   `CONTRACT.SOURCE_IMPORT_DISALLOWED`, `CONTRACT.MODULE_EXPORT_MISSING`, `CONTRACT.EXPORT_INVALID`
 */
export async function loadContractFromTs(
  entryPath: string,
  options?: LoadTsContractOptions,
): Promise<Contract> {
  const allowlist = options?.allowlist ?? DEFAULT_ALLOWLIST;

  if (!existsSync(entryPath)) {
    throw new CliStructuredError('CLI.FILE_NOT_FOUND', `Contract file not found: ${entryPath}`, {
      where: { path: entryPath },
    });
  }

  const tempFile = join(
    tmpdir(),
    `prisma-8-contract-${Date.now()}-${Math.random().toString(36).slice(2)}.mjs`,
  );

  // Disallowed imports are collected by the allowlist resolver plugin itself,
  // which has the `importer` context to distinguish entry-direct imports from
  // transitive imports made inside allowlisted (`@internal/*`) dependencies.
  // The metafile is intentionally not re-walked: it would surface internal
  // `node:*` imports inside framework code as false positives.
  const disallowedFromEntry = new Set<string>();

  try {
    const result = await build({
      entryPoints: [entryPath],
      bundle: true,
      format: 'esm',
      platform: 'node',
      target: 'es2022',
      outfile: tempFile,
      write: false,
      metafile: true,
      plugins: [createImportAllowlistPlugin(allowlist, entryPath, disallowedFromEntry)],
      logLevel: 'error',
    });

    if (result.errors.length > 0) {
      const errorMessages = result.errors.map((e: { text: string }) => e.text).join('\n');
      throw contractSourceError(
        'CONTRACT.SOURCE_LOAD_FAILED',
        `Failed to bundle contract file: ${errorMessages}`,
        { meta: { path: entryPath, stage: 'bundle' } },
      );
    }

    if (!result.outputFiles || result.outputFiles.length === 0) {
      throw new InternalError('No output files generated from bundling');
    }

    if (disallowedFromEntry.size > 0) {
      throw contractSourceError(
        'CONTRACT.SOURCE_IMPORT_DISALLOWED',
        `Disallowed imports detected. Only imports matching the allowlist are permitted:\n  Allowlist: ${allowlist.join(', ')}\n  Disallowed imports: ${[...disallowedFromEntry].join(', ')}`,
        { meta: { allowlist: [...allowlist], disallowed: [...disallowedFromEntry] } },
      );
    }

    const bundleContent = result.outputFiles[0]?.text;
    if (bundleContent === undefined) {
      throw new InternalError('Bundle content is undefined');
    }
    writeFileSync(tempFile, bundleContent, 'utf-8');

    const module = (await import(/* @vite-ignore */ pathToFileURL(tempFile).href)) as {
      default?: unknown;
      contract?: unknown;
    };
    unlinkSync(tempFile);

    let contract: unknown;

    if (module.default !== undefined) {
      contract = module.default;
    } else if (module.contract !== undefined) {
      contract = module.contract;
    } else {
      throw new CliStructuredError(
        'CONTRACT.MODULE_EXPORT_MISSING',
        `Contract file must export a contract as default export or named export 'contract'. Found exports: ${Object.keys(module as Record<string, unknown>).join(', ') || 'none'}`,
        { where: { path: entryPath } },
      );
    }

    if (typeof contract !== 'object' || contract === null) {
      throw contractSourceError(
        'CONTRACT.EXPORT_INVALID',
        `Contract export must be an object, got ${typeof contract}`,
        { meta: { path: entryPath, reason: 'not-object' } },
      );
    }

    validatePurity(contract, entryPath);

    // Blind cast: the loaded module was authored by user code
    // (typically via `defineContract` / a contract builder) and
    // its runtime shape is structurally a `Contract`, but the
    // dynamic import collapses the source typing. The contract
    // structural validation that asserts the shape happens
    // downstream at the `familyInstance.deserializeContract` seam
    // (e.g. in `executeContractEmit`); this helper only checks
    // purity here.
    return contract as unknown as Contract;
  } catch (error) {
    try {
      if (tempFile) {
        unlinkSync(tempFile);
      }
    } catch {
      // Ignore cleanup errors
    }

    if (error instanceof Error) {
      throw error;
    }
    throw contractSourceError(
      'CONTRACT.SOURCE_LOAD_FAILED',
      `Failed to load contract from ${entryPath}: ${String(error)}`,
      { meta: { path: entryPath, stage: 'import' }, cause: error },
    );
  }
}
