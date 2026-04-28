import { create } from 'zustand';

export interface User {
  id: string;
  username: string;
}

export interface AuthState {
  user: User | null;
  isAuthenticated: boolean;
  isLoading: boolean;
  login: (username: string, password: string) => Promise<void>;
  logout: () => Promise<void>;
  checkAuth: () => Promise<void>;
}

export const useAuthStore = create<AuthState>((set) => ({
  user: null,
  isAuthenticated: false,
  isLoading: false,

  login: async (username: string, _password: string) => {
    // TODO: Phase 2.2 — real API call with credential validation
    set({ isLoading: true });
    try {
      // Placeholder: simulate successful login
      set({
        user: { id: '1', username },
        isAuthenticated: true,
        isLoading: false,
      });
    } catch {
      set({ isLoading: false });
    }
  },

  logout: async () => {
    // TODO: Phase 2.5 — real API call to invalidate session/token
    set({
      user: null,
      isAuthenticated: false,
      isLoading: false,
    });
  },

  checkAuth: async () => {
    // TODO: Phase 2.3 — real token validation
    // No-op placeholder
  },
}));
