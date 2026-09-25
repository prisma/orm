import { readdir, readFile, stat } from 'node:fs/promises';
import type { ContractConfig, ContractSourceDiagnostic } from '@internal/config/config-types';
import { applySpecifierDefaultControlPolicy } from '@internal/contract/apply-specifier-default-control-policy';
import type { Contract, ControlPolicy } from '@internal/contract/types';
import { validateContractDomain } from '@internal/contract/validate-domain';
import { type MongoContract, validateMongoStorage } from '@internal/mongo-contract';
import type { ParseDiagnostic, SourceFile } from '@internal/psl-parser/syntax';
import { parse } from '@internal/psl-parser/syntax';
import { blindCast } from '@internal/utils/casts';
import { InternalError } from '@internal/utils/internal-error';
import { notOk, ok } from '@internal/utils/result';
import { isStructuredError } from '@internal/utils/structured-error';
import { dirname, extname, join, normalize } from 'pathe';
import { prisma6Diagnostic } from './diagnostics';
import { interpretPrisma6Documents, type Prisma6Document } from './interpreter';
import type { Prisma6TargetBinding } from './target-binding';

export interface Prisma6ContractOptions {
  readonly binding: Prisma6TargetBinding;
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
 * The files a Prisma 6 schema input names: the file itself, or every regular `.prisma` file under the directory, nested directories and symbolic links included, as Prisma 6 reads a schema directory. Sorted by path so duplicate detection blames the later file deterministically.
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

function readFailure(schemaPath: string, message: string, meta: Record<string, unknown>) {
  return notOk({
    summary: `Failed to read Prisma 6 schema at "${schemaPath}"`,
    diagnostics: [
      prisma6Diagnostic('PSL.PRISMA6_MONGO_SCHEMA_READ_FAILED', message, schemaPath, undefined),
    ],
    meta,
  });
}

/**
 * A `ContractConfig` that reads a Prisma 6 MongoDB `schema.prisma` (a file, or a directory of `.prisma` files) as the contract source.
 */
export function prisma6Contract(
  schemaPath: string,
  options: Prisma6ContractOptions,
): ContractConfig {
  return {
    source: {
      format: 'prisma6',
      inputs: [schemaPath],
      async load(context) {
        const [absolutePath] = context.resolvedInputs;
        if (absolutePath === undefined) {
          throw new InternalError(
            'prisma6Contract: context.resolvedInputs is empty. The CLI config loader should populate it from source.inputs.',
          );
        }
        let files: SchemaFile[];
        try {
          files = await listSchemaFiles(absolutePath, schemaPath);
        } catch (error) {
          const message = String(error);
          return readFailure(schemaPath, message, { schemaPath, absolutePath, cause: message });
        }
        if (files.length === 0) {
          return readFailure(
            schemaPath,
            `The schema directory "${schemaPath}" contains no .prisma file.`,
            { schemaPath, absolutePath },
          );
        }
        const documents: Prisma6Document[] = [];
        const seedDiagnostics: ContractSourceDiagnostic[] = [];
        for (const file of files) {
          let schema: string;
          try {
            schema = await readFile(file.absolutePath, 'utf-8');
          } catch (error) {
            const message = String(error);
            return readFailure(file.sourceId, message, {
              schemaPath: file.sourceId,
              absoluteSchemaPath: file.absolutePath,
              cause: message,
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
          const interpreted = interpretPrisma6Documents({
            documents,
            seedDiagnostics,
            binding: options.binding,
            authoringContributions: context.authoringContributions,
            codecLookup: context.codecLookup,
          });
          if (!interpreted.ok) return interpreted;
          contract = applySpecifierDefaultControlPolicy(
            interpreted.value,
            options.defaultControlPolicy,
          );
          validateContractDomain(contract);
          validateMongoStorage(
            blindCast<MongoContract, 'the Prisma 6 reader built a Mongo contract'>(contract),
          );
        } catch (error) {
          if (!isStructuredError(error)) throw error;
          return notOk({
            summary: 'Prisma 6 MongoDB schema interpretation failed',
            diagnostics: [
              prisma6Diagnostic(
                'PSL.PRISMA6_MONGO_CONTRACT_INVALID',
                `This schema gives a contract that Prisma 8 rejects, and the Prisma 6 MongoDB contract source has no specific diagnostic for the cause: ${error.message.replace(/\.$/, '')}. This is a bug in Prisma ORM; please report it with this schema.`,
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
