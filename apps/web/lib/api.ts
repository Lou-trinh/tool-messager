'use client';

import { useSession } from './store';

const configuredApiUrl = process.env.NEXT_PUBLIC_API_URL?.trim();
const isGitHubPages = process.env.NEXT_PUBLIC_GITHUB_PAGES === 'true';
const apiUrl = configuredApiUrl || (isGitHubPages ? '' : 'http://localhost:4000/api/v1');

export class ApiError extends Error {
  constructor(public readonly status: number, message: string) { super(message); }
}

export async function api<T>(path: string, init: RequestInit = {}): Promise<T> {
  if (!apiUrl) {
    throw new ApiError(
      503,
      'Bản GitHub Pages đang chạy frontend-only. Hãy cấu hình repository variable NEXT_PUBLIC_API_URL tới API HTTPS để bật dữ liệu thật.',
    );
  }

  const token = useSession.getState().accessToken;
  const response = await fetch(`${apiUrl}${path}`, {
    ...init,
    headers: {
      'content-type': 'application/json',
      ...(token ? { authorization: `Bearer ${token}` } : {}),
      ...init.headers,
    },
  });
  const body = await response.json() as { success?: boolean; data?: T; error?: { message?: string } };
  if (!response.ok) throw new ApiError(response.status, body.error?.message ?? 'Request failed');
  return body.data as T;
}
