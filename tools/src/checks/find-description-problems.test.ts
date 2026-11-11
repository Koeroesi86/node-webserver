import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { findDescriptionProblems } from './find-description-problems';

const template = readFileSync(resolve(__dirname, '../../../.github/pull_request_template.md'), 'utf8');

const description = `## What and why

Closes #1.

## Changes

- Adds a thing

## Verification

Tried by hand: started the server and requested /

**Not verified:** nothing

## Not in this pull request

Nothing.
`;

describe('findDescriptionProblems', () => {
  it('accepts a filled description, with the sections that may be deleted deleted', () => {
    expect(findDescriptionProblems(description, template)).toEqual([]);
  });

  it('rejects the template itself', () => {
    expect(findDescriptionProblems(template, template)).toEqual(
      expect.arrayContaining([
        'The section "What and why" is empty or still the template.',
        'The section "Changes" is empty or still the template.',
        '"Tried by hand:" in Verification says nothing.',
        '"**Not verified:**" in Verification says nothing (write "nothing" if all was done).',
      ])
    );
  });

  it('names a section that is missing, but not one the template allows to delete', () => {
    expect(findDescriptionProblems(description.replace('## Not in this pull request\n\nNothing.\n', ''), template)).toEqual([
      'The section "Not in this pull request" is missing.',
    ]);
  });

  it('rejects an optional section that is kept but empty', () => {
    expect(findDescriptionProblems(`${description}\n## Release\n\n<!-- which packages -->\n`, template)).toEqual([
      'The section "Release" is empty or still the template.',
    ]);
  });

  it('rejects a verification that lists a check that CI runs', () => {
    expect(findDescriptionProblems(description.replace('started the server', 'pnpm lint and pnpm build, then started the server'), template)).toEqual([
      'Verification lists a check that CI runs; write what was tried by hand.',
    ]);
  });

  it('allows the checks CI runs under Not verified', () => {
    expect(findDescriptionProblems(description.replace('nothing\n', 'the load test, it needs k6\n'), template)).toEqual([]);
  });
});
