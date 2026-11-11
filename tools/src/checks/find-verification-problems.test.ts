import { findVerificationProblems } from './find-verification-problems';

describe('findVerificationProblems', () => {
  it('finds nothing in a filled verification', () => {
    expect(findVerificationProblems('\nTried by hand: requested /\n\n**Not verified:** nothing\n')).toEqual([]);
  });

  it('names a part that is only the comment of the template', () => {
    expect(findVerificationProblems('Tried by hand: <!-- what -->\n\n**Not verified:** <!-- why -->\n')).toHaveLength(2);
  });

  it('names a command that CI runs', () => {
    expect(findVerificationProblems('Tried by hand: pnpm quality\n\n**Not verified:** nothing\n')).toEqual([
      'Verification lists a check that CI runs; write what was tried by hand.',
    ]);
  });
});
