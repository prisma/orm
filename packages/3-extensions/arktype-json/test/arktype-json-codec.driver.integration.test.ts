import postgresDriver from '@internal/driver-postgres/runtime';
import type { CodecInstanceContext } from '@internal/framework-components/codec';
import {
  ColumnRef,
  ProjectionItem,
  SelectAst,
  TableSource,
} from '@internal/sql-relational-core/ast';
import {
  buildDecodeContext,
  buildTestContractCodecs,
  decodeRow,
  sqlNativeArrayListDecoder,
} from '@internal/sql-runtime/test/utils';
import { createDevDatabase, timeouts } from '@repo/test-utils';
import { type Type, type } from 'arktype';
import { afterEach, describe, expect, it } from 'vitest';
import { arktypeJsonColumn } from '../src/core/arktype-json-codec';

const SYNTH_CTX: CodecInstanceContext = { name: '<arktype-json-driver-test>' };

describe('arktype-json decoding of values read through the Postgres runtime driver', () => {
  const cleanups: Array<() => Promise<void>> = [];

  afterEach(async () => {
    while (cleanups.length > 0) {
      await cleanups.pop()?.();
    }
  }, timeouts.spinUpPpgDev);

  async function connect() {
    const database = await createDevDatabase();
    const driver = postgresDriver.create();
    cleanups.push(async () => {
      await driver.close();
      await database.close();
    });
    await driver.connect({ kind: 'url', url: database.connectionString });
    return driver;
  }

  async function storeAndDecode(schema: Type<unknown>, values: readonly unknown[]) {
    const driver = await connect();
    await driver.execute({ sql: 'create table payloads (id int primary key, v jsonb)' });
    for (const [id, value] of values.entries()) {
      await driver.execute({
        sql: 'insert into payloads values ($1, $2::jsonb)',
        params: [id, JSON.stringify(value)],
      });
    }

    const codec = arktypeJsonColumn(schema).codecFactory(SYNTH_CTX);
    const decoded: unknown[] = [];
    for await (const row of driver.query<{ v: string }>({
      sql: 'select v from payloads order by id',
      params: [],
    })) {
      decoded.push(await codec.fromWire(row.v, {}));
    }
    return decoded;
  }

  it(
    'decodes stored strings to the exact strings under a string schema',
    async () => {
      const values = ['plain', '123', '{"not":"a document"}'];

      expect(await storeAndDecode(type('string'), values)).toEqual(values);
    },
    timeouts.spinUpPpgDev,
  );

  it(
    'decodes stored documents to objects under an object schema',
    async () => {
      const values = [{ name: 'Widget' }];

      expect(await storeAndDecode(type({ name: 'string' }), values)).toEqual(values);
    },
    timeouts.spinUpPpgDev,
  );

  it(
    'reports wire text that is not JSON with the column it was read from',
    async () => {
      const driver = await connect();
      await driver.execute({ sql: 'create table documents (body text)' });
      await driver.execute({ sql: "insert into documents values ('not json')" });
      const codec = arktypeJsonColumn(type('string')).codecFactory(SYNTH_CTX);
      const ast = SelectAst.from(TableSource.named('documents')).withProjection([
        ProjectionItem.of('body', ColumnRef.of('documents', 'body'), { codecId: codec.id }),
      ]);
      const decodeCtx = buildDecodeContext(ast, buildTestContractCodecs([codec]));
      const rows: Array<Record<string, unknown>> = [];
      for await (const row of driver.query({ sql: 'select body from documents' })) {
        rows.push(row);
      }

      await expect(
        decodeRow(rows[0]!, decodeCtx, {}, sqlNativeArrayListDecoder),
      ).rejects.toMatchObject({
        code: 'RUNTIME.DECODE_FAILED',
        message: expect.stringMatching(
          /^Failed to decode column documents\.body with codec 'arktype\/json@1': .*not valid JSON/,
        ),
        details: { table: 'documents', column: 'body', codec: codec.id, wirePreview: 'not json' },
        cause: expect.any(SyntaxError),
      });
    },
    timeouts.spinUpPpgDev,
  );
});
