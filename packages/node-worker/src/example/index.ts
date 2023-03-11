import Worker from '../Worker';

const worker = new Worker('ts-node ./script.ts', {
  stdio: 'inherit',
  cwd: __dirname,
});

process.once('exit', () => {
  worker.terminate();
});
