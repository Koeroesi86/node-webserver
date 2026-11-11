/** the websocket connections that are open, to close them when the process stops */
const webSocketConnections = new Set<{ close: (code?: number, reason?: string) => void }>();

export default webSocketConnections;
