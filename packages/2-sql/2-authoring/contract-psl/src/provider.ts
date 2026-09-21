import { readFile } from 'node:fs/promises';
import type { ContractConfig } from '@internal/config/config-types';
import type { ControlPolicy } from '@internal/contract/types';
import { collectScalarTypeConstructors } from '@internal/framework-components/authoring';
import type { ExtensionPackRef, TargetPackRef } from '@internal/framework-components/components';
import { buildSymbolTable, mapPslDiagnostics } from '@internal/psl-parser';
import type { PslInterpretCapable } from '@internal/psl-parser/interpret';
import { withSeedDiagnostics } from '@internal/psl-parser/interpret';
import { parse } from '@internal/psl-parser/syntax';
import type { SqlNamespaceBase, SqlNamespaceInput } from '@internal/sql-contract/types';
import { applySqlSpecifierControlPolicy } from '@internal/sql-contract-ts/contract-builder';
import { ifDefined } from '@internal/utils/defined';
import { InternalError } from '@internal/utils/internal-error';
import { notOk, ok } from '@internal/utils/result';
import { basename, extname } from 'pathe';

import { interpretPslDocumentToSqlContract } from './interpreter';
import type { ColumnDescriptor } from './psl-column-resolution';

export interface PrismaContractOptions {
  readonly output?: string;
  readonly target: TargetPackRef<'sql', string>;
  readonly composedExtensionPackRefs?: readonly ExtensionPackRef<'sql', string>[];
  readonly createNamespace: (input: SqlNamespaceInput) => SqlNamespaceBase;
  readonly defaultControlPolicy?: ControlPolicy;
  /** The target's default codec ids for an `enum` block that omits `@@type`. */
  readonly enumInferenceCodecs?: { readonly text: string; readonly int: string };
}

/**
 * Derives the emit output path from the schema input path so artefacts land
 * colocated with the source (e.g. `src/contract/schema.prisma` →
 * `src/contract/contract.json`). The provider owns this because it is the
 * only layer that knows the input path; the upstream `normalizeContractConfig`
 * default is a last-resort fallback for providers that don't carry one.
 */
function defaultOutputFromSchemaPath(schemaPath: string): string {
  const ext = extname(schemaPath);
  if (ext.length === 0) return `${schemaPath}.json`;
  const base = schemaPath.slice(0, -ext.length);
  // PSL schemas commonly use `schema.prisma`; the emitted JSON is called
  // `contract.json` to mirror the rest of the toolchain, not `schema.json`.
  // Match only the exact basename `schema` so files like `my-schema.prisma`
  // are not silently rewritten to `my-contract.json`.
  if (basename(base) === 'schema') {
    return `${base.slice(0, -'schema'.length)}contract.json`;
  }
  return `${base}.json`;
}

export function prismaContract(schemaPath: string, options: PrismaContractOptions): ContractConfig {
  const source: PslInterpretCapable = {
    format: 'psl',
    inputs: [schemaPath],
    interpret(input, context) {
      const scalarColumnDescriptors: ReadonlyMap<string, ColumnDescriptor> =
        collectScalarTypeConstructors(context.authoringContributions.type);
      return interpretPslDocumentToSqlContract({
        document: input.document,
        symbolTable: input.symbolTable,
        sources: input.sources,
        seedDiagnostics: [],
        target: options.target,
        authoringContributions: context.authoringContributions,
        scalarColumnDescriptors,
        ...ifDefined(
          'composedExtensions',
          context.composedExtensions.length > 0 ? [...context.composedExtensions] : undefined,
        ),
        composedExtensionContracts: context.composedExtensionContracts,
        ...ifDefined(
          'composedExtensionPackRefs',
          options.composedExtensionPackRefs?.length ? options.composedExtensionPackRefs : undefined,
        ),
        controlMutationDefaults: context.controlMutationDefaults,
        createNamespace: options.createNamespace,
        capabilities: context.capabilities,
        codecLookup: context.codecLookup,
        dataTypeLookup: context.dataTypeLookup,
        ...ifDefined('enumInferenceCodecs', options.enumInferenceCodecs),
      });
    },
    async load(context) {
      const [absoluteSchemaPath] = context.resolvedInputs;
      if (absoluteSchemaPath === undefined) {
        throw new InternalError(
          'prismaContract: context.resolvedInputs is empty. The CLI config loader should populate it positional-matched with source.inputs.',
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

      const interpreted = withSeedDiagnostics(
        this.interpret({ document, sources, symbolTable }, context),
        seedDiagnostics,
      );
      if (!interpreted.ok) {
        return interpreted;
      }

      // The specifier's policy lands after the contract is built, so the
      // funnel runs here rather than at the emission site: a table that only
      // becomes non-managed now must still shed its derived checks.
      return ok(
        applySqlSpecifierControlPolicy(
          interpreted.value,
          options.defaultControlPolicy,
          options.createNamespace,
        ),
      );
    },
  };

  return {
    source,
    output: options.output ?? defaultOutputFromSchemaPath(schemaPath),
  };
}
