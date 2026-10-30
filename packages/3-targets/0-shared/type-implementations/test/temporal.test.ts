import { Temporal as otherTemporal } from 'temporal-polyfill/implementation';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const hostTemporal = Temporal;

type TemporalModule = typeof import('../src/temporal');

async function freshModule(): Promise<TemporalModule> {
  vi.resetModules();
  return import('../src/temporal');
}

beforeEach(() => {
  Reflect.deleteProperty(globalThis, 'Temporal');
});

afterEach(() => {
  Reflect.set(globalThis, 'Temporal', hostTemporal);
});

describe('findTemporal', () => {
  it('the two implementations these tests use are different objects', () => {
    expect(otherTemporal).not.toBe(hostTemporal);
  });

  it("returns the runtime's Temporal when the runtime has one, whatever the fallback is", async () => {
    const { setFallbackTemporal, findTemporal } = await freshModule();
    setFallbackTemporal(otherTemporal);
    Reflect.set(globalThis, 'Temporal', hostTemporal);

    expect(findTemporal()).toBe(hostTemporal);
  });

  it('returns the fallback when the runtime has no Temporal, and sets no global', async () => {
    const { setFallbackTemporal, findTemporal } = await freshModule();
    setFallbackTemporal(otherTemporal);

    expect(findTemporal()).toBe(otherTemporal);
    expect('Temporal' in globalThis).toBe(false);
  });

  it('returns undefined when there is no Temporal and no fallback', async () => {
    const { findTemporal } = await freshModule();

    expect(findTemporal()).toBeUndefined();
  });

  it('ignores a global Temporal that is not an object', async () => {
    const { findTemporal } = await freshModule();
    Reflect.set(globalThis, 'Temporal', null);

    expect(findTemporal()).toBeUndefined();
  });
});
