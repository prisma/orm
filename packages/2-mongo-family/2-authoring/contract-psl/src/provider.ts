import { readFile } from 'node:fs/promises';
import type { ContractConfig, ContractSourceDiagnostic } from '@internal/config/config-types';
import type { AuthoringTypeNamespace } from '@internal/framework-components/authoring';
import { collectScalarTypeConstructors } from '@internal/framework-components/authoring';
import { buildSymbolTable, isPrismaNextSchema, mapPslDiagnostics } from '@internal/psl-parser';
import type { PslInterpretCapable } from '@internal/psl-parser/interpret';
import { withSeedDiagnostics } from '@internal/psl-parser/interpret';
import { parse } from '@internal/psl-parser/syntax';
import { assertDefined } from '@internal/utils/assertions';
import { ifDefined } from '@internal/utils/defined';
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
        documents: input.documents,
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
      const candidates = [...new Set(context.resolvedInputs)].sort();
      if (candidates.length === 0) {
        return notOk({
          summary: 'No schema files matched the configured contract source',
          diagnostics: [
            {
              code: 'PSL_NO_SCHEMA_FILES_MATCHED',
              message: `No files matched the configured pattern "${schemaPath}"`,
              sourceId: schemaPath,
            },
          ],
        });
      }

      const readDiagnostics: ContractSourceDiagnostic[] = [];
      const members: { readonly path: string; readonly text: string }[] = [];
      const undirected: string[] = [];
      for (const path of candidates) {
        let text: string;
        try {
          text = await readFile(path, 'utf-8');
        } catch (error) {
          const message = String(error);
          readDiagnostics.push({ code: 'PSL_SCHEMA_READ_FAILED', message, sourceId: path });
          continue;
        }
        if (isPrismaNextSchema(text)) {
          members.push({ path, text });
        } else {
          undirected.push(path);
        }
      }

      if (members.length === 0) {
        if (undirected.length === 0) {
          return notOk({
            summary: 'Failed to read Prisma schema files',
            diagnostics: readDiagnostics,
          });
        }
        return notOk({
          summary: 'No schema file carries the "// use prisma-8" directive',
          diagnostics: [
            ...readDiagnostics,
            {
              code: 'PSL_NO_OPTED_IN_SCHEMA_FILES',
              message: `None of the matched files carry the "// use prisma-8" directive: ${undirected.join(', ')}`,
              sourceId: schemaPath,
            },
          ],
        });
      }

      const parsed = members.map(({ path, text }) => parse(text, path));
      const documents = parsed.map(({ document }) => document);
      const [firstSources, ...restSources] = parsed.map(({ sources }) => sources);
      assertDefined(firstSources, 'mongoContract requires at least one parsed schema file');
      const sources = firstSources.merge(...restSources);
      const { symbolTable, diagnostics: symbolTableDiagnostics } = buildSymbolTable({
        documents,
        sources,
        pslBlockDescriptors: context.authoringContributions.pslBlockDescriptors,
      });

      // Do not short-circuit on provider-level diagnostics; recovered CST can
      // still produce interpreter diagnostics in the same response.
      const seedDiagnostics = [
        ...readDiagnostics,
        ...mapPslDiagnostics(
          [...parsed.flatMap(({ diagnostics }) => diagnostics), ...symbolTableDiagnostics],
          sources,
        ),
      ];

      return withSeedDiagnostics(
        this.interpret({ documents, sources, symbolTable }, context),
        seedDiagnostics,
      );
    },
  };

  return {
    source,
    ...ifDefined('output', options?.output),
  };
}
