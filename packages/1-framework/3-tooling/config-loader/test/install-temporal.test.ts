import { Temporal as polyfillTemporal } from 'temporal-polyfill/full/implementation';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { installTemporalWhenMissing } from '../src/install-temporal';

describe('installTemporalWhenMissing', () => {
  let original: PropertyDescriptor | undefined;

  beforeEach(() => {
    original = Object.getOwnPropertyDescriptor(globalThis, 'Temporal');
  });

  afterEach(() => {
    Reflect.deleteProperty(globalThis, 'Temporal');
    if (original !== undefined) {
      Object.defineProperty(globalThis, 'Temporal', original);
    }
  });

  it('leaves an existing global Temporal untouched', () => {
    const existing = { name: 'the Temporal the runtime provides' };
    const descriptor = { value: existing, writable: true, configurable: true, enumerable: false };
    Object.defineProperty(globalThis, 'Temporal', descriptor);

    installTemporalWhenMissing();

    expect(Object.getOwnPropertyDescriptor(globalThis, 'Temporal')).toEqual(descriptor);
    expect(Reflect.get(globalThis, 'Temporal')).toBe(existing);
  });

  it('installs the polyfill when the runtime has no global Temporal', () => {
    Reflect.deleteProperty(globalThis, 'Temporal');

    installTemporalWhenMissing();

    expect(Object.getOwnPropertyDescriptor(globalThis, 'Temporal')).toEqual({
      value: polyfillTemporal,
      writable: true,
      configurable: true,
      enumerable: false,
    });
  });

  it('keeps the Temporal it installed when called again', () => {
    Reflect.deleteProperty(globalThis, 'Temporal');

    installTemporalWhenMissing();
    const installed = Reflect.get(globalThis, 'Temporal');
    installTemporalWhenMissing();

    expect(Reflect.get(globalThis, 'Temporal')).toBe(installed);
  });
});
