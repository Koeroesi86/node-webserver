import createFrontReload from './create-front-reload';
import createMockLogger from '../observability/mock-logger.test-helper';
import { FrontCountError } from '../cluster';

describe('createFrontReload', () => {
  const logger = createMockLogger();
  const send = jest.fn();

  beforeEach(() => jest.clearAllMocks());

  const create = () => {
    const prepared: Array<{ instances: []; commit: jest.Mock; discard: jest.Mock }> = [];
    const server = {
      prepare: jest.fn(() => {
        prepared.push({ instances: [], commit: jest.fn(), discard: jest.fn() });
        return prepared[prepared.length - 1];
      }),
      report: jest.fn((servers?: object) => ({
        files: ['a.js'],
        fingerprint: servers ? 'new' : 'running',
        singleFrontOnly: false,
        targets: [],
        certificates: [],
      })),
    };
    return { reload: createFrontReload(server, send, logger), server, prepared };
  };

  it('prepares the servers and answers with the fingerprint of what it prepared, without serving it', () => {
    const { reload, prepared } = create();

    reload.prepare(1);

    expect(send.mock.calls).toEqual([[{ nodeWebserver: 'prepared', round: 1, fingerprint: 'new' }]]);
    expect(prepared[0].commit).not.toHaveBeenCalled();
  });

  it.each(['commit', 'discard'] as const)('does a %s of the round it prepared once, and tells which files to watch then', (how) => {
    const { reload, prepared } = create();
    reload.prepare(1);
    send.mockClear();

    reload[how](1);
    reload[how](1);

    expect(prepared[0][how]).toHaveBeenCalledTimes(1);
    expect(send.mock.calls).toEqual([[{ nodeWebserver: 'files', files: ['a.js'], singleFrontOnly: false, targets: [], certificates: [] }]]);
  });

  it('leaves the round it holds alone for another one', () => {
    const { reload, prepared } = create();
    reload.prepare(2);

    reload.commit(1);

    expect(prepared[0].commit).not.toHaveBeenCalled();
  });

  it('closes what it holds for an earlier round before it prepares the next one', () => {
    const { reload, prepared } = create();

    reload.prepare(1);
    reload.prepare(2);

    expect(prepared[0].discard).toHaveBeenCalled();
    expect(prepared[1].discard).not.toHaveBeenCalled();
  });

  it('answers with the reason when the servers cannot be loaded, and still tells which files to watch', () => {
    const { reload, server } = create();
    server.prepare.mockImplementation(() => {
      throw new Error('broken');
    });

    reload.prepare(3);
    reload.commit(3);

    expect(send.mock.calls).toEqual([
      [{ nodeWebserver: 'prepare-failed', round: 3, reason: 'broken' }],
      [{ nodeWebserver: 'files', files: ['a.js'], singleFrontOnly: false, targets: [], certificates: [] }],
    ]);
    expect(logger.error).toHaveBeenCalled();
  });

  it('tells the primary when the servers need another number of fronts', () => {
    const { reload, server } = create();
    server.prepare.mockImplementation(() => {
      throw new FrontCountError(1, 2);
    });

    reload.prepare(1);

    expect(send.mock.calls[0][0]).toMatchObject({ nodeWebserver: 'prepare-failed', recount: true });
  });
});
