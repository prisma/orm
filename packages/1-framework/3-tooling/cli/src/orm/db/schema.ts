import { ormConfigSection } from '@internal/config-loader';
import type {
  CoreSchemaView,
  SchemaLabelPart,
  SchemaLabelPartRole,
  SchemaTreeNode,
} from '@internal/framework-components/control';
import { ifDefined } from '@internal/utils/defined';
import type { Block, Presentations, Span, TreeNode } from '@prisma/cli-engine';
import { noDataLines } from '@prisma/cli-engine';
import { notOk, ok } from '@prisma/cli-engine/protocol';
import { createControlClient } from '../../control-api/client';
import { errorFromCaught } from '../../control-api/operations/caught-errors';
import type { CreateControlClient } from '../../control-api/types';
import { errorDatabaseConnectionRequired, errorDriverRequired } from '../../utils/cli-errors';
import { closeQuietly, maskConnectionUrl } from '../../utils/command-helpers';
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

const PART_TONES = {
  title: 'emphasis',
  keyword: 'muted',
  name: 'identifier',
  detail: 'muted',
} as const satisfies Record<SchemaLabelPartRole, Span['tone']>;

function partSpan(part: SchemaLabelPart): Span {
  return part.role === undefined
    ? { text: part.text }
    : { text: part.text, tone: PART_TONES[part.role] };
}

/** A node's label in tones, taken from the parts its family marked. */
function labelSpans(node: SchemaTreeNode): readonly Span[] {
  return node.labelParts.map(partSpan);
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
    stdout: noDataLines(
      'Data lines are not defined: the schema is a tree whose shape depends on the database family. --json carries it.',
    ),
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
        return notOk(
          normalizeError(
            errorFromCaught(error, (message) => `Unexpected error during db schema: ${message}`, {
              connection: typeof dbConnection === 'string' ? dbConnection : undefined,
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
