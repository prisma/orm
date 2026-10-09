import { tsTaggedTemplateSource } from '@internal/framework-components/authoring';
import { SQL_EXPRESSION_TAG } from './sql-expression';

export interface SqlTagImport {
  readonly moduleSpecifier: string;
  readonly symbol: string;
}

/**
 * Writes the SQL texts of one generated migration-file call. Each text becomes a `sql` template where the tag reads it
 * back unchanged, else a string literal. `imports()` holds the `sql` import exactly when a written text used the tag.
 */
export interface SqlTextSources {
  source(text: string): string;
  imports(): readonly SqlTagImport[];
}

/** `moduleSpecifier` is the module the generated file imports `sql` from. */
export function createSqlTextSources(moduleSpecifier: string): SqlTextSources {
  let usesTag = false;
  return {
    source(text) {
      const written = tsTaggedTemplateSource(SQL_EXPRESSION_TAG, text);
      usesTag ||= written.usesTag;
      return written.source;
    },
    imports() {
      return usesTag ? [{ moduleSpecifier, symbol: SQL_EXPRESSION_TAG }] : [];
    },
  };
}
