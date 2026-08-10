import { Injectable, ServiceUnavailableException } from '@nestjs/common';
import { createCipheriv, createDecipheriv, createHash, randomBytes } from 'node:crypto';

@Injectable()
export class SecretEncryptionService {
  private key(): Buffer {
    const encryptionKey = process.env.ENCRYPTION_KEY;
    if (!encryptionKey) throw new ServiceUnavailableException('ENCRYPTION_KEY is not configured.');
    return createHash('sha256').update(encryptionKey).digest();
  }

  encrypt(value: string): string {
    const iv = randomBytes(12);
    const cipher = createCipheriv('aes-256-gcm', this.key(), iv);
    const encrypted = Buffer.concat([cipher.update(value, 'utf8'), cipher.final()]);
    return `${iv.toString('base64url')}.${cipher.getAuthTag().toString('base64url')}.${encrypted.toString('base64url')}`;
  }

  decrypt(value: string): string {
    const [ivValue, tagValue, encryptedValue, ...extra] = value.split('.');
    if (!ivValue || !tagValue || !encryptedValue || extra.length) throw new Error('Encrypted secret has an invalid format.');
    const decipher = createDecipheriv('aes-256-gcm', this.key(), Buffer.from(ivValue, 'base64url'));
    decipher.setAuthTag(Buffer.from(tagValue, 'base64url'));
    return Buffer.concat([
      decipher.update(Buffer.from(encryptedValue, 'base64url')),
      decipher.final(),
    ]).toString('utf8');
  }
}
