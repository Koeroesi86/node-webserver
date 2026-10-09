import type { Agent } from 'http';

/** closes the connections of an agent once they are idle: the requests on them finish, none of them is used again */
const retireAgent = (agent: Agent) => {
  agent.on('free', (socket) => socket.destroy());
  Object.values(agent.freeSockets).forEach((sockets) => sockets?.forEach((socket) => socket.destroy()));
};

export default retireAgent;
