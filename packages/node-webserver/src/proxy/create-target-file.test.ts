import { existsSync, mkdtempSync, readFileSync, rmSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import createTargetFile from './create-target-file';
import createMockLogger from '../observability/mock-logger.test-helper';

describe('createTargetFile', () => {
  const logger = createMockLogger();
  let folder: string;

  beforeEach(() => {
    jest.clearAllMocks();
    folder = mkdtempSync(join(tmpdir(), 'target-file-'));
  });

  afterEach(() => rmSync(folder, { recursive: true, force: true }));

  it('keeps the last of the targets it is given, and nothing of the ones that are not for the file', async () => {
    const path = join(folder, 'target.json');
    const file = createTargetFile(path, logger);
    const change = { key: 'https a', persistPath: path };

    file.save({ target: 'http://203.0.113.7/', setAt: 1 });
    file.save({ ...change, target: 'http://203.0.113.8/', setAt: 2, expiresAt: 3 });
    await file.saved();

    expect(JSON.parse(readFileSync(path, 'utf8'))).toEqual({ target: 'http://203.0.113.8/', setAt: 2, expiresAt: 3 });
  });

  it('removes the file once the target is removed', async () => {
    const path = join(folder, 'target.json');
    const file = createTargetFile(path, logger);

    file.save({ target: 'http://203.0.113.7/', setAt: 1 });
    file.save({ setAt: 2 });
    await file.saved();

    expect(existsSync(path)).toBe(false);
  });

  it('says that a target cannot be kept, and goes on', async () => {
    const file = createTargetFile(join(folder, 'missing', 'target.json'), logger);

    file.save({ target: 'http://203.0.113.7/', setAt: 1 });
    await file.saved();

    expect(logger.error).toHaveBeenCalledWith(expect.stringContaining('cannot be kept'), expect.anything());
  });
});
