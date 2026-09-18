import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import { syncBuiltinESMExports } from 'node:module';
import { fileURLToPath } from 'node:url';
import { basename, dirname } from 'pathe';

if (process.argv[1]?.endsWith('/shell-pack.ts')) {
  const barrier = (phase: string, path: string) => {
    execFileSync(
      process.execPath,
      [fileURLToPath(new URL('./pack-lifecycle.ts', import.meta.url)), phase],
      { env: { ...process.env, PACK_OWNER: basename(dirname(path)) }, stdio: 'pipe' },
    );
  };
  const writeFileSync = fs.writeFileSync;
  fs.writeFileSync = (file, data, options) => {
    if (typeof file === 'string' && file.endsWith('/ticket.tmp')) barrier('choosing', file);
    writeFileSync(file, data, options);
  };
  const renameSync = fs.renameSync;
  fs.renameSync = (from, to) => {
    renameSync(from, to);
    if (typeof to === 'string' && to.endsWith('/ticket')) barrier('chosen', to);
  };
  syncBuiltinESMExports();
}
