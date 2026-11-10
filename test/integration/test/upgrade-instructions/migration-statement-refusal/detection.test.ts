import { describe, expect, it } from 'vitest';
import { detectionPatterns } from '../guide-detections';

const GUIDE_PATH =
  'skills/prisma-8/upgrading/app/upgrades/8.0.0-rc.16-to-8.0.0-rc.17/instructions.md';

function detectionOf(id: string): readonly RegExp[] {
  return detectionPatterns(GUIDE_PATH, id);
}

function detects(id: string, content: string): boolean {
  return detectionOf(id).some((pattern) => pattern.test(content));
}

describe('db-update-confirm-no-longer-consents detection', () => {
  it('finds --confirm on a db update command line', () => {
    expect(
      detects('db-update-confirm-no-longer-consents', 'prisma db update --confirm appdb'),
    ).toBe(true);
  });

  it('finds --confirm on a db update command continued over several lines', () => {
    const script = 'pnpm prisma db update \\\n  --no-interactive \\\n  --confirm appdb\n';
    expect(detects('db-update-confirm-no-longer-consents', script)).toBe(true);
  });

  it('skips a --confirm that belongs to a later command', () => {
    const script = 'pnpm prisma db update --json\npnpm prisma orm init --confirm my-app\n';
    expect(detects('db-update-confirm-no-longer-consents', script)).toBe(false);
  });

  it('skips a longer flag that starts with --confirm', () => {
    expect(detects('db-update-confirm-no-longer-consents', 'prisma db update --confirmed')).toBe(
      false,
    );
  });
});
