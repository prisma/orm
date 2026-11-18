import { readdirSync, readFileSync } from 'node:fs';
import { join, resolve } from 'pathe';
import { describe, expect, it } from 'vitest';

const SOURCE = resolve(import.meta.dirname, '../src');
const MYSQL_ONLY = /\bMySQL\b/;

function sourceFiles(directory: string): string[] {
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const path = join(directory, entry.name);
    if (entry.isDirectory()) return sourceFiles(path);
    return entry.name.endsWith('.ts') ? [path] : [];
  });
}

/** The arguments of each error this source raises, as text: the calls to `mysqlError`, `structuredError` and the error helpers, up to the call's closing parenthesis. */
function errorCalls(source: string): string[] {
  const calls: string[] = [];
  const opener =
    /\b(?:mysqlError|structuredError|errorDateTimeUnreadable|errorDateTimeUnwritable|refuseJsonValue)\(/g;
  for (const match of source.matchAll(opener)) {
    let depth = 1;
    let index = (match.index ?? 0) + match[0].length;
    while (depth > 0 && index < source.length) {
      const char = source[index];
      if (char === '(') depth += 1;
      if (char === ')') depth -= 1;
      index += 1;
    }
    calls.push(source.slice(match.index, index));
  }
  return calls;
}

describe('the errors of the target MySQL and MariaDB share', () => {
  it('finds an error naming MySQL alone, and passes one naming both', () => {
    const source = [
      "throw mysqlError('X', 'MySQL has no FULL JOIN');",
      "throw mysqlError('Y', 'MySQL and MariaDB hold microseconds at most');",
    ].join('\n');
    expect(
      errorCalls(source).filter((call) => MYSQL_ONLY.test(call) && !call.includes('MariaDB')),
    ).toEqual(["mysqlError('X', 'MySQL has no FULL JOIN')"]);
  });

  it('name MariaDB wherever they name MySQL, since a mariadb() client raises them too', () => {
    const files = sourceFiles(SOURCE);
    const found = files.flatMap((file) =>
      errorCalls(readFileSync(file, 'utf8'))
        .filter((call) => MYSQL_ONLY.test(call) && !call.includes('MariaDB'))
        .map((call) => `${file.slice(SOURCE.length + 1)}: ${call.slice(0, 120)}`),
    );
    expect({ scanned: files.length > 20, found }).toEqual({ scanned: true, found: [] });
  });
});
