import WorkerClass from './Worker';
import WaitingLineClass from './waiting-line';
import type { WorkerOptions as WorkerOptionsType } from './types';

// `export =` keeps `require('@koeroesi86/node-worker')` the class itself, the waiting line is a property next to the statics
const Entry = Object.assign(WorkerClass, { WaitingLine: WaitingLineClass });
type Entry = WorkerClass;

declare namespace Entry {
  export type WorkerOptions = WorkerOptionsType;
  export type WaitingLine<Request, Result> = WaitingLineClass<Request, Result>;
}

export = Entry;
