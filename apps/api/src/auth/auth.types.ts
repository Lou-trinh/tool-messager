export interface AuthUser {
  id: string;
  email: string;
  systemRole: 'SUPER_ADMIN' | 'USER';
}

export interface TokenPair {
  accessToken: string;
  refreshToken: string;
  expiresInSeconds: number;
}
