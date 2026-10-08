import postgresControlDriverDescriptor from '@internal/driver-postgres/control';
import {
  type CodecCallContext,
  CodecImpl,
  type CodecInstanceContext,
  type DataTypeValue,
} from '@internal/framework-components/codec';
import type { ProjectionExpr } from '@internal/sql-relational-core/ast';
import { PostgresCodecDescriptor } from '@internal/target-postgres/codec-descriptor';
import { pgText } from '@internal/target-postgres/data-types';
import { createDevDatabase, timeouts } from '@repo/test-utils';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { ConformanceConnection } from '../src/index';
import { runPostgresCodecProjection } from '../src/index';

/** A text codec whose application value gains a mark on the way in, so a value does not come back as it went. */
class MarkingTextCodec extends CodecImpl<'test/marking-text@1', readonly [], string, string> {
  fromDataTypeValue(value: DataTypeValue<string>): string {
    return `${value.value}!`;
  }
  toDataTypeValue(input: string): DataTypeValue {
    return this.dataTypeValueOf(input);
  }
  async fromWire(wire: string, _ctx: CodecCallContext): Promise<string> {
    return wire;
  }
  async toWire(input: string, _ctx: CodecCallContext): Promise<string> {
    return input;
  }
}

class MarkingTextDescriptor extends PostgresCodecDescriptor<void> {
  protected override jsonProjection(expression: ProjectionExpr): ProjectionExpr {
    return expression;
  }
  override readonly dataType = pgText.id;
  override readonly codecId = 'test/marking-text@1';
  override readonly traits = [] as const;
  override readonly paramsSchema = undefined;
  override factory(): (ctx: CodecInstanceContext) => MarkingTextCodec {
    return () => new MarkingTextCodec(this, pgText);
  }
}

describe('the harness checks that a value comes back from the application value', {
  concurrent: false,
}, () => {
  let database: Awaited<ReturnType<typeof createDevDatabase>> | undefined;
  let driver: Awaited<ReturnType<typeof postgresControlDriverDescriptor.create>> | undefined;
  let connection: ConformanceConnection | undefined;

  beforeAll(async () => {
    database = await createDevDatabase();
    driver = await postgresControlDriverDescriptor.create(database.connectionString);
    connection = { query: async (sql, params) => (await driver!.query(sql, params)).rows };
  }, timeouts.spinUpPpgDev);

  afterAll(async () => {
    await driver?.close();
    await database?.close();
  }, timeouts.spinUpPpgDev);

  it(
    'fails a codec whose toDataTypeValue(fromDataTypeValue(v)) is not v',
    async () => {
      const outcome = await runPostgresCodecProjection(connection!, {
        codecId: 'test/marking-text@1',
        descriptor: new MarkingTextDescriptor(),
        label: 'a value that gains a mark',
        value: 'hello',
      });

      expect(outcome.failure).toEqual({
        kind: 'value-round-trip',
        detail: 'toDataTypeValue(fromDataTypeValue(v)) is not v: "hello" came back as "hello!"',
      });
    },
    timeouts.spinUpPpgDev,
  );
});
