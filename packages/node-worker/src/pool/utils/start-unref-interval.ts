/** like `startUnrefTimer`, repeated: an interval that does not keep the process alive */
const startUnrefInterval = (callback: () => void, delay: number) => setInterval(callback, delay).unref();

export default startUnrefInterval;
