import { defineConfig } from '@repo/tsdown';

type TypedExport = string | { readonly types: string; readonly import: string };

function typedExports(exports: Record<string, string>): Record<string, TypedExport> {
  const out: Record<string, TypedExport> = {};

  for (let [key, value] of Object.entries(exports)) {
    key = key.replace(/exports\/?/, '');
    if (key === './') key = '.';
    if (key === '.') {
      const match = value.match(/\/([^/]+)\.mjs$/);
      if (match && match[1] !== 'index') key = `./${match[1]}`;
    }
    out[key] = { types: value.replace(/\.mjs$/, '.d.mts'), import: value };
  }

  return out;
}

export default defineConfig({
  entry: {
    index: 'src/exports/index.ts',
    'exports/provider': 'src/exports/provider.ts',
  },
  exports: {
    enabled: 'local-only',
    exclude: [/cli\./],
    customExports: typedExports,
  },
});
