/** the authors whose pull requests are not written by a person, so there is no description to hold to the template */
export const EXEMPT_AUTHORS = ['dependabot[bot]'];

/** commands that the pipeline runs, so a description that lists them as tried by hand says nothing */
export const CI_COMMAND = /\bpnpm (lint|build|test|test:coverage|test:integration|quality|fallow|fallow:ci|load-test|docs:build)\b/;

export const TRIED_BY_HAND = /Tried by hand:([\s\S]*?)(?=\*\*Not verified:\*\*|$)/;

export const NOT_VERIFIED = /\*\*Not verified:\*\*([\s\S]*)$/;
