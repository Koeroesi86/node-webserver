import { CI_COMMAND, NOT_VERIFIED, TRIED_BY_HAND } from '../constants/pull-request-description';
import { stripPlaceholders } from './strip-placeholders';

/** what is wrong with the Verification section: a part that says nothing, or a check that CI runs listed as tried */
export const findVerificationProblems = (verification: string): string[] => {
  const tried = stripPlaceholders(verification.match(TRIED_BY_HAND)?.[1] ?? '');
  const notVerified = stripPlaceholders(verification.match(NOT_VERIFIED)?.[1] ?? '');

  return [
    ...(tried === '' ? ['"Tried by hand:" in Verification says nothing.'] : []),
    ...(notVerified === '' ? ['"**Not verified:**" in Verification says nothing (write "nothing" if all was done).'] : []),
    ...(CI_COMMAND.test(tried) ? ['Verification lists a check that CI runs; write what was tried by hand.'] : []),
  ];
};
