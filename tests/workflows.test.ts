import { describe, expect, it } from 'vitest';
import { readdirSync, readFileSync } from 'node:fs';
import { parse } from 'yaml';

// a workflow file that is not valid YAML fails on GitHub in 0 s and the site is not deployed (17/11/2026: ": " in run-name)
describe('GitHub workflows', () => {
  for (const f of readdirSync('.github/workflows').filter((x) => /\.ya?ml$/.test(x)))
    it(`${f} is valid YAML with jobs`, () => {
      const d = parse(readFileSync(`.github/workflows/${f}`, 'utf8'));
      expect(d.jobs).toBeTruthy();
    });
  it('pages.yml accepts what the review worker sends for a scheduled run', () => {
    const d = parse(readFileSync('.github/workflows/pages.yml', 'utf8'));
    expect(Object.keys(d.on.workflow_dispatch.inputs)).toEqual(expect.arrayContaining(['trigger', 'slot', 'from', 'to', 'profile', 'requested_by']));
  });
});
