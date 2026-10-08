/** the version of a release: year, month, the id of the run and the name of the branch, for example 26.10.123-main */
export const createVersion = (date: Date, runId: string, refName: string) =>
  `${`${date.getFullYear()}`.substring(2)}.${`${date.getMonth() + 1}`.padStart(2, '0')}.${runId}-${refName.replace(/\//g, '-')}`;
