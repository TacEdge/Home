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
      expect.arrayContaining(['ci.yml', 'migrate.yml', 'migrate-preview.yml']),
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
