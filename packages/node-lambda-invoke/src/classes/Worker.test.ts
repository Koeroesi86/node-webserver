import fs from 'fs/promises';
import os from 'os';
import path from 'path';
import Worker from './Worker';

describe('Worker', () => {
  it('leaves the output of the process to whoever reads it, instead of logging it itself', async () => {
    const folder = await fs.mkdtemp(path.join(os.tmpdir(), 'worker-'));
    const script = path.join(folder, 'print.js');
    await fs.writeFile(script, "console.log('printed by the worker');");
    const info = jest.spyOn(console, 'info').mockImplementation(() => {});

    try {
      const worker = new Worker(script);
      const output = new Promise<string>((resolve) => worker.stdout?.once('data', (data: Buffer) => resolve(data.toString())));
      await new Promise((resolve) => worker.addEventListenerOnce('close', resolve));

      expect(await output).toContain('printed by the worker');
      expect(info).not.toHaveBeenCalled();
    } finally {
      info.mockRestore();
      await fs.rm(folder, { recursive: true, force: true });
    }
  });
});
