import { DatabaseSync, type SQLInputValue } from 'node:sqlite';
import {
  type CodecCallContext,
  CodecImpl,
  type CodecInstanceContext,
  type DataTypeValue,
} from '@internal/framework-components/codec';
import type { ProjectionExpr } from '@internal/sql-relational-core/ast';
import { SqliteCodecDescriptor } from '@internal/target-sqlite/codec-descriptor';
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
});
