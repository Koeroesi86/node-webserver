import path from 'path';
import createWorkerCommand, { workerCommands } from './create-worker-command';

describe('createWorkerCommand', () => {
  const invoke = path.resolve(__dirname, '../workerInvoke.js');

  it('runs a JavaScript worker through the invoker', () => {
    expect(createWorkerCommand('/app/worker.js')).toEqual(['node', '--expose-gc', invoke, '/app/worker.js']);
  });

  it('falls back to the JavaScript command for an extension without an entry', () => {
    expect(createWorkerCommand('/app/worker.unknown')).toEqual(['node', '--expose-gc', invoke, '/app/worker.unknown']);
  });

  it('keeps a path with spaces in one argument', () => {
    expect(createWorkerCommand('/my app/worker.js').pop()).toBe('/my app/worker.js');
  });

  it('uses the entry of an extension that was added to the map', () => {
    workerCommands['.py'] = (workerPath) => ['python', workerPath];

    try {
      expect(createWorkerCommand('/app/worker.py')).toEqual(['python', '/app/worker.py']);
    } finally {
      delete workerCommands['.py'];
    }
  });
});
