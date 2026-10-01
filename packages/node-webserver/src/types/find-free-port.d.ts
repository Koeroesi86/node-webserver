declare module 'find-free-port' {
  function findFreePort(from: number, to: number, address: string, count: number): Promise<number[]>;

  export = findFreePort;
}
