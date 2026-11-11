import notFoundResponse from './not-found-response';

describe('notFoundResponse', () => {
  it('answers 404 without repeating the path', () => {
    expect(notFoundResponse()).toEqual({
      statusCode: 404,
      headers: { 'Content-Type': 'text/plain', 'Cache-Control': 'public, max-age=0' },
      body: 'The requested path does not exist.',
      isBase64Encoded: false,
    });
  });
});
