import type { FrontService } from '../types';

/** all that the primary keeps for its fronts as one, in the order it is given: a front is told by one after the other when it listens */
const createFrontServices = (services: FrontService[]): FrontService => ({
  join: (send) => {
    const members = services.map((service) => service.join(send));

    return {
      hello: () => members.forEach((member) => member.hello()),
      receive: (message) => members.forEach((member) => member.receive(message)),
      serves: (report) => members.forEach((member) => member.serves(report)),
      leave: () => members.forEach((member) => member.leave()),
    };
  },
});

export default createFrontServices;
