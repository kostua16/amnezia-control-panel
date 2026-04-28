'use client';

import { useState, useCallback, useEffect } from 'react';
import { Loader2 } from 'lucide-react';
import { Dialog } from '@/components/ui/dialog';
import { EditUserForm } from '@/components/users/edit-user-form';
import type { EditUserFormData } from '@/components/users/edit-user-form';
import type { ServiceType } from '@/generated/prisma/enums';

interface EditUserModalProps {
  open: boolean;
  onClose: () => void;
  onSuccess: () => void;
  userId: number;
}

interface UserData {
  id: number;
  username: string;
  displayName: string | null;
  isActive: boolean;
  isBlocked: boolean;
  trafficQuotaBytes: number;
  speedLimitKbps: number;
  assignedServices: ServiceType[];
}

export function EditUserModal({
  open,
  onClose,
  onSuccess,
  userId,
}: EditUserModalProps) {
  const [userData, setUserData] = useState<UserData | null>(null);
  const [loading, setLoading] = useState(false);
  const [fetching, setFetching] = useState(false);
  const [apiError, setApiError] = useState<string | null>(null);

  // Fetch user data when modal opens
  useEffect(() => {
    if (!open) return;

    let cancelled = false;

    async function fetchUser() {
      setFetching(true);
      setApiError(null);

      try {
        const response = await fetch(`/api/users/${userId}`);
        const result = await response.json();

        if (cancelled) return;

        if (!response.ok) {
          setApiError(
            result.error || 'Failed to load user data.',
          );
          return;
        }

        setUserData(result.data);
      } catch {
        if (!cancelled) {
          setApiError('Network error. Please check your connection.');
        }
      } finally {
        if (!cancelled) {
          setFetching(false);
        }
      }
    }

    fetchUser();

    return () => {
      cancelled = true;
    };
  }, [open, userId]);

  const handleClose = useCallback(() => {
    setUserData(null);
    setApiError(null);
    onClose();
  }, [onClose]);

  const handleSubmit = useCallback(
    async (data: EditUserFormData) => {
      if (!userData) return;

      setLoading(true);
      setApiError(null);

      try {
        const response = await fetch(`/api/users/${userId}`, {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(data),
        });

        const result = await response.json();

        if (!response.ok) {
          setApiError(
            result.error || 'Failed to update user. Please try again.',
          );
          return;
        }

        onSuccess();
        handleClose();
      } catch {
        setApiError('Network error. Please check your connection and try again.');
      } finally {
        setLoading(false);
      }
    },
    [userData, userId, onSuccess, handleClose],
  );

  return (
    <Dialog open={open} onClose={handleClose} title="Edit User">
      {fetching ? (
        <div className="flex items-center justify-center py-8">
          <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
          <span className="ml-2 text-sm text-muted-foreground">
            Loading user data...
          </span>
        </div>
      ) : userData ? (
        <div>
          {apiError && (
            <div className="mb-4 rounded-md border border-destructive/50 bg-destructive/10 px-3 py-2 text-sm text-destructive">
              {apiError}
            </div>
          )}
          <EditUserForm
            key={userData.id}
            initialData={{
              displayName: userData.displayName,
              trafficQuotaBytes: userData.trafficQuotaBytes,
              speedLimitKbps: userData.speedLimitKbps,
              assignedServices: userData.assignedServices,
            }}
            onSubmit={handleSubmit}
            onCancel={handleClose}
            loading={loading}
          />
        </div>
      ) : (
        <div className="py-4 text-center text-sm text-destructive">
          {apiError || 'Failed to load user data.'}
        </div>
      )}
    </Dialog>
  );
}
