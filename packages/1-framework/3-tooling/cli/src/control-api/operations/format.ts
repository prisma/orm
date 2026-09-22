import { readFile, writeFile } from 'node:fs/promises';
import { EOL } from 'node:os';
import type { PrismaNextConfig } from '@internal/config/config-types';
import { expandContractInputs } from '@internal/config-loader';
import { type FormatOptions, format } from '@internal/psl-parser/format';
import { notOk, ok, type Result } from '@internal/utils/result';
import { isStructuredError } from '@internal/utils/structured-error';
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
    formatted = format(contents, formatOptions);
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
  for (const inputPath of resolvedInputs) {
    const outcome = await formatOneFile(inputPath, formatOptions);
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
