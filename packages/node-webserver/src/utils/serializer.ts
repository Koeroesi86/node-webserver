const serializer = {
  serialize: (data: unknown) => JSON.stringify(data),
  deserialize: <T>(data: string): T => JSON.parse(data),
};

export default serializer;
