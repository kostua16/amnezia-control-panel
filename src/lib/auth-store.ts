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

      const { user } = await response.json();
      set({
        user,
        token: 'cookie',
        isAuthenticated: true,
        isLoading: false,
      });
    } catch (error) {
      set({ isLoading: false });
      throw error;
    }
  },

  logout: async () => {
    try {
      await fetch('/api/auth/logout', { method: 'POST' });
    } catch {
      // Proceed with local state cleanup even if API call fails
    }
    set({
      user: null,
      isAuthenticated: false,
      isLoading: false,
      token: null,
    });
  },

  checkAuth: async () => {
    set({ isLoading: true });
    try {
      const response = await fetch('/api/auth/me');
      if (response.ok) {
        const { user } = await response.json();
        set({ user, token: 'cookie', isAuthenticated: true, isLoading: false });
      } else {
        set({
          user: null,
          token: null,
          isAuthenticated: false,
          isLoading: false,
        });
      }
    } catch {
      set({
        user: null,
        token: null,
        isAuthenticated: false,
        isLoading: false,
      });
    }
  },
}));
