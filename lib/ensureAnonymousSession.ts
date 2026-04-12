import type { User } from '@supabase/supabase-js';

import { supabase } from './supabase';

export async function ensureAnonymousSession(): Promise<User> {
  const { data: sessionData } = await supabase.auth.getSession();

  if (sessionData.session?.user) {
    console.log('existing session:', sessionData.session.user.id);
    return sessionData.session.user;
  }

  console.log('no session, signing in anonymously');

  const { data, error } = await supabase.auth.signInAnonymously();
  if (error) {
    console.error('anon sign-in failed', error);
    throw error;
  }

  if (!data.user) {
    throw new Error('Anonymous sign-in returned no user');
  }

  console.log('new anon user:', data.user.id);

  return data.user;
}
