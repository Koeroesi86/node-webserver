/** a websocket client broke the protocol, `code` is the close code it is closed with */
class WsProtocolError extends Error {
  constructor(readonly code: number, message: string) {
    super(message);
    this.name = 'WsProtocolError';
  }
}

export default WsProtocolError;
