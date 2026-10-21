const pad = (value: number, length = 2) => String(value).padStart(length, '0');

/** the date and time down to the second, kept for as long as the second lasts: it is the same for all the lines that are logged in it */
let cachedSecond = -1;
let cachedPrefix = '';

/** the local time as `YYYY-MM-DD HH:mm:ss.SS`, with hundredths of a second */
const getDate = () => {
  const now = Date.now();
  const second = Math.floor(now / 1000);

  if (second !== cachedSecond) {
    const date = new Date(now);
    cachedSecond = second;
    cachedPrefix = `${pad(date.getFullYear(), 4)}-${pad(date.getMonth() + 1)}-${pad(date.getDate())} ${pad(date.getHours())}:${pad(date.getMinutes())}:${pad(
      date.getSeconds()
    )}`;
  }

  return `${cachedPrefix}.${pad(Math.floor((now % 1000) / 10))}`;
};

export default getDate;
