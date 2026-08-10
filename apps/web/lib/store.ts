'use client';

import { create } from 'zustand';
import { persist, createJSONStorage } from 'zustand/middleware';

interface SessionState {
  accessToken: string | null;
  refreshToken: string | null;
  workspaceId: string | null;
  setTokens: (accessToken: string, refreshToken: string) => void;
  setWorkspace: (workspaceId: string) => void;
  clear: () => void;
}

export const useSession = create<SessionState>()(
  persist(
    (set) => ({
      accessToken: null,
      refreshToken: null,
      workspaceId: null,
      setTokens: (accessToken, refreshToken) => set({ accessToken, refreshToken }),
      setWorkspace: (workspaceId) => set({ workspaceId }),
      clear: () => set({ accessToken: null, refreshToken: null, workspaceId: null }),
    }),
    { name: 'omnisocial-session', storage: createJSONStorage(() => sessionStorage) },
  ),
);
