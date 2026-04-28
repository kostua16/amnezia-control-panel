'use client';

import { useState, useEffect, useCallback } from 'react';
import {
  Search,
  Pencil,
  Ban,
  ShieldCheck,
  Trash2,
  Plus,
  ChevronLeft,
  ChevronRight,
  Loader2,
  Gauge,
} from 'lucide-react';
import { clsx } from 'clsx';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { useUsers } from '@/hooks/use-users';
import { UserStatusBadge } from '@/components/users/user-status-badge';
import { UserServiceBadge } from '@/components/users/user-service-badge';
import { UserTableSkeleton } from '@/components/users/user-table-skeleton';
import { UserEmptyState } from '@/components/users/user-empty-state';
import { CreateUserModal } from '@/components/users/create-user-modal';
import { EditUserModal } from '@/components/users/edit-user-modal';
import { UserQuotaModal } from '@/components/users/user-quota-modal';

type SortOption = 'newest' | 'name-asc' | 'name-desc';

const sortOptions: { value: SortOption; label: string; sortBy: string; sortOrder: string }[] = [
  { value: 'newest', label: 'Newest', sortBy: 'createdAt', sortOrder: 'desc' },
  { value: 'name-asc', label: 'Name A-Z', sortBy: 'username', sortOrder: 'asc' },
  { value: 'name-desc', label: 'Name Z-A', sortBy: 'username', sortOrder: 'desc' },
];

function formatQuota(bytes: number): string {
  if (bytes === 0) return 'Unlimited';
  const gb = bytes / (1024 * 1024 * 1024);
  return gb.toFixed(1) + ' GB';
}

interface UserItem {
  id: number;
  username: string;
  displayName: string | null;
  isActive: boolean;
  isBlocked: boolean;
  trafficQuotaBytes: number;
  speedLimitKbps: number;
  assignedServices: string[];
}

