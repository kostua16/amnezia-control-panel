'use client';

import { useState, useCallback, useEffect } from 'react';
import { Loader2 } from 'lucide-react';
import { Dialog } from '@/components/ui/dialog';
import { UserQuotaForm } from '@/components/users/user-quota-form';
import { useUpdateUserQuota } from '@/hooks/use-users';

type QuotaPeriod = 'DAILY' | 'WEEKLY' | 'MONTHLY';

interface QuotaData {
  id: number;
  userId: number;
  quotaBytes: number;
  period: QuotaPeriod;
  resetAt: string | null;
}

interface UserQuotaModalProps {
  open: boolean;
  onClose: () => void;
  onSuccess: () => void;
  userId: number;
}

export function UserQuotaModal({
  open,
  onClose,
  onSuccess,
  userId,
}: UserQuotaModalProps) {
  const [quotaData, setQuotaData] = useState<QuotaData | null | undefined>(
    undefined,
  );
  const [loading, setLoading] = useState(false);
  const [fetching, setFetching] = useState(false);
  const [apiError, setApiError] = useState<string | null>(null);
  const updateQuota = useUpdateUserQuota();

  useEffect(() => {
    if (!open) return;

    let cancelled = false;

    async function fetchQuota() {
      setFetching(true);
      setApiError(null);

      try {
        const response = await fetch(`/api/users/${userId}/quota`);
        const result = await response.json();

        if (cancelled) return;

        if (!response.ok) {
          setApiError(result.error || 'Failed to load quota data.');
          return;
        }

        setQuotaData(result.data);
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

    fetchQuota();

    return () => {
      cancelled = true;
    };
  }, [open, userId]);

  const handleClose = useCallback(() => {
    setQuotaData(undefined);
    setApiError(null);
    onClose();
  }, [onClose]);

  const handleSubmit = useCallback(
    async (data: { quotaBytes: number; period: QuotaPeriod }) => {
      setLoading(true);
      setApiError(null);

      try {
        await updateQuota.mutateAsync({ id: userId, body: data });
        onSuccess();
        handleClose();
      } catch (err) {
        setApiError(
          err instanceof Error && err.message
            ? err.message
            : 'Failed to update quota.',
        );
      } finally {
        setLoading(false);
      }
    },
    [userId, updateQuota, onSuccess, handleClose],
  );

  return (
    <Dialog open={open} onClose={handleClose} title="Edit Traffic Quota">
      {fetching ? (
        <div className="flex items-center justify-center py-8">
          <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
          <span className="ml-2 text-sm text-muted-foreground">
            Loading quota data...
          </span>
        </div>
      ) : quotaData !== undefined ? (
        <div>
          {apiError && (
            <div className="mb-4 rounded-md border border-destructive/50 bg-destructive/10 px-3 py-2 text-sm text-destructive">
              {apiError}
            </div>
          )}
          <UserQuotaForm
            key={userId}
            userId={userId}
            initialData={quotaData}
            onSubmit={handleSubmit}
            onCancel={handleClose}
            loading={loading}
          />
        </div>
      ) : (
        <div className="py-4 text-center text-sm text-destructive">
          {apiError || 'Failed to load quota data.'}
        </div>
      )}
    </Dialog>
  );
}
