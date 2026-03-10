import { createClient } from '@supabase/supabase-js';

const SUPABASE_URL_ENV_KEYS = ['NEXT_PUBLIC_SUPABASE_URL', 'SUPABASE_URL'] as const;
const SUPABASE_PUBLISHABLE_KEY_ENV_KEYS = [
  'NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY',
  'NEXT_PUBLIC_SUPABASE_PUBLISHABLE_DEFAULT_KEY',
  'NEXT_PUBLIC_SUPABASE_ANON_KEY',
] as const;

function getEnvValue(keys: readonly string[]) {
  for (const key of keys) {
    const value = process.env[key];
    if (value?.trim()) {
      return value.trim();
    }
  }

  return undefined;
}

export function getSupabaseConfig() {
  const url = getEnvValue(SUPABASE_URL_ENV_KEYS);
  const publishableKey = getEnvValue(SUPABASE_PUBLISHABLE_KEY_ENV_KEYS);
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY?.trim() || undefined;

  if (!url) {
    throw new Error(
      'Missing Supabase URL. Set NEXT_PUBLIC_SUPABASE_URL in .env.local.',
    );
  }

  if (!publishableKey) {
    throw new Error(
      'Missing Supabase publishable key. Set NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY in .env.local.',
    );
  }

  return {
    url,
    publishableKey,
    serviceRoleKey,
  };
}

export function createSupabaseClients() {
  const { url, publishableKey, serviceRoleKey } = getSupabaseConfig();

  return {
    supabase: createClient(url, publishableKey),
    supabaseStorage: createClient(url, serviceRoleKey ?? publishableKey),
  };
}

export function createSupabaseServerClient() {
  const { url, publishableKey, serviceRoleKey } = getSupabaseConfig();

  return createClient(url, serviceRoleKey ?? publishableKey);
}
