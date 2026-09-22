import { ormConfigSection } from '@internal/config-loader';
import type { CoreSchemaView, SchemaTreeNode } from '@internal/framework-components/control';
import { ifDefined } from '@internal/utils/defined';
import type { Block, Presentations, Span, TreeNode } from '@prisma/cli-engine';
import { notOk, ok } from '@prisma/cli-engine/protocol';
import { createControlClient } from '../../control-api/client';
import type { CreateControlClient } from '../../control-api/types';
import {
  CliStructuredError,
  errorDatabaseConnectionRequired,
  errorDriverRequired,
  errorUnexpected,
} from '../../utils/cli-errors';
import { closeQuietly, maskConnectionUrl, sanitizeErrorMessage } from '../../utils/command-helpers';
import { defineOrmCommand } from '../define-command';
import { dbFlag } from '../flags';
import { normalizeError } from '../normalize-error';
import { controlProgressReporter } from '../progress';

interface SchemaDocument {
  readonly ok: true;
  readonly summary: string;
  readonly target: { readonly familyId: string; readonly id: string };
  readonly schema: unknown;
  readonly meta: { readonly dbUrl?: string };
  readonly timings: { readonly total: number };
}

const SUMMARY = 'Schema read successfully';

/**
 * A leading keyword and the name it introduces: `<keyword> <name>`, or
 * `<keyword>: <name>`. The keyword recedes and the name is the identifier.
 */
function keywordThenName(label: string): readonly Span[] | undefined {
  const colon = label.match(/^(.+?):\s*(\S.*)$/);
  if (colon?.[1] !== undefined && colon[2] !== undefined) {
    return [
      { text: colon[1], tone: 'muted' },
      { text: ': ' },
      { text: colon[2], tone: 'identifier' },
    ];
  }
  const spaced = label.match(/^(\S.*\S|\S+)\s+(\S+)$/);
  if (spaced?.[1] !== undefined && spaced[2] !== undefined) {
    return [
      { text: spaced[1], tone: 'muted' },
      { text: ' ' },
      { text: spaced[2], tone: 'identifier' },
    ];
  }
  return undefined;
}

/** `<name>: <detail> (<qualifier>)` — the name leads and the qualifier recedes. */
function namedDetail(label: string): readonly Span[] | undefined {
  const parts = label.match(/^([^:]+):\s*(.+)$/);
  if (parts?.[1] === undefined || parts[2] === undefined) {
    return undefined;
  }
  const [, name, rest] = parts;
  const qualified = rest.match(/^([^\s(]+)\s*(\([^)]+\))$/);
  if (qualified?.[1] !== undefined && qualified[2] !== undefined) {
    return [
      { text: name, tone: 'identifier' },
      { text: `: ${qualified[1]} ` },
      { text: qualified[2], tone: 'muted' },
    ];
  }
  return [{ text: name, tone: 'identifier' }, { text: `: ${rest}` }];
}

/** `<name> <rest>` — the name leads and the prose behind it recedes. */
function nameThenProse(label: string): readonly Span[] | undefined {
  const parts = label.match(/^(\S+)\s+(\S.*)$/);
  if (parts?.[1] === undefined || parts[2] === undefined) {
    return undefined;
  }
  return [{ text: parts[1], tone: 'identifier' }, { text: ' ' }, { text: parts[2], tone: 'muted' }];
}

/**
 * What a schema node's label means, said in tones.
 *
 * The families phrase these labels themselves, so the shapes recognised here
 * are positional (`<keyword> <name>`, `<name>: <detail>`) rather than a list of
 * words: a family that renames a keyword keeps its colouring, and no family's
 * vocabulary is written down in the framework layer.
 */
function labelSpans(node: SchemaTreeNode): readonly Span[] {
  switch (node.kind) {
    case 'root':
      return [{ text: node.label, tone: 'emphasis' }];
    case 'collection':
      return [{ text: node.label, tone: 'muted' }];
    case 'entity':
    case 'index':
      return keywordThenName(node.label) ?? [{ text: node.label, tone: 'identifier' }];
    case 'field':
      return namedDetail(node.label) ?? [{ text: node.label }];
    case 'dependency':
      return nameThenProse(node.label) ?? [{ text: node.label, tone: 'identifier' }];
    default:
      return [{ text: node.label }];
  }
}

