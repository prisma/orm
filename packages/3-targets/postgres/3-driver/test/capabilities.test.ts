import { describe, expect, it } from 'vitest';
import { postgresDriverCapabilities } from '../src/exports/capabilities';
import postgresControlDriver from '../src/exports/control';
import postgresRuntimeDriver from '../src/exports/runtime';

describe('the driver capabilities', () => {
  it('declares, on the runtime driver, what the connection provides: nothing yet', () => {
    expect(postgresRuntimeDriver.capabilities).toBe(postgresDriverCapabilities);
    expect(postgresDriverCapabilities).toEqual({});
  });

  it('declares nothing on the control driver, which migrates and does not run the application', () => {
    expect(postgresControlDriver.capabilities).toEqual({});
  });
});
