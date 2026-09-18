import { packShell } from '@repo/tsdown/shell-testkit';

const [shellDir, outDir, lockTimeoutMs] = process.argv.slice(2);
if (!shellDir || !outDir) throw new Error('Expected package and output directories');

try {
  const packed = packShell(shellDir, outDir, {
    lockTimeoutMs: lockTimeoutMs === undefined ? undefined : Number(lockTimeoutMs),
  });
  console.log(JSON.stringify(packed));
} catch (error) {
  console.error(error);
  process.exitCode = 1;
}
