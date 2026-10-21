/** visits the items in order until `visit` answers `false`, which stops the source early (an async generator runs its cleanup). Tells whether every item was visited. */
const forEachWhile = async <T>(source: AsyncIterable<T>, visit: (item: T) => Promise<boolean>): Promise<boolean> => {
  const iterator = source[Symbol.asyncIterator]();
  const step = async (): Promise<boolean> => {
    const { done, value } = await iterator.next();
    return done === true || ((await visit(value)) && step());
  };

  try {
    return await step();
  } finally {
    await iterator.return?.();
  }
};

export default forEachWhile;
