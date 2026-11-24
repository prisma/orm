// Loaded with `node --import` to stop the script the way a crash would, just before the
// `skip`-th file operation whose `<operation> <path>` matches `pattern`.
import fs from 'node:fs';
import { syncBuiltinESMExports } from 'node:module';

const pattern = new RegExp(process.env['STOP_BEFORE'] ?? '(?!)');
let skip = Number(process.env['STOP_SKIP'] ?? '0');

function stopBefore(operation, path) {
  if (!pattern.test(`${operation} ${String(path)}`)) return;
  if (skip-- === 0) process.exit(70);
}

const { renameSync, rmSync, writeFileSync } = fs;
fs.writeFileSync = (path, ...rest) => {
  stopBefore('write', path);
  return writeFileSync(path, ...rest);
};
fs.renameSync = (from, to) => {
  stopBefore('rename', to);
  return renameSync(from, to);
};
fs.rmSync = (path, ...rest) => {
  stopBefore('remove', path);
  return rmSync(path, ...rest);
};
syncBuiltinESMExports();
