import { parseAssignments } from './parse-assignments';

describe('parseAssignments', () => {
  it('has a property for every NAME=value word', () => {
    expect(parseAssignments('ACCESS_LOGS=1  WORKERS_PER_PATH=2')).toEqual({ ACCESS_LOGS: '1', WORKERS_PER_PATH: '2' });
  });

  it('keeps everything after the first = in the value', () => {
    expect(parseAssignments('TOKEN=a=b')).toEqual({ TOKEN: 'a=b' });
  });

  it('is empty for nothing, or for words that are not assignments', () => {
    expect(parseAssignments(undefined)).toEqual({});
    expect(parseAssignments('')).toEqual({});
    expect(parseAssignments('word =value')).toEqual({});
  });
});
