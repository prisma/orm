import { describe, expect, it } from 'vitest';
import { resolveGating } from '../src/gating';

describe('resolveGating', () => {
  it('returns enabled=true when no env override and stored enableTelemetry is true', () => {
    expect(resolveGating({ env: {}, config: { enableTelemetry: true } })).toEqual({
      enabled: true,
    });
  });

  it('returns enabled=false when stored enableTelemetry is false', () => {
    expect(resolveGating({ env: {}, config: { enableTelemetry: false } })).toEqual({
      enabled: false,
      reason: 'stored-opt-out',
    });
  });

  it('returns enabled=true when enableTelemetry is undefined (opt-out default: file missing or field absent)', () => {
    expect(resolveGating({ env: {}, config: {} })).toEqual({
      enabled: true,
    });
  });

  it('returns enabled=false when PRISMA_DISABLE_TELEMETRY=1 overrides a true stored preference', () => {
    expect(
      resolveGating({
        env: { PRISMA_DISABLE_TELEMETRY: '1' },
        config: { enableTelemetry: true },
      }),
    ).toEqual({ enabled: false, reason: 'env-override' });
  });

  it('treats any truthy value of PRISMA_DISABLE_TELEMETRY as opt-out', () => {
    for (const value of ['1', 'true', 'yes', 'on', 'truthy-anything']) {
      expect(
        resolveGating({
          env: { PRISMA_DISABLE_TELEMETRY: value },
          config: { enableTelemetry: true },
        }).enabled,
      ).toBe(false);
    }
  });

  it('treats PRISMA_DISABLE_TELEMETRY=0 / empty / "false" as NOT an opt-out (set-but-falsy = unset)', () => {
    for (const value of ['', '0', 'false', 'FALSE']) {
      expect(
        resolveGating({
          env: { PRISMA_DISABLE_TELEMETRY: value },
          config: { enableTelemetry: true },
        }).enabled,
      ).toBe(true);
    }
  });

  it('still honours the PRISMA_NEXT_DISABLE_TELEMETRY opt-out earlier releases documented', () => {
    expect(
      resolveGating({
        env: { PRISMA_NEXT_DISABLE_TELEMETRY: '1' },
        config: { enableTelemetry: true },
      }),
    ).toEqual({ enabled: false, reason: 'env-override' });
    expect(
      resolveGating({
        env: { PRISMA_NEXT_DISABLE_TELEMETRY: '0' },
        config: { enableTelemetry: true },
      }).enabled,
    ).toBe(true);
  });

  it('returns enabled=false when DO_NOT_TRACK=1 overrides a true stored preference', () => {
    expect(
      resolveGating({
        env: { DO_NOT_TRACK: '1' },
        config: { enableTelemetry: true },
      }),
    ).toEqual({ enabled: false, reason: 'env-override' });
  });

  it('treats DO_NOT_TRACK=0 as NOT an opt-out (community convention pins the trigger to "=1")', () => {
    expect(
      resolveGating({
        env: { DO_NOT_TRACK: '0' },
        config: { enableTelemetry: true },
      }).enabled,
    ).toBe(true);
  });

  it('env override takes precedence over both stored false and stored true (returns the same env-override reason)', () => {
    const result = resolveGating({
      env: { DO_NOT_TRACK: '1' },
      config: { enableTelemetry: false },
    });
    expect(result).toEqual({ enabled: false, reason: 'env-override' });
  });
});
