import fs from 'fs/promises';
import os from 'os';
import path from 'path';
import type { Request, Response } from 'express';
import createTargetResolver from './create-target-resolver';
import { uncachedProbe } from './create-probe';

describe('createTargetResolver', () => {
  let root: string;

  beforeAll(async () => {
    root = await fs.mkdtemp(path.join(os.tmpdir(), 'target-resolver-'));
    await fs.mkdir(path.join(root, 'app'));
    await fs.writeFile(path.join(root, 'app', 'worker.js'), '');
    await fs.writeFile(path.join(root, 'file.txt'), '');
  });

  afterAll(() => fs.rm(root, { recursive: true, force: true }));

  const request = {} as Request;
  const createResponse = () => ({ writeHead: jest.fn(), end: jest.fn() }) as never as Response & { writeHead: jest.Mock; end: jest.Mock };
  const setup = (params = {}) => {
    const onForbiddenPath = jest.fn();
    const findRoute = jest.fn((): { worker: string; pathParameters?: Record<string, string> } | undefined => undefined);
    const resolve = createTargetResolver({
      rootPath: root,
      index: ['worker.js'],
      fallthrough: true,
      probe: uncachedProbe,
      findRoute,
      onForbiddenPath,
      answersMissingPaths: true,
      ...params,
    });
    const run = (pathname: string, response = createResponse()) =>
      resolve(request, response, pathname, pathname.split('/').filter(Boolean)).then((target) => ({ target, response }));

    return { onForbiddenPath, findRoute, run };
  };

  it('hands a forbidden path to the handler of it', async () => {
    const { onForbiddenPath, run } = setup();
    const response = createResponse();

    await expect(run('/../x', response)).resolves.toMatchObject({ target: undefined });

    expect(onForbiddenPath).toHaveBeenCalledWith(request, response);
  });

  it('answers 404 for a path without a route when routes do not fall through', async () => {
    const { run } = setup({ fallthrough: false });

    const { target, response } = await run('/app/worker.js');

    expect(target).toBeUndefined();
    expect(response.writeHead).toHaveBeenCalledWith(404, expect.anything());
    expect(response.end).toHaveBeenCalledWith('Not found.');
  });

  it('goes to the worker of a route, with its path parameters', async () => {
    const { findRoute, run } = setup({ fallthrough: false });
    findRoute.mockReturnValue({ worker: '/routed.js', pathParameters: { id: '1' } });

    const { target } = await run('/items/1');

    expect(target).toEqual({ indexPath: '/routed.js', isWorker: true, targetExists: true, pathParameters: { id: '1' } });
  });

  it('finds the worker file in the root', async () => {
    const { run } = setup();

    const { target } = await run('/app/worker.js');

    expect(target).toMatchObject({ indexPath: path.join(root, 'app', 'worker.js'), isWorker: true });
  });

  it('leaves a file that no worker answers to the static worker', async () => {
    const { run } = setup();

    const { target } = await run('/file.txt');

    expect(target).toMatchObject({ isWorker: false, targetExists: true });
  });

  it('answers a missing path with the 404 of the static worker, with its length', async () => {
    const { run } = setup();

    const { target, response } = await run('/missing.txt');

    expect(target).toBeUndefined();
    expect(response.writeHead).toHaveBeenCalledWith(404, expect.objectContaining({ 'Content-Length': expect.any(Number) }));
    expect(response.end).toHaveBeenCalledTimes(1);
  });

  it('leaves a missing path to another static worker', async () => {
    const { run } = setup({ answersMissingPaths: false });

    const { target, response } = await run('/missing.txt');

    expect(target).toMatchObject({ isWorker: false, targetExists: false });
    expect(response.end).not.toHaveBeenCalled();
  });

  it('remembers a path that was found without asking the file system again', async () => {
    const exists = jest.fn(uncachedProbe.exists);
    const { run } = setup({ probe: { ...uncachedProbe, exists } });

    await run('/app/worker.js');
    const calls = exists.mock.calls.length;
    const { target } = await run('/app/worker.js');

    expect(exists.mock.calls.length).toBe(calls);
    expect(target).toMatchObject({ isWorker: true, targetExists: true });
  });

  it('does not remember a path that is not there', async () => {
    const exists = jest.fn(uncachedProbe.exists);
    const { run } = setup({ probe: { ...uncachedProbe, exists }, answersMissingPaths: false });

    await run('/missing.txt');
    const calls = exists.mock.calls.length;
    await run('/missing.txt');

    expect(exists.mock.calls.length).toBeGreaterThan(calls);
  });
});
