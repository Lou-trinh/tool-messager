'use client';

import { useSession } from './store';

const apiUrl = process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:4000/api/v1';

export class ApiError extends Error {
  constructor(public readonly status: number, message: string) { super(message); }
}

export async function api<T>(path: string, init: RequestInit = {}): Promise<T> {
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
