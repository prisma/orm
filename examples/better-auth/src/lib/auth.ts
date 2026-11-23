import { prismaAdapter } from '@prisma/orm-better-auth';
import { betterAuth } from 'better-auth';
import { db } from './db';

export const auth = betterAuth({
  database: prismaAdapter(db),
  emailAndPassword: { enabled: true },
});
