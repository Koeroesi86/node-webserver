/** a timer that does not keep the process alive: what it watches over is no reason to stay up */
const startUnrefTimer = (callback: () => void, delay: number) => setTimeout(callback, delay).unref();

export default startUnrefTimer;
