import { describe, expect, it } from 'vitest';
import { postgresRenderCheckExpressions } from '../src/core/check-expressions';
import { postgresTargetDescriptorMeta } from '../src/core/descriptor-meta';
import postgresRuntimeTargetDescriptor from '../src/exports/runtime';

describe('postgresTargetDescriptorMeta', () => {
  it('declares namespace support, so emitted model names keep their namespace segment', () => {
    expect(postgresTargetDescriptorMeta.supportsNamespaces).toBe(true);
  });

  it('declares the expected defaultNamespaceId', () => {
    expect(postgresTargetDescriptorMeta.defaultNamespaceId).toBe('public');
  });

  // Check emission is hook-conditional and a target without the hook writes no
  // checks — a supported branch, so losing this wiring would silently stop
  // Postgres emitting every check rather than failing anywhere.
  it('contributes the check-expression renderer', () => {
    expect(postgresTargetDescriptorMeta.authoring.renderCheckExpressions).toBe(
      postgresRenderCheckExpressions,
    );
  });

  it('declares, on the control and runtime target, that every session prints dates in DateStyle ISO and money under lc_monetary C, which its codecs read', () => {
    const settings = { DateStyle: 'ISO', lc_monetary: 'C' };
    expect([
      postgresTargetDescriptorMeta.sessionSettings,
      postgresRuntimeTargetDescriptor.sessionSettings,
    ]).toEqual([settings, settings]);
  });
});
