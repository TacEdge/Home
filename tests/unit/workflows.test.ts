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

  it('dependabot covers github-actions', () => {
    const text = readFileSync('.github/dependabot.yml', 'utf8');
    expect(text).toMatch(/package-ecosystem:\s*github-actions/);
  });
});
