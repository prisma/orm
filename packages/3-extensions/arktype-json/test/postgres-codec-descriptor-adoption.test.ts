import type { JsonValue } from '@internal/contract/types';
import type { CodecRef } from '@internal/framework-components/codec';
import { ColumnRef } from '@internal/sql-relational-core/ast';
import { type } from 'arktype';
import { describe, expect, it } from 'vitest';
import {
  arktypeJsonColumn,
  arktypeJsonDescriptor,
  codecDescriptors,
} from '../src/core/arktype-json-codec';
import { arktypeJsonCodecRegistry } from '../src/core/registry';
import { arktypeJsonExtensionDescriptor } from '../src/exports/control';
import { arktypeJsonRuntimeDescriptor } from '../src/exports/runtime';
import { fromContractJson, toContractJson } from './contract-json';

describe('arktype-json PostgreSQL codec descriptor adoption', () => {
  it('uses one target descriptor instance across canonical, registry, runtime, and control contributions', () => {
    expect(codecDescriptors).toEqual([arktypeJsonDescriptor]);
    expect(
      codecDescriptors.every((descriptor) => descriptor.descriptorKind === 'postgres-codec'),
    ).toBe(true);
    expect([...arktypeJsonCodecRegistry.values()]).toEqual(codecDescriptors);
    expect(arktypeJsonRuntimeDescriptor.codecs()).toEqual(codecDescriptors);
    expect(arktypeJsonRuntimeDescriptor.types?.codecTypes?.codecDescriptors).toEqual(
      codecDescriptors,
    );
    expect(arktypeJsonExtensionDescriptor.types?.codecTypes?.codecDescriptors).toEqual(
      codecDescriptors,
    );
  });

  it('preserves the jsonb data type, identity projection, and structured JSON behavior', () => {
    const schema = type({ name: 'string', price: 'number' });
    const column = arktypeJsonColumn(schema);
    const ref: CodecRef = {
      codecId: arktypeJsonDescriptor.codecId,
      typeParams: {
        expression: column.typeParams.expression,
        jsonIr: column.typeParams.jsonIr as JsonValue,
      },
    };
    const expression = ColumnRef.of('products', 'details');

    expect(arktypeJsonDescriptor.dataType).toBe('pg/jsonb');
    expect(arktypeJsonDescriptor.projectJson(expression, ref)).toBe(expression);

    const codec = column.codecFactory({ name: 'details' });
    const value = { name: 'Widget', price: 9.99 };
    expect(toContractJson(codec, value)).toEqual(value);
    expect(fromContractJson(codec, value, ref.typeParams)).toEqual(value);
  });
});
