import getDate from './get-date';

/** the line of the output of the application or the workers of a server, with the time and the host of the server in front of it */
const labelLine = (hostname: string, text: string) => `[${getDate()}] [${hostname}] ${text}`;

export default labelLine;
