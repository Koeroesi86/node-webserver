import { AUTOMERGE_LABEL } from '../constants/merge-queue';
import type { OpenPullRequest } from '../types/merge-queue';

/** whether the label asks for auto-merge that is not on yet. A pull request from a fork is left alone: its author does not decide what merges */
export const needsAutoMerge = ({ isDraft, isCrossRepository, autoMergeRequest, labels }: OpenPullRequest): boolean =>
  !isDraft && !isCrossRepository && !autoMergeRequest && labels.nodes.some(({ name }) => name === AUTOMERGE_LABEL);
