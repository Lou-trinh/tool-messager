'use client';

import { create } from 'zustand';
import { persist, createJSONStorage } from 'zustand/middleware';

interface SessionState {
  accessToken: string | null;
  refreshToken: string | null;
  workspaceId: string | null;
  hydrated: boolean;
  setTokens: (accessToken: string, refreshToken: string) => void;
  setWorkspace: (workspaceId: string) => void;
  setHydrated: (hydrated: boolean) => void;
  clear: () => void;
}

export const useSession = create<SessionState>()(
  persist(
    (set) => ({
      accessToken: null,
      refreshToken: null,
      workspaceId: null,
      hydrated: false,
      setTokens: (accessToken, refreshToken) => set({ accessToken, refreshToken }),
      setWorkspace: (workspaceId) => set({ workspaceId }),
      setHydrated: (hydrated) => set({ hydrated }),
      clear: () => set({ accessToken: null, refreshToken: null, workspaceId: null }),
    }),
    {
      name: 'omnisocial-session',
      storage: createJSONStorage(() => sessionStorage),
      partialize: ({ accessToken, refreshToken, workspaceId }) => ({ accessToken, refreshToken, workspaceId }),
      onRehydrateStorage: () => (state) => state?.setHydrated(true),
    },
  ),
);
