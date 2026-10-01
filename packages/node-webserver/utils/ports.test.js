const { findPorts, getFreePort, clearPorts, getPorts, addPort } = require("./ports");
const { portLookup } = require('../configuration.example');
const fp = require('find-free-port');

jest.mock('find-free-port');

describe('The ports', () => {
  beforeEach(() => {
    clearPorts();
  });

  it('should lookup free ports in the given range', done => {
    const mockedResult = Array(portLookup.to - portLookup.from).fill(1).map((_, i) => portLookup.from + i);
    fp.mockReturnValue(Promise.resolve(mockedResult));
    findPorts(portLookup)
      .then(ports => {
        expect(ports.length).toEqual(portLookup.to - portLookup.from);
        done();
      });
  });

  it('should maintain PORTS', () => {
    addPort(1000);

    const freePort = getFreePort();

    expect(freePort).toEqual([1000]);
    expect(getPorts().length).toEqual(0);
  });
});
