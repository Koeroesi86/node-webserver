import type { HeaderMap } from '../types';

const lowerCaseHeaders = (headers: HeaderMap): HeaderMap => Object.fromEntries(Object.entries(headers).map(([name, value]) => [name.toLowerCase(), value]));

export default lowerCaseHeaders;
