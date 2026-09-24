import { describe, expect, it } from 'vitest';
import { buildLoadedConfig, requireConfigSections } from '../src/exports/index';

const load = async () => ({ ok: true, value: {} });

function sectionsWithDiagnostics(raw: Record<string, unknown>): readonly unknown[] {
  return buildLoadedConfig(raw, '/project').diagnostics.map((diagnostic) =>
    Reflect.get(diagnostic.meta ?? {}, 'section'),
  );
}

describe('buildLoadedConfig', () => {
  it('resolves the contract paths of an orm section against the directory', () => {
    const { config } = buildLoadedConfig(
      { contract: { source: { load, inputs: ['prisma/schema.prisma'] }, output: 'src/prisma' } },
      '/project',
    );

    expect(config.contract).toMatchObject({
      source: { inputs: ['/project/prisma/schema.prisma'] },
      output: '/project/src/prisma',
    });
  });

  it('returns a section it cannot read as authored, with a diagnostic that blocks every subsection', () => {
    const raw = {
      get family(): never {
        throw new Error('boom');
      },
    };

    const loaded = buildLoadedConfig(raw, '/project');

    expect(loaded.config).toBe(raw);
    expect(loaded.diagnostics).toContainEqual(
      expect.objectContaining({ code: 'CONFIG.VALIDATION_FAILED' }),
    );
    expect(requireConfigSections(loaded, ['contract']).ok).toBe(false);
  });

  it('tags a diagnostic with the section it concerns', () => {
    expect(sectionsWithDiagnostics({ contract: { source: { load } } })).not.toContain('contract');
    expect(sectionsWithDiagnostics({ contract: 'prisma/schema.prisma' })).toContain('contract');
    expect(sectionsWithDiagnostics({})).toContain('family');
  });
});
