import Worker = require('./index');
import WorkerClass from './Worker';
import WaitingLineClass from './waiting-line';

describe('entry', () => {
  it('is the Worker class itself, with the waiting line next to it', () => {
    expect(Worker).toBe(WorkerClass);
    expect(Worker.WaitingLine).toBe(WaitingLineClass);
  });
});
