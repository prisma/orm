import type { ContractComparison } from '../contract/compare';
import type { ContractSourceFile } from './edit-contract-source';
import { notChanged } from './refusal';

const passOutput = 'Pass your contract file with `--output`.';
const typeScriptContract =
  'it is written in TypeScript. Add the equivalent models and fields in TypeScript.';
const typeScriptFile = /\.[cm]?tsx?$/;

function isMissingFile(error: unknown): boolean {
  return error instanceof Error && Reflect.get(error, 'code') === 'ENOENT';
}

async function contractInputs(comparison: ContractComparison): Promise<readonly string[]> {
  const loader = await import('@prisma/orm-toolchain/config-loader');
  const loaded = await loader.loadConfig(undefined, { cwd: process.cwd() });
  if (!loaded.ok) {
    throw notChanged(
      comparison,
      loaded.failure.code === 'CONFIG.FILE_NOT_FOUND'
        ? `it found no prisma.config.ts in the working directory. ${passOutput}`
        : `prisma.config.ts did not load: ${loaded.failure.message}. ${passOutput}`,
    );
  }
  const config = loader.requireConfigSections(loaded.value, ['contract']);
  if (!config.ok) {
    throw notChanged(
      comparison,
      `prisma.config.ts did not load: ${config.failure.message}. ${passOutput}`,
    );
  }
  const source = config.value.contract?.source;
  const inputs = await loader.expandContractInputs(source?.inputs);
  if (source === undefined || inputs.length === 0) {
    throw notChanged(comparison, `prisma.config.ts names no contract. ${passOutput}`);
  }
  if (source.format !== 'psl') throw notChanged(comparison, typeScriptContract);
  return inputs;
}

/**
 * The contract's source files: the file `--output` names when Better Auth passes one, otherwise the inputs of the contract in `prisma.config.ts` in the working directory. Each file's path is relative to the working directory when the file is inside it. Throws the contract message, with the reason, when no PSL source can be read.
 */
export async function contractSourceFiles(
  file: string | undefined,
  comparison: ContractComparison,
): Promise<readonly ContractSourceFile[]> {
  const { readFile } = await import('node:fs/promises');
  const { isAbsolute, relative, resolve } = await import('node:path');
  const shown = (path: string): string => {
    const fromCwd = relative(process.cwd(), path);
    return fromCwd.startsWith('..') || isAbsolute(fromCwd) ? path : fromCwd;
  };
  const paths = file === undefined ? await contractInputs(comparison) : [resolve(file)];
  const files: ContractSourceFile[] = [];
  for (const path of paths) {
    try {
      files.push({ path: shown(path), text: await readFile(path, 'utf8') });
    } catch (error) {
      if (!isMissingFile(error)) throw error;
      throw notChanged(comparison, `${shown(path)} was not found. ${passOutput}`);
    }
  }
  if (file !== undefined && typeScriptFile.test(file)) {
    throw notChanged(comparison, typeScriptContract);
  }
  return files;
}
