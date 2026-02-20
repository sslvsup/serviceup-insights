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
 * Download a PDF from Firebase Storage given a Firebase Storage URL.
 * Returns the PDF as a base64 string.
 */
export async function fetchPdfAsBase64(pdfUrl: string): Promise<string> {
  initFirebase();

  const { pathname } = new URL(pdfUrl);
  // Firebase Storage URLs encode the path after /o/
  const encodedPath = pathname.split('/o/')[1];
  if (!encodedPath) {
    throw new Error(`Cannot parse Firebase Storage path from URL: ${pdfUrl}`);
  }
  const filePath = decodeURIComponent(encodedPath.split('?')[0]);

  logger.debug('Downloading PDF from Firebase Storage', { filePath });

  const bucket = admin.storage().bucket();
  const file = bucket.file(filePath);

  const TIMEOUT_MS = 30_000;
  const downloadPromise = file.download();
  const timeoutPromise = new Promise<never>((_, reject) =>
    setTimeout(() => reject(new Error(`Firebase download timed out after ${TIMEOUT_MS}ms`)), TIMEOUT_MS),
  );
  const [data] = await Promise.race([downloadPromise, timeoutPromise]);
  return data.toString('base64');
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
 */
export async function fetchPdf(url: string): Promise<string> {
  if (url.includes('firebasestorage.googleapis.com')) {
    return fetchPdfAsBase64(url);
  }
  return fetchPdfFromHttpUrl(url);
}
