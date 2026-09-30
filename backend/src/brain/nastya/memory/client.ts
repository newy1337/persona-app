import type { UsageRow } from '../llm/usage';

export interface UsageDb {
  record(row: UsageRow): Promise<void>;
}

export type Db = unknown;
