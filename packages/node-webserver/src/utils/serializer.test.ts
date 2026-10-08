import serializer from './serializer';

describe('serializer', () => {
  it('turns data into JSON and back', () => {
    const data = { statusCode: 200, headers: { 'x-a': ['1', '2'] }, body: 'ő' };

    expect(serializer.serialize(data)).toBe(JSON.stringify(data));
    expect(serializer.deserialize(serializer.serialize(data))).toEqual(data);
  });

  it('throws on data that is not JSON', () => {
    expect(() => serializer.deserialize('{not json')).toThrow(SyntaxError);
  });
});
