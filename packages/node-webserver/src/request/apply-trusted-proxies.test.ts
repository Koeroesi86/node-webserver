import type { Express } from 'express';
import applyTrustedProxies from './apply-trusted-proxies';

const createApp = () => ({ set: jest.fn() }) as unknown as Express;

describe('applyTrustedProxies', () => {
  it('gives every app the same list when it is not split by protocol', () => {
    const http = createApp();
    const https = createApp();

    applyTrustedProxies(['loopback'], [http], [https]);

    expect(http.set).toHaveBeenCalledWith('trust proxy', ['loopback']);
    expect(https.set).toHaveBeenCalledWith('trust proxy', ['loopback']);
  });

  it('gives each protocol its own list', () => {
    const http = createApp();
    const https = createApp();

    applyTrustedProxies({ http: ['10.0.0.0/8'], https: ['loopback'] }, [http], [https]);

    expect(http.set).toHaveBeenCalledWith('trust proxy', ['10.0.0.0/8']);
    expect(https.set).toHaveBeenCalledWith('trust proxy', ['loopback']);
  });

  it('trusts nothing for a protocol that is left out', () => {
    const https = createApp();

    applyTrustedProxies({ http: ['loopback'] }, [], [https]);

    expect(https.set).toHaveBeenCalledWith('trust proxy', []);
  });
});
