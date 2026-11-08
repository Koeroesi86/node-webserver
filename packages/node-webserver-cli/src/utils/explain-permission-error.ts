/** the error to throw for a failed write: the message for a permission error, the error itself for any other */
const explainPermissionError = (error: unknown, message: string): unknown =>
  typeof error === 'object' && error !== null && 'code' in error && (error.code === 'EACCES' || error.code === 'EPERM') ? new Error(message) : error;

export default explainPermissionError;
