import { Injectable, Pipe, PipeTransform, inject, signal } from '@angular/core';
import { DE } from './de';
import { EN, type MessageKey } from './en';
import { ES } from './es';
import { FR } from './fr';
import { PT } from './pt';

export const LOCALES = ['en', 'es', 'fr', 'de', 'pt'] as const;
export type Locale = (typeof LOCALES)[number];

export interface LocaleMeta {
  id: Locale;
  code: string;
  nativeName: string;
}

export const LOCALE_META: LocaleMeta[] = [
  { id: 'en', code: 'EN', nativeName: 'English' },
  { id: 'es', code: 'ES', nativeName: 'Español' },
  { id: 'fr', code: 'FR', nativeName: 'Français' },
  { id: 'de', code: 'DE', nativeName: 'Deutsch' },
  { id: 'pt', code: 'PT', nativeName: 'Português' },
];

const STORAGE_KEY = 'nb_locale';

const DICTS: Record<Locale, Record<MessageKey, string>> = {
  en: EN,
  es: ES,
  fr: FR,
  de: DE,
  pt: PT,
};

export function interpolate(template: string, params?: Record<string, string | number>): string {
  if (!params) return template;
  return template.replace(/\{(\w+)\}/g, (_, key: string) =>
    params[key] === undefined || params[key] === null ? `{${key}}` : String(params[key]),
  );
}

function detectLocale(): Locale {
  try {
    const saved = localStorage.getItem(STORAGE_KEY);
    if (saved && (LOCALES as readonly string[]).includes(saved)) return saved as Locale;
  } catch {
    /* ignore */
  }
  const nav = typeof navigator !== 'undefined' ? navigator.language : 'en';
  const short = nav.slice(0, 2).toLowerCase();
  if ((LOCALES as readonly string[]).includes(short)) return short as Locale;
  return 'en';
}

@Injectable({ providedIn: 'root' })
export class I18n {
  readonly locales = LOCALE_META;
  readonly locale = signal<Locale>(detectLocale());

  constructor() {
    this.applyDocument(this.locale());
  }

  meta(): LocaleMeta {
    return LOCALE_META.find((l) => l.id === this.locale()) ?? LOCALE_META[0];
  }

  setLocale(locale: Locale): void {
    if (this.locale() === locale) return;
    this.locale.set(locale);
    try {
      localStorage.setItem(STORAGE_KEY, locale);
    } catch {
      /* ignore */
    }
    this.applyDocument(locale);
  }

  t(key: MessageKey, params?: Record<string, string | number>): string {
    const loc = this.locale();
    const raw = DICTS[loc][key] ?? EN[key] ?? key;
    return interpolate(raw, params);
  }

  private applyDocument(locale: Locale): void {
    if (typeof document === 'undefined') return;
    document.documentElement.lang = locale;
  }
}

@Pipe({ name: 't' })
export class TranslatePipe implements PipeTransform {
  private readonly i18n = inject(I18n);

  transform(key: MessageKey, locale: Locale, params?: Record<string, string | number>): string {
    void locale;
    return this.i18n.t(key, params);
  }
}
