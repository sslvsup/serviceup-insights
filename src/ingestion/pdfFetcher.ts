import * as admin from 'firebase-admin';
import { config } from '../config/env';
import { logger } from '../utils/logger';

let _initialized = false;

function initFirebase() {
  if (_initialized || admin.apps.length > 0) return;

  const { serviceAccountKeyBase64, serviceAccountKey, serviceAccountKeyPath, storageBucket } = config.firebase;

  let credential: admin.credential.Credential;

  if (serviceAccountKeyBase64) {
    // Doppler convention: base64-encoded service account JSON (SERVICE_ACCOUNT_JSON_BASE64)
    const sa = JSON.parse(Buffer.from(serviceAccountKeyBase64, 'base64').toString());
    credential = admin.credential.cert(sa);
  } else if (serviceAccountKey) {
    // Inline raw JSON
    const sa = JSON.parse(serviceAccountKey);
    credential = admin.credential.cert(sa);
  } else if (serviceAccountKeyPath) {
    // Path to a local JSON file
    credential = admin.credential.cert(serviceAccountKeyPath);
  } else {
    // Fall back to application default credentials (e.g. Cloud Run, GKE workload identity)
    credential = admin.credential.applicationDefault();
  }

  admin.initializeApp({
    credential,
    storageBucket,
  });

  _initialized = true;
  logger.info('Firebase Admin initialized', { bucket: storageBucket });
}

/**
 * Parse the file path from a Firebase Storage URL.
 * Expects format: https://firebasestorage.googleapis.com/v0/b/<bucket>/o/<encoded-path>?...
 */
function parseFirebaseStoragePath(pdfUrl: string): string {
  const url = new URL(pdfUrl);
  const { pathname } = url;

  // Firebase Storage URLs encode the path after /o/
  const oIndex = pathname.indexOf('/o/');
  if (oIndex === -1) {
    throw new Error(`Invalid Firebase Storage URL (missing /o/ segment): ${pdfUrl}`);
  }

  const encodedPath = pathname.slice(oIndex + 3);
  if (!encodedPath) {
    throw new Error(`Cannot parse Firebase Storage path from URL: ${pdfUrl}`);
  }

  // Strip any query params that might have been included in the path segment
  return decodeURIComponent(encodedPath.split('?')[0]);
}

/**
 * Retry a function with exponential backoff.
 */
async function withRetry<T>(
  fn: () => Promise<T>,
  label: string,
  maxRetries: number,
): Promise<T> {
  let lastError: Error | undefined;
  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    try {
      return await fn();
    } catch (err) {
      lastError = err instanceof Error ? err : new Error(String(err));
      if (attempt < maxRetries) {
        const delayMs = Math.pow(2, attempt) * 1000; // 1s, 2s, 4s
        logger.warn(`${label} failed (attempt ${attempt + 1}/${maxRetries + 1}), retrying in ${delayMs}ms`, {
          error: lastError.message,
        });
        await new Promise((resolve) => setTimeout(resolve, delayMs));
      }
    }
  }
  throw lastError;
}

/**
 * Download a PDF from Firebase Storage given a Firebase Storage URL.
 * Returns the PDF as a base64 string.
 */
export async function fetchPdfAsBase64(pdfUrl: string): Promise<string> {
  initFirebase();

  const filePath = parseFirebaseStoragePath(pdfUrl);
  logger.debug('Downloading PDF from Firebase Storage', { filePath });

  const bucket = admin.storage().bucket();
  const file = bucket.file(filePath);

  const TIMEOUT_MS = 30_000;

  // Firebase Admin SDK's file.download() does not support AbortSignal.
  // Use Promise.race with a timeout that rejects — the download runs to
  // completion in the background but we stop waiting for it.
  const downloadPromise = file.download();
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeoutPromise = new Promise<never>((_, reject) => {
    timer = setTimeout(
      () => reject(new Error(`Firebase download timed out after ${TIMEOUT_MS}ms: ${filePath}`)),
      TIMEOUT_MS,
    );
  });

  try {
    const [data] = await Promise.race([downloadPromise, timeoutPromise]);
    return data.toString('base64');
  } finally {
    if (timer) clearTimeout(timer);
  }
}

/**
 * Download a PDF from a public HTTP/HTTPS URL directly.
 * Used when the PDF is publicly accessible without Firebase auth.
 */
export async function fetchPdfFromHttpUrl(url: string): Promise<string> {
  const response = await fetch(url, { signal: AbortSignal.timeout(30_000) });
  if (!response.ok) {
    throw new Error(`HTTP ${response.status} fetching PDF: ${url}`);
  }
  const buffer = await response.arrayBuffer();
  return Buffer.from(buffer).toString('base64');
}

/**
 * Smart PDF fetcher — handles both Firebase Storage URLs and plain HTTP URLs.
 * Retries transient failures with exponential backoff.
 */
export async function fetchPdf(url: string): Promise<string> {
  const maxRetries = config.processing.pdfFetchRetries;

  if (url.includes('firebasestorage.googleapis.com')) {
    return withRetry(() => fetchPdfAsBase64(url), 'Firebase PDF fetch', maxRetries);
  }
  return withRetry(() => fetchPdfFromHttpUrl(url), 'HTTP PDF fetch', maxRetries);
}
