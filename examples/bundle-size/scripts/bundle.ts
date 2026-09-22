import { execFileSync } from 'node:child_process';
import { mkdir, readFile, rename, rm, stat, writeFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { dirname, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { gzipSync } from 'node:zlib';
import * as esbuild from 'esbuild';

const here = dirname(fileURLToPath(import.meta.url));
const root = resolve(here, '..');

const require_ = createRequire(import.meta.url);
const pkg: { dependencies?: Record<string, string> } = require_(resolve(root, 'package.json'));

// Only mark the Node-runtime drivers (`pg`, `mongodb`) external. Everything
// Prisma 8 owns is inlined into the bundle — that's the realistic shape of
// a serverless / single-binary deployment.
const external = ['pg', 'pg-native', 'mongodb'];

await mkdir(resolve(root, 'dist'), { recursive: true });

interface BundleSpec {
  readonly label: string;
  readonly entry: string;
  readonly outBase: string;
}

const bundles: readonly BundleSpec[] = [
  {
    label: 'postgres / no-emit (TS contract)',
    entry: 'src/postgres/main.ts',
    outBase: 'dist/postgres-no-emit',
  },
  {
    label: 'postgres / emit (contract.json)',
    entry: 'src/postgres/main-emit.ts',
    outBase: 'dist/postgres-emit',
  },
  {
    label: 'mongo    / no-emit (TS contract)',
    entry: 'src/mongo/main.ts',
    outBase: 'dist/mongo-no-emit',
  },
  {
    label: 'mongo    / emit (contract.json)',
    entry: 'src/mongo/main-emit.ts',
    outBase: 'dist/mongo-emit',
  },
];

interface Variant {
  readonly label: 'minified' | 'unminified';
  readonly minify: boolean;
  readonly suffix: string;
}

const variants: readonly Variant[] = [
  { label: 'unminified', minify: false, suffix: '.bundle.mjs' },
  { label: 'minified', minify: true, suffix: '.bundle.min.mjs' },
];

interface BuildOutput {
  readonly spec: BundleSpec;
  readonly variant: Variant;
  readonly outfile: string;
  readonly bytes: number;
  readonly gzipBytes: number;
  readonly metafile: esbuild.Metafile;
}

const outputs: BuildOutput[] = [];

for (const spec of bundles) {
  for (const variant of variants) {
    const outfile = resolve(root, `${spec.outBase}${variant.suffix}`);
    const built = await esbuild.build({
      entryPoints: [resolve(root, spec.entry)],
      outfile,
      bundle: true,
      format: 'esm',
      platform: 'node',
      target: 'node24',
      minify: variant.minify,
      treeShaking: true,
      external,
      legalComments: 'none',
      metafile: true,
      logLevel: 'warning',
    });
    const { size } = await stat(outfile);
    const contents = await readFile(outfile);
    const gzipped = gzipSync(contents, { level: 9 });
    // Persist the .gz alongside so consumers can inspect it.
    await writeFile(`${outfile}.gz`, gzipped);
    // Persist the esbuild metafile so it can be fed to a visualiser
    // (esbuild.github.io/analyze, esbuild-visualizer, bundle-buddy, ...).
    await writeFile(`${outfile}.meta.json`, JSON.stringify(built.metafile, null, 2));
    outputs.push({
      spec,
      variant,
      outfile,
      bytes: size,
      gzipBytes: gzipped.byteLength,
      metafile: built.metafile,
    });
  }
}

const fmtBytes = (n: number) => `${n.toLocaleString().padStart(9)} bytes`;
const fmtKiB = (n: number) => `${(n / 1024).toFixed(1).padStart(6)} KiB`;

console.log('');
console.log(`deps:     ${Object.keys(pkg.dependencies ?? {}).join(', ')}`);
console.log(`external: ${external.join(', ')}`);
console.log('');

console.log('bundles:');
console.log(
  `  ${'entry'.padEnd(40)}  ${'variant'.padEnd(10)}  ${'raw'.padStart(22)}  ${'gzip (level 9)'.padStart(22)}`,
);
for (const { spec, variant, bytes, gzipBytes } of outputs) {
  console.log(
    `  ${spec.label.padEnd(40)}  ${variant.label.padEnd(10)}  ${fmtBytes(bytes)} (${fmtKiB(bytes)})  ${fmtBytes(gzipBytes)} (${fmtKiB(gzipBytes)})`,
  );
}

console.log('');
for (const { spec, variant, metafile } of outputs) {
  if (variant.label !== 'minified') continue; // top inputs are identical across variants
  console.log(`top 10 inputs — ${spec.label}:`);
  const top = Object.entries(metafile.inputs)
    .map(([path, info]) => ({ path, bytes: info.bytes }))
    .sort((a, b) => b.bytes - a.bytes)
    .slice(0, 10);
  for (const { path, bytes } of top) {
    const display = relative(resolve(root, '..', '..'), resolve(root, path));
    console.log(`  ${(bytes / 1024).toFixed(1).padStart(7)} KiB  ${display}`);
  }
  console.log('');
}

// -----------------------------------------------------------------
// Cloudflare Workers bundles via wrangler.
//
// Wrangler uses esbuild internally with Workers-specific settings
// (workerd/worker conditions, nodejs_compat polyfills, etc). The
// `--dry-run --outdir <dir>` flow builds without deploying;
// `--metafile` emits the esbuild metafile next to the bundle so the
// `why.ts` tracer (see sibling script) can inspect it the same way
// it inspects esbuild's own output.
// -----------------------------------------------------------------

interface WranglerSpec {
  readonly label: string;
  readonly config: string;
  readonly outBase: string;
  /** Wrangler names the output file after the worker entry's basename. */
  readonly emittedFile: string;
}

const wranglerBundles: readonly WranglerSpec[] = [
  {
    label: 'cf-worker / no-emit (TS contract)',
    config: 'wrangler.worker.jsonc',
    outBase: 'dist/cf-worker-no-emit',
    emittedFile: 'worker.js',
  },
  {
    label: 'cf-worker / emit (contract.json)',
    config: 'wrangler.worker-emit.jsonc',
    outBase: 'dist/cf-worker-emit',
    emittedFile: 'worker-emit.js',
  },
];

const wranglerVariants: readonly Variant[] = [
  { label: 'unminified', minify: false, suffix: '.worker.mjs' },
  { label: 'minified', minify: true, suffix: '.worker.min.mjs' },
];

interface WranglerOutput {
  readonly spec: WranglerSpec;
  readonly variant: Variant;
  readonly outfile: string;
  readonly bytes: number;
  readonly gzipBytes: number;
  readonly metafilePath: string;
}

const wranglerOutputs: WranglerOutput[] = [];

for (const spec of wranglerBundles) {
  for (const variant of wranglerVariants) {
    // Wrangler always emits worker.js + worker.js.map + bundle-meta.json +
    // README.md to the outdir. Use a per-(spec,variant) temp dir so
    // simultaneous runs don't clobber, then move the two artefacts we want
    // to stable flat paths matching the esbuild naming convention.
    const tmpDir = resolve(
      root,
      `dist/.wrangler-${spec.outBase.replace('dist/', '')}-${variant.label}`,
    );
    await rm(tmpDir, { recursive: true, force: true });
    await mkdir(tmpDir, { recursive: true });

    const wranglerArgs = [
      'exec',
      'wrangler',
      'deploy',
      '--dry-run',
      '--config',
      spec.config,
      '--outdir',
      tmpDir,
      '--metafile',
    ];
    if (variant.minify) wranglerArgs.push('--minify');

    execFileSync('pnpm', wranglerArgs, { cwd: root, stdio: 'inherit' });

    const finalBundle = resolve(root, `${spec.outBase}${variant.suffix}`);
    const finalMeta = `${finalBundle}.meta.json`;
    await rename(resolve(tmpDir, spec.emittedFile), finalBundle);
    await rename(resolve(tmpDir, 'bundle-meta.json'), finalMeta);
    await rm(tmpDir, { recursive: true, force: true });

    const { size } = await stat(finalBundle);
    const contents = await readFile(finalBundle);
    const gzipped = gzipSync(contents, { level: 9 });
    await writeFile(`${finalBundle}.gz`, gzipped);

    wranglerOutputs.push({
      spec,
      variant,
      outfile: finalBundle,
      bytes: size,
      gzipBytes: gzipped.byteLength,
      metafilePath: finalMeta,
    });
  }
}

console.log('cf-worker bundles (wrangler):');
console.log(
  `  ${'entry'.padEnd(40)}  ${'variant'.padEnd(10)}  ${'raw'.padStart(22)}  ${'gzip (level 9)'.padStart(22)}`,
);
for (const { spec, variant, bytes, gzipBytes } of wranglerOutputs) {
  console.log(
    `  ${spec.label.padEnd(40)}  ${variant.label.padEnd(10)}  ${fmtBytes(bytes)} (${fmtKiB(bytes)})  ${fmtBytes(gzipBytes)} (${fmtKiB(gzipBytes)})`,
  );
}
console.log('');
for (const { spec, variant, metafilePath } of wranglerOutputs) {
  if (variant.label !== 'minified') continue;
  const meta: esbuild.Metafile = JSON.parse(await readFile(metafilePath, 'utf8'));
  console.log(`top 10 inputs — ${spec.label}:`);
  const top = Object.entries(meta.inputs)
    .map(([path, info]) => ({ path, bytes: info.bytes }))
    .sort((a, b) => b.bytes - a.bytes)
    .slice(0, 10);
  for (const { path, bytes } of top) {
    console.log(`  ${(bytes / 1024).toFixed(1).padStart(7)} KiB  ${path}`);
  }
  console.log('');
}
