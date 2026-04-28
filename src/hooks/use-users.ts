import { useQuery } from '@tanstack/react-query';
import type { ServiceType } from '@/generated/prisma/enums';

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
    queryKey: ['users', params],
    queryFn: () => fetchUsers(params),
    staleTime: 10_000,
  });
}
