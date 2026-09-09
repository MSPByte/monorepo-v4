import { createRemoteJWKSet, jwtVerify } from 'jose';
import { env } from './env.js';
import { logger } from './logger.js';

const ENTRA_JWKS_URL = 'https://login.microsoftonline.com/common/discovery/v2.0/keys';

// Cached JWKS — jose handles key rotation automatically.
let jwks: ReturnType<typeof createRemoteJWKSet> | null = null;

function getJWKS() {
  if (!jwks) jwks = createRemoteJWKSet(new URL(ENTRA_JWKS_URL));
  return jwks;
}

export interface EntraIdentity {
  upn: string;
  oid: string;
  tenantId: string;
  displayName?: string;
}

export async function verifyEntraToken(token: string): Promise<EntraIdentity | null> {
  const clientId = env.MICROSOFT_AUTH_CLIENT_ID;
  if (!clientId) {
    logger.warn('MICROSOFT_AUTH_CLIENT_ID not set — Entra token verification skipped');
    return null;
  }

  try {
    const { payload } = await jwtVerify(token, getJWKS(), {
      audience: clientId,
    });

    const upn = (payload['preferred_username'] ?? payload['upn'] ?? payload['email']) as string | undefined;
    const oid = payload['oid'] as string | undefined;
    const tenantId = (payload['tid']) as string | undefined;

    if (!upn || !oid || !tenantId) {
      logger.warn('Entra token missing required claims', { upn: !!upn, oid: !!oid, tenantId: !!tenantId });
      return null;
    }

    // Tokens obtained through the multi-tenant `common` authority have a
    // tenant-specific issuer. The shared JWKS validates the signature, but
    // we must still bind that issuer to the token's tenant claim.
    const expectedIssuer = `https://login.microsoftonline.com/${tenantId}/v2.0`;
    if (payload.iss !== expectedIssuer) {
      logger.warn('Entra token issuer does not match tenant claim', {
        issuer: payload.iss,
        tenantId,
      });
      return null;
    }

    return {
      upn,
      oid,
      tenantId,
      displayName: payload['name'] as string | undefined,
    };
  } catch (err) {
    logger.warn('Entra token verification failed', { err: String(err) });
    return null;
  }
}
