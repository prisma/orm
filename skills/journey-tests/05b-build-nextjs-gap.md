# Journey 05b — Next.js gap (no first-party plugin yet)

**Skills under test:** `prisma-next-build`, `prisma-next-feedback`.

**Acceptance criterion:** AC8b (Next.js prompt) from `specs/usage-skill.spec.md`.

## Setup

A fresh Next.js project (`pnpm create next-app`) into which `prisma orm init` has been run.

## Prompt

> do the same as Vite, but in Next.js

(Following journey 05 in which the user successfully set up the Vite plugin.)

## Expected agent behaviour

- [ ] Skill matcher fires on `prisma-next-build` (description contains "next plugin", "next.js plugin", "withPrismaNext").
- [ ] Agent surfaces the *What PN doesn't do yet* entry: no first-party Next.js plugin exists.
- [ ] Agent does NOT fabricate `@internal/next` or `withPrismaNext` — those packages / exports do not exist.
- [ ] Agent recommends the workaround:
   1. Add a `prebuild` script to `package.json` running `prisma contract emit`.
   2. Run `prisma contract emit` manually during development when the contract source changes, or wire a `tsx --watch` script.
- [ ] Agent asks the user if they want to file a feature request and, if yes, routes to the `prisma-next-feedback` skill (does NOT open an issue without explicit user confirmation).

## Success criteria

- [ ] No fabricated `@internal/next` / `withPrismaNext` / `@internal/next-plugin-contract-emit` imports in any file the agent touches.
- [ ] `package.json` contains a `prebuild` script that runs `prisma contract emit`.
- [ ] The user is offered the `prisma-next-feedback` route for filing a request.
