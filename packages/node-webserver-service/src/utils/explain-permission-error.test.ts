import explainPermissionError from './explain-permission-error';

describe('explainPermissionError', () => {
  it.each(['EACCES', 'EPERM'])('answers a %s error with the message', (code) => {
    const result = explainPermissionError(Object.assign(new Error('denied'), { code }), 'run this as root');

    expect(result).toEqual(new Error('run this as root'));
  });

  it('keeps an error of another code', () => {
    const error = Object.assign(new Error('gone'), { code: 'ENOENT' });

    expect(explainPermissionError(error, 'run this as root')).toBe(error);
  });

  it.each([undefined, 'text', new Error('no code')])('keeps %p', (error) => {
    expect(explainPermissionError(error, 'run this as root')).toBe(error);
  });
});
