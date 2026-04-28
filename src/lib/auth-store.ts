import { create } from 'zustand';

export interface User {
  id: string;
  username: string;
}

export interface AuthState {
  user: User | null;
  isAuthenticated: boolean;
  isLoading: boolean;
  token: string | null;
  login: (username: string, password: string) => Promise<void>;
  logout: () => Promise<void>;
  checkAuth: () => Promise<void>;
}

export const useAuthStore = create<AuthState>((set) => ({
  user: null,
  isAuthenticated: false,
  isLoading: false,
  token: null,

  login: async (username: string, password: string) => {
    set({ isLoading: true });
    try {
      const response = await fetch('/api/auth/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ username, password }),
      });

      if (!response.ok) {
        const data = await response.json();
        throw new Error(data.error || 'Login failed');
      }

      const { token, user } = await response.json();
      set({
        user,
        token,
        isAuthenticated: true,
        isLoading: false,
      });
    } catch (error) {
      set({ isLoading: false });
      throw error;
    }
  },

  logout: async () => {
    // TODO: Phase 2.5 — real API call to invalidate session/token
    set({
      user: null,
      isAuthenticated: false,
      isLoading: false,
      token: null,
    });
  },

  checkAuth: async () => {
    // TODO: Phase 2.3 — real token validation
    // No-op placeholder
  },
}));
