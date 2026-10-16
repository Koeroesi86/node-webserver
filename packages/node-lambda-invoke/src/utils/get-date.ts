const pad = (value: number, length = 2) => String(value).padStart(length, '0');

/** the local time as `YYYY-MM-DD HH:mm:ss.SS`, with hundredths of a second, as the lines of the lambdas have always been prefixed */
const getDate = (now = new Date()) => {
  const date = [now.getFullYear(), now.getMonth() + 1, now.getDate()].map((part, index) => pad(part, index === 0 ? 4 : 2)).join('-');
  const time = [now.getHours(), now.getMinutes(), now.getSeconds()].map((part) => pad(part)).join(':');

  return `${date} ${time}.${pad(Math.floor(now.getMilliseconds() / 10))}`;
};

export default getDate;
