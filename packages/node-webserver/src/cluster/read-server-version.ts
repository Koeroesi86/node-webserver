import fs from 'fs';
import { resolve } from 'path';
import { PACKAGE_ROOT } from '../constants';

/** the version of the package of the server as it is installed now, which an update changes while the processes that run keep their code */
const readServerVersion = (root = PACKAGE_ROOT): string => String(JSON.parse(fs.readFileSync(resolve(root, 'package.json'), 'utf8')).version);

export default readServerVersion;
