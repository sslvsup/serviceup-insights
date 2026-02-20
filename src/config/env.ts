import 'dotenv/config';

function required(name: string): string {
  const val = process.env[name];
  if (!val) throw new Error(`Missing required environment variable: ${name}`);
  return val;
}

function optional(name: string, fallback: string): string {
  return process.env[name] || fallback;
}

export const config = {
  database: {
    url: required('DATABASE_URL'),
  },

  metabase: {
    url: optional('METABASE_URL', ''),
    apiKey: optional('METABASE_API_KEY', ''),
    databaseId: parseInt(optional('METABASE_DATABASE_ID', '34')),
  },

  firebase: {
    serviceAccountKeyPath: optional('FIREBASE_SERVICE_ACCOUNT_KEY_PATH', ''),
    serviceAccountKey: optional('FIREBASE_SERVICE_ACCOUNT_KEY', ''),
    storageBucket: optional('FIREBASE_STORAGE_BUCKET', 'serviceupios.appspot.com'),
  },

  gemini: {
    apiKey: optional('GEMINI_API_KEY', ''),
  },

  api: {
    port: parseInt(optional('PORT', '4050')),
    apiKey: optional('API_KEY', ''),
    embedSecret: optional('EMBED_SECRET', 'dev-secret-change-in-prod'),
  },

  processing: {
    batchSize: parseInt(optional('INSIGHTS_BATCH_SIZE', '10')),
    maxRetries: parseInt(optional('INSIGHTS_MAX_RETRIES', '3')),
  },

  seed: {
    gsheetCsvPath: optional('GSHEET_CSV_PATH', './data/seed-invoices.csv'),
  },
};
