import { InternalServerError } from '../constants';
import answerWorkerFailure from './answer-worker-failure';

describe('answerWorkerFailure', () => {
  beforeEach(() => jest.spyOn(console, 'error').mockImplementation(() => {}));

  afterEach(() => jest.restoreAllMocks());

  it('logs the error and answers a request that was not answered', () => {
    const respond = jest.fn();
    const error = new Error('failed');

    answerWorkerFailure(respond, () => false)(error);

    expect(console.error).toHaveBeenCalledWith(error);
    expect(respond).toHaveBeenCalledWith(InternalServerError);
  });

  it('logs the error but does not answer a second time', () => {
    const respond = jest.fn();

    answerWorkerFailure(respond, () => true)(new Error('failed'));

    expect(console.error).toHaveBeenCalledTimes(1);
    expect(respond).not.toHaveBeenCalled();
  });
});
