import { createHmac } from 'crypto';

type Credentials = { id: number; passwordHash: string };

export function credentialTag(
  user: Credentials,
  secret = process.env.JWT_SECRET,
): string {
  if (!secret) throw Error('JWT_SECRET is required');
  return createHmac('sha256', secret)
    .update(`${user.id}:${user.passwordHash}`)
    .digest('hex');
}

export function currentSession(
  claims: any,
  user: Credentials | null,
  kind: 'access' | 'refresh',
  secret = process.env.JWT_SECRET,
): boolean {
  return Boolean(
    user &&
    claims?.kind === kind &&
    claims.id === user.id &&
    claims.credential === credentialTag(user, secret),
  );
}
