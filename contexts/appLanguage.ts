/**
 * App-wide UI locale (`en` / `es`), storage key, and toggle labels.
 * Used by `LanguageProvider` and by copy helpers via `import type { AppLanguage }`.
 */

/** App UI language. Extend here when adding locales app-wide. */
export type AppLanguage = 'en' | 'es';

/** AsyncStorage key for the persisted app-wide language preference. */
export const APP_LANGUAGE_STORAGE_KEY = 'app.language';

/** Supported locales in display order (language switch, validation). */
export const APP_LANGUAGES: AppLanguage[] = ['en', 'es'];

/** Narrows a string from storage or deep links to a known `AppLanguage`. */
export function isAppLanguage(value: string): value is AppLanguage {
  return value === 'en' || value === 'es';
}

/** Human-readable labels for the global language toggle. */
export const appLanguageToggleLabels: Record<AppLanguage, string> = {
  en: 'English',
  es: 'Español',
};
