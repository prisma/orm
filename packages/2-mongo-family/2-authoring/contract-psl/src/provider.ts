import { readFile } from 'node:fs/promises';
import type { ContractConfig } from '@internal/config/config-types';
import type { AuthoringTypeNamespace } from '@internal/framework-components/authoring';
import { collectScalarTypeConstructors } from '@internal/framework-components/authoring';
import { buildSymbolTable, mapPslDiagnostics } from '@internal/psl-parser';
import type { PslInterpretCapable } from '@internal/psl-parser/interpret';
import { withSeedDiagnostics } from '@internal/psl-parser/interpret';
import { parse } from '@internal/psl-parser/syntax';
import { ifDefined } from '@internal/utils/defined';
import { InternalError } from '@internal/utils/internal-error';
import { notOk } from '@internal/utils/result';

import { interpretPslDocumentToMongoContract } from './interpreter';

export interface MongoContractOptions {
  readonly output?: string;
  /** The target's default codec ids for an `enum` block that omits `@@type`. */
  readonly enumInferenceCodecs?: { readonly text: string; readonly int: string };
}

function collectScalarTypeCodecIds(namespace: AuthoringTypeNamespace): ReadonlyMap<string, string> {
  return new Map(
    [...collectScalarTypeConstructors(namespace)].map(([name, output]) => [name, output.codecId]),
  );
}

export function mongoContract(schemaPath: string, options?: MongoContractOptions): ContractConfig {
  const source: PslInterpretCapable = {
    format: 'psl',
    inputs: [schemaPath],
    interpret(input, context) {
      return interpretPslDocumentToMongoContract({
        document: input.document,
        symbolTable: input.symbolTable,
        sources: input.sources,
        seedDiagnostics: [],
        scalarTypeCodecIds: collectScalarTypeCodecIds(context.authoringContributions.type),
        controlMutationDefaults: {
          ...context.controlMutationDefaults,
          dataTypeEntries: context.authoringContributions.dataTypes,
        },
        codecLookup: context.codecLookup,
        authoringContributions: context.authoringContributions,
        ...ifDefined('enumInferenceCodecs', options?.enumInferenceCodecs),
      });
    },
    async load(context) {
      const [absoluteSchemaPath] = context.resolvedInputs;
      if (absoluteSchemaPath === undefined) {
        throw new InternalError(
          'mongoContract: context.resolvedInputs is empty. The CLI config loader should populate it positional-matched with source.inputs.',
        );
      }
      let schema: string;
      try {
        schema = await readFile(absoluteSchemaPath, 'utf-8');
      } catch (error) {
        const message = String(error);
        return notOk({
          summary: `Failed to read Prisma schema at "${schemaPath}"`,
          diagnostics: [
            {
              code: 'PSL_SCHEMA_READ_FAILED',
              message,
              sourceId: schemaPath,
            },
          ],
          meta: { schemaPath, absoluteSchemaPath, cause: message },
        });
      }

      const { document, sources, diagnostics: parseDiagnostics } = parse(schema, schemaPath);
      const { symbolTable, diagnostics: symbolTableDiagnostics } = buildSymbolTable({
        documents: [document],
        sources,
        pslBlockDescriptors: context.authoringContributions.pslBlockDescriptors,
      });

      // Do not short-circuit on provider-level diagnostics; recovered CST can
      // still produce interpreter diagnostics in the same response.
      const seedDiagnostics = mapPslDiagnostics(
        [...parseDiagnostics, ...symbolTableDiagnostics],
        sources,
      );

      return withSeedDiagnostics(
        this.interpret({ document, sources, symbolTable }, context),
        seedDiagnostics,
      );
    },
  };

  return {
    source,
    ...ifDefined('output', options?.output),
  };
}
