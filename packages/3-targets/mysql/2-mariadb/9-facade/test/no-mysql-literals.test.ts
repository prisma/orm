import { readdirSync, readFileSync } from 'node:fs';
import { join, resolve } from 'pathe';
import { describe, expect, it } from 'vitest';

const MARIADB_PACKAGES = resolve(import.meta.dirname, '../..');
const IMPORT_OR_EXPORT_FROM = /^\s*(?:import|export)\b[^;]*?\bfrom\s*'[^']*';/gms;
const COMMENT = /\/\*[\s\S]*?\*\/|\/\/[^\n]*/g;
const MYSQL_LITERAL = /['"`]mysql\b[^'"`\n]*/g;

function sourceFiles(directory: string): string[] {
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const path = join(directory, entry.name);
    if (entry.isDirectory()) return sourceFiles(path);
    return entry.name.endsWith('.ts') ? [path] : [];
  });
}

function mysqlLiterals(source: string): string[] {
  const code = source.replace(IMPORT_OR_EXPORT_FROM, '').replace(COMMENT, '');
  return [...code.matchAll(MYSQL_LITERAL)].map(([literal]) => literal);
}

describe('the MariaDB packages', () => {
  it('finds a mysql literal in code but not in an import specifier or a comment', () => {
    const source = [
      "import mysqlPack from '@internal/target-mysql/pack';",
      '/** Shares the `mysql/…` ids. */',
      "const id = 'mysql';",
    ].join('\n');
    expect(mysqlLiterals(source)).toEqual(["'mysql"]);
  });

  it("write no 'mysql' string literal outside import specifiers, so no MariaDB code path is typed or labelled MySQL", () => {
    const files = readdirSync(MARIADB_PACKAGES).flatMap((pkg) =>
      sourceFiles(join(MARIADB_PACKAGES, pkg, 'src')),
    );
    const found = files.flatMap((file) =>
      mysqlLiterals(readFileSync(file, 'utf8')).map(
        (literal) => `${file.slice(MARIADB_PACKAGES.length + 1)}: ${literal}`,
      ),
    );
    expect({ scanned: files.length > 10, found }).toEqual({ scanned: true, found: [] });
  });
});
