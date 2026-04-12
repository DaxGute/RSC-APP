import 'react-native-url-polyfill/auto';

import AsyncStorage from '@react-native-async-storage/async-storage';
import { createClient } from '@supabase/supabase-js';

import type { Database } from './database.types';

const url = process.env.EXPO_PUBLIC_SUPABASE_URL;
const anonKey = process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY;

if (!url || !anonKey) {
  throw new Error(
    'Set EXPO_PUBLIC_SUPABASE_URL and EXPO_PUBLIC_SUPABASE_ANON_KEY (e.g. in .env). See .env.example.'
  );
}

/**
 * Anon client — public reads; anonymous auth + `user_notification_settings` per RLS.
 *
 * Persist the session on device (AsyncStorage) so the same anonymous `user_id` is restored after
 * app relaunch. Without `storage` + `persistSession`, each cold start would look like a new user.
 * @see https://supabase.com/docs/guides/auth/quickstarts/react-native
 */
export const supabase = createClient<Database>(url, anonKey, {
  auth: {
    storage: AsyncStorage,
    persistSession: true,
    autoRefreshToken: true,
    detectSessionInUrl: false,
  },
});

/** Call once at app startup so `user_id` is stable before any reminder writes. */
export async function ensureAnonymousSession(): Promise<void> {
  const { data: sessionData } = await supabase.auth.getSession();
  if (sessionData.session?.user) return;

  const { error } = await supabase.auth.signInAnonymously();
  if (error) throw error;
}
