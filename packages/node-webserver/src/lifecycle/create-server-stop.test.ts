import createGracefulStop from './create-graceful-stop';
import createServerStop from './create-server-stop';

jest.mock('./create-graceful-stop', () => ({ __esModule: true, default: jest.fn() }));

describe('createServerStop', () => {
  it('closes every loaded server with the time that is left once the listening ones stopped', async () => {
    const close = jest.fn(async () => undefined);
    createServerStop([], () => [{ close }, { close }] as never);
    const stopBehind = jest.mocked(createGracefulStop).mock.calls[0][1];

    await stopBehind(3);

    expect(close.mock.calls).toEqual([[3], [3]]);
  });
});
