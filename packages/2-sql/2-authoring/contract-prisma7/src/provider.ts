import { readdir, readFile, stat } from 'node:fs/promises';
import type { ContractConfig, ContractSourceDiagnostic } from '@internal/config/config-types';
import type { ControlPolicy } from '@internal/contract/types';
import type { TargetPackRef } from '@internal/framework-components/components';
import { rangeToPslSpan } from '@internal/psl-parser';
import type { ParseDiagnostic, SourceFile } from '@internal/psl-parser/syntax';
import { parse } from '@internal/psl-parser/syntax';
import type { SqlNamespaceBase, SqlNamespaceInput } from '@internal/sql-contract/types';
import { applySqlSpecifierControlPolicy } from '@internal/sql-contract-ts/contract-builder';
import { InternalError } from '@internal/utils/internal-error';
import { notOk, ok } from '@internal/utils/result';
import { dirname, extname, join, normalize } from 'pathe';
import { prisma7Diagnostic } from './diagnostics';
import { interpretPrisma7Documents, type Prisma7Document } from './interpreter';
import type { Prisma7TypeMap } from './native-types';

export interface Prisma7SchemaOptions {
  readonly output?: string;
  readonly target: TargetPackRef<'sql', string>;
  readonly createNamespace: (input: SqlNamespaceInput) => SqlNamespaceBase;
  readonly defaultControlPolicy?: ControlPolicy;
  /**
   * The target's native enum vocabulary: the entity kind its pack registers
   * (Postgres: `native_enum`) and the type constructor path that references
   * one from a field (Postgres: `pg.enum`).
   */
  readonly nativeEnum: {
    readonly entityKind: string;
    readonly typeConstructor: readonly string[];
  };
  /** The target's table of what Prisma 7 creates for each scalar and `@db.*` type. */
  readonly typeMap: Prisma7TypeMap;
  /**
   * Picks the execution generator `@updatedAt` lowers to on create and update
   * from the column's resolved codec, so the generated value is in the
   * representation that codec encodes.
   */
  readonly updatedAt: {
    readonly generatorIdFor: (column: {
      readonly codecId: string;
      readonly nativeType: string;
    }) => string;
  };
}

function defaultOutputFromSchemaPath(schemaPath: string): string {
  return join(dirname(schemaPath), 'contract.json');
}

function mapParseDiagnostics(
  diagnostics: readonly ParseDiagnostic[],
  sourceFile: SourceFile,
  sourceId: string,
): ContractSourceDiagnostic[] {
  return diagnostics.map((diagnostic) => ({
    code: diagnostic.code,
    message: diagnostic.message,
    sourceId,
    span: rangeToPslSpan(diagnostic.range, sourceFile),
  }));
}

interface SchemaFile {
  /** The path shown in diagnostics: the input path, or the file's path under the input directory. */
  readonly sourceId: string;
  readonly absolutePath: string;
}

/**
 * The files a Prisma 7 schema input names: the file itself, or every `.prisma`
 * file under the directory, nested directories included, as Prisma 7 reads a
 * schema directory. Sorted by path so duplicate detection blames the later file
 * deterministically.
 */
async function listSchemaFiles(absolutePath: string, displayPath: string): Promise<SchemaFile[]> {
  const info = await stat(absolutePath);
  if (!info.isDirectory()) return [{ sourceId: displayPath, absolutePath }];
  const entries = await readdir(absolutePath, { recursive: true });
  return entries
    .filter((entry) => extname(entry) === '.prisma')
    .map((entry) => normalize(entry))
    .sort()
    .map((entry) => ({
      sourceId: join(displayPath, entry),
      absolutePath: join(absolutePath, entry),
    }));
}

export function prisma7Schema(schemaPath: string, options: Prisma7SchemaOptions): ContractConfig {
  return {
    source: {
      format: 'prisma7',
      inputs: [schemaPath],
      async load(context) {
        const [absolutePath] = context.resolvedInputs;
        if (absolutePath === undefined) {
          throw new InternalError(
            'prisma7Schema: context.resolvedInputs is empty. The CLI config loader should populate it positional-matched with source.inputs.',
          );
        }
        let files: SchemaFile[];
        try {
          files = await listSchemaFiles(absolutePath, schemaPath);
        } catch (error) {
          const message = String(error);
          return notOk({
            summary: `Failed to read Prisma 7 schema at "${schemaPath}"`,
            diagnostics: [
              prisma7Diagnostic('PRISMA7_SCHEMA_READ_FAILED', message, schemaPath, undefined),
            ],
            meta: { schemaPath, absolutePath, cause: message },
          });
        }
        const documents: Prisma7Document[] = [];
        const seedDiagnostics: ContractSourceDiagnostic[] = [];
        for (const file of files) {
          let schema: string;
          try {
            schema = await readFile(file.absolutePath, 'utf-8');
          } catch (error) {
            const message = String(error);
            return notOk({
              summary: `Failed to read Prisma 7 schema at "${file.sourceId}"`,
              diagnostics: [
                prisma7Diagnostic('PRISMA7_SCHEMA_READ_FAILED', message, file.sourceId, undefined),
              ],
              meta: {
                schemaPath: file.sourceId,
                absoluteSchemaPath: file.absolutePath,
                cause: message,
              },
            });
          }
          const { document, sourceFile, diagnostics } = parse(schema, { dialect: 'prisma7' });
          seedDiagnostics.push(...mapParseDiagnostics(diagnostics, sourceFile, file.sourceId));
          documents.push({ document, sourceFile, sourceId: file.sourceId });
        }

        const interpreted = interpretPrisma7Documents({
          documents,
          seedDiagnostics,
          target: options.target,
          createNamespace: options.createNamespace,
          nativeEnum: options.nativeEnum,
          typeMap: options.typeMap,
          updatedAt: options.updatedAt,
          controlMutationDefaults: context.controlMutationDefaults,
          authoringContributions: context.authoringContributions,
          codecLookup: context.codecLookup,
          composedExtensions: context.composedExtensions,
        });
        if (!interpreted.ok) return interpreted;
        return ok(
          applySqlSpecifierControlPolicy(
            interpreted.value,
            options.defaultControlPolicy,
            options.createNamespace,
          ),
        );
      },
    },
    output: options.output ?? defaultOutputFromSchemaPath(schemaPath),
  };
}
