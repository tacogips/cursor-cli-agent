/**
 * Phase 4 HTTP resource API DTOs (`P4-HTTP-RESOURCE-APIS`).
 * Transport shapes for `/api/groups`, `/api/queues`, `/api/bookmarks`,
 * `/api/files`, `/api/activity`, and `/api/repository/analytics`.
 */

import type { AuthPermission } from "../auth";

export interface ApiListQuery {
  readonly limit?: number;
  readonly offset?: number;
}

export interface ApiListResponse<T> {
  readonly items: readonly T[];
  readonly total: number;
  readonly limit?: number;
  readonly offset?: number;
}

export interface ApiMutationResult<T> {
  readonly data: T;
}

export interface ApiDeletionResult<T> {
  readonly deleted: true;
  readonly data: T;
}

/** Permission type for HTTP resource API routes — authoritative source is `AuthPermission`. */
export type ResourcePermission = AuthPermission;
