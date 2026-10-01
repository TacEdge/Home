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
    expect(workflows).toEqual(expect.arrayContaining(['ci.yml', 'migrate.yml']));
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

  it('dependabot covers github-actions', () => {
    const text = readFileSync('.github/dependabot.yml', 'utf8');
    expect(text).toMatch(/package-ecosystem:\s*github-actions/);
  });
});
