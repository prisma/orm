import { describe, expect, it } from 'vitest';
import { detectionPatterns, type GuideChange, guideChange } from '../guide-detections';

const GUIDE_PATHS = {
  app: 'skills/prisma-8/upgrading/app/upgrades/8.0.0-rc.19-to-8.0.0-rc.20/instructions.md',
  extension:
    'skills/prisma-8/upgrading/extension/upgrades/8.0.0-rc.19-to-8.0.0-rc.20/instructions.md',
} as const;

function changeBlock(audience: keyof typeof GUIDE_PATHS, id: string): GuideChange {
  return guideChange(GUIDE_PATHS[audience], id);
}

function patternsOf(audience: keyof typeof GUIDE_PATHS, id: string): readonly RegExp[] {
  return detectionPatterns(GUIDE_PATHS[audience], id);
}

const manifest = (engine: string) =>
  JSON.stringify({ devDependencies: { '@prisma/cli-engine': engine } }, null, 2);

describe.each(['app', 'extension'] as const)('the %s cli-engine 0.9.0 detection', (audience) => {
  const matches = (content: string) =>
    patternsOf(audience, 'engine-pin-moves-to-0-9-0').some((pattern) => pattern.test(content));

  it('matches an engine pin or range below 0.9', () => {
    expect(
      ['0.7.0', '^0.7.0', '~0.7.0', '0.2.3', '^0.8.1', '0.8', '>=0.7.0 <0.9.0']
        .map(manifest)
        .map(matches),
    ).toEqual([true, true, true, true, true, true, true]);
  });

  it('does not match 0.9.0 or later', () => {
    expect(
      ['0.9.0', '^0.9.0', '0.10.0', '1.0.0', '>=0.9.0 <1.0.0', '10.8.0', '1.0.8']
        .map(manifest)
        .map(matches),
    ).toEqual([false, false, false, false, false, false, false]);
  });

  it('does not match a manifest without the engine', () => {
    expect(matches(JSON.stringify({ dependencies: { '@prisma/cli': '0.7.0' } }))).toBe(false);
  });

  it('reads pnpm-workspace.yaml as well as package.json', () => {
    expect(changeBlock(audience, 'engine-pin-moves-to-0-9-0').detection?.glob).toBe(
      '**/{package.json,pnpm-workspace.yaml}',
    );
  });

  const workspace = (entry: string) =>
    `packages:\n  - packages/*\ncatalog:\n  ${entry}\n  typescript: ^5.9.0\n`;
  const namedCatalog = (entry: string) =>
    `catalogs:\n  tooling:\n    ${entry}\n    vitest: 0.9.0\n`;

  it('matches a catalog entry below 0.9', () => {
    expect(
      [
        workspace("'@prisma/cli-engine': 0.7.0"),
        workspace('"@prisma/cli-engine": ^0.7.0'),
        workspace("'@prisma/cli-engine': '~0.8.1'"),
        namedCatalog("'@prisma/cli-engine': 0.7.0"),
      ].map(matches),
    ).toEqual([true, true, true, true]);
  });

  it('does not match a catalog entry of 0.9.0 or later, or a catalog reference', () => {
    expect(
      [
        workspace("'@prisma/cli-engine': 0.9.0"),
        workspace("'@prisma/cli-engine': ^1.0.8"),
        namedCatalog("'@prisma/cli-engine': '0.10.0'"),
        manifest('catalog:'),
        manifest('catalog:tooling'),
      ].map(matches),
    ).toEqual([false, false, false, false, false]);
  });

  it('shows the piped-output instruction to every project', () => {
    expect(changeBlock(audience, 'piped-output-needs-json').detection).toBeUndefined();
  });
});
