import { version } from '../../package.json' with { type: 'json' };

export const DRIVER_INFO = { name: 'Prisma', version } as const;
