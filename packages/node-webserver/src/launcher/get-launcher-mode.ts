import { LAUNCHER_ENV } from '../constants';
import type { LauncherMode } from '../types';

const given = process.send ? process.env[LAUNCHER_ENV] : undefined;
// read and removed when the module is loaded, before the environment is copied for the fronts and everything they start, which no launcher started
delete process.env[LAUNCHER_ENV];
const mode: LauncherMode | undefined = given === 'start' || given === 'restart' ? given : undefined;

/** how the launcher started this process, undefined when no launcher did */
const getLauncherMode = () => mode;

export default getLauncherMode;
