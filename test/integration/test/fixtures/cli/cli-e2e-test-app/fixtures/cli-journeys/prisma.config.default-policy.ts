// A TypeScript contract with a default control policy, read from
// `prisma/contract.ts`, where the journey copies `contract-default-policy.ts`.
import { defineConfig as postgres } from '@internal/postgres/config';
import { definePrismaConfig } from '@prisma/cli-engine';

export default definePrismaConfig({
  orm: postgres({ contract: './prisma/contract.ts' }),
});