function treeNode(node: SchemaTreeNode): TreeNode {
  return {
    label: labelSpans(node),
    ...ifDefined(
      'children',
      node.children === undefined || node.children.length === 0
        ? undefined
        : node.children.map(treeNode),
    ),
  };
}

function schemaPresentations(inputs: {
  readonly document: SchemaDocument;
  readonly schemaView: CoreSchemaView | undefined;
  readonly database: string | undefined;
}): Presentations {
  const { document, schemaView, database } = inputs;
  return {
    stdout: () => [],
    next: () => [],
    human: (): readonly Block[] => [
      ...(database === undefined
        ? []
        : [
            {
              kind: 'fields' as const,
              rail: true,
              rows: [{ label: 'database', value: database }],
            },
          ]),
      schemaView === undefined
        ? { kind: 'summary', status: 'ok', text: document.summary }
        : { kind: 'tree', roots: [treeNode(schemaView.root)] },
    ],
    json: () => document,
  };
}

export function createDbSchemaCommand(createClient: CreateControlClient) {
  return defineOrmCommand({
    help: {
      summary: 'Inspect the live database schema',
      description:
        'Reads the live database schema and prints it as a tree, or as the result\n' +
        'document with --json. Always read-only: it never writes a file and never\n' +
        'changes the database.',
      examples: ['db schema', 'db schema --db $DATABASE_URL', 'db schema --json'],
    },
    args: { flags: { db: dbFlag } },
    needs: { config: ormConfigSection },
    handler: async (args, ctx) => {
      const startedAt = Date.now();
      const dbConnection = args.flags.db ?? ctx.config.db?.connection;
      if (dbConnection === undefined) {
        return notOk(
          normalizeError(
            errorDatabaseConnectionRequired({
              why: 'Database connection is required for db schema (set db.connection in prisma.config.ts, or pass --db <url>)',
              commandName: 'db schema',
              missingFlags: ['--db'],
            }),
          ),
        );
      }
      if (ctx.config.driver === undefined) {
        return notOk(
          normalizeError(errorDriverRequired({ why: 'Config.driver is required for db schema' })),
        );
      }

      const client = createClient({
        family: ctx.config.family,
        target: ctx.config.target,
        adapter: ctx.config.adapter,
        driver: ctx.config.driver,
        extensions: ctx.config.extensions ?? [],
      });

      let schema: unknown;
      let schemaView: CoreSchemaView | undefined;
      try {
        schema = await client.introspect({
          connection: dbConnection,
          onProgress: controlProgressReporter(ctx.report),
        });
        schemaView = client.toSchemaView(schema);
      } catch (error) {
        if (CliStructuredError.is(error)) {
          return notOk(normalizeError(error));
        }
        const safeMessage = sanitizeErrorMessage(
          error instanceof Error ? error.message : String(error),
          typeof dbConnection === 'string' ? dbConnection : undefined,
        );
        return notOk(
          normalizeError(
            errorUnexpected(safeMessage, {
              why: `Unexpected error during db schema: ${safeMessage}`,
            }),
          ),
        );
      } finally {
        await closeQuietly(client);
      }

      const database =
        typeof dbConnection === 'string' ? maskConnectionUrl(dbConnection) : undefined;
      const document: SchemaDocument = {
        ok: true,
        summary: SUMMARY,
        target: { familyId: ctx.config.family.familyId, id: ctx.config.target.targetId },
        schema,
        meta: { ...ifDefined('dbUrl', database) },
        timings: { total: Date.now() - startedAt },
      };

      return ok(
        ctx.present({ data: document }, schemaPresentations({ document, schemaView, database })),
      );
    },
  });
}

export const dbSchemaCommand = createDbSchemaCommand(createControlClient);
