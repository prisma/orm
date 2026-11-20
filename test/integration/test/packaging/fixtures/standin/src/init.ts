import type { InitContribution } from '@prisma/orm-toolchain/cli/init-contribution';

const STARTER = `// use prisma-8

model User {
  id    Int    @id @default(autoincrement())
  email String @unique
}
`;

const contribution: InitContribution = {
  label: 'Stand-in',
  configModule: 'prisma-orm-standin/config',
  peerPackages: [],
  authoringModes: ['psl'],
  starterContract: () => STARTER,
  contractSample: () => `\`\`\`prisma\n${STARTER}\`\`\``,
  databaseFile: () => `import 'dotenv/config';
import standin from 'prisma-orm-standin/runtime';
import { contractFromJson } from 'prisma-orm-standin/static';
import type { Contract } from './contract.d.js';
import contractJson from './contract.json' with { type: 'json' };

export const contract = contractFromJson<Contract>(contractJson);

export const db = standin({
  contract,
  url: process.env['DATABASE_URL']!,
});
`,
  envExample: () => 'DATABASE_URL="postgresql://user:password@localhost:5432/mydb"\n',
  quickReference: (input) =>
    `# Stand-in\n\nEdit ${input.schemaPath}, then run \`${input.cliCommand} contract emit\`.\n${input.requirements}\n`,
};

export default contribution;
