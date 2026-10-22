/**
 * Checks the files that a branch adds against the layout rules of CLAUDE.md (kebab-case names, an export from the index.ts of the folder, one export and a test
 * for a file of utils/), for CI and for .claude/hooks/standards-gate.sh. Existing files are not checked.
 *
 * Usage: node check-layout.js [base], the base defaults to origin/master. Exits with 1 and lists the problems.
 */
import { resolve } from 'node:path';
import { findLayoutProblems, listAddedFiles, readFile } from '../utils';

// compiled to tools/dist/scripts, the workspace root is three levels up
const rootPath = resolve(__dirname, '../../..');
const problems = findLayoutProblems(listAddedFiles(rootPath, process.argv[2] ?? 'origin/master'), (path) => readFile(resolve(rootPath, path)));

problems.forEach((problem) => console.error(`layout of CLAUDE.md: ${problem}`));
process.exit(problems.length > 0 ? 1 : 0);
