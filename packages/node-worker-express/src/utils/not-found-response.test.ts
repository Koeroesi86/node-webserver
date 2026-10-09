import notFoundResponse from './not-found-response';

describe('notFoundResponse', () => {
  it('answers 404 with the path that does not exist', () => {
    expect(notFoundResponse('/static/missing.html')).toEqual({
      statusCode: 404,
      headers: { 'Content-Type': 'text/plain', 'Cache-Control': 'public, max-age=0' },
      body: '/static/missing.html does not exist',
      isBase64Encoded: false,
    });
  });
});
