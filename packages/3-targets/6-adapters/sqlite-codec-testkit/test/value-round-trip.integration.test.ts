import { DatabaseSync, type SQLInputValue } from 'node:sqlite';
import {
  type CodecCallContext,
  CodecImpl,
  type CodecInstanceContext,
  type DataTypeValue,
} from '@internal/framework-components/codec';
import { CastExpr, FunctionCallExpr, type ProjectionExpr } from '@internal/sql-relational-core/ast';
import type { AnySqliteCodecDescriptor } from '@internal/target-sqlite/codec-descriptor';
import { SqliteCodecDescriptor } from '@internal/target-sqlite/codec-descriptor';
import { sqliteCodecDescriptorRegistry } from '@internal/target-sqlite/codecs';
import { sqliteText } from '@internal/target-sqlite/data-types';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { ConformanceConnection } from '../src/index';
import { runSqliteCodecProjection } from '../src/index';

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

class MarkingTextDescriptor extends SqliteCodecDescriptor<void> {
  protected override jsonProjection(expression: ProjectionExpr): ProjectionExpr {
    return expression;
  }
  override readonly dataType = sqliteText.id;
  override readonly codecId = 'test/marking-text@1';
  override readonly traits = [] as const;
  override readonly paramsSchema = undefined;
  override factory(): (ctx: CodecInstanceContext) => MarkingTextCodec {
    return () => new MarkingTextCodec(this, sqliteText);
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
class UpperCasingTextDescriptor extends SqliteCodecDescriptor<void> {
  protected override jsonProjection(expression: ProjectionExpr): ProjectionExpr {
    return FunctionCallExpr.of('upper', [expression]);
  }
  override readonly dataType = sqliteText.id;
  override readonly codecId = 'test/upper-casing-text@1';
  override readonly traits = [] as const;
  override readonly paramsSchema = undefined;
  override factory(): (ctx: CodecInstanceContext) => TextCodec {
    return () => new TextCodec(this, sqliteText);
  }
}

/** `sqlite/bigint@1` with a projection that adds one, so the projected value is not the value written. */
function offByOneBigintDescriptor(): AnySqliteCodecDescriptor {
  const bigint = sqliteCodecDescriptorRegistry.descriptorFor('sqlite/bigint@1');
  if (bigint === undefined) throw new Error('sqlite/bigint@1 is not registered');
  return Object.assign(Object.create(bigint), {
    projectJson: (expression: ProjectionExpr) =>
      CastExpr.as(FunctionCallExpr.of('add_one', [expression]), 'TEXT'),
  });
}

describe('the harness checks that a value comes back from the application value', () => {
  let database: DatabaseSync | undefined;
  let connection: ConformanceConnection | undefined;

  beforeAll(() => {
    database = new DatabaseSync(':memory:');
    connection = {
      query: async (sql, params) =>
        database!.prepare(sql).all(...((params ?? []) as SQLInputValue[])),
    };
  });

  afterAll(() => {
    database?.close();
  });

  it('fails a codec whose toDataTypeValue(fromDataTypeValue(v)) is not v', async () => {
    const outcome = await runSqliteCodecProjection(connection!, {
      codecId: 'test/marking-text@1',
      descriptor: new MarkingTextDescriptor(),
      label: 'a value that gains a mark',
      value: 'hello',
      storageType: 'TEXT',
    });

    expect(outcome.failure).toEqual({
      kind: 'value-round-trip',
      detail: 'toDataTypeValue(fromDataTypeValue(v)) is not v: "hello" came back as "hello!"',
    });
  });

  it('fails a codec whose fromWire reads the projected value to another value than the row', async () => {
    const outcome = await runSqliteCodecProjection(connection!, {
      codecId: 'test/upper-casing-text@1',
      descriptor: new UpperCasingTextDescriptor(),
      label: 'a projection that changes the text',
      value: 'hello',
      storageType: 'TEXT',
    });

    expect(outcome.failure).toEqual({
      kind: 'mismatch',
      detail: "fromWire read the projected 'HELLO' as 'HELLO' and the row's 'hello' as 'hello'",
    });
  });

  it('checks the projection of a value the driver cannot read as a row', async () => {
    database!.function('add_one', { useBigIntArguments: true }, (value) =>
      typeof value === 'bigint' ? value + 1n : null,
    );
    const outcome = await runSqliteCodecProjection(connection!, {
      codecId: 'sqlite/bigint@1',
      descriptor: offByOneBigintDescriptor(),
      label: 'an integer past 2^53 projected off by one',
      value: 9007199254740993n,
      storageType: 'INTEGER',
    });

    expect(outcome.failure).toEqual({
      kind: 'mismatch',
      detail:
        "fromWire read the projected '9007199254740994' as 9007199254740994n for an application value of 9007199254740993n",
    });
  });
});
