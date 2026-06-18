import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import type { ServiceType } from '@/generated/prisma/enums';
import type { CreateUserPayload, UpdateUserPayload } from '@/types/user';
import { queryKeys } from '@/lib/query-keys';

export interface UsersListParams {
  search?: string;
  sortBy?: string;
  sortOrder?: string;
  page?: number;
  limit?: number;
}

export interface UserListItem {
  id: number;
  username: string;
  displayName: string | null;
  isActive: boolean;
  isBlocked: boolean;
  trafficQuotaBytes: number;
  speedLimitKbps: number;
  assignedServices: ServiceType[];
  hasPartialProvisioning: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface UsersResponse {
  success: boolean;
  data: UserListItem[];
  pagination: {
    page: number;
    limit: number;
    total: number;
    totalPages: number;
  };
}

/**
 * Shared query-key prefix for the users cache. Reads use ['users', params];
 * mutations invalidate by this prefix so every successful write refreshes the
 * list immediately instead of serving the pre-action state for the staleTime.
 */

const JSON_HEADERS = { 'Content-Type': 'application/json' } as const;

/**
 * Throw with the server-provided error message (or a fallback) so call sites
 * can surface it inline the same way their raw-fetch predecessors did — no
 * silent swallowing introduced by routing mutations through hooks.
 */
async function assertOk(response: Response): Promise<void> {
  if (response.ok) return;
  const result = await response.json().catch(() => null);
  const message =
    result && typeof result === 'object' && 'error' in result
      ? String((result as { error: unknown }).error)
      : `Request failed (status ${response.status})`;
  throw new Error(message);
}

async function fetchUsers(params?: UsersListParams): Promise<UsersResponse> {
  const searchParams = new URLSearchParams();

  if (params?.search) searchParams.set('search', params.search);
  if (params?.sortBy) searchParams.set('sortBy', params.sortBy);
  if (params?.sortOrder) searchParams.set('sortOrder', params.sortOrder);
  if (params?.page) searchParams.set('page', String(params.page));
  if (params?.limit) searchParams.set('limit', String(params.limit));

  const query = searchParams.toString();
  const url = `/api/users${query ? `?${query}` : ''}`;

  const response = await fetch(url);
  if (!response.ok) {
    throw new Error(`Failed to fetch users (status ${response.status})`);
  }
  return response.json();
}

export function useUsers(params?: UsersListParams) {
  return useQuery({
    queryKey: [...queryKeys.users, params],
    queryFn: () => fetchUsers(params),
    staleTime: 10_000,
  });
}

export function useCreateUser() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (body: CreateUserPayload) => {
      const response = await fetch('/api/users', {
        method: 'POST',
        headers: JSON_HEADERS,
        body: JSON.stringify(body),
      });
      await assertOk(response);
      return response.json();
    },
    onSuccess: () =>
      queryClient.invalidateQueries({ queryKey: queryKeys.users }),
  });
}

export function useUpdateUser() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (vars: { id: number; body: UpdateUserPayload }) => {
      const response = await fetch(`/api/users/${vars.id}`, {
        method: 'PUT',
        headers: JSON_HEADERS,
        body: JSON.stringify(vars.body),
      });
      await assertOk(response);
      return response.json();
    },
    onSuccess: () =>
      queryClient.invalidateQueries({ queryKey: queryKeys.users }),
  });
}

export function useUpdateUserQuota() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (vars: {
      id: number;
      body: { quotaBytes: number; period: 'DAILY' | 'WEEKLY' | 'MONTHLY' };
    }) => {
      const response = await fetch(`/api/users/${vars.id}/quota`, {
        method: 'PUT',
        headers: JSON_HEADERS,
        body: JSON.stringify(vars.body),
      });
      await assertOk(response);
      return response.json();
    },
    onSuccess: () =>
      queryClient.invalidateQueries({ queryKey: queryKeys.users }),
  });
}

export function useDeleteUser() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (id: number) => {
      const response = await fetch(`/api/users/${id}`, { method: 'DELETE' });
      await assertOk(response);
      return response.json();
    },
    onSuccess: () =>
      queryClient.invalidateQueries({ queryKey: queryKeys.users }),
  });
}

export function useToggleUserBlock() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (vars: { id: number; block: boolean }) => {
      const endpoint = `/api/users/${vars.id}/${vars.block ? 'block' : 'unblock'}`;
      const response = await fetch(endpoint, { method: 'POST' });
      await assertOk(response);
      return response.json();
    },
    onSuccess: () =>
      queryClient.invalidateQueries({ queryKey: queryKeys.users }),
  });
}
