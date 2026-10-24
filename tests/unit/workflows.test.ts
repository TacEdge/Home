import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

// Contract §1.5: every GitHub Action in every workflow is pinned to a full
// commit SHA, with the version tag in a trailing comment so humans (and
// Dependabot) can read it.
const dir = '.github/workflows';
const workflows = readdirSync(dir).filter((f) => /\.ya?ml$/.test(f));

describe('GitHub workflows', () => {
  it('exist', () => {
    expect(workflows).toEqual(
      expect.arrayContaining([
        'ci.yml',
        'migrate.yml',
        'migrate-preview.yml',
        'kev-live-verify.yml',
      ]),
    );
  });

  it.each(workflows)('%s pins every action to a 40-character commit SHA', (file) => {
    const uses = readFileSync(join(dir, file), 'utf8')
      .split('\n')
      .map((l) => l.match(/^\s*-?\s*uses:\s*(\S+)(.*)$/))
      .filter((m): m is RegExpMatchArray => m !== null);
    expect(uses.length).toBeGreaterThan(0);
    for (const [, ref, rest] of uses) {
      expect(ref, `${file}: ${ref}`).toMatch(/^[\w.-]+\/[\w.-]+(\/[\w./-]+)?@[0-9a-f]{40}$/);
      expect(rest, `${file}: ${ref} needs a "# vX.Y.Z" comment`).toMatch(/#\s*v\d+\.\d+\.\d+/);
    }
  });

  it('migrate.yml only runs from main', () => {
    const text = readFileSync(join(dir, 'migrate.yml'), 'utf8');
    expect(text).toMatch(/if:\s*github\.ref == 'refs\/heads\/main'/);
    expect(text).toMatch(/environment:\s*production/);
  });

  it('migrate-preview.yml is dispatch-only, main-only, and never touches production', () => {
    const text = readFileSync(join(dir, 'migrate-preview.yml'), 'utf8');
    // The only trigger is a manual dispatch: no push, schedule or PR event.
    const on = text.match(/^on:\n((?:[ \t]+.*\n)+)/m)?.[1] ?? '';
    expect(on.trim()).toBe('workflow_dispatch:');
    expect(text).toMatch(/if:\s*github\.ref == 'refs\/heads\/main'/);
    expect(text).toMatch(/environment:\s*preview/);
    // The production environment and its credential boundary stay in migrate.yml.
    expect(text).not.toMatch(/environment:\s*production/);
    expect(text).not.toMatch(/migrate-production/);
    expect(text).toMatch(/DATABASE_URL_MIGRATE: \$\{\{ secrets\.DATABASE_URL_MIGRATE \}\}/);
  });

  describe('kev-live-verify.yml (M8 live verification; owner decisions 2-4)', () => {
    const text = () => readFileSync(join(dir, 'kev-live-verify.yml'), 'utf8');
    const job = (name: string) => {
      const t = text();
      const start = t.indexOf(`\n  ${name}:\n`);
      const next = t.slice(start + 1).search(/\n  [a-z-]+:\n/);
      return next < 0 ? t.slice(start) : t.slice(start, start + 1 + next);
    };

    it('runs only on a manual dispatch from main: never on a push, pull request or schedule', () => {
      const on = text().match(/^on:\n((?:[ \t]+.*\n)+)/m)?.[1] ?? '';
      expect(on.split('\n')[0]!.trim()).toBe('workflow_dispatch:');
      expect(on).not.toMatch(
        /^\s{2}(push|pull_request|pull_request_target|schedule|workflow_run|repository_dispatch):/m,
      );
      expect(text()).not.toMatch(
        /^\s*(push|pull_request|pull_request_target|schedule|cron|workflow_run):/m,
      );
      for (const j of ['plan', 'run'])
        expect(job(j)).toMatch(/if: github\.ref == 'refs\/heads\/main'/);
      expect(text()).toMatch(/^permissions:\n {2}contents: read\n/m);
    });

    it('the plan job holds no key, no environment and no database; the run job waits for it and for the owner', () => {
      expect(job('plan')).not.toMatch(/secrets\.|environment:|services:/);
      expect(job('plan')).toMatch(/run: node scripts\/kev-live\/run\.mts --check-plan/);
      expect(job('run')).toMatch(/needs: plan/);
      expect(job('run')).toMatch(/environment: kev-evals/);
      expect(job('run')).toMatch(/run: node scripts\/kev-live\/run\.mts --live/);
    });

    it('the key is the kev-evals secret KEV_EVAL_PROVIDER_KEY, given to the runner step only; no other key name', () => {
      const t = text();
      expect(t.match(/secrets\.[A-Z_]+/g)).toEqual(['secrets.KEV_EVAL_PROVIDER_KEY']);
      expect(t).not.toMatch(/HOME_KEV_PROVIDER_KEY|ANTHROPIC_API_KEY|KEV_LIVE_PROVIDER_KEY/);
      const step = t.slice(
        t.indexOf('- name: Run the approved plan'),
        t.indexOf('run: node scripts/kev-live/run.mts --live'),
      );
      expect(step).toMatch(/KEV_EVAL_PROVIDER_KEY: \$\{\{ secrets\.KEV_EVAL_PROVIDER_KEY \}\}/);
    });

    it('the job’s own Postgres, the fixture seed, never a hosted database; inputs only through env', () => {
      const run = job('run');
      expect(run).toMatch(/image: postgres:16/);
      expect(run).toMatch(/POSTGRES_DB: home_live_verify/);
      expect(run).toMatch(
        /DATABASE_URL: postgres:\/\/home_app:home_app@localhost:5432\/home_live_verify/,
      );
      expect(run).toMatch(/run: pnpm db:seed:fixtures/);
      // Seeded without usage: the live cap check needs a database that counts nothing (ADR 0012 §69).
      const seed = run.slice(
        run.indexOf('- name: Seed the fixture family'),
        run.indexOf('run: pnpm db:seed:fixtures'),
      );
      expect(seed).toMatch(/HOME_SEED_FIXTURES_USAGE: none/);
      expect(text()).not.toMatch(/neon|HOME_REAL_DATA|VERCEL/i);
      // Dispatch inputs never interpolated into a shell command.
      expect(text()).not.toMatch(/run: .*\$\{\{/);
      expect(run).toMatch(/upload-artifact@[0-9a-f]{40}/);
    });

    it('a campaign batch’s declared unrecorded spend (ADR 0012 §76) is an optional input, given to both checks through env only', () => {
      expect(text()).toMatch(/\n {6}campaign_spent_usd:\n(?: {8}.*\n)*? {8}required: false\n/);
      for (const j of ['plan', 'run'])
        expect(job(j)).toMatch(
          /KEV_LIVE_CAMPAIGN_SPENT_USD: \$\{\{ inputs\.campaign_spent_usd \}\}/,
        );
    });
  });

  it('ci.yml runs the previous-schema check and its self-test with full history (migration-first)', () => {
    const text = readFileSync(join(dir, 'ci.yml'), 'utf8');
    const job = text.slice(
      text.indexOf('Lint, typecheck, unit and integration tests'),
      text.indexOf('\n  bundle:'),
    );
    expect(job).toMatch(/fetch-depth: 0/);
    const build = job.indexOf('run: pnpm build');
    const check = job.indexOf('run: node scripts/check-previous-schema.mts --boot');
    const self = job.indexOf('run: node scripts/check-previous-schema.mts --self-test');
    // The boot check needs the build; the self-test leaves a broken schema, so it runs last.
    expect(build).toBeGreaterThan(0);
    expect(check).toBeGreaterThan(build);
    expect(self).toBeGreaterThan(check);
  });

  describe('risk-based browser verification (ADR 0010)', () => {
    const text = () => readFileSync(join(dir, 'ci.yml'), 'utf8');
    const e2e = () => text().slice(text().indexOf('\n  e2e:'));

    it('the four required check names are unchanged', () => {
      for (const name of [
        'Secret scan (gitleaks)',
        'Lint, typecheck, unit and integration tests',
        'Vercel bundle build',
        'End-to-end (Playwright)',
      ])
        expect(text()).toContain(`name: ${name}\n`);
    });

    it('no job is skipped at the job level and the browser job waits for nothing', () => {
      // A skipped required job counts as passing on GitHub: none may have a job-level `if`.
      for (const m of text().matchAll(/^  [a-z0-9-]+:\n((?:    .*\n|\n)*)/gm)) {
        const header = m[1]!.split('\n').filter((l) => /^    [a-z-]+:/.test(l));
        expect(
          header.some((l) => /^    if:/.test(l)),
          m[0].split('\n')[0],
        ).toBe(false);
      }
      expect(e2e()).not.toMatch(/^    needs:/m);
    });

    it('the selection step runs first, cannot be ignored, and an unknown answer fails the job', () => {
      const job = e2e();
      expect(job).toMatch(/id: select\n\s+run: node scripts\/ci-select\.mts --ci/);
      expect(job).not.toMatch(/continue-on-error/);
      const guard = job.slice(job.indexOf('Refuse an unrecognised selection'));
      expect(guard).toMatch(/steps\.select\.outputs\.mode != 'none'/);
      expect(guard).toMatch(/steps\.select\.outputs\.mode != 'targeted'/);
      expect(guard).toMatch(/steps\.select\.outputs\.mode != 'full'/);
      expect(guard).toMatch(/exit 1/);
      expect(job.indexOf('id: select')).toBeLessThan(
        job.indexOf('Refuse an unrecognised selection'),
      );
      expect(job.indexOf('Refuse an unrecognised selection')).toBeLessThan(
        job.indexOf('pnpm test:e2e'),
      );
    });

    it('full regression and selected specs each run only on their own mode; specs pass through env', () => {
      const job = e2e();
      expect(job).toMatch(/if: steps\.select\.outputs\.mode == 'full'\n\s+run: pnpm test:e2e/);
      expect(job).toMatch(/if: steps\.select\.outputs\.mode == 'targeted'/);
      expect(job).toMatch(
        /SPECS: \$\{\{ steps\.select\.outputs\.specs \}\}\n\s+run: pnpm exec playwright test \$SPECS/,
      );
      // Never interpolated into a shell command.
      expect(job).not.toMatch(/run: .*\$\{\{ steps\.select/);
    });

    it('main, the nightly run and manual runs trigger the workflow (always full)', () => {
      expect(text()).toMatch(/push:\n\s+branches: \[main\]/);
      expect(text()).toMatch(/schedule:\n\s+- cron: '[^']+'/);
      expect(text()).toMatch(/workflow_dispatch:/);
      expect(text()).toMatch(/types: \[opened, synchronize, reopened, labeled, unlabeled\]/);
    });

    it('the browser job never runs Playwright with more than one worker', () => {
      expect(e2e()).not.toMatch(/--workers|--shard|fullyParallel/);
      expect(readFileSync('playwright.config.ts', 'utf8')).toMatch(/workers: 1,/);
    });
  });

  it('dependabot covers github-actions', () => {
    const text = readFileSync('.github/dependabot.yml', 'utf8');
    expect(text).toMatch(/package-ecosystem:\s*github-actions/);
  });
});
