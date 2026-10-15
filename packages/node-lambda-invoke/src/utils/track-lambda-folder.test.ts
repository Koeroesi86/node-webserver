import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import trackLambdaFolder from './track-lambda-folder';

describe('trackLambdaFolder', () => {
  it('hooks the process exit only while a folder is tracked, once for all of them', () => {
    const before = process.listenerCount('exit');

    const untrackFirst = trackLambdaFolder('/lambda-a');
    const untrackSecond = trackLambdaFolder('/lambda-b');
    expect(process.listenerCount('exit')).toBe(before + 1);

    untrackFirst();
    expect(process.listenerCount('exit')).toBe(before + 1);
    untrackSecond();
    expect(process.listenerCount('exit')).toBe(before);
  });

  it('removes the folders that are still tracked when the process exits, and not those that were released', () => {
    const [kept, released] = [fs.mkdtempSync(path.join(os.tmpdir(), 'lambda-kept-')), fs.mkdtempSync(path.join(os.tmpdir(), 'lambda-released-'))];
    const untrack = trackLambdaFolder(kept);
    trackLambdaFolder(released)();

    // the listener of the module only, as the test runner has its own
    process.listeners('exit').at(-1)?.call(process, 0);
    untrack();

    expect(fs.existsSync(kept)).toBe(false);
    expect(fs.existsSync(released)).toBe(true);
    fs.rmSync(released, { recursive: true, force: true });
  });
});
