import { afterEach, describe, expect, it, vi } from 'vitest';

describe('moduleBase', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.resetModules();
  });

  it('is the workspace package when the build defines no published name', async () => {
    const { moduleBase } = await import('../src/core/module-base');
    expect(moduleBase).toBe('@internal/extension-pgvector');
  });

  it('is the published name the build defines', async () => {
    vi.stubGlobal(
      '__PRISMA_PUBLISHED_MODULE_BASE__EXTENSION_PGVECTOR',
      '@prisma/orm-extension-pgvector',
    );
    vi.resetModules();
    const { moduleBase } = await import('../src/core/module-base');
    expect(moduleBase).toBe('@prisma/orm-extension-pgvector');
  });
});
