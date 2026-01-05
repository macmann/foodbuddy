const STRINGS = {
  en: {
    NEED_LOCATION: "Where are you right now (township/city)?",
    ASK_CRAVING: "What are you craving? (e.g., hotpot, noodles, BBQ)",
  },
  my: {
    NEED_LOCATION: "လက်ရှိဘယ်မှာရှိပါသလဲ (မြို့/မြို့နယ်)?",
    ASK_CRAVING: "ဘာစားချင်တာလဲ? (ဥပမာ ဟော့ပေါ့၊ ခေါက်ဆွဲ၊ BBQ)",
  },
};

export type I18nKey = keyof (typeof STRINGS)["en"];

const normalizeLang = (lang?: string | null) => {
  if (!lang) {
    return "en";
  }
  return lang.split("-")[0]?.toLowerCase() || "en";
};

export const t = (key: I18nKey, lang?: string | null): string => {
  const normalized = normalizeLang(lang);
  const table = STRINGS[normalized as keyof typeof STRINGS] ?? STRINGS.en;
  return table[key] ?? STRINGS.en[key];
};
