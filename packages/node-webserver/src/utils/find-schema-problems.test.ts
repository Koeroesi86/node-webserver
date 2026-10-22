import findSchemaProblems from './find-schema-problems';
import getSchemaValidator from './get-schema-validator';

const server = (extra: object = {}) => ({ hostname: 'a.localhost', protocol: 'http', ...extra });
const find = (data: unknown) =>
  findSchemaProblems(getSchemaValidator('/definitions/server'), data, 'http://a.localhost').map(({ setting, message }) => `${setting} ${message}`);

describe('findSchemaProblems', () => {
  it('finds nothing in a valid server, functions included', () => {
    expect(find(server({ type: 'worker', options: { root: '/', limitPerPath: () => 1, onStdout: () => {} } }))).toEqual([]);
  });

  it('accepts rules that redirect or rewrite, and names those that do both, neither or lack a status', () => {
    expect(
      find(
        server({
          rules: [
            { path: '/a', redirect: '/b', status: 301 },
            { pattern: '/x/(?<id>.+)', flags: 'i', methods: ['GET'], rewrite: '/y/{id}' },
          ],
        })
      )
    ).toEqual([]);
    expect(find(server({ rules: [{ path: '/a' }] }))).not.toEqual([]);
    expect(find(server({ rules: [{ path: '/a', redirect: '/b' }] }))).not.toEqual([]);
    expect(find(server({ rules: [{ path: '/a', redirect: '/b', status: 303 }] }))).not.toEqual([]);
    expect(find(server({ rules: [{ path: '/a', redirect: '/b', status: 301, rewrite: '/c' }] }))).not.toEqual([]);
    expect(find(server({ rules: [{ path: '/a', rewrite: '/c', status: 301 }] }))).not.toEqual([]);
    expect(find(server({ rules: [{ path: '/a', pattern: '/b', rewrite: '/c' }] }))).not.toEqual([]);
    expect(find(server({ rules: [{ path: '/a', rewrite: 'c' }] }))).not.toEqual([]);
  });

  it('accepts defaultHost as a flag only', () => {
    expect(find(server({ defaultHost: true }))).toEqual([]);
    expect(find(server({ defaultHost: 'yes' }))).not.toEqual([]);
  });

  it('accepts the redirect and HSTS settings as a flag or as options, and names a status that is not one', () => {
    expect(find(server({ protocol: 'https', redirectHttp: true, hsts: { maxAge: 60, preload: true } }))).toEqual([]);
    expect(find(server({ protocol: 'https', redirectHttp: { status: 301 }, hsts: false }))).toEqual([]);
    expect(find(server({ protocol: 'https', redirectHttp: { status: 302 } }))).not.toEqual([]);
  });

  it('wants the email and the storage of acme, and names a setting of it that does not exist', () => {
    expect(find(server({ protocol: 'https', acme: { email: 'a@example.com', storagePath: '/var/lib/nws', renewBeforeDays: 20 } }))).toEqual([]);
    expect(find(server({ protocol: 'https', acme: { email: 'a@example.com', agree: true } }))).toEqual([
      'acme.storagePath is required',
      'acme.agree is not a setting',
    ]);
  });

  it('names a setting that does not exist', () => {
    expect(find(server({ proxyOption: {} }))).toEqual(['proxyOption is not a setting']);
  });

  it('names a setting of the wrong type, and the place of a nested one', () => {
    expect(find(server({ type: 'worker', options: { root: '/', limit: 'many' } }))).toEqual(['options.limit must be integer']);
  });

  it('names the required settings of the type of the server', () => {
    expect(find(server({ type: 'worker' }))).toEqual(['options is required']);
    expect(find(server({ type: 'child' }))).toEqual(['childOptions is required', 'proxyOptions is required', 'serverOptions is required']);
  });

  it('lists the values a setting may have', () => {
    expect(find(server({ type: 'ftp' }))).toEqual(['type must be one of: child, lambda, proxy, worker']);
  });

  it('reports all of the problems together', () => {
    expect(find({ protocol: 'ftp', typo: true, compression: { level: 12 } })).toEqual(
      expect.arrayContaining(['hostname is required', 'protocol must be one of: http, https', 'typo is not a setting', 'compression.level must be <= 9'])
    );
  });

  it('says once what a value that can be one of several things is not', () => {
    expect(find(server({ type: 'worker', options: { root: '/', limitPerPath: 'x' } }))).toEqual([
      'options.limitPerPath must be a function, or must be integer',
    ]);
  });

  it('puts the position of a route in its place', () => {
    expect(find(server({ type: 'worker', options: { root: '/', routes: [{ worker: 'a.js' }] } }))).toEqual([
      'options.routes[0] path is required, or pattern is required',
    ]);
  });

  it('marks the problems with the server they are in', () => {
    expect(findSchemaProblems(getSchemaValidator('/definitions/server'), {}, 'x')[0]).toEqual({
      severity: 'error',
      server: 'x',
      setting: 'hostname',
      message: 'is required',
    });
  });
});
