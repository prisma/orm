import type { JsonValue } from '@internal/contract/types';
import {
  type CodecCallContext,
  CodecImpl,
  type CodecInstanceContext,
  type ColumnHelperFor,
  type ColumnHelperForStrict,
  column,
  type DataTypeValue,
  renderTsLiteral,
} from '@internal/framework-components/codec';
import type { ExtractCodecTypes, ProjectionExpr } from '@internal/sql-relational-core/ast';
import {
  definePostgresCodecs,
  PostgresCodecDescriptor,
} from '@internal/target-postgres/codec-descriptor';
import { CITEXT_CODEC_ID } from './constants';
import { citextCitext } from './data-types';

export class CitextCodec extends CodecImpl<
  typeof CITEXT_CODEC_ID,
  readonly ['equality', 'order', 'textual'],
  string,
  string
> {
  async toWire(value: string, _ctx: CodecCallContext): Promise<string> {
    return value;
  }
  async fromWire(wire: string, _ctx: CodecCallContext): Promise<string> {
    return wire;
  }
  fromDataTypeValue(value: DataTypeValue<string>): string {
    return value.value;
  }
  toDataTypeValue(input: string): DataTypeValue {
    return this.dataTypeValueOf(input);
  }
}

/**
 * The traits are a text codec's. PostgreSQL compares, orders and matches citext values without regard to case.
 */
export class CitextDescriptor extends PostgresCodecDescriptor<void> {
  protected override jsonProjection(expression: ProjectionExpr): ProjectionExpr {
    return expression;
  }
  override readonly dataType = citextCitext.id;
  override readonly codecId = CITEXT_CODEC_ID;
  override readonly jsonType = 'string' as const;
  override readonly traits = ['equality', 'order', 'textual'] as const;
  override readonly enumRefusal =
    'A CHECK on a citext column compares without regard to case, so it admits a value that differs from a member only in case, and that value reads back as no member. No enum can use a citext codec; use a text enum instead.';
  override readonly paramsSchema = undefined;
  override renderValueLiteral(value: JsonValue): string | undefined {
    return renderTsLiteral(value);
  }
  override factory(): (ctx: CodecInstanceContext) => CitextCodec {
    return () => new CitextCodec(this, citextCitext);
  }
}

export const citextDescriptor = new CitextDescriptor();

export const citextColumn = () =>
  column(citextDescriptor.factory(), citextDescriptor.codecId, undefined);

citextColumn satisfies ColumnHelperFor<CitextDescriptor>;
citextColumn satisfies ColumnHelperForStrict<CitextDescriptor>;

const codecDescriptorMap = {
  citext: citextDescriptor,
} as const;

export type CodecTypes = ExtractCodecTypes<typeof codecDescriptorMap>;

export const codecDescriptors = definePostgresCodecs(Object.values(codecDescriptorMap));
