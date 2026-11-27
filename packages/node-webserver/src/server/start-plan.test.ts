import startPlan from './start-plan';
import createServerPlan from './create-server-plan';
import { sendMessage } from '../cluster';

jest.mock('./create-server-plan', () => ({ __esModule: true, default: jest.fn(() => ({ frontCount: 2 })) }));
jest.mock('../cluster', () => ({ sendMessage: jest.fn(async () => undefined) }));

describe('startPlan', () => {
  // a test process can have a channel of its own, to the one that runs the tests
  const original = Object.getOwnPropertyDescriptor(process, 'channel');
  const ref = jest.fn();

  beforeEach(() => Object.defineProperty(process, 'channel', { configurable: true, writable: true, value: { ref } }));

  afterEach(() => {
    jest.restoreAllMocks();
    if (original) Object.defineProperty(process, 'channel', original);
    else Reflect.deleteProperty(process, 'channel');
  });

  it('answers with the plan of the server and ends, once the answer left', async () => {
    const exit = jest.spyOn(process, 'exit').mockImplementation(() => undefined as never);

    await startPlan({ portHttp: 80 }, '/configuration.js');

    expect(ref).toHaveBeenCalled();
    expect(createServerPlan).toHaveBeenCalledWith({ portHttp: 80 }, '/configuration.js');
    expect(sendMessage).toHaveBeenCalledWith({ nodeWebserver: 'plan', plan: { frontCount: 2 } });
    expect(exit).toHaveBeenCalledWith(0);
  });
});
