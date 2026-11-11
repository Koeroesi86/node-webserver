import { WebSocketCloseCode } from '../constants';
import webSocketConnections from './web-socket-connections';

/** closes every websocket connection that is open with a close frame (1001, going away by default), for a server that is stopping */
const closeWebSockets = (code: number = WebSocketCloseCode.goingAway, reason = 'Going away.') => {
  webSocketConnections.forEach((connection) => connection.close(code, reason));
};

export default closeWebSockets;
