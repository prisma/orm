import fs from 'node:fs';
import { syncBuiltinESMExports } from 'node:module';

const failAt = Number(process.env['FAIL_AT_WRITE']);
let writes = 0;

for (const name of ['writeFileSync', 'renameSync', 'rmSync', 'mkdirSync']) {
  const write: unknown = Reflect.get(fs, name);
  if (typeof write !== 'function') continue;
  Object.defineProperty(fs, name, {
    value: (...args: unknown[]): unknown => {
      writes += 1;
      if (writes === failAt) throw new Error(`injected failure at write ${writes}`);
      return Reflect.apply(write, fs, args);
    },
  });
}
syncBuiltinESMExports();
