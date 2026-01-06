import crypto from 'crypto';
import fs from 'fs';

export interface KalshiAuthHeaders {
  'KALSHI-ACCESS-KEY': string;
  'KALSHI-ACCESS-TIMESTAMP': string;
  'KALSHI-ACCESS-SIGNATURE': string;
}

function loadPrivateKey(): string | null {
  const pemString = process.env.KALSHI_PRIVATE_KEY_PEM;
  if (pemString) {
    return pemString.replace(/\\n/g, '\n');
  }

  const pemPath = process.env.KALSHI_PRIVATE_KEY_PATH;
  if (pemPath) {
    try {
      return fs.readFileSync(pemPath, 'utf-8');
    } catch (err) {
      console.error('Failed to read private key from path:', err);
      return null;
    }
  }

  return null;
}

export function hasAuthCredentials(): boolean {
  const accessKey = process.env.KALSHI_ACCESS_KEY;
  const privateKey = loadPrivateKey();
  return !!(accessKey && privateKey);
}

export function generateAuthHeaders(
  method: string = 'GET',
  path: string = '/trade-api/ws/v2'
): KalshiAuthHeaders | null {
  const accessKey = process.env.KALSHI_ACCESS_KEY;
  const privateKeyPem = loadPrivateKey();

  if (!accessKey || !privateKeyPem) {
    return null;
  }

  const timestamp = Date.now().toString();
  const signatureText = timestamp + method.toUpperCase() + path;

  try {
    const privateKey = crypto.createPrivateKey({
      key: privateKeyPem,
      format: 'pem',
    });

    const signature = crypto.sign('sha256', Buffer.from(signatureText), {
      key: privateKey,
      padding: crypto.constants.RSA_PKCS1_PSS_PADDING,
      saltLength: crypto.constants.RSA_PSS_SALTLEN_DIGEST,
    });

    return {
      'KALSHI-ACCESS-KEY': accessKey,
      'KALSHI-ACCESS-TIMESTAMP': timestamp,
      'KALSHI-ACCESS-SIGNATURE': signature.toString('base64'),
    };
  } catch (err) {
    console.error('Failed to generate auth signature:', err);
    return null;
  }
}
