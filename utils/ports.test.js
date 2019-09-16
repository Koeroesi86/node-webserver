const { findPorts, getFreePort, clearPorts, getPorts, addPort } = require("./ports");
const { PORT_LOOKUP } = require(process.env.NODE_WEBSERVER_CONFIG || '../configuration');
const fp = require('find-free-port');

jest.mock('find-free-port');

describe('The ports', () => {
  beforeEach(() => {
    clearPorts();
  });

  it('should lookup free ports in the given range', done => {
    const mockedResult = Array(PORT_LOOKUP.to - PORT_LOOKUP.from).fill(1).map((_, i) => PORT_LOOKUP.from + i);
    fp.mockReturnValue(Promise.resolve(mockedResult));
    findPorts()
      .then(ports => {
        expect(ports.length).toEqual(PORT_LOOKUP.to - PORT_LOOKUP.from);
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
