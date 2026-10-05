# HOME

A private family operating system for one household, powered by **Kev**.

This repository holds the product documentation, the M0 experience prototype (reference only), and the production application.

- Start with [`CLAUDE.md`](./CLAUDE.md) — the operating rules for anyone (human or AI) working here.
- Product and architecture: [`docs/`](./docs/).
- Current milestone: **M4 — Calendar Integration**, in progress on synthetic data ([`docs/m4/M4-BUILD-CONTRACT.md`](./docs/m4/M4-BUILD-CONTRACT.md)). M3 is code complete and audited ([`docs/m3/M3-ACCEPTANCE.md`](./docs/m3/M3-ACCEPTANCE.md)); its owner acceptance waits on the restore rehearsal. M2 is complete; M1 is deployed with its acceptance items open (`docs/runbooks/DEPLOY.md` §E). The Production real-data gate is closed.

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
