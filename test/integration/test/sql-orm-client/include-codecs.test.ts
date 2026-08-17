import {
  byteaColumn,
  int4Column,
  timestampTemporalColumn,
  timestamptzTemporalColumn,
} from '@internal/adapter-postgres/column-types';
import postgresAdapter from '@internal/adapter-postgres/runtime';
import type { JsonValue } from '@internal/contract/types';
import {
  type CodecCallContext,
  CodecDescriptorImpl,
  CodecImpl,
  type CodecInstanceContext,
  type ColumnTypeDescriptor,
  voidParamsSchema,
} from '@internal/framework-components/codec';
import { defineContract, field, model, rel } from '@internal/postgres/contract-builder';
import { Collection } from '@internal/sql-orm-client';
import {
  createExecutionContext,
  createSqlExecutionStack,
  type SqlRuntimeExtensionDescriptor,
} from '@internal/sql-runtime';
import { postgresCodec } from '@internal/target-postgres/codec-descriptor';
import postgresTarget from '@internal/target-postgres/runtime';
import { describe, expect, it } from 'vitest';
import { timeouts, withCollectionRuntime } from './integration-helpers';
import type { PgIntegrationRuntime } from './runtime-helpers';

const TEST_INCLUDED_TEXT_CODEC_ID = 'test/included-text@1' as const;
const SENSITIVE_DATABASE_VALUE = 'credential=do-not-expose';

class IncludedTextCodec extends CodecImpl<
  typeof TEST_INCLUDED_TEXT_CODEC_ID,
  readonly ['textual'],
  string,
  string
> {
  async encode(value: string, _ctx: CodecCallContext): Promise<string> {
    return value;
  }

  async decode(wire: string, _ctx: CodecCallContext): Promise<string> {
    return wire;
  }

  encodeJson(value: string): JsonValue {
    return value;
  }

  decodeJson(json: JsonValue): string {
    if (typeof json !== 'string') {
      throw new TypeError(`expected included text database JSON value, got ${typeof json}`);
    }
    if (json === SENSITIVE_DATABASE_VALUE) {
      throw new Error('intentional included text decode failure');
    }
    return `decoded-json:${json}`;
  }
}

class IncludedTextDescriptor extends CodecDescriptorImpl<void> {
  override readonly codecId = TEST_INCLUDED_TEXT_CODEC_ID;
  override readonly traits = ['textual'] as const;
  override readonly targetTypes = ['text'] as const;
  override readonly paramsSchema = voidParamsSchema;

  override factory(): (ctx: CodecInstanceContext) => IncludedTextCodec {
    return () => new IncludedTextCodec(this);
  }
}

/**
 * A PostgreSQL extension contributing a column codec has to say how that
 * column reaches JSON, since the renderer asks the descriptor rather than
 * assuming. This one stores and projects text unchanged.
 */
const includedTextDescriptor = postgresCodec(new IncludedTextDescriptor(), {
  nativeType: () => 'text',
  jsonProjection: (expression) => expression,
});
const includedTextColumn = {
  codecId: TEST_INCLUDED_TEXT_CODEC_ID,
  nativeType: 'text',
} as const satisfies ColumnTypeDescriptor;

const includedTextExtension: SqlRuntimeExtensionDescriptor<'postgres'> = {
  kind: 'extension',
  id: 'test-included-text',
  version: '0.0.1',
  familyId: 'sql',
  targetId: 'postgres',
  // The renderer resolves a column's JSON projection out of the assembled
  // descriptor registry, which reads `types.codecTypes.codecDescriptors`.
  types: { codecTypes: { codecDescriptors: [includedTextDescriptor] } },
  codecs: () => [includedTextDescriptor],
  create() {
    return { familyId: 'sql', targetId: 'postgres' };
  },
};

const Project = model('Project', {
  fields: {
    id: field.column(int4Column).id(),
    wrappedDek: field.column(byteaColumn).column('wrapped_dek').optional(),
    deletedAt: field.column(timestampTemporalColumn).column('deleted_at').optional(),
    deletedAtTz: field.column(timestamptzTemporalColumn).column('deleted_at_tz').optional(),
    customText: field.column(includedTextColumn).column('custom_text').optional(),
  },
}).sql({ table: 'codec_projects' });

