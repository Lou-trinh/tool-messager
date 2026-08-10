import { afterEach, describe, expect, it, vi } from 'vitest';
import { SecretEncryptionService } from './secret-encryption.service';

describe('SecretEncryptionService', () => {
  afterEach(() => vi.unstubAllEnvs());

  it('round-trips a token and rejects tampering', () => {
    vi.stubEnv('ENCRYPTION_KEY', 'test-encryption-key-that-is-long-enough');
    const service = new SecretEncryptionService();
    const encrypted = service.encrypt('refresh-token');
    const [iv, tag, ciphertext = ''] = encrypted.split('.');
    const tampered = `${iv}.${tag}.${ciphertext.startsWith('A') ? 'B' : 'A'}${ciphertext.slice(1)}`;

    expect(encrypted).not.toContain('refresh-token');
    expect(service.decrypt(encrypted)).toBe('refresh-token');
    expect(() => service.decrypt(tampered)).toThrow();
  });
});
