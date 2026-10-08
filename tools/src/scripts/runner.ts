import { readFileSync } from 'node:fs';
import { buildRunnerReport } from '../utils/build-runner-report';
import { takeSnapshot } from '../utils/take-snapshot';

// Describes the machine a load test ran on, as the numbers of shared runners differ a lot between machines.
//   node runner.js snapshot [/proc/stat] [/proc/cpuinfo]    prints what is known now as JSON, to be called before and after the test
//   node runner.js report before.json [after.json]          prints a markdown table for the job summary

const [command, ...args] = process.argv.slice(2);

if (command === 'snapshot') {
  const [statPath, cpuInfoPath] = args;
  console.log(JSON.stringify(takeSnapshot(statPath, cpuInfoPath)));
} else if (command === 'report') {
  const [beforePath, afterPath] = args;
  console.log(
    buildRunnerReport(JSON.parse(readFileSync(beforePath, 'utf8')), afterPath === undefined ? undefined : JSON.parse(readFileSync(afterPath, 'utf8')))
  );
} else {
  console.error('Usage: runner.js snapshot [stat] [cpuinfo] | runner.js report before.json [after.json]');
  process.exit(1);
}
