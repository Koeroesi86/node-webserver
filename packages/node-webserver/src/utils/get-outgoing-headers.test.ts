import getOutgoingHeaders from './get-outgoing-headers';

describe('getOutgoingHeaders', () => {
  it('leaves out the headers of the connection, the ones it names and the ones asked for', () => {
    expect(
      getOutgoingHeaders(
        {
          connection: 'keep-alive, X-Hop',
          'keep-alive': 'timeout=5',
          'transfer-encoding': 'chunked',
          upgrade: 'websocket',
          expect: '100-continue',
          'x-hop': 'yes',
          server: 'provider',
          'set-cookie': ['a=1', 'b=2'],
          'content-type': 'text/plain',
        },
        ['server']
      )
    ).toEqual({ 'set-cookie': ['a=1', 'b=2'], 'content-type': 'text/plain' });
  });
});
