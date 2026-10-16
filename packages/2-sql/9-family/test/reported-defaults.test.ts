import {
  type CodecCallContext,
  CodecDescriptorImpl,
  CodecImpl,
  type CodecInstanceContext,
  type DataTypeValue,
  dataType,
} from '@internal/framework-components/codec';
import { structuredError } from '@internal/utils/structured-error';
import { describe, expect, it } from 'vitest';
import {
  contractColumns,
  readColumnDefault,
  readReportedDefault,
} from '../src/core/reported-defaults';

const count = dataType('demo/count', { read: (json) => json });

/** Reads the digits a database prints, and refuses anything else. */
class CountCodec extends CodecImpl<'demo/count@1', readonly ['equality'], string, number> {
  async toWire(value: number, _ctx: CodecCallContext): Promise<string> {
    return String(value);
  }
  async fromWire(wire: string, _ctx: CodecCallContext): Promise<number> {
    if (!/^\d+$/.test(wire)) {
      throw structuredError('RUNTIME.DECODE_FAILED', `"${wire}" is not a count.`);
    }
    return Number(wire);
  }
  toDataTypeValue(value: number): DataTypeValue {
    return this.dataTypeValueOf(value);
  }
  fromDataTypeValue(value: DataTypeValue): number {
    return Number(value.value);
  }
}

class CountDescriptor extends CodecDescriptorImpl<void> {
  override readonly dataType = count.id;
  override readonly codecId = 'demo/count@1' as const;
  override readonly traits = ['equality'] as const;
  override readonly paramsSchema = undefined;
  override factory(): (ctx: CodecInstanceContext) => CountCodec {
    return () => new CountCodec(this, count);
  }
}

const codec = new CountDescriptor().factory()({ name: 'demo/count@1' });

describe('readReportedDefault', () => {
  it('reads a literal body with fromWire, then toDataTypeValue', async () => {
    expect(await readReportedDefault(codec, { kind: 'value', body: '0042' }, "'0042'")).toEqual({
      resolvedDefault: { kind: 'literal', value: 42 },
      defaultValue: count.fromContract(42, {}),
    });
  });

  it('reads a list element by element, keeping SQL NULL', async () => {
    expect(
      await readReportedDefault(codec, { kind: 'list', elements: ['1', null] }, "'{1,NULL}'"),
    ).toEqual({
      resolvedDefault: { kind: 'literal', value: [1, null] },
      defaultValue: [count.fromContract(1, {}), null],
    });
  });

  it('gives the codec message for a body the codec cannot read', async () => {
    expect(await readReportedDefault(codec, { kind: 'value', body: 'x' }, "'x'")).toEqual({
      defaultUnreadable:
        'The column codec demo/count@1 cannot read the default the database reports, \'x\': "x" is not a count.',
    });
  });

  it('names the element of a list the codec cannot read', async () => {
    expect(
      await readReportedDefault(codec, { kind: 'list', elements: ['1', 'x'] }, "'{1,x}'"),
    ).toEqual({
      defaultUnreadable:
        'The column codec demo/count@1 cannot read element 2 of the default the database reports, \'{1,x}\': "x" is not a count.',
    });
  });
});

describe('readColumnDefault', () => {
  const reported = { literal: { kind: 'value', body: '42' }, raw: '42' } as const;

  it('reads the literal a contract expression writes beside the reported one', async () => {
    expect(
      await readColumnDefault(codec, reported, {
        literal: { kind: 'value', body: '0042' },
        expression: "'0042'",
      }),
    ).toEqual({
      resolvedDefault: { kind: 'literal', value: 42 },
      defaultValue: count.fromContract(42, {}),
      defaultExpressionValue: count.fromContract(42, {}),
    });
  });

  it('leaves out the expression value when the codec cannot read the written literal', async () => {
    expect(
      await readColumnDefault(codec, reported, {
        literal: { kind: 'value', body: 'x' },
        expression: "'x'",
      }),
    ).toEqual({
      resolvedDefault: { kind: 'literal', value: 42 },
      defaultValue: count.fromContract(42, {}),
    });
  });
});

describe('contractColumns', () => {
  const contract = (typeParams: Record<string, unknown>) => ({
    storage: {
      types: { Short: { kind: 'codec-instance', codecId: 'demo/count@1', typeParams } },
      namespaces: {
        public: {
          entries: {
            table: {
              item: {
                columns: {
                  n: {
                    codecId: 'demo/count@1',
                    typeRef: 'Short',
                    default: { kind: 'function', expression: "'7'" },
                  },
                  tags: { codecId: 'demo/count@1', many: { elementNullable: true } },
                },
              },
            },
          },
        },
      },
    },
  });

  it('gives a column its codec, with the parameters of its named type, and its expression default', () => {
    const codecs = contractColumns(contract({ max: 9 }));
    expect({
      named: codecs.columnOf(['public'], 'item', 'n'),
      list: codecs.columnOf(undefined, 'item', 'tags'),
      otherNamespace: codecs.columnOf(['auth'], 'item', 'n'),
      missing: codecs.columnOf(['public'], 'item', 'absent'),
    }).toEqual({
      named: {
        codecRef: { codecId: 'demo/count@1', typeParams: { max: 9 } },
        defaultExpression: "'7'",
      },
      list: { codecRef: { codecId: 'demo/count@1', many: true }, defaultExpression: undefined },
      otherNamespace: undefined,
      missing: undefined,
    });
  });

  it('reads a table of several spaces with the named types of its own space', () => {
    const app = contract({ max: 9 });
    const extension = {
      storage: {
        types: {
          Short: { kind: 'codec-instance', codecId: 'demo/count@1', typeParams: { max: 3 } },
        },
        namespaces: {
          ext: {
            entries: {
              table: { counter: { columns: { n: { codecId: 'demo/count@1', typeRef: 'Short' } } } },
            },
          },
        },
      },
    };
    const merged = {
      storage: {
        namespaces: { ...app.storage.namespaces, ...extension.storage.namespaces },
      },
      contracts: [app, extension],
    };
    const codecs = contractColumns(merged);
    expect({
      app: codecs.columnOf(['public'], 'item', 'n')?.codecRef,
      extension: codecs.columnOf(['ext'], 'counter', 'n')?.codecRef,
    }).toEqual({
      app: { codecId: 'demo/count@1', typeParams: { max: 9 } },
      extension: { codecId: 'demo/count@1', typeParams: { max: 3 } },
    });
  });

  it('gives nothing without a contract', () => {
    expect(contractColumns(undefined).columnOf(undefined, 'item', 'n')).toBeUndefined();
  });
});
