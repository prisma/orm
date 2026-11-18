import { describe, expect, it } from 'vitest';
import { type GuideChange, guideChange, patternsOf } from '../guide-detections';

const GUIDE_PATHS = {
  app: 'skills/prisma-8/upgrading/app/upgrades/8.0.0-rc.18-to-8.0.0-rc.19/instructions.md',
  extension:
    'skills/prisma-8/upgrading/extension/upgrades/8.0.0-rc.18-to-8.0.0-rc.19/instructions.md',
} as const;

function entryOf(audience: keyof typeof GUIDE_PATHS): GuideChange {
  return guideChange(GUIDE_PATHS[audience], 'runner-failures-report-own-codes');
}

function detects(audience: keyof typeof GUIDE_PATHS, content: string): boolean {
  return patternsOf(entryOf(audience)).some((pattern) => pattern.test(content));
}

describe.each(['app', 'extension'] as const)(
  '%s runner-failures-report-own-codes detection',
  (audience) => {
    it('reads only code and shell files', () => {
      expect(entryOf(audience).detection?.glob).toBe('**/*.{ts,tsx,mts,cts,js,mjs,cjs,sh}');
    });

    it.each([
      ['the dotted code', "if (error.code === 'MIGRATION.RUNNER_FAILED') retry();"],
      ['the meta key', 'report(error.meta.runnerErrorCode);'],
    ])('finds %s', (_name, content) => {
      expect(detects(audience, content)).toBe(true);
    });

    it('skips a code of the same name in another namespace', () => {
      expect(detects(audience, "throw new AppError('RUNNER_FAILED', message);")).toBe(false);
    });
  },
);
