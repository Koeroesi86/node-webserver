import createHstsHandler from './create-hsts-handler';
import type { Request, Response } from 'express';

const header = (hsts: Parameters<typeof createHstsHandler>[0]) => {
  const setHeader = jest.fn();
  const next = jest.fn();

  createHstsHandler(hsts)({} as Request, { setHeader } as unknown as Response, next);

  expect(next).toHaveBeenCalledWith();
  return setHeader.mock.calls;
};

describe('createHstsHandler', () => {
  it('sends a year by default', () => {
    expect(header(true)).toEqual([['Strict-Transport-Security', 'max-age=31536000']]);
  });

  it('sends what was asked for', () => {
    expect(header({ maxAge: 60, includeSubDomains: true, preload: true })).toEqual([['Strict-Transport-Security', 'max-age=60; includeSubDomains; preload']]);
  });

  it('can send a max age of 0, which makes browsers forget the host', () => {
    expect(header({ maxAge: 0 })).toEqual([['Strict-Transport-Security', 'max-age=0']]);
  });
});
