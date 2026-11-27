import createPrimaryCertificates from './create-primary-certificates';
import createMockLogger from '../observability/mock-logger.test-helper';
import type { AcmeRenewerContext, CertificateServer } from '../types';

describe('createPrimaryCertificates', () => {
  const server: CertificateServer = { hostname: 'a.example.com', protocol: 'https', acme: { email: 'a@example.com', storagePath: '/acme' } };
  const renewer = { start: jest.fn(async () => undefined), stop: jest.fn(), check: jest.fn(), recheck: jest.fn() };
  const createRenewer = jest.fn((_context: AcmeRenewerContext) => renewer);
  const reload = jest.fn();

  beforeEach(() => jest.clearAllMocks());

  const create = () => createPrimaryCertificates({ logger: createMockLogger(), reload, createRenewer });

  it('orders for the servers of the fronts, with the challenges they answer, and has them load what it got', () => {
    const certificates = create();
    certificates.service.join(jest.fn()).serves({ targets: [], certificates: [server] });

    const context = createRenewer.mock.calls[0][0];

    expect(context.getLoaded()).toEqual([{ instance: server }]);
    expect(context.challenges).toBe(certificates.service.challenges);
    expect(context.reload).toBe(reload);
  });

  it('looks for certificates once it is started, and again for a server that is new then', () => {
    const certificates = create();
    const member = certificates.service.join(jest.fn());
    member.serves({ targets: [], certificates: [server] });
    expect(renewer.recheck).not.toHaveBeenCalled();

    certificates.start();
    member.serves({ targets: [], certificates: [server, { ...server, hostname: 'b.example.com' }] });

    expect(renewer.start).toHaveBeenCalledTimes(1);
    expect(renewer.recheck).toHaveBeenCalledTimes(1);

    certificates.stop();
    member.serves({ targets: [], certificates: [{ ...server, hostname: 'c.example.com' }] });
    expect(renewer.stop).toHaveBeenCalled();
    expect(renewer.recheck).toHaveBeenCalledTimes(1);
  });
});
