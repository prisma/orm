import { flattenPackage } from './flatten.mjs';
import { readPackageApi } from './read-api.mjs';

const packageDir = process.argv[2];
try {
  process.send({ lines: flattenPackage(packageDir, readPackageApi(packageDir)) });
} catch (error) {
  process.send({ error: error instanceof Error ? error.message : String(error) });
}