const Branch = model('Branch', {
  fields: {
    id: field.column(int4Column).id(),
    projectId: field.column(int4Column).column('project_id'),
  },
  relations: {
    project: rel.belongsTo(Project, { from: 'projectId', to: 'id' }),
  },
}).sql({ table: 'codec_branches' });

const contract = defineContract({ models: { Project, Branch } });
const context = createExecutionContext({
  contract,
  stack: createSqlExecutionStack({
    target: postgresTarget,
    adapter: postgresAdapter,
    extensions: [includedTextExtension],
  }),
});

async function setupCodecTables(runtime: PgIntegrationRuntime): Promise<void> {
  await runtime.query('drop table if exists codec_branches');
  await runtime.query('drop table if exists codec_projects');
  await runtime.query(`
    create table codec_projects (
      id integer primary key,
      wrapped_dek bytea,
      deleted_at timestamp,
      deleted_at_tz timestamptz,
      custom_text text
    )
  `);
  await runtime.query(`
    create table codec_branches (
      id integer primary key,
      project_id integer not null
    )
  `);
}

describe('integration/include codecs', () => {
  it(
    'delegates database JSON values to codec.decodeJson',
    async () => {
      await withCollectionRuntime(
        async (runtime) => {
          await setupCodecTables(runtime);
          await runtime.query(`
          insert into codec_projects (id, wrapped_dek, deleted_at, deleted_at_tz, custom_text)
          values (
            10,
            decode('01020304', 'hex'),
            timestamp '2026-07-09 15:23:33.037',
            timestamptz '2026-07-09 15:23:33.037+00',
            'extension value'
          )
        `);
          await runtime.query('insert into codec_branches (id, project_id) values (1, 10)');

          const [databaseJson] = await runtime.query<{
            value: {
              wrappedDek: string;
              deletedAt: string;
              deletedAtTz: string;
              customText: string;
            };
          }>(`
            select json_build_object(
              'wrappedDek', wrapped_dek,
              'deletedAt', deleted_at,
              'deletedAtTz', deleted_at_tz,
              'customText', custom_text
            ) as value
            from codec_projects
            where id = 10
          `);
          expect(databaseJson?.value).toEqual({
            wrappedDek: '\\x01020304',
            deletedAt: '2026-07-09T15:23:33.037',
            deletedAtTz: '2026-07-09T15:23:33.037+00:00',
            customText: 'extension value',
          });

          const branches = new Collection({ runtime, context }, 'Branch', {
            namespaceId: 'public',
          });
          const rows = await branches
            .select('id')
            .include('project', (project) =>
              project.select('wrappedDek', 'deletedAt', 'deletedAtTz', 'customText'),
            )
            .all();

          expect(rows).toEqual([
            {
              id: 1,
              project: {
                wrappedDek: new Uint8Array([1, 2, 3, 4]),
                deletedAt: Temporal.PlainDateTime.from('2026-07-09T15:23:33.037'),
                deletedAtTz: Temporal.Instant.from('2026-07-09T15:23:33.037Z'),
                customText: 'decoded-json:extension value',
              },
            },
          ]);
        },
        contract,
        [includedTextExtension],
      );
    },
    timeouts.spinUpPpgDev,
  );

  it(
    'omits raw database values from include decode errors',
    async () => {
      await withCollectionRuntime(
        async (runtime) => {
          await setupCodecTables(runtime);
          await runtime.query(`
            insert into codec_projects (id, custom_text)
            values (10, '${SENSITIVE_DATABASE_VALUE}')
          `);
          await runtime.query('insert into codec_branches (id, project_id) values (1, 10)');

          const branches = new Collection({ runtime, context }, 'Branch', {
            namespaceId: 'public',
          });
          let decodeError: unknown;
          try {
            await branches
              .select('id')
              .include('project', (project) => project.select('customText'))
              .all();
          } catch (error) {
            decodeError = error;
          }

          expect(decodeError).toMatchObject({
            code: 'RUNTIME.DECODE_FAILED',
            details: {
              table: 'codec_projects',
              column: 'custom_text',
              codec: TEST_INCLUDED_TEXT_CODEC_ID,
            },
          });
          expect(decodeError).not.toHaveProperty('details.wirePreview');
          expect(JSON.stringify(decodeError)).not.toContain(SENSITIVE_DATABASE_VALUE);
        },
        contract,
        [includedTextExtension],
      );
    },
    timeouts.spinUpPpgDev,
  );
});
