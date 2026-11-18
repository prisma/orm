import { describe, expect, it } from 'vitest';
import {
  defaultTsConfig,
  mergeTsConfig,
  REQUIRED_COMPILER_OPTIONS,
} from '../../../src/commands/init/templates/tsconfig';

describe('tsconfig template', () => {
  describe('defaultTsConfig', () => {
    it('sets strict: true', () => {
      const config = JSON.parse(defaultTsConfig()) as Record<string, unknown>;
      const opts = config['compilerOptions'] as Record<string, unknown>;

      expect(opts['strict']).toBe(true);
    });

    it('sets skipLibCheck: true', () => {
      const config = JSON.parse(defaultTsConfig()) as Record<string, unknown>;
      const opts = config['compilerOptions'] as Record<string, unknown>;

      expect(opts['skipLibCheck']).toBe(true);
    });
  });

  describe('mergeTsConfig', () => {
    it('preserves existing non-conflicting options', () => {
      const existing = JSON.stringify(
        { compilerOptions: { outDir: './dist', strict: true, declaration: true } },
        null,
        2,
      );
      const merged = JSON.parse(mergeTsConfig(existing, 'module')) as Record<string, unknown>;
      const opts = merged['compilerOptions'] as Record<string, unknown>;

      expect(opts['outDir']).toBe('./dist');
      expect(opts['strict']).toBe(true);
      expect(opts['declaration']).toBe(true);
    });

    it('overrides conflicting options with required values', () => {
      const existing = JSON.stringify(
        {
          compilerOptions: {
            module: 'commonjs',
            moduleResolution: 'node',
            resolveJsonModule: false,
          },
        },
        null,
        2,
      );
      const merged = JSON.parse(mergeTsConfig(existing, 'module')) as Record<string, unknown>;
      const opts = merged['compilerOptions'] as Record<string, unknown>;

      expect(opts['module']).toBe('preserve');
      expect(opts['moduleResolution']).toBe('bundler');
      expect(opts['resolveJsonModule']).toBe(true);
    });

    it('preserves non-compilerOptions fields', () => {
      const existing = JSON.stringify(
        {
          compilerOptions: { strict: true },
          include: ['src/**/*.ts'],
          exclude: ['node_modules'],
        },
        null,
        2,
      );
      const merged = JSON.parse(mergeTsConfig(existing, 'module')) as Record<string, unknown>;

      expect(merged['include']).toEqual(['src/**/*.ts']);
      expect(merged['exclude']).toEqual(['node_modules']);
    });

    it('creates compilerOptions if missing', () => {
      const existing = JSON.stringify({ include: ['src'] }, null, 2);
      const merged = JSON.parse(mergeTsConfig(existing, 'module')) as Record<string, unknown>;
      const opts = merged['compilerOptions'] as Record<string, unknown>;

      for (const [key, value] of Object.entries(REQUIRED_COMPILER_OPTIONS)) {
        expect(opts[key]).toBe(value);
      }
      expect(merged['include']).toEqual(['src']);
    });
  });
});

// FR5.4: snapshot tests cover all four (target × authoring) cells.
// The companion FR2.3 / FR5.4 typecheck guarantee against the published
// facade lives in `test/integration/test/cli.init-templates.e2e.test.ts`.
