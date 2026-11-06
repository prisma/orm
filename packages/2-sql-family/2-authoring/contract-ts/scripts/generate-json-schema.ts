import { writeFileSync } from 'node:fs';
import { join } from 'pathe';
import { generateDataContractJsonSchema } from '../src/data-contract-json-schema';

const outPath = join(import.meta.dirname, '..', 'schemas', 'data-contract-sql-v1.json');
writeFileSync(outPath, `${JSON.stringify(generateDataContractJsonSchema(), null, 2)}\n`);
console.log(`wrote ${outPath}`);
