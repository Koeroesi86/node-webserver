import type { IdleWorker } from '../types';

/** a spare of a path goes before the last worker of a path, and the one that was used longest ago before the others */
const goesBefore = (candidate: IdleWorker, other: IdleWorker) => (candidate.spare !== other.spare ? candidate.spare : candidate.lastUsed < other.lastUsed);

/** The idle worker to stop first to make room. */
const pickIdleWorker = (candidates: Array<IdleWorker | undefined>): IdleWorker | undefined =>
  candidates
    .filter((candidate): candidate is IdleWorker => candidate !== undefined)
    .reduce<IdleWorker | undefined>((best, candidate) => (best === undefined || goesBefore(candidate, best) ? candidate : best), undefined);

export default pickIdleWorker;
