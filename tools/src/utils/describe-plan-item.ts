import type { PlanItem } from '../types/version';

export const describePlanItem = ({ item, published, reason }: PlanItem, newVersion: string) =>
  `${item.packageJson.name}: ${reason ? newVersion : published?.version} (${reason ?? 'unchanged, already published'})`;
