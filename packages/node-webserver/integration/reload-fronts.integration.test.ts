import os from 'os';
import { until } from './helpers/reloaded-folder';
import { startServer } from './helpers/start-server';
import { createVersionedServers } from './helpers/versioned-servers';
import type { RunningServer } from './helpers/start-server';

const hosts = ['inline-worker.localhost', 'inline-lambda.localhost', 'filed.localhost'];
// a single core runs one front, whatever is asked for
const processes = os.availableParallelism() < 2 ? [1] : [1, 2];

interface Answer {
  version: string;
  front: number;
}

describe.each(processes)('the server with %i front processes, when the files of its servers change', (fronts) => {
  const servers = createVersionedServers();
  let server: RunningServer;

  /** the versions and the fronts a host answers with, over enough requests that every front gets some */
  const ask = async (host: string) => {
    const replies = await Promise.all(Array.from({ length: 4 * fronts }, () => server.get(host)));
    const answers = replies.filter(({ status }) => status === 200).map((reply) => reply.json() as Answer);

    return { versions: Array.from(new Set(answers.map(({ version }) => version))), fronts: new Set(answers.map(({ front }) => front)).size };
  };

  const answersEverywhere = async (host: string, version: string) => {
    const answered = await ask(host);
    return answered.versions.length === 1 && answered.versions[0] === version && answered.fronts === fronts;
  };

  /** every front serves the version of every host, for a test to start from: they do not depend on each other, as a test that fails is run again */
  const serve = async (version: string) => {
    servers.reset(version);
    for (const host of hosts) {
      await until(server, () => answersEverywhere(host, version));
    }
  };

  beforeAll(async () => {
    servers.reset('first');
    server = await startServer({ VERSIONED_SERVERS: servers.folder, SYSTEM_LOGS: 'true', ...(fronts > 1 && { FRONT_PROCESSES: `${fronts}` }) });
  });

  afterAll(async () => {
    await server.stop();
    servers.remove();
  });

  it.each([
    ['worker of a server of the configuration', 'inline-worker.localhost', servers.writeWorker],
    ['lambda of a server of the configuration', 'inline-lambda.localhost', servers.writeLambda],
    ['file of a server', 'filed.localhost', servers.writeServer],
  ])('picks up a changed %s in every front', async (_, host, change) => {
    await serve('second');

    change('third');

    await until(server, () => answersEverywhere(host, 'third'));
  });

  it('picks up nothing in any front while a file is broken', async () => {
    await serve('fourth');
    const failures = () => server.output().split('The servers were not loaded again').length;
    const before = failures();

    servers.breakServer();

    await until(server, () => failures() > before);
    expect(await answersEverywhere('filed.localhost', 'fourth')).toBe(true);
  });
});
