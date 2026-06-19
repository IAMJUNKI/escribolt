export type Nova3LanguageOption = {
    code: string;
    label: string;
};

export const NOVA3_MONOLINGUAL_LANGUAGE_OPTIONS: Nova3LanguageOption[] = [
    { code: 'ar', label: 'Arabic' },
    { code: 'ar-AE', label: 'Arabic (United Arab Emirates)' },
    { code: 'ar-SA', label: 'Arabic (Saudi Arabia)' },
    { code: 'ar-QA', label: 'Arabic (Qatar)' },
    { code: 'ar-KW', label: 'Arabic (Kuwait)' },
    { code: 'ar-SY', label: 'Arabic (Syria)' },
    { code: 'ar-LB', label: 'Arabic (Lebanon)' },
    { code: 'ar-PS', label: 'Arabic (Palestine)' },
    { code: 'ar-JO', label: 'Arabic (Jordan)' },
    { code: 'ar-EG', label: 'Arabic (Egypt)' },
    { code: 'ar-SD', label: 'Arabic (Sudan)' },
    { code: 'ar-TD', label: 'Arabic (Chad)' },
    { code: 'ar-MA', label: 'Arabic (Morocco)' },
    { code: 'ar-DZ', label: 'Arabic (Algeria)' },
    { code: 'ar-TN', label: 'Arabic (Tunisia)' },
    { code: 'ar-IQ', label: 'Arabic (Iraq)' },
    { code: 'ar-IR', label: 'Arabic (Iran)' },
    { code: 'be', label: 'Belarusian' },
    { code: 'bn', label: 'Bengali' },
    { code: 'bs', label: 'Bosnian' },
    { code: 'bg', label: 'Bulgarian' },
    { code: 'ca', label: 'Catalan' },
    { code: 'zh-HK', label: 'Chinese (Cantonese, Traditional)' },
    { code: 'zh', label: 'Chinese (Mandarin)' },
    { code: 'zh-CN', label: 'Chinese (Mandarin, Simplified)' },
    { code: 'zh-Hans', label: 'Chinese (Simplified)' },
    { code: 'zh-TW', label: 'Chinese (Mandarin, Traditional)' },
    { code: 'zh-Hant', label: 'Chinese (Traditional)' },
    { code: 'hr', label: 'Croatian' },
    { code: 'cs', label: 'Czech' },
    { code: 'da', label: 'Danish' },
    { code: 'da-DK', label: 'Danish (Denmark)' },
    { code: 'nl', label: 'Dutch' },
    { code: 'en', label: 'English' },
    { code: 'en-US', label: 'English (United States)' },
    { code: 'en-AU', label: 'English (Australia)' },
    { code: 'en-GB', label: 'English (United Kingdom)' },
    { code: 'en-IN', label: 'English (India)' },
    { code: 'en-NZ', label: 'English (New Zealand)' },
    { code: 'et', label: 'Estonian' },
    { code: 'fi', label: 'Finnish' },
    { code: 'nl-BE', label: 'Flemish' },
    { code: 'fr', label: 'French' },
    { code: 'fr-CA', label: 'French (Canada)' },
    { code: 'de', label: 'German' },
    { code: 'de-CH', label: 'German (Switzerland)' },
    { code: 'el', label: 'Greek' },
    { code: 'gu', label: 'Gujarati' },
    { code: 'gu-IN', label: 'Gujarati (India)' },
    { code: 'he', label: 'Hebrew' },
    { code: 'hi', label: 'Hindi' },
    { code: 'hu', label: 'Hungarian' },
    { code: 'id', label: 'Indonesian' },
    { code: 'it', label: 'Italian' },
    { code: 'ja', label: 'Japanese' },
    { code: 'kn', label: 'Kannada' },
    { code: 'ko', label: 'Korean' },
    { code: 'ko-KR', label: 'Korean (South Korea)' },
    { code: 'lv', label: 'Latvian' },
    { code: 'lt', label: 'Lithuanian' },
    { code: 'mk', label: 'Macedonian' },
    { code: 'ms', label: 'Malay' },
    { code: 'mr', label: 'Marathi' },
    { code: 'no', label: 'Norwegian' },
    { code: 'fa', label: 'Persian' },
    { code: 'pl', label: 'Polish' },
    { code: 'pt', label: 'Portuguese' },
    { code: 'pt-BR', label: 'Portuguese (Brazil)' },
    { code: 'pt-PT', label: 'Portuguese (Portugal)' },
    { code: 'ro', label: 'Romanian' },
    { code: 'ru', label: 'Russian' },
    { code: 'sr', label: 'Serbian' },
    { code: 'sk', label: 'Slovak' },
    { code: 'sl', label: 'Slovenian' },
    { code: 'es', label: 'Spanish' },
    { code: 'es-419', label: 'Spanish (Latin America)' },
    { code: 'sv', label: 'Swedish' },
    { code: 'sv-SE', label: 'Swedish (Sweden)' },
    { code: 'tl', label: 'Tagalog' },
    { code: 'ta', label: 'Tamil' },
    { code: 'te', label: 'Telugu' },
    { code: 'th', label: 'Thai' },
    { code: 'th-TH', label: 'Thai (Thailand)' },
    { code: 'tr', label: 'Turkish' },
    { code: 'uk', label: 'Ukrainian' },
    { code: 'ur', label: 'Urdu' },
    { code: 'vi', label: 'Vietnamese' },
];

const NOVA3_MONOLINGUAL_LANGUAGE_BY_CODE = new Map(
    NOVA3_MONOLINGUAL_LANGUAGE_OPTIONS.map((entry) => [entry.code.toLowerCase(), entry]),
);

export function findNova3MonolingualLanguageLabel(code: string, fallback = 'English'): string {
    const cleanCode = String(code || '').trim().toLowerCase();
    return NOVA3_MONOLINGUAL_LANGUAGE_BY_CODE.get(cleanCode)?.label || fallback;
}

export function formatNova3LanguageBadgeCode(code: string): string {
    const cleanCode = String(code || 'en').trim();
    const baseCode = cleanCode.split('-')[0] || 'en';
    return baseCode.slice(0, 3).toUpperCase();
}
