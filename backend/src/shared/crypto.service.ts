import { Injectable, InternalServerErrorException } from '@nestjs/common';
import { createCipheriv, createDecipheriv, randomBytes } from 'crypto';
import { appConfig } from '../config/app.config';

@Injectable()
export class CryptoService {
  private key(): Buffer {
    const hex = appConfig.sessionEncKey;
    if (!/^[0-9a-fA-F]{64}$/.test(hex)) {
      throw new InternalServerErrorException(
        'SESSION_ENC_KEY is not configured (expected 32-byte hex)',
      );
    }
    return Buffer.from(hex, 'hex');
  }

  encrypt(plain: string): string {
    const iv = randomBytes(12);
    const cipher = createCipheriv('aes-256-gcm', this.key(), iv);
    const body = Buffer.concat([cipher.update(plain, 'utf8'), cipher.final()]);
    const tag = cipher.getAuthTag();
    return `v1:${iv.toString('base64')}:${tag.toString('base64')}:${body.toString('base64')}`;
  }

  decrypt(sealed: string): string {
    const [version, iv, tag, body] = sealed.split(':');
    if (version !== 'v1' || !iv || !tag || !body) {
      throw new InternalServerErrorException(
        'sealed value has an unknown format',
      );
    }
    const decipher = createDecipheriv(
      'aes-256-gcm',
      this.key(),
      Buffer.from(iv, 'base64'),
    );
    decipher.setAuthTag(Buffer.from(tag, 'base64'));
    return Buffer.concat([
      decipher.update(Buffer.from(body, 'base64')),
      decipher.final(),
    ]).toString('utf8');
  }
}
