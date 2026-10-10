import { compareFiles } from '../utils/compare-files';

// Compares the k6 summaries of the base of a pull request with the ones of the pull request itself, both measured in the same job.
//   node compare.js --base base-1.json base-2.json ... --head head-1.json head-2.json ... [--base-cpu ...] [--head-cpu ...] [--base-binary ...] [--head-binary ...]
// Prints markdown for the job summary and exits with 1 when the pull request is clearly slower. The limits are in constants/comparison-limits.ts, and
// can be set with MAX_THROUGHPUT_DROP, MAX_P95_INCREASE, MAX_CPU_P95_INCREASE and MIN_P95_DIFFERENCE_MS.
// The summaries of the CPU bound run (cpu.ts) come after --base-cpu and --head-cpu, the ones of the binary run (binary.ts) after --base-binary and --head-binary, and both are optional.

// the files after --base are the runs of the base, the ones after --head the runs of the pull request
const groups = new Map<string, string[]>(['--base', '--head', '--base-cpu', '--head-cpu', '--base-binary', '--head-binary'].map((name) => [name, []]));
process.argv.slice(2).reduce<string[] | undefined>((current, argument) => {
  const next = groups.get(argument);
  if (next === undefined) current?.push(argument);

  return next ?? current;
}, undefined);

const { markdown, passed } = compareFiles({
  base: groups.get('--base') ?? [],
  head: groups.get('--head') ?? [],
  baseCpu: groups.get('--base-cpu'),
  headCpu: groups.get('--head-cpu'),
  baseBinary: groups.get('--base-binary'),
  headBinary: groups.get('--head-binary'),
});
console.log(markdown);
process.exit(passed ? 0 : 1);
