const {findPorts, getFreePort, clearPorts, getPorts, addPort} = require("./ports");
const {PORT_LOOKUP} = require('../configuration');
const assert = require('assert');

describe('The ports', () => {
    beforeEach(() => {
        clearPorts();
    });

    it('should lookup free ports in the given range', done => {
        findPorts()
            .then(ports => {
                assert.equal(ports.length, PORT_LOOKUP.to - PORT_LOOKUP.from);
                done();
            });
    });

    it('should maintain PORTS', () => {
        addPort(1000);

        const freePort = getFreePort();

        assert.equal(freePort, 1000);
        assert.equal(getPorts().length, 0);
    });
});