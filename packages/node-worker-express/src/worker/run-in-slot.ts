/** Takes a slot, gets what the request needs and serves it with the way to give the slot back. The slot is given back when getting or serving fails, so no way out of here leaks it. Gives false when no slot was left. */
const runInSlot = async <T>(take: () => (() => void) | undefined, acquire: () => Promise<T>, serve: (acquired: T, releaseSlot: () => void) => void) => {
  const releaseSlot = take();
  if (!releaseSlot) return false;

  try {
    serve(await acquire(), releaseSlot);
    return true;
  } catch (error) {
    releaseSlot();
    throw error;
  }
};

export default runInSlot;
