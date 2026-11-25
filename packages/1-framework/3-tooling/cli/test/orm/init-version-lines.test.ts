import { describe, expect, it } from 'vitest';
import { requirementAdmits, versionLines } from '../../src/orm/init-version-lines';

describe('the lines init writes, read from how the facade names its peers', () => {
  it('keeps the versions as they are when every peer is an exact version', () => {
    const lines = versionLines('8.0.0-rc.27', ['8.0.0-rc.27', '8.0.0-rc.27'], { addsFacade: true });

    expect({ facade: lines.facade, peer: lines.ormPackage('8.0.0-rc.27') }).toEqual({
      facade: '8.0.0-rc.27',
      peer: '8.0.0-rc.27',
    });
  });

  it('keeps the versions as they are for a development build', () => {
    const lines = versionLines('8.1.0-dev.4', ['8.1.0-dev.4'], { addsFacade: true });

    expect({ facade: lines.facade, peer: lines.ormPackage('8.1.0-dev.4') }).toEqual({
      facade: '8.1.0-dev.4',
      peer: '8.1.0-dev.4',
    });
  });

  it('reads a workspace specifier on an exact version as exact', () => {
    expect(
      versionLines('8.0.0-rc.25', ['workspace:8.0.0-rc.25'], { addsFacade: true }).facade,
    ).toBe('8.0.0-rc.25');
  });

  it('writes a caret on every line when it adds a GA facade', () => {
    const lines = versionLines('8.1.2', ['~8.1.0'], { addsFacade: true });

    expect({
      facade: lines.facade,
      tilde: lines.ormPackage('~8.1.0'),
      caret: lines.ormPackage('^8.1.0'),
    }).toEqual({ facade: '^8.1.0', tilde: '^8.1.0', caret: '^8.1.0' });
  });

  it('writes each peer at the range the facade declares when the project already lists it', () => {
    const lines = versionLines('8.1.2', ['~8.1.0'], { addsFacade: false });

    expect(lines.ormPackage('~8.1.0')).toBe('~8.1.0');
  });

  it('writes a tilde on every line for a facade at a pre-release', () => {
    const lines = versionLines('8.1.0-ea.1', ['~8.1.0', '~8.1.0-ea.0'], { addsFacade: true });

    expect({
      facade: lines.facade,
      ga: lines.ormPackage('~8.1.0'),
      belowGa: lines.ormPackage('~8.1.0-ea.0'),
    }).toEqual({ facade: '~8.1.0-ea.1', ga: '~8.1.0', belowGa: '~8.1.0-ea.0' });
  });

  it('reads a manifest that mixes exact versions and ranges as ranges', () => {
    expect(versionLines('8.1.2', ['8.1.2', '~8.1.0'], { addsFacade: true }).facade).toBe('^8.1.0');
  });
});

describe('whether a line the project lists stands for the line init writes', () => {
  it.each([
    ['the exact version', '8.0.0-rc.27', undefined, true],
    ['another exact version', '8.0.0-rc.26', undefined, false],
    ['a caret with the version installed', '^8.0.0-rc.26', '8.0.0-rc.27', true],
    ['a caret with another version installed', '^8.0.0-rc.26', '8.0.0-rc.26', false],
  ])('on the release candidates, decides %s', (_case, line, installed, stands) => {
    const lines = versionLines('8.0.0-rc.27', ['8.0.0-rc.27'], { addsFacade: true });

    expect(lines.standsFor(line, '8.0.0-rc.27', installed)).toBe(stands);
  });

  it.each([
    ['the line init writes', '^8.1.0', '8.1.0', true],
    ['another line, nothing installed', 'workspace:*', undefined, true],
    ['another line with the same release installed', '8.1.3', '8.1.3', true],
    ['another line with an earlier release installed', '^8.0.0', '8.0.4', false],
  ])('on the levels line, decides %s', (_case, line, installed, stands) => {
    const lines = versionLines('8.1.2', ['~8.1.0'], { addsFacade: true });

    expect(lines.standsFor(line, '^8.1.0', installed)).toBe(stands);
  });
});

describe('whether a requirement admits an installed version', () => {
  it.each([
    ['8.0.0-rc.27', '8.0.0-rc.27', true],
    ['8.0.0-rc.27', '8.0.0-rc.26', false],
    ['v8.0.0-rc.27', '8.0.0-rc.27', true],
    ['=8.0.0-rc.27', 'v8.0.0-rc.27', true],
    ['~8.1.0', '8.1.5', true],
    ['~8.1.0', '8.0.4', false],
    ['~8.1.0', '8.2.0', false],
    ['^8.1.0', '8.2.0', true],
    ['^8.1.0', '8.0.4', false],
    ['^8.1.0', '9.0.0', false],
    ['~8.1.0-ea.0', '8.1.0-ea.3', true],
    ['~8.1.0-ea.1', '8.1.0-ea.0', false],
    ['~8.1.0-ea.0', '8.1.0', true],
    ['~8.1.0-ea.0', '8.1.2', true],
    ['~8.1.0-ea.0', '8.1.1-ea.0', false],
    ['~8.1.0', '8.1.1-ea.0', false],
    ['^8.0.0', '8.0.0-rc.26', false],
    ['~8.0.1-ea.0', '8.0.0-rc.26', false],
    ['~8.0.1-ea.0', '8.0.1-ea.2', true],
    ['~8.0.1-ea.0', '8.0.1-preview.0', true],
    ['~8.0.1-rc.0', '8.0.1-preview.0', false],
    ['~8.0.0-rc.27', '8.0.0-rc.26', false],
    ['~8.0.0-rc.27', '8.0.0-rc.30', true],
  ])('%s admits %s: %s', (requirement, version, admits) => {
    expect(requirementAdmits(requirement, version)).toBe(admits);
  });

  it('cannot tell for a range it does not read', () => {
    expect(requirementAdmits('>=8.1.0 <8.2.0', '8.1.0')).toBeUndefined();
  });
});
