import FrontCountError from './front-count-error';

describe('FrontCountError', () => {
  it('says both numbers', () => {
    expect(new FrontCountError(2, 4).message).toContain('2 front processes instead of 4');
  });
});
