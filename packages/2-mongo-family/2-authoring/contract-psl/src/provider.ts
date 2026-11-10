import { readFile } from 'node:fs/promises';
import type { ContractConfig, ContractSourceDiagnostic } from '@internal/config/config-types';
import type { ExtensionPackRef, TargetPackRef } from '@internal/framework-components/components';
import {
  buildSymbolTable,
  createBinder,
  isPrismaNextSchema,
  mapPslDiagnostics,
} from '@internal/psl-parser';
import type { PslInterpretCapable } from '@internal/psl-parser/interpret';
import { withSeedDiagnostics } from '@internal/psl-parser/interpret';
import { parse } from '@internal/psl-parser/syntax';
import { assertDefined } from '@internal/utils/assertions';
import { ifDefined } from '@internal/utils/defined';
import { notOk } from '@internal/utils/result';
import { structuredError } from '@internal/utils/structured-error';

import { interpretPslDocumentToMongoContract } from './interpreter';

export interface MongoContractOptions {
  /** The target and extension packs of the stack, which the contract records. */
  readonly target: TargetPackRef<'mongo', string>;
  readonly extensionPacks?: Readonly<Record<string, ExtensionPackRef<string, string>>>;
  readonly output?: string;
  /** The target's default codec ids for an `enum` block that omits `@@type`. */
  readonly enumInferenceCodecs?: { readonly text: string; readonly int: string };
}

function hasTarget(options: MongoContractOptions | undefined): boolean {
  return options?.target !== undefined;
}

export function mongoContract(schemaPath: string, options: MongoContractOptions): ContractConfig {
  if (!hasTarget(options)) {
    throw structuredError(
      'CONTRACT.ARGUMENT_INVALID',
      `mongoContract("${schemaPath}") needs the MongoDB target pack, which the contract records.`,
      {
        fix: "Pass { target: mongoTargetPack }, with mongoTargetPack imported from '@prisma/orm-mongo/target/pack', or name the schema in defineConfig({ contract }) from '@prisma/orm-mongo/config', which passes it for you.",
        meta: { schemaPath, reason: 'target-pack-missing' },
      },
    );
  }
  const source: PslInterpretCapable = {
    format: 'psl',
    inputs: [schemaPath],
    interpret(input, context) {
      return interpretPslDocumentToMongoContract({
        documents: input.documents,
        symbolTable: input.symbolTable,
        sources: input.sources,
        binder: input.binder,
        target: options.target,
        ...ifDefined('extensionPacks', options.extensionPacks),
        seedDiagnostics: [],
        defaultFunctionRegistry: context.controlMutationDefaults.defaultFunctionRegistry,
        generatorFunctions: context.generatorFunctions,
        dataTypes: context.dataTypes,
        codecLookup: context.codecLookup,
        authoringContributions: context.authoringContributions,
        ...ifDefined('enumInferenceCodecs', options.enumInferenceCodecs),
        ...ifDefined('reportWarning', context.reportWarning),
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

      // Do not short-circuit on provider-level diagnostics; recovered CST can
      // still produce interpreter diagnostics in the same response.
      const seedDiagnostics = [
        ...readDiagnostics,
        ...mapPslDiagnostics(
          parsed.flatMap(({ diagnostics }) => diagnostics),
          sources,
        ),
      ];

      const { symbolTable, diagnostics: symbolTableDiagnostics } = buildSymbolTable({
        documents,
        sources,
        defaultNamespaceId: context.defaultNamespaceId,
      });
      const { binder, diagnostics: binderDiagnostics } = createBinder({
        symbolTable,
        sources,
        context,
      });
      return withSeedDiagnostics(
        this.interpret({ documents, sources, symbolTable, binder }, context),
        [
          ...seedDiagnostics,
          ...mapPslDiagnostics([...symbolTableDiagnostics, ...binderDiagnostics], sources),
        ],
      );
    },
  };

  return {
    source,
    ...ifDefined('output', options.output),
  };
}
