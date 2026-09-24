import { readFile } from 'node:fs/promises';
import type { ContractConfig, ContractSourceDiagnostic } from '@internal/config/config-types';
import type { ControlPolicy } from '@internal/contract/types';
import { collectScalarTypeConstructors } from '@internal/framework-components/authoring';
import type { ExtensionPackRef, TargetPackRef } from '@internal/framework-components/components';
import { buildSymbolTable, isPrismaNextSchema, mapPslDiagnostics } from '@internal/psl-parser';
import type { PslInterpretCapable } from '@internal/psl-parser/interpret';
import { withSeedDiagnostics } from '@internal/psl-parser/interpret';
import { parse } from '@internal/psl-parser/syntax';
import type { SqlNamespaceBase, SqlNamespaceInput } from '@internal/sql-contract/types';
import { applySqlSpecifierControlPolicy } from '@internal/sql-contract-ts/contract-builder';
import { assertDefined } from '@internal/utils/assertions';
import { ifDefined } from '@internal/utils/defined';
import { notOk, ok } from '@internal/utils/result';
import { basename, extname } from 'pathe';
import { isDynamicPattern } from 'tinyglobby';

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
 * The directory portion of `pattern` before its first glob-magic segment,
 * joined back with `/` (e.g. a `prisma` directory holding a recursive
 * `.prisma` glob derives `./prisma`). A rootless pattern with no static
 * segments yields `''`.
 */
function staticPrefixDirectory(pattern: string): string {
  const staticSegments: string[] = [];
  for (const segment of pattern.replaceAll('\\', '/').split('/')) {
    if (isDynamicPattern(segment)) break;
    staticSegments.push(segment);
  }
  return staticSegments.join('/');
}

/**
 * Derives the emit output path from the schema input path so artefacts land
 * colocated with the source (e.g. `src/contract/schema.prisma` →
 * `src/contract/contract.json`). A glob-shaped path derives from its static
 * prefix directory instead (a recursive glob under `prisma` derives
 * `./prisma/contract.json`). The provider owns this because it is the only
 * layer that knows the input path; the upstream `normalizeContractConfig`
 * default is a last-resort fallback for providers that don't carry one.
 */
function defaultOutputFromSchemaPath(schemaPath: string): string {
  if (isDynamicPattern(schemaPath)) {
    const prefix = staticPrefixDirectory(schemaPath);
    return prefix.length === 0 ? 'contract.json' : `${prefix}/contract.json`;
  }
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
        documents: input.documents,
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
      assertDefined(firstSources, 'prismaContract requires at least one parsed schema file');
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

      const interpreted = withSeedDiagnostics(
        this.interpret({ documents, sources, symbolTable }, context),
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
