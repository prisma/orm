import { isPrisma8Schema } from '@prisma/orm-framework/psl-parser';
import type { ContractComparison } from '../contract/compare';
import type { ContractSourceFile } from './edit-contract-source';
import { notChanged } from './refusal';

export interface ReadContractSourceFile extends ContractSourceFile {
  /** The file's absolute path, which Better Auth writes to whatever its `--cwd`. */
  readonly absolutePath: string;
}

const passOutput = 'Pass your contract file with `--output`.';
const typeScriptContract =
  'it is written in TypeScript. Add the equivalent models and fields in TypeScript.';
const typeScriptFile = /\.[cm]?tsx?$/;

/**
 * How a reason line names a caught error: by its code, as the operating system and the module loader give one, since their messages differ between systems and hold absolute paths; otherwise by the first line of its message, which comes from the developer's own config.
 */
function errorDetail(error: unknown): string {
  const code: unknown = error instanceof Error ? Reflect.get(error, 'code') : undefined;
  if (typeof code === 'string') return ` (${code})`;
  const message = error instanceof Error ? error.message : String(error);
  return `: ${message.split('\n')[0]}`;
}

function isMissingFile(error: unknown): boolean {
  return error instanceof Error && Reflect.get(error, 'code') === 'ENOENT';
}

async function configLoader(comparison: ContractComparison) {
  try {
    return await import('@prisma/orm-toolchain/config-loader');
  } catch (error) {
    throw notChanged(
      comparison,
      `Prisma's config loader could not be loaded${errorDetail(error)}. ${passOutput}`,
    );
  }
}

/** The absolute paths of the contract's inputs in `prisma.config.ts` in the working directory. Better Auth does not tell the adapter its `--cwd`. */
async function contractInputs(
  comparison: ContractComparison,
  shown: (path: string) => string,
): Promise<readonly string[]> {
  const loader = await configLoader(comparison);
  const didNotLoad = (reason: string) =>
    notChanged(comparison, `prisma.config.ts did not load${reason}. ${passOutput}`);
  let loaded: Awaited<ReturnType<typeof loader.loadConfigForSections>>;
  try {
    loaded = await loader.loadConfigForSections(undefined, ['contract']);
  } catch (error) {
    throw didNotLoad(errorDetail(error));
  }
  if (!loaded.ok) {
    if (loaded.failure.code === 'CONFIG.FILE_NOT_FOUND') {
      throw notChanged(
        comparison,
        `it found no prisma.config.ts in the working directory. ${passOutput}`,
      );
    }
    throw didNotLoad(`: ${loaded.failure.message}`);
  }
  const source = loaded.value.contract?.source;
  if (source === undefined) {
    throw notChanged(comparison, `prisma.config.ts names no contract. ${passOutput}`);
  }
  if (source.format !== 'psl') throw notChanged(comparison, typeScriptContract);
  if (source.parserOptions?.grammar === 'prisma-7') {
    throw notChanged(
      comparison,
      'it is a Prisma 7 schema, and the lines above are Prisma 8 syntax. Add the equivalent lines by hand.',
    );
  }
  const inputs = await loader.expandContractInputs(source.inputs);
  if (inputs.length === 0) {
    throw notChanged(
      comparison,
      `the contract inputs prisma.config.ts names match no file: ${(source.inputs ?? []).map(shown).join(', ')}. ${passOutput}`,
    );
  }
  return inputs;
}

/**
 * The contract's source files: the file `--output` names when Better Auth passes one, otherwise the files of the contract in `prisma.config.ts` in the working directory that start with `// use prisma-8`, as emitting reads them. Each file's `path` is relative to the working directory when the file is inside it. Throws the contract message, with the reason, when no PSL source can be read.
 */
export async function contractSourceFiles(
  file: string | undefined,
  comparison: ContractComparison,
): Promise<readonly ReadContractSourceFile[]> {
  if (file !== undefined && typeScriptFile.test(file)) {
    throw notChanged(comparison, typeScriptContract);
  }
  const { readFile } = await import('node:fs/promises');
  const { isAbsolute, relative, resolve } = await import('node:path');
  const shown = (path: string): string => {
    const fromCwd = relative(process.cwd(), path);
    return fromCwd.startsWith('..') || isAbsolute(fromCwd) ? path : fromCwd;
  };
  const paths = file === undefined ? await contractInputs(comparison, shown) : [resolve(file)];
  const files: ReadContractSourceFile[] = [];
  for (const absolutePath of paths) {
    const path = shown(absolutePath);
    let text: string;
    try {
      text = await readFile(absolutePath, 'utf8');
    } catch (error) {
      throw notChanged(
        comparison,
        isMissingFile(error)
          ? `${path} was not found. ${passOutput}`
          : `${path} could not be read${errorDetail(error)}. ${passOutput}`,
      );
    }
    if (file === undefined && !isPrisma8Schema(text)) continue;
    files.push({ path, text, absolutePath });
  }
  if (files.length === 0) {
    throw notChanged(
      comparison,
      `none of the files prisma.config.ts names starts with \`// use prisma-8\`. ${passOutput}`,
    );
  }
  return files;
}
