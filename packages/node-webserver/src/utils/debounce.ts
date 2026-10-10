/** calls `fn` once the calls stopped for `wait` milliseconds */
const debounce = (fn: () => void, wait: number) => {
  let timer: NodeJS.Timeout | undefined;

  return () => {
    clearTimeout(timer);
    timer = setTimeout(fn, wait);
  };
};

export default debounce;
