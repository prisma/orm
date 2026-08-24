import { expectTypeOf, test } from 'vitest';
import {
  temporalCodecPreset,
  temporalCodecPresetWithPrecision,
} from '../src/core/timestamp-now-generator';

const withPrecision = temporalCodecPresetWithPrecision({
  codecId: 'pg/timestamp-temporal@1',
  nativeType: 'timestamp',
});
const withoutPrecision = temporalCodecPreset({
  codecId: 'sqlite/datetime@1',
  nativeType: 'text',
});

test('codec id and native type survive as literals, not widened to string', () => {
  expectTypeOf(withPrecision.output.codecId).toEqualTypeOf<'pg/timestamp-temporal@1'>();
  expectTypeOf(withPrecision.output.nativeType).toEqualTypeOf<'timestamp'>();
  expectTypeOf(withoutPrecision.output.codecId).toEqualTypeOf<'sqlite/datetime@1'>();
  expectTypeOf(withoutPrecision.output.nativeType).toEqualTypeOf<'text'>();
});

test('option arg values survive as the literal union that types the TS surface', () => {
  expectTypeOf(withPrecision.args[1].values).toEqualTypeOf<readonly ['now']>();
  expectTypeOf(withPrecision.args[2].values).toEqualTypeOf<readonly ['now']>();
  expectTypeOf(withoutPrecision.args[0].values).toEqualTypeOf<readonly ['now']>();
  expectTypeOf(withoutPrecision.args[1].values).toEqualTypeOf<readonly ['now']>();
});

test('arg-ref indices survive as literals so template resolution stays precise', () => {
  expectTypeOf(withPrecision.output.typeParams.precision.index).toEqualTypeOf<0>();
  expectTypeOf(withPrecision.output.executionDefaults.onCreate.index).toEqualTypeOf<1>();
  expectTypeOf(withPrecision.output.executionDefaults.onUpdate.index).toEqualTypeOf<2>();
  expectTypeOf(withoutPrecision.output.executionDefaults.onCreate.index).toEqualTypeOf<0>();
  expectTypeOf(withoutPrecision.output.executionDefaults.onUpdate.index).toEqualTypeOf<1>();
});
