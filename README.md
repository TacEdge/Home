# HOME

A private family operating system for one household, powered by **Kev**.

This repository holds the product documentation, the M0 experience prototype (reference only), and the production application.

- Start with [`CLAUDE.md`](./CLAUDE.md) — the operating rules for anyone (human or AI) working here.
- Product and architecture: [`docs/`](./docs/).
- Current milestone: **M1 — Foundations**, code complete ([`docs/m1/M1-BUILD-CONTRACT.md`](./docs/m1/M1-BUILD-CONTRACT.md)).

## Local development

Requirements: Node 22 (see `.nvmrc`), pnpm 10, Docker (for Postgres).

```sh
pnpm install
cp .env.example .env.local     # then fill in values — never commit this file
pnpm dev
```

Full steps, including the database and tests, are in [`docs/runbooks/LOCAL-DEV.md`](./docs/runbooks/LOCAL-DEV.md). Deployment: [`docs/runbooks/DEPLOY.md`](./docs/runbooks/DEPLOY.md). Migrations: [`docs/runbooks/MIGRATIONS.md`](./docs/runbooks/MIGRATIONS.md).

## Scripts

| Script | Purpose |
|---|---|
| `pnpm dev` | Run the app locally |
| `pnpm build` / `pnpm start` | Production build and serve |
| `pnpm lint` | ESLint + Prettier check |
| `pnpm typecheck` | TypeScript, strict |
| `pnpm test` | Unit tests |
| `pnpm test:integration` | Integration tests against Postgres |
| `pnpm test:e2e` | Playwright end-to-end |

## Privacy

No real family information belongs in this repository — not in code, docs, fixtures, tests or screenshots. Tests use a synthetic fixture family. Secrets live only in environment configuration.
