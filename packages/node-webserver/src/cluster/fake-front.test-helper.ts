import type { FrontHandle, FrontMessage, FrontProcess, PrimaryMessage } from '../types';

export interface FakeFront {
  front: FrontProcess;
  sent: PrimaryMessage[];
  killed: boolean;
  say: (message: FrontMessage | string) => void;
  exit: (code: number | null, signal?: string) => void;
}

/** a fork that starts no process, and the fronts it was asked for */
export const createFakeFork = () => {
  const fronts: FakeFront[] = [];

  const fork = (front: FrontProcess): FrontHandle => {
    let message: (value: unknown) => void = () => {};
    let exit: (code: number | null, signal: string | null) => void = () => {};
    const fake: FakeFront = {
      front,
      sent: [],
      killed: false,
      say: (value) => message(value),
      exit: (code, signal) => exit(code, signal ?? null),
    };
    fronts.push(fake);

    return {
      pid: 100 + fronts.length,
      send: (value) => fake.sent.push(value),
      kill: () => {
        fake.killed = true;
        fake.exit(null, 'SIGKILL');
      },
      onMessage: (listener) => (message = listener),
      onExit: (listener) => (exit = listener),
    };
  };

  return { fork, fronts };
};
