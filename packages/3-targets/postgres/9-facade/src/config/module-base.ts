declare const __PRISMA_PUBLISHED_MODULE_BASE__POSTGRES: string | undefined;

export const moduleBase =
  typeof __PRISMA_PUBLISHED_MODULE_BASE__POSTGRES === 'string'
    ? __PRISMA_PUBLISHED_MODULE_BASE__POSTGRES
    : '@internal/postgres';

export const configModule = `${moduleBase}/config`;
