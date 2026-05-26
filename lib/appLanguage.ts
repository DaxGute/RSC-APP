/** App UI language. Extend here when adding locales app-wide. */
export type AppLanguage = 'en' | 'es';

/** AsyncStorage key for the persisted app-wide language preference. */
export const APP_LANGUAGE_STORAGE_KEY = 'app.language';

export const APP_LANGUAGES: AppLanguage[] = ['en', 'es'];

export function isAppLanguage(value: string): value is AppLanguage {
  return value === 'en' || value === 'es';
}

export const appLanguageToggleLabels: Record<AppLanguage, string> = {
  en: 'English',
  es: 'Español',
};
