import createFrontServices from './create-front-services';

describe('createFrontServices', () => {
  it('passes everything about a front on to every service, in their order', () => {
    const calls: string[] = [];
    const service = (name: string) => ({
      join: jest.fn(() => ({
        hello: () => calls.push(`${name} hello`),
        receive: () => calls.push(`${name} receive`),
        serves: () => calls.push(`${name} serves`),
        leave: () => calls.push(`${name} leave`),
      })),
    });
    const services = [service('first'), service('second')];
    const send = jest.fn();

    const member = createFrontServices(services).join(send);
    member.hello();
    member.receive({ nodeWebserver: 'challenge-taken', token: 'a' });
    member.serves({ targets: [], certificates: [] });
    member.leave();

    services.forEach(({ join }) => expect(join).toHaveBeenCalledWith(send));
    expect(calls).toEqual(['hello', 'receive', 'serves', 'leave'].flatMap((what) => [`first ${what}`, `second ${what}`]));
  });
});
