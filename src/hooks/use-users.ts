import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import type { ServiceType } from '@/generated/prisma/enums';
import type { CreateUserPayload, UpdateUserPayload } from '@/types/user';
import { queryKeys } from '@/lib/query-keys';
import { apiGet, apiMutate } from '@/lib/api-client';

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

export function useUsers(params?: UsersListParams) {
  return useQuery({
    queryKey: [...queryKeys.users, params],
    queryFn: () => apiGet<UsersResponse>('/api/users', params),
    staleTime: 10_000,
  });
}

export function useCreateUser() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (body: CreateUserPayload) =>
      apiMutate<{ success: boolean }>('/api/users', 'POST', body),
    onSuccess: () =>
      queryClient.invalidateQueries({ queryKey: queryKeys.users }),
  });
}

export function useUpdateUser() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (vars: { id: number; body: UpdateUserPayload }) =>
      apiMutate<{ success: boolean }>(
        `/api/users/${vars.id}`,
        'PUT',
        vars.body,
      ),
    onSuccess: () =>
      queryClient.invalidateQueries({ queryKey: queryKeys.users }),
  });
}

export function useUpdateUserQuota() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (vars: {
      id: number;
      body: { quotaBytes: number; period: 'DAILY' | 'WEEKLY' | 'MONTHLY' };
    }) =>
      apiMutate<{ success: boolean }>(
        `/api/users/${vars.id}/quota`,
        'PUT',
        vars.body,
      ),
    onSuccess: () =>
      queryClient.invalidateQueries({ queryKey: queryKeys.users }),
  });
}

export function useDeleteUser() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (id: number) =>
      apiMutate<{ success: boolean }>(`/api/users/${id}`, 'DELETE'),
    onSuccess: () =>
      queryClient.invalidateQueries({ queryKey: queryKeys.users }),
  });
}

export function useToggleUserBlock() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (vars: { id: number; block: boolean }) =>
      apiMutate<{ success: boolean }>(
        `/api/users/${vars.id}/${vars.block ? 'block' : 'unblock'}`,
        'POST',
      ),
    onSuccess: () =>
      queryClient.invalidateQueries({ queryKey: queryKeys.users }),
  });
}
