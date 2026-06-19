export type RecordingSummaryLanguageOption = {
    code: string;
    label: string;
};

export const DEFAULT_RECORDING_SUMMARY_LANGUAGE = 'en';

export const RECORDING_SUMMARY_LANGUAGE_OPTIONS: RecordingSummaryLanguageOption[] = [
    { code: 'en', label: 'English' },
    { code: 'es', label: 'Spanish' },
    { code: 'ca', label: 'Catalan' },
    { code: 'eu', label: 'Basque' },
    { code: 'gl', label: 'Galician' },
    { code: 'fr', label: 'French' },
    { code: 'de', label: 'German' },
    { code: 'pt', label: 'Portuguese' },
    { code: 'it', label: 'Italian' },
    { code: 'nl', label: 'Dutch' },
    { code: 'sv', label: 'Swedish' },
    { code: 'da', label: 'Danish' },
    { code: 'no', label: 'Norwegian' },
    { code: 'fi', label: 'Finnish' },
    { code: 'pl', label: 'Polish' },
    { code: 'cs', label: 'Czech' },
    { code: 'uk', label: 'Ukrainian' },
    { code: 'ru', label: 'Russian' },
    { code: 'ar', label: 'Arabic' },
    { code: 'he', label: 'Hebrew' },
    { code: 'hi', label: 'Hindi' },
    { code: 'zh', label: 'Chinese' },
    { code: 'ja', label: 'Japanese' },
    { code: 'ko', label: 'Korean' },
    { code: 'tr', label: 'Turkish' },
    { code: 'vi', label: 'Vietnamese' },
    { code: 'id', label: 'Indonesian' },
];

const RECORDING_SUMMARY_LANGUAGE_BY_CODE = new Map(
    RECORDING_SUMMARY_LANGUAGE_OPTIONS.map((entry) => [entry.code.toLowerCase(), entry]),
);

export function normalizeRecordingSummaryLanguageCode(rawCode: unknown): string {
    const normalized = String(rawCode || '')
        .trim()
        .replace(/_/g, '-')
        .toLowerCase();
    if (!normalized) return DEFAULT_RECORDING_SUMMARY_LANGUAGE;

    if (RECORDING_SUMMARY_LANGUAGE_BY_CODE.has(normalized)) {
        return normalized;
    }

    const baseCode = normalized.split('-')[0] || '';
    return RECORDING_SUMMARY_LANGUAGE_BY_CODE.has(baseCode)
        ? baseCode
        : DEFAULT_RECORDING_SUMMARY_LANGUAGE;
}

export function findRecordingSummaryLanguageLabel(code: string, fallback = 'English'): string {
    const normalized = normalizeRecordingSummaryLanguageCode(code);
    return RECORDING_SUMMARY_LANGUAGE_BY_CODE.get(normalized)?.label || fallback;
}
