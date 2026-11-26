/** the servers would run on another number of fronts than the server was started with, which takes new fronts */
class FrontCountError extends Error {
  constructor(found: number, running: number) {
    super(`The servers would run on ${found} front processes instead of ${running}, which takes new ones.`);
    this.name = 'FrontCountError';
  }
}

export default FrontCountError;
