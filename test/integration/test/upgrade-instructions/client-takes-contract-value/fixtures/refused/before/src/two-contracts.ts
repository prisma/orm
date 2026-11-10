import postgres from '@prisma/orm-postgres/runtime';
import type { Contract as AuditContract } from './audit/contract.d';
import auditContractJson from './audit/contract.json' with { type: 'json' };
import type { Contract } from './contract.d';
import contractJson from './contract.json' with { type: 'json' };

export const db = postgres<Contract>({ contractJson });
export const auditDb = postgres<AuditContract>({ contractJson: auditContractJson });
