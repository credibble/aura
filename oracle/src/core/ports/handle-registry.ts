import type { HandleConfig } from "../domain/handle";

export interface IHandleRegistry {
  all(): Promise<HandleConfig[]>;
  get(id: string): Promise<HandleConfig | null>;
}