/** the packages whose installed version differs, with the new and the old one, of two answers of `readServerVersion` */
const describeVersionChange = (running: string, found: string) => {
  const only = (versions: string, others: string) => versions.split(' ').filter((entry) => !others.split(' ').includes(entry));

  return `${only(found, running).join(', ')} now, instead of ${only(running, found).join(', ')}`;
};

export default describeVersionChange;
