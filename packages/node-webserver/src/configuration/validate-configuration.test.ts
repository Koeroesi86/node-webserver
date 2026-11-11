import exampleConfiguration from '../configuration.example';
import validateConfiguration from './validate-configuration';

const find = (configuration: object) => validateConfiguration(configuration).map(({ setting, message }) => `${setting} ${message}`);

describe('validateConfiguration', () => {
  it('finds nothing in the example configuration, nor in an empty one', () => {
    expect(find(exampleConfiguration)).toEqual([]);
    expect(find({})).toEqual([]);
  });

  it('leaves the servers to validateServers, the paths and definitions alike', () => {
    expect(find({ servers: ['a.js', { nothing: true }] })).toEqual([]);
  });

  it('finds a setting that is not one, and wrong types, all at once', () => {
    expect(find({ portHtp: 80, portHttp: '80', http2: 'yes', servers: [1], fileLogPath: true })).toEqual(
      expect.arrayContaining(['portHtp is not a setting', 'portHttp must be integer', 'http2 must be boolean', 'servers[0] must be object, or must be string'])
    );
    expect(find({ fileLogPath: true })).toEqual(['fileLogPath must be false, or must be string']);
  });

  it('finds the two ports being the same', () => {
    expect(find({ portHttp: 8080, portHttps: 8080 })).toEqual(['portHttps listens on the port of portHttp too: 8080']);
    expect(find({ portHttp: 0, portHttps: 0 })).toEqual([]);
  });

  it('finds a page for unknown hosts that is not a file', () => {
    expect(find({ unknownHostPage: '/does/not/exist.html' })).toEqual(['unknownHostPage is not a file: /does/not/exist.html']);
    expect(find({ unknownHostPage: __filename })).toEqual([]);
  });

  it('finds a range of ports that ends before it starts', () => {
    expect(find({ portLookup: { from: 3010, to: 3000, address: 'localhost' } })).toEqual(['portLookup starts above where it ends']);
  });
});
