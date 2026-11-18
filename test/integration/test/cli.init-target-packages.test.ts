import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import type { InitContribution } from '@internal/cli/init-contribution';
import { describe, expect, it } from 'vitest';
import {
  KNOWN_TARGET_PACKAGES,
  type KnownTargetPackage,
} from '../../../packages/1-framework/3-tooling/cli/src/commands/init/target-packages';

const REPO_ROOT = resolve(import.meta.dirname, '../../..');

/**
 * The list holds what `init` needs before it has installed anything: the label the picker shows
 * and the packages the printed Prisma 6 setup installs. The contribution owns the same facts.
 */
function disagreements(entry: KnownTargetPackage, contribution: InitContribution): string[] {
  return [
    ...(contribution.label === entry.label
      ? []
      : [`label: list ${entry.label}, contribution ${contribution.label}`]),
    ...(JSON.stringify(contribution.peerPackages) === JSON.stringify(entry.peerPackages)
      ? []
      : [
          `peerPackages: list ${entry.peerPackages.join(', ')}, contribution ${contribution.peerPackages.join(', ')}`,
        ]),
    ...(contribution.configModule === `${entry.packageName}/config`
      ? []
      : [`configModule: ${contribution.configModule}, not ${entry.packageName}/config`]),
  ];
}

async function publishedContribution(packageName: string): Promise<InitContribution> {
  const entry = resolve(REPO_ROOT, 'packages/9-public', packageName, 'dist/init.mjs');
  const module: { default: InitContribution } = await import(pathToFileURL(entry).href);
  return module.default;
}

describe('the list of known target packages agrees with their published contributions', () => {
  for (const entry of KNOWN_TARGET_PACKAGES) {
    it(`${entry.packageName}: label, peer packages and config module`, async () => {
      expect(disagreements(entry, await publishedContribution(entry.packageName))).toEqual([]);
    });
  }

  it('names each fact that disagrees', async () => {
    const [entry] = KNOWN_TARGET_PACKAGES;
    const contribution = await publishedContribution(entry.packageName);

    expect(
      disagreements(entry, {
        ...contribution,
        label: 'Other',
        peerPackages: ['other-driver'],
        configModule: 'other/config',
      }),
    ).toEqual([
      `label: list ${entry.label}, contribution Other`,
      `peerPackages: list ${entry.peerPackages.join(', ')}, contribution other-driver`,
      `configModule: other/config, not ${entry.packageName}/config`,
    ]);
  });
});