export function UserList() {
  const [searchInput, setSearchInput] = useState('');
  const [debouncedSearch, setDebouncedSearch] = useState('');
  const [sortOption, setSortOption] = useState<SortOption>('newest');
  const [page, setPage] = useState(1);
  const [createModalOpen, setCreateModalOpen] = useState(false);
  const [editModalOpen, setEditModalOpen] = useState(false);
  const [selectedUserId, setSelectedUserId] = useState<number | null>(null);
  const [deleteConfirmId, setDeleteConfirmId] = useState<number | null>(null);
  const [quotaModalOpen, setQuotaModalOpen] = useState(false);
  const [quotaUserId, setQuotaUserId] = useState<number | null>(null);
  const [blockLoadingId, setBlockLoadingId] = useState<number | null>(null);
  const [deleteLoadingId, setDeleteLoadingId] = useState<number | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);

  // Debounce search input by 300ms
  useEffect(() => {
    const timer = setTimeout(() => {
      setDebouncedSearch(searchInput);
    }, 300);
    return () => clearTimeout(timer);
  }, [searchInput]);

  // Reset to page 1 when search or sort changes
  useEffect(() => {
    setPage(1);
  }, [debouncedSearch, sortOption]);

  // Dismiss action errors after 5 seconds
  useEffect(() => {
    if (!actionError) return;
    const timer = setTimeout(() => setActionError(null), 5000);
    return () => clearTimeout(timer);
  }, [actionError]);

  const currentSort = sortOptions.find((s) => s.value === sortOption)!;

  const { data, isLoading, refetch } = useUsers({
    search: debouncedSearch || undefined,
    sortBy: currentSort.sortBy,
    sortOrder: currentSort.sortOrder,
    page,
    limit: 50,
  });

  const users = data?.data ?? [];
  const pagination = data?.pagination;

  const handlePageChange = useCallback(
    (newPage: number) => {
      if (newPage >= 1 && pagination && newPage <= pagination.totalPages) {
        setPage(newPage);
      }
    },
    [pagination],
  );

  const handleEditClick = useCallback((userId: number) => {
    setSelectedUserId(userId);
    setEditModalOpen(true);
  }, []);

  const handleEditSuccess = useCallback(() => {
    refetch();
  }, [refetch]);

  const handleDeleteClick = useCallback((userId: number) => {
    setDeleteConfirmId(userId);
  }, []);

  const handleDeleteConfirm = useCallback(async () => {
    if (deleteConfirmId === null) return;

    setDeleteLoadingId(deleteConfirmId);
    setActionError(null);

    try {
      const response = await fetch(`/api/users/${deleteConfirmId}`, {
        method: 'DELETE',
      });

      if (!response.ok) {
        const result = await response.json();
        setActionError(result.error || 'Failed to delete user.');
        return;
      }

      setDeleteConfirmId(null);
      refetch();
    } catch {
      setActionError('Network error. Please check your connection.');
    } finally {
      setDeleteLoadingId(null);
    }
  }, [deleteConfirmId, refetch]);

  const handleDeleteCancel = useCallback(() => {
    setDeleteConfirmId(null);
  }, []);

  const handleBlockToggle = useCallback(
    async (user: UserItem) => {
      setBlockLoadingId(user.id);
      setActionError(null);

      const endpoint = user.isBlocked
        ? `/api/users/${user.id}/unblock`
        : `/api/users/${user.id}/block`;

      try {
        const response = await fetch(endpoint, { method: 'POST' });

        if (!response.ok) {
          const result = await response.json();
          setActionError(result.error || 'Failed to update block status.');
          return;
        }

        refetch();
      } catch {
        setActionError('Network error. Please check your connection.');
      } finally {
        setBlockLoadingId(null);
      }
    },
    [refetch],
  );

  // Loading state
  if (isLoading) {
    return (
      <Card>
        <CardHeader>
          <CardTitle>Users</CardTitle>
        </CardHeader>
        <CardContent>
          <UserTableSkeleton />
        </CardContent>
      </Card>
    );
  }

  // Empty state
  if (pagination && pagination.total === 0) {
    return (
      <Card>
        <CardHeader>
          <CardTitle>Users</CardTitle>
        </CardHeader>
        <CardContent>
          <UserEmptyState hasSearch={!!debouncedSearch} />
        </CardContent>
      </Card>
    );
  }

  const rangeStart = pagination ? (page - 1) * pagination.limit + 1 : 0;
  const rangeEnd = pagination
    ? Math.min(page * pagination.limit, pagination.total)
    : 0;

  return (
    <Card>
      <CardHeader className="flex flex-row items-center justify-between">
        <CardTitle>Users</CardTitle>
        <Button size="sm" onClick={() => setCreateModalOpen(true)}>
          <Plus className="mr-2 h-4 w-4" />
          Create User
        </Button>
      </CardHeader>
      <CardContent className="space-y-4">
        {/* Action error banner */}
        {actionError && (
          <div className="rounded-md border border-destructive/50 bg-destructive/10 px-3 py-2 text-sm text-destructive">
            {actionError}
          </div>
        )}

        {/* Search + Sort row */}
        <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <div className="relative max-w-sm flex-1">
            <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
            <Input
              placeholder="Search users..."
              value={searchInput}
              onChange={(e) => setSearchInput(e.target.value)}
              className="pl-9"
            />
          </div>

          <div className="flex items-center gap-1 rounded-md border border-border p-1">
            {sortOptions.map((option) => (
              <Button
                key={option.value}
                variant={sortOption === option.value ? 'default' : 'ghost'}
                size="sm"
                className="h-7 px-3 text-xs"
                onClick={() => setSortOption(option.value)}
              >
                {option.label}
              </Button>
            ))}
          </div>
        </div>

        {/* Table */}
        <div className="overflow-x-auto">
          <table className="w-full text-left text-sm">
            <thead>
              <tr className="border-b border-border">
                <th className="px-4 py-3 font-medium text-muted-foreground">
                  Name
                </th>
                <th className="px-4 py-3 font-medium text-muted-foreground">
                  Status
                </th>
                <th className="hidden px-4 py-3 font-medium text-muted-foreground sm:table-cell">
                  Services
                </th>
                <th className="hidden px-4 py-3 font-medium text-muted-foreground md:table-cell">
                  Quota / Limit
                </th>
                <th className="px-4 py-3 text-right font-medium text-muted-foreground">
                  Actions
                </th>
              </tr>
            </thead>
            <tbody>
              {users.map((user) => (
                <tr
                  key={user.id}
                  className="border-b border-border last:border-0"
                >
                  <td className="px-4 py-3">
                    <div>
                      <span className="font-medium">
                        {user.displayName ?? user.username}
                      </span>
                      {user.displayName && (
                        <span className="ml-2 text-xs text-muted-foreground">
                          @{user.username}
                        </span>
                      )}
                    </div>
                  </td>
                  <td className="px-4 py-3">
                    <UserStatusBadge
                      isActive={user.isActive}
                      isBlocked={user.isBlocked}
                    />
                  </td>
                  <td className="hidden px-4 py-3 sm:table-cell">
                    <UserServiceBadge assignedServices={user.assignedServices} />
                  </td>
                  <td className="hidden px-4 py-3 md:table-cell">
                    <div className="flex items-center gap-2">
                      <span className="text-sm text-muted-foreground">
                        {formatQuota(user.trafficQuotaBytes)}
                      </span>
                      <button
                        className="rounded p-1 text-muted-foreground hover:bg-muted hover:text-foreground transition-colors"
                        onClick={() => {
                          setQuotaUserId(user.id);
                          setQuotaModalOpen(true);
                        }}
                        aria-label={`Edit quota for ${user.username}`}
                        title="Edit quota & limits"
                      >
                        <Gauge className="h-3.5 w-3.5" />
                      </button>
                    </div>
                  </td>
                  <td className="px-4 py-3">
                    <div className="flex items-center justify-end gap-1">
                      <Button
                        variant="ghost"
                        size="icon"
                        className="h-8 w-8"
                        onClick={() => handleEditClick(user.id)}
                        aria-label={`Edit ${user.username}`}
                      >
                        <Pencil className="h-4 w-4" />
                      </Button>
                      <Button
                        variant="ghost"
                        size="icon"
                        className="h-8 w-8"
                        onClick={() => handleBlockToggle(user)}
                        disabled={blockLoadingId === user.id}
                        aria-label={
                          user.isBlocked
                            ? `Unblock ${user.username}`
                            : `Block ${user.username}`
                        }
                      >
                        {blockLoadingId === user.id ? (
                          <Loader2 className="h-4 w-4 animate-spin" />
                        ) : user.isBlocked ? (
                          <ShieldCheck className="h-4 w-4" />
                        ) : (
                          <Ban className="h-4 w-4" />
                        )}
                      </Button>
                      <Button
                        variant="ghost"
                        size="icon"
                        className="h-8 w-8"
                        onClick={() => handleDeleteClick(user.id)}
                        disabled={deleteLoadingId === user.id}
                        aria-label={`Delete ${user.username}`}
                      >
                        {deleteLoadingId === user.id ? (
                          <Loader2 className="h-4 w-4 animate-spin text-destructive" />
                        ) : (
                          <Trash2 className="h-4 w-4 text-destructive" />
                        )}
                      </Button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        {/* Delete confirmation */}
        {deleteConfirmId !== null && (
          <div className="rounded-md border border-destructive/50 bg-destructive/5 px-4 py-3">
            <p className="text-sm text-foreground">
              Are you sure you want to delete this user? This action cannot be
              undone.
            </p>
            <div className="mt-3 flex items-center justify-end gap-2">
              <Button
                variant="outline"
                size="sm"
                onClick={handleDeleteCancel}
                disabled={deleteLoadingId !== null}
              >
                Cancel
              </Button>
              <Button
                variant="destructive"
                size="sm"
                onClick={handleDeleteConfirm}
                disabled={deleteLoadingId !== null}
              >
                {deleteLoadingId !== null && (
                  <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                )}
                Delete User
              </Button>
            </div>
          </div>
        )}

        {/* Pagination */}
        {pagination && pagination.totalPages > 1 && (
          <div className="flex items-center justify-between text-sm text-muted-foreground">
            <span>
              Showing {rangeStart}-{rangeEnd} of {pagination.total} users
            </span>
            <div className="flex items-center gap-2">
              <Button
                variant="outline"
                size="sm"
                disabled={page <= 1}
                onClick={() => handlePageChange(page - 1)}
              >
                <ChevronLeft className="mr-1 h-4 w-4" />
                Previous
              </Button>
              <Button
                variant="outline"
                size="sm"
                disabled={page >= pagination.totalPages}
                onClick={() => handlePageChange(page + 1)}
              >
                Next
                <ChevronRight className="ml-1 h-4 w-4" />
              </Button>
            </div>
          </div>
        )}
      </CardContent>
      <CreateUserModal
        open={createModalOpen}
        onClose={() => setCreateModalOpen(false)}
        onSuccess={() => refetch()}
      />
      {selectedUserId !== null && (
        <EditUserModal
          open={editModalOpen}
          onClose={() => {
            setEditModalOpen(false);
            setSelectedUserId(null);
          }}
          onSuccess={handleEditSuccess}
          userId={selectedUserId}
        />
      )}
      {quotaUserId !== null && (
        <UserQuotaModal
          open={quotaModalOpen}
          onClose={() => {
            setQuotaModalOpen(false);
            setQuotaUserId(null);
          }}
          onSuccess={() => refetch()}
          userId={quotaUserId}
        />
      )}
    </Card>
  );
}
