import { readdir, readFile, stat, writeFile } from 'node:fs/promises';
import { EOL } from 'node:os';
import type { PrismaNextConfig, PslParserOptions } from '@internal/config/config-types';
import { expandContractInputs } from '@internal/config-loader';
import { type FormatOptions, format } from '@internal/psl-parser/format';
import { notOk, ok, type Result } from '@internal/utils/result';
import { isStructuredError } from '@internal/utils/structured-error';
import { join } from 'pathe';
import { type CliStructuredError, errorRuntime, errorUnexpected } from '../../utils/cli-errors';

export interface FormatOperationOptions {
  readonly config: PrismaNextConfig;
  /** Directory the command was invoked from. */
  readonly cwd: string;
  readonly eol?: string;
}

export interface FormatOperationResult {
  readonly formatted: boolean;
  readonly paths: readonly string[];
}

export function resolveNewline(
  formatterNewline: 'LF' | 'CRLF' | undefined,
  eol: string,
): 'LF' | 'CRLF' {
  if (formatterNewline !== undefined) {
    return formatterNewline;
  }
  return eol === '\r\n' ? 'CRLF' : 'LF';
}

async function formatOneFile(
  inputPath: string,
  formatOptions: FormatOptions,
  parserOptions: PslParserOptions | undefined,
): Promise<Result<string, CliStructuredError>> {
  let contents: string;
  try {
    contents = await readFile(inputPath, 'utf-8');
  } catch (error) {
    return notOk(
      errorRuntime('CONTRACT.SOURCE_LOAD_FAILED', 'Failed to read contract source file', {
        why: error instanceof Error ? error.message : String(error),
        fix: `Check that ${inputPath} exists and is readable.`,
        cause: error,
      }),
    );
  }

  let formatted: string;
  try {
    formatted = format(contents, formatOptions, parserOptions);
  } catch (error) {
    if (isStructuredError(error) && error.code === 'PSL.PARSE_FAILED') {
      return notOk(
        errorRuntime('PSL.PARSE_FAILED', 'Cannot format PSL with parse errors', {
          why: error.message,
          fix: 'Fix the parse errors in your schema and try again.',
          meta: { diagnostics: error.meta?.['diagnostics'] },
          cause: error,
        }),
      );
    }
    return notOk(errorUnexpected(error instanceof Error ? error.message : String(error)));
  }

  try {
    await writeFile(inputPath, formatted, 'utf-8');
  } catch (error) {
    return notOk(
      errorRuntime('CLI.FILE_WRITE_FAILED', 'Failed to write formatted contract source file', {
        why: error instanceof Error ? error.message : String(error),
        fix: `Check that ${inputPath} is writable.`,
        cause: error,
      }),
    );
  }

  return ok(inputPath);
}

/** The input itself, or every `.prisma` file under it when the input is a directory. */
async function pslFilesOf(inputPath: string): Promise<readonly string[]> {
  const isDirectory = await stat(inputPath).then(
    (stats) => stats.isDirectory(),
    () => false,
  );
  if (!isDirectory) return [inputPath];
  const entries = await readdir(inputPath, { recursive: true });
  return entries
    .filter((entry) => entry.endsWith('.prisma'))
    .sort()
    .map((entry) => join(inputPath, entry));
}

export async function executeFormat(
  options: FormatOperationOptions,
): Promise<Result<FormatOperationResult, CliStructuredError>> {
  const eol = options.eol ?? EOL;
  const config = options.config;

  const source = config.contract?.source;
  if (source?.format !== 'psl') {
    return ok({ formatted: false, paths: [] });
  }

  const resolvedInputs = await expandContractInputs(source.inputs);
  if (resolvedInputs.length === 0) {
    return ok({ formatted: false, paths: [] });
  }

  const formatOptions: FormatOptions = {
    indent: config.formatter?.indent ?? 2,
    newline: resolveNewline(config.formatter?.newline, eol),
  };

  const paths: string[] = [];
  const failures: CliStructuredError[] = [];
  const files = (await Promise.all(resolvedInputs.map(pslFilesOf))).flat();
  for (const inputPath of files) {
    const outcome = await formatOneFile(inputPath, formatOptions, source.parserOptions);
    if (outcome.ok) {
      paths.push(outcome.value);
    } else {
      failures.push(outcome.failure);
    }
  }

  const [firstFailure] = failures;
  if (firstFailure !== undefined) {
    return notOk(firstFailure);
  }

  return ok({ formatted: paths.length > 0, paths });
}
