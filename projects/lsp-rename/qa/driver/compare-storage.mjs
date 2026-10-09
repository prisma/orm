import { readFileSync } from 'node:fs';
import { isDeepStrictEqual } from 'node:util';

const [, , beforeDir, ...afterDirs] = process.argv;
const read = (dir) => JSON.parse(readFileSync(`${dir}/contract.json`, 'utf8'));

function storageNames(contract) {
  const names = [];
  for (const [namespaceId, namespace] of Object.entries(contract.storage.namespaces ?? {})) {
    for (const [kind, entries] of Object.entries(namespace.entries ?? {})) {
      for (const [name, entry] of Object.entries(entries)) {
        names.push(`${namespaceId}.${kind}.${name}`);
        for (const column of Object.keys(entry?.columns ?? {})) {
          names.push(`${namespaceId}.${kind}.${name}.${column}`);
        }
        if (typeof entry?.typeName === 'string') {
          names.push(`${namespaceId}.${kind}.${name} typeName=${entry.typeName}`);
        }
      }
    }
  }
  return names.sort();
}

const before = read(beforeDir);
console.log(`${beforeDir}: storageHash ${before.storageHash ?? before.storage?.storageHash}`);
for (const name of storageNames(before)) console.log(`  ${name}`);
for (const dir of afterDirs) {
  const after = read(dir);
  const sameNames = isDeepStrictEqual(storageNames(after), storageNames(before));
  const sameStorage = isDeepStrictEqual(after.storage, before.storage);
  console.log(
    `${dir}: storageHash ${after.storageHash ?? after.storage?.storageHash}; storage names equal: ${sameNames ? 'yes' : 'NO'}; storage section equal: ${sameStorage ? 'yes' : 'NO'}`,
  );
  if (!sameNames) for (const name of storageNames(after)) console.log(`  ${name}`);
  console.log(`  roots: ${JSON.stringify(Object.keys(after.roots ?? {}))}`);
}
