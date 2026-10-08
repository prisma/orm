import {
  type CodecCallContext,
  CodecImpl,
  type CodecInstanceContext,
  type DataTypeValue,
} from '@internal/framework-components/codec';
import { FunctionCallExpr, type ProjectionExpr } from '@internal/sql-relational-core/ast';
import { PostgresCodecDescriptor } from '@internal/target-postgres/codec-descriptor';
import { pgText } from '@internal/target-postgres/data-types';
import { createDevDatabase, timeouts } from '@repo/test-utils';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { ConformanceConnection } from '../src/index';
import { runPostgresCodecProjection } from '../src/index';
import { connectRuntimeDriver } from './runtime-connection';

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

class TextCodec extends CodecImpl<'test/upper-casing-text@1', readonly [], string, string> {
  fromDataTypeValue(value: DataTypeValue<string>): string {
    return value.value;
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

/** A text codec whose projection changes the text, so the projected value reads to another value than the row. */
class UpperCasingTextDescriptor extends PostgresCodecDescriptor<void> {
  protected override jsonProjection(expression: ProjectionExpr): ProjectionExpr {
    return FunctionCallExpr.of('upper', [expression]);
  }
  override readonly dataType = pgText.id;
  override readonly codecId = 'test/upper-casing-text@1';
  override readonly traits = [] as const;
  override readonly paramsSchema = undefined;
  override factory(): (ctx: CodecInstanceContext) => TextCodec {
    return () => new TextCodec(this, pgText);
  }
}

describe('the harness checks that a value comes back from the application value', {
  concurrent: false,
}, () => {
  let database: Awaited<ReturnType<typeof createDevDatabase>> | undefined;
  let runtime: Awaited<ReturnType<typeof connectRuntimeDriver>> | undefined;
  let connection: ConformanceConnection | undefined;

  beforeAll(async () => {
    database = await createDevDatabase();
    runtime = await connectRuntimeDriver(database.connectionString);
    connection = runtime.connection;
  }, timeouts.spinUpPpgDev);

  afterAll(async () => {
    await runtime?.close();
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

  it(
    'fails a codec whose fromWire reads the projected value to another value than the row',
    async () => {
      const outcome = await runPostgresCodecProjection(connection!, {
        codecId: 'test/upper-casing-text@1',
        descriptor: new UpperCasingTextDescriptor(),
        label: 'a projection that changes the text',
        value: 'hello',
      });

      expect(outcome.failure).toEqual({
        kind: 'mismatch',
        detail: "fromWire read the projected 'HELLO' as 'HELLO' and the row's 'hello' as 'hello'",
      });
    },
    timeouts.spinUpPpgDev,
  );
});
