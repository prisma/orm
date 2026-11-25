import { relative } from 'node:path';
import { ApiListError, flattenPackage } from './flatten.mjs';
import { TypeTextError } from './normalize-type.mjs';
import { ApiReadError, readPackageApi } from './read-api.mjs';

const packageDir = process.argv[2];
try {
  process.send({ lines: flattenPackage(packageDir, readPackageApi(packageDir)) });
} catch (error) {
  const expected =
    error instanceof ApiReadError ||
    error instanceof ApiListError ||
    error instanceof TypeTextError;
  process.send({
    error: expected
      ? error.message
      : `${relative(process.cwd(), packageDir)}: unexpected error: ${error instanceof Error ? error.stack : String(error)}`,
  });
}
