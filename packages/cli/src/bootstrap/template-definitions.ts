export interface TemplateEntry {
  name: string
  label: string
}

export const CURATED_TEMPLATES: TemplateEntry[] = [
  { name: 'nextjs', label: 'Next.js' },
  { name: 'express', label: 'Express' },
  { name: 'hono', label: 'Hono' },
  { name: 'fastify', label: 'Fastify' },
  { name: 'nuxt', label: 'Nuxt' },
  { name: 'sveltekit', label: 'SvelteKit' },
  { name: 'remix', label: 'Remix' },
  { name: 'react-router-7', label: 'React Router 7' },
  { name: 'astro', label: 'Astro' },
  { name: 'nest', label: 'NestJS' },
]
