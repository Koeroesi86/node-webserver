import { readFileSync } from 'node:fs';
import { EXEMPT_AUTHORS } from '../constants/pull-request-description';
import { findDescriptionProblems } from '../utils';

// Holds the description of a pull request to the template of the repository, exits with 1 and names the problems when it does not fit.
//   PR_AUTHOR=login node check-pull-request.js description.md [.github/pull_request_template.md]

const [descriptionPath = 'description.md', templatePath = '.github/pull_request_template.md'] = process.argv.slice(2);

if (EXEMPT_AUTHORS.includes(process.env.PR_AUTHOR ?? '')) {
  console.log(`Pull requests of ${process.env.PR_AUTHOR} are not checked against the template.`);
} else {
  const problems = findDescriptionProblems(readFileSync(descriptionPath, 'utf8'), readFileSync(templatePath, 'utf8'));

  problems.forEach((problem) => console.error(`::error::${problem}`));
  process.exitCode = problems.length === 0 ? 0 : 1;
}
