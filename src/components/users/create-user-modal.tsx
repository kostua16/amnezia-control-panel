'use client';

import { useState, useCallback } from 'react';
import { Dialog } from '@/components/ui/dialog';
import { CreateUserForm } from '@/components/users/create-user-form';
import type { CreateUserPayload } from '@/types/user';

interface CreateUserModalProps {
  open: boolean;
  onClose: () => void;
  onSuccess: () => void;
}

export function CreateUserModal({
  open,
  onClose,
  onSuccess,
}: CreateUserModalProps) {
  const [loading, setLoading] = useState(false);
  const [apiError, setApiError] = useState<string | null>(null);
  const [formKey, setFormKey] = useState(0);

  const resetForm = useCallback(() => {
    setApiError(null);
    setFormKey((k) => k + 1);
  }, []);

  const handleClose = useCallback(() => {
    resetForm();
    onClose();
  }, [onClose, resetForm]);

  const handleSubmit = useCallback(
    async (data: CreateUserPayload) => {
      setLoading(true);
      setApiError(null);

      try {
        const response = await fetch('/api/users', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(data),
        });

        const result = await response.json();

        if (!response.ok) {
          setApiError(
            result.error || 'Failed to create user. Please try again.',
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
    [onSuccess, handleClose],
  );

  return (
    <Dialog open={open} onClose={handleClose} title="Create User">
      <div key={formKey}>
        {apiError && (
          <div className="mb-4 rounded-md border border-destructive/50 bg-destructive/10 px-3 py-2 text-sm text-destructive">
            {apiError}
          </div>
        )}
        <CreateUserForm
          onSubmit={handleSubmit}
          onCancel={handleClose}
          loading={loading}
        />
      </div>
    </Dialog>
  );
}
