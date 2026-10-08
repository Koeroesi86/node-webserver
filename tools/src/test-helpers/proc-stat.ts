/** the first lines of /proc/stat */
export const procStat = (user: number, system: number, idle: number, steal: number) =>
  `cpu  ${user} 0 ${system} ${idle} 0 0 0 ${steal} 0 0\ncpu0 1 1 1 1 0 0 0 1 0 0\n`;
