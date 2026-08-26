import 'dotenv/config';
import { definePrismaConfig } from '@prisma/cli-engine';
import { defineConfig as ormConfig } from '@prisma/orm-postgres/config';

const rawContractSource = process.env['PRISMA_NEXT_CONTRACT_SOURCE'];
const contractSource =
  rawContractSource === undefined || rawContractSource === '' ? 'psl' : rawContractSource;
if (contractSource !== 'psl' && contractSource !== 'ts') {
  throw new Error(
    `PRISMA_NEXT_CONTRACT_SOURCE must be 'ts' or 'psl' (got: ${JSON.stringify(contractSource)}).`,
  );
}

// Left undefined when DATABASE_URL is not set so emit-only flows
// (`prisma contract emit`, CI typegen) work in fresh checkouts.
export default definePrismaConfig({
  orm: ormConfig({
    contract: contractSource === 'ts' ? './src/prisma/contract.ts' : './src/prisma/contract.prisma',
    ...(process.env['DATABASE_URL'] !== undefined && {
      db: { connection: process.env['DATABASE_URL'] },
    }),
  }),
});
