const { readFileSync } = require('fs');
const os = require('os');

// Describes the machine a load test ran on, as the numbers of shared runners differ a lot between machines.
//   node runner.js snapshot [/proc/stat] [/proc/cpuinfo]    prints what is known now as JSON, to be called before and after the test
//   node runner.js report before.json [after.json]          prints a markdown table for the job summary

const read = (path) => {
  try {
    return readFileSync(path, 'utf8');
  } catch {
    return undefined;
  }
};

/** the model of the processor, `/proc/cpuinfo` knows it on Linux */
const getCpuModel = (cpuInfo) => cpuInfo?.match(/^(?:model name|Model|Hardware)\s*:\s*(.+)$/m)?.[1].trim() ?? os.cpus()[0]?.model ?? 'unknown';

/**
 * The time of all cores since boot, and how much of it was steal: time that the hypervisor gave to other virtual machines
 * while this one wanted to run. The line is `cpu user nice system idle iowait irq softirq steal ...`
 */
const getCpuTimes = (stat) => {
  const fields = stat
    ?.match(/^cpu\s+(.+)$/m)?.[1]
    .trim()
    .split(/\s+/)
    .map(Number);

  return fields === undefined || fields.length < 8
    ? undefined
    : {
        total: fields.slice(0, 8).reduce((sum, value) => sum + value, 0),
        steal: fields[7],
      };
};

const snapshot = (statPath = '/proc/stat', cpuInfoPath = '/proc/cpuinfo') => ({
  cpuModel: getCpuModel(read(cpuInfoPath)),
  cores: os.availableParallelism(),
  times: getCpuTimes(read(statPath)),
});

/** the share of the time between two snapshots that was steal, in percent, undefined when it is not known or no time passed */
const stealPercent = (before, after) => {
  if (before?.times === undefined || after?.times === undefined) return undefined;
  const total = after.times.total - before.times.total;

  return total > 0 ? ((after.times.steal - before.times.steal) / total) * 100 : undefined;
};

const report = (before, after) => {
  const steal = stealPercent(before, after);

  return [
    '### Runner',
    '',
    '| | |',
    '| --- | --- |',
    `| Processor | ${before.cpuModel} |`,
    `| Cores | ${before.cores} |`,
    `| Steal time during the test | ${steal === undefined ? 'n/a' : `${steal.toFixed(1)}%`} |`,
    '',
    ...(steal !== undefined && steal > 5
      ? ['⚠️ The machine was held back by its host for a noticeable part of the test, the numbers of this run say little.', '']
      : []),
  ].join('\n');
};

module.exports = { getCpuModel, getCpuTimes, stealPercent, snapshot, report };

if (require.main === module) {
  const [command, ...args] = process.argv.slice(2);

  if (command === 'snapshot') {
    console.log(JSON.stringify(snapshot(...args)));
  } else if (command === 'report') {
    const [beforePath, afterPath] = args;
    console.log(report(JSON.parse(readFileSync(beforePath, 'utf8')), afterPath === undefined ? undefined : JSON.parse(readFileSync(afterPath, 'utf8'))));
  } else {
    console.error('Usage: runner.js snapshot [stat] [cpuinfo] | runner.js report before.json [after.json]');
    process.exit(1);
  }
}
