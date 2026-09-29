import i18n from "i18next";
import { initReactI18next } from "react-i18next";
import LanguageDetector from "i18next-browser-languagedetector";

import ruCommon from "./locales/ru/common.json";
import enCommon from "./locales/en/common.json";

const resources = {
  ru: {
    common: ruCommon,
  },
  en: {
    common: enCommon,
  },
} as const;

export type SupportedLanguage = keyof typeof resources;
export type Namespace = keyof (typeof resources)["ru"];

i18n
  .use(LanguageDetector)
  .use(initReactI18next)
  .init({
    resources,
    fallbackLng: "en",
    supportedLngs: ["ru", "en"],
    defaultNS: "common",
    ns: ["common"],
    detection: {
      order: ["localStorage", "navigator", "htmlTag"],
      caches: ["localStorage"],
      lookupLocalStorage: "niriforge:locale",
    },
    interpolation: {
      escapeValue: false,
    },
    react: {
      useSuspense: false,
    },
  });

export default i18n;