import { readdir, readFile, stat } from 'node:fs/promises';
import type { ContractConfig, ContractSourceDiagnostic } from '@internal/config/config-types';
import type { Contract, ControlPolicy } from '@internal/contract/types';
import { validateContractDomain } from '@internal/contract/validate-domain';
import type { ParseDiagnostic, SourceFile } from '@internal/psl-parser/syntax';
import { parse } from '@internal/psl-parser/syntax';
import type { SqlStorage } from '@internal/sql-contract/types';
import {
  validateModelStorageReferences,
  validateSqlStorageConsistency,
} from '@internal/sql-contract/validators';
import { applySqlSpecifierControlPolicy } from '@internal/sql-contract-ts/contract-builder';
import { blindCast } from '@internal/utils/casts';
import { InternalError } from '@internal/utils/internal-error';
import { notOk, ok } from '@internal/utils/result';
import { isStructuredError } from '@internal/utils/structured-error';
import { dirname, extname, join, normalize } from 'pathe';
import { prisma7Diagnostic } from './diagnostics';
import { interpretPrisma7Documents, type Prisma7Document } from './interpreter';
import type { Prisma7TargetBinding } from './target-binding';

export interface Prisma7ContractOptions {
  readonly binding: Prisma7TargetBinding;
  readonly output?: string;
  readonly defaultControlPolicy?: ControlPolicy;
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
    span: sourceFile.rangeToPslSpan(diagnostic.range),
  }));
}

interface SchemaFile {
  /** The path shown in diagnostics: the input path, or the file's path under the input directory. */
  readonly sourceId: string;
  readonly absolutePath: string;
}

/**
 * The files a Prisma 7 schema input names: the file itself, or every regular
 * `.prisma` file under the directory, nested directories and symbolic links
 * included, as Prisma 7 reads a schema directory. Sorted by path so duplicate
 * detection blames the later file deterministically.
 */
async function listSchemaFiles(absolutePath: string, displayPath: string): Promise<SchemaFile[]> {
  const info = await stat(absolutePath);
  if (!info.isDirectory()) return [{ sourceId: displayPath, absolutePath }];
  const entries = await readdir(absolutePath, { recursive: true });
  const files: SchemaFile[] = [];
  for (const entry of entries
    .filter((name) => extname(name) === '.prisma')
    .map((name) => normalize(name))
    .sort()) {
    const entryPath = join(absolutePath, entry);
    if ((await stat(entryPath)).isFile()) {
      files.push({ sourceId: join(displayPath, entry), absolutePath: entryPath });
    }
  }
  return files;
}

/**
 * The checks `contract emit` runs on the contract after `load` that the
 * contract builder does not: domain roots and relations, column defaults
 * against nullability, and model storage references. The structural check also
 * needs the target's entity kinds, which `load` does not receive.
 */
function validateInterpretedContract(contract: Contract): void {
  validateContractDomain(contract);
  const sqlContract = blindCast<Contract<SqlStorage>, 'the SQL contract builder built it'>(
    contract,
  );
  validateSqlStorageConsistency(sqlContract);
  validateModelStorageReferences(sqlContract);
}

export function prisma7Contract(
  schemaPath: string,
  options: Prisma7ContractOptions,
): ContractConfig {
  return {
    source: {
      format: 'prisma7',
      inputs: [schemaPath],
      async load(context) {
        const [absolutePath] = context.resolvedInputs;
        if (absolutePath === undefined) {
          throw new InternalError(
            'prisma7Contract: context.resolvedInputs is empty. The CLI config loader should populate it positional-matched with source.inputs.',
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
              prisma7Diagnostic('PSL.PRISMA7_SCHEMA_READ_FAILED', message, schemaPath, undefined),
            ],
            meta: { schemaPath, absolutePath, cause: message },
          });
        }
        if (files.length === 0) {
          return notOk({
            summary: `Failed to read Prisma 7 schema at "${schemaPath}"`,
            diagnostics: [
              prisma7Diagnostic(
                'PSL.PRISMA7_SCHEMA_READ_FAILED',
                `The schema directory "${schemaPath}" contains no .prisma file.`,
                schemaPath,
                undefined,
              ),
            ],
            meta: { schemaPath, absolutePath },
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
                prisma7Diagnostic(
                  'PSL.PRISMA7_SCHEMA_READ_FAILED',
                  message,
                  file.sourceId,
                  undefined,
                ),
              ],
              meta: {
                schemaPath: file.sourceId,
                absoluteSchemaPath: file.absolutePath,
                cause: message,
              },
            });
          }
          const { document, sources, diagnostics } = parse(schema, file.sourceId, {
            grammar: 'prisma7',
          });
          const sourceFile = sources.sourceFileFor(document.syntax);
          seedDiagnostics.push(...mapParseDiagnostics(diagnostics, sourceFile, file.sourceId));
          documents.push({ document, sources, sourceFile, sourceId: file.sourceId });
        }

        let contract: Contract;
        try {
          const interpreted = interpretPrisma7Documents({
            documents,
            seedDiagnostics,
            binding: options.binding,
            controlMutationDefaults: context.controlMutationDefaults,
            authoringContributions: context.authoringContributions,
            codecLookup: context.codecLookup,
            composedExtensions: context.composedExtensions,
          });
          if (!interpreted.ok) return interpreted;
          contract = applySqlSpecifierControlPolicy(
            interpreted.value,
            options.defaultControlPolicy,
            options.binding.createNamespace,
          );
          validateInterpretedContract(contract);
        } catch (error) {
          if (!isStructuredError(error)) throw error;
          return notOk({
            summary: 'Prisma 7 schema interpretation failed',
            diagnostics: [
              prisma7Diagnostic(
                'PSL.PRISMA7_CONTRACT_INVALID',
                `This schema gives a contract that Prisma 8 rejects, and the Prisma 7 contract source has no specific diagnostic for the cause: ${error.message.replace(/\.$/, '')}. This is a bug in Prisma ORM; please report it with this schema.`,
                schemaPath,
                undefined,
              ),
            ],
            meta: { schemaPath, code: error.code },
          });
        }
        return ok(contract);
      },
    },
    output: options.output ?? defaultOutputFromSchemaPath(schemaPath),
  };
}
