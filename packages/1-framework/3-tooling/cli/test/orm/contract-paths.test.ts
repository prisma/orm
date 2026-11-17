import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { filePathKey } from '../../src/orm/contract/paths';

const filesystem = vi.hoisted(() => {
  vi.resetModules();
  return { realpath: vi.fn(), stat: vi.fn() };
});

vi.mock('node:fs/promises', () => filesystem);

afterAll(() => {
  vi.doUnmock('node:fs/promises');
  vi.resetModules();
});

beforeEach(() => {
  vi.resetAllMocks();
  filesystem.realpath.mockImplementation(async (path: string) => path);
});

describe('filePathKey', () => {
  it('detects case-insensitive files beneath a case-sensitive mount path', async () => {
    filesystem.stat.mockImplementation(async (path: string) => {
      if (path === '/mount/project/schema.prisma' || path === '/mount/project/SCHEMA.PRISMA') {
        return { dev: 1, ino: 2 };
      }
      throw new Error('ENOENT');
    });

    expect(await filePathKey('/mount/project/SCHEMA.PRISMA')).toBe('/mount/project/schema.prisma');
    expect(await filePathKey('/mount/project/schema.prisma')).toBe('/mount/project/schema.prisma');
  });

  it('preserves case when differently cased paths name distinct files', async () => {
    filesystem.stat.mockImplementation(async (path: string) => ({
      dev: 1,
      ino: path === '/mount/project/SCHEMA.PRISMA' ? 2 : 3,
    }));

    expect(await filePathKey('/mount/project/SCHEMA.PRISMA')).toBe('/mount/project/SCHEMA.PRISMA');
  });
});
