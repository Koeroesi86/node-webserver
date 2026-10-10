/** resolves once `idle` does, or after the timeout, whichever comes first */
const untilIdle = async (idle: () => Promise<void>, timeout: number) => {
  let timer: NodeJS.Timeout | undefined;
  await Promise.race([idle(), new Promise<void>((resolve) => (timer = setTimeout(resolve, timeout)))]);
  clearTimeout(timer);
};

export default untilIdle;
