import { spawnSync } from 'node:child_process';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

describe('check-pull-request script', () => {
  let folder = '';
  let template = '';

  beforeAll(() => {
    folder = mkdtempSync(join(tmpdir(), 'check-pull-request-'));
    template = join(folder, 'template.md');
    writeFileSync(template, '## What and why\n\n<!-- why -->\n');
  });

  afterAll(() => rmSync(folder, { recursive: true, force: true }));

  const run = (body: string, author = 'someone') => {
    const description = join(folder, 'description.md');
    writeFileSync(description, body);

    return spawnSync('node', [resolve(__dirname, '../../dist/scripts/check-pull-request.js'), description, template], {
      encoding: 'utf8',
      env: { ...process.env, PR_AUTHOR: author },
    });
  };

  it('succeeds for a description that fits the template', () => {
    expect(run('## What and why\n\nBecause.\n').status).toBe(0);
  });

  it('fails and names the problem as an error annotation', () => {
    const result = run('## What and why\n\n<!-- why -->\n');

    expect(result.status).toBe(1);
    expect(result.stderr).toContain('::error::The section "What and why" is empty or still the template.');
  });

  it('does not check the pull requests of dependabot', () => {
    expect(run('', 'dependabot[bot]').status).toBe(0);
  });
});
