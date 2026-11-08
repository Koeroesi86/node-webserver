import validateServiceName from './validate-service-name';

describe('validateServiceName', () => {
  it('accepts a name that is safe in a file name', () => {
    expect(validateServiceName('node-webserver_1.prod')).toBe('node-webserver_1.prod');
  });

  it.each(['', 'a b', '../etc/x', 'a/b', 'a;rm', '-rf', '.hidden', undefined, 5])('rejects %p', (name) => {
    expect(() => validateServiceName(name)).toThrow('Invalid serviceName');
  });
});
