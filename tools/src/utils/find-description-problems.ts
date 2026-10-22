import { findVerificationProblems } from './find-verification-problems';
import { splitSections } from './split-sections';
import { stripPlaceholders } from './strip-placeholders';

/** what is wrong with the description of a pull request compared with the template, empty when nothing is */
export const findDescriptionProblems = (description: string, template: string): string[] => {
  const written = splitSections(description);
  const expected = [...splitSections(template)];
  const present = expected.map(([heading]) => heading).filter((heading) => written.has(heading));

  return [
    // the template says which sections may be deleted
    ...expected.filter(([heading, text]) => !written.has(heading) && !/\bdelete\b/i.test(text)).map(([heading]) => `The section "${heading}" is missing.`),
    ...present
      .filter((heading) => heading !== 'Verification' && stripPlaceholders(written.get(heading) ?? '') === '')
      .map((heading) => `The section "${heading}" is empty or still the template.`),
    ...(present.includes('Verification') ? findVerificationProblems(written.get('Verification') ?? '') : []),
  ];
};
