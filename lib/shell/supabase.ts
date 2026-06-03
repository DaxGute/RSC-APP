/**
 * Typed Supabase client for React Native (AsyncStorage session persistence).
 * Row types and `Database` schema — regenerate from the dashboard when columns change.
 * Requires `EXPO_PUBLIC_SUPABASE_URL` and `EXPO_PUBLIC_SUPABASE_ANON_KEY` at build time.
 */

import 'react-native-url-polyfill/auto';

import AsyncStorage from '@react-native-async-storage/async-storage';
import { createClient, type User } from '@supabase/supabase-js';

/** One PurpleAir sensor row from the ingestion pipeline (`purple_air` table). */
export interface PurpleAirRow {
  sensor_index: number | string;
  name: string | null;
  latitude: number;
  longitude: number;
  pm25: number | null;
  aqi: number | null;
  humidity: number | null;
  temperature: number | null;
  /** When the sensor last reported (ISO 8601). */
  last_seen: string;
  /** When the pipeline recorded this row (ISO 8601). */
  time: string;
}

/** One Clarity sensor row from the ingestion pipeline (`clarity` table). */
export interface ClarityRow {
  sensor_index: number | string;
  name: string | null;
  latitude: number;
  longitude: number;
  pm25: number | null;
  aqi: number | null;
  humidity: number | null;
  temperature: number | null;
  last_seen: string;
  time: string;
}

/** Precomputed kriging grid cell (client may recompute variance locally). */
export interface CurrentKrigingRow {
  latitude: number;
  longitude: number;
  pm25: number | null;
  aqi: number | null;
  /** Kriging prediction variance for this grid cell (client-side recompute). */
  kriging_variance: number | null;
  /** Pipeline timestamp for this surface (ISO 8601). */
  time: string;
}

/** Per-sensor daily rollup used by calendar and graph screens (`daily_sensor_aqi`). */
export interface DailySensorAqiRow {
  source: string;
  sensor_index: number | string;
  name: string | null;
  latitude: number;
  longitude: number;
  pm25: number | null;
  aqi: number | null;
  time: string;
  reading_count: number | null;
}

/** Supabase client generic: maps public table names to Row types. */
export interface Database {
  public: {
    Tables: {
      purple_air: {
        Row: PurpleAirRow;
        Insert: never;
        Update: never;
        Relationships: [];
      };
      clarity: {
        Row: ClarityRow;
        Insert: never;
        Update: never;
        Relationships: [];
      };
      daily_sensor_aqi: {
        Row: DailySensorAqiRow;
        Insert: never;
        Update: never;
        Relationships: [];
      };
      forecast_wind_grid: {
        Row: {
          forecast_time_utc: string;
          lat: number;
          lon: number;
          wind_speed_mps: number;
          wind_direction_deg: number;
          fetched_at: string;
        };
        Insert: {
          forecast_time_utc: string;
          lat: number;
          lon: number;
          wind_speed_mps: number;
          wind_direction_deg: number;
          fetched_at?: string;
        };
        Update: Partial<{
          wind_speed_mps: number;
          wind_direction_deg: number;
          fetched_at: string;
        }>;
        Relationships: [];
      };
      user_notification_settings: {
        Row: {
          user_id: string;
          notification_on: boolean;
          notification_lat: number;
          notification_lng: number;
          notification_threshold: number;
          /** Minutes between notifications (matches app `cooldownMinutes`). */
          notification_cooldown: number;
          expo_push_token: string;
        };
        Insert: {
          user_id: string;
          notification_on: boolean;
          notification_lat: number;
          notification_lng: number;
          notification_threshold: number;
          notification_cooldown: number;
          expo_push_token: string;
        };
        Update: Partial<{
          notification_on: boolean;
          notification_lat: number;
          notification_lng: number;
          notification_threshold: number;
          notification_cooldown: number;
          expo_push_token: string;
        }>;
        Relationships: [];
      };
    };
    Views: Record<string, never>;
    Functions: Record<string, never>;
    Enums: Record<string, never>;
    CompositeTypes: Record<string, never>;
  };
}

const SUPABASE_URL = process.env.EXPO_PUBLIC_SUPABASE_URL;
const SUPABASE_ANON_KEY = process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY;

console.log('SUPABASE_URL present:', !!SUPABASE_URL);
console.log('SUPABASE_ANON_KEY present:', !!SUPABASE_ANON_KEY);

if (!SUPABASE_URL || !SUPABASE_ANON_KEY) {
  console.error('Missing Supabase env vars at startup', {
    hasUrl: !!SUPABASE_URL,
    hasAnonKey: !!SUPABASE_ANON_KEY,
  });

  throw new Error(
    'Missing EXPO_PUBLIC_SUPABASE_URL or EXPO_PUBLIC_SUPABASE_ANON_KEY in the build environment.'
  );
}

/** Shared client — import this rather than calling `createClient` again. */
export const supabase = createClient<Database>(SUPABASE_URL, SUPABASE_ANON_KEY, {
  auth: {
    storage: AsyncStorage,
    autoRefreshToken: true,
    persistSession: true,
    detectSessionInUrl: false,
  },
});

/** Returns the current user, creating an anonymous session if none is stored. */
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
