import React from 'react';
import type { UiSettings } from '../types';
import { SettingsRow } from './SettingsLayout';

type ByokLlmProvider = 'openai' | 'groq' | 'anthropic' | 'gemini';

const BYOK_LLM_MODEL_OPTIONS: Record<ByokLlmProvider, Array<{ id: string; label: string }>> = {
    openai: [
        { id: 'gpt-5-nano', label: 'GPT-5 Nano' },
        { id: 'gpt-4.1-mini', label: 'GPT-4.1 Mini' },
        { id: 'gpt-4o-mini', label: 'GPT-4o Mini' },
    ],
    groq: [
        { id: 'llama-3.3-70b-versatile', label: 'Llama 3.3 70B Versatile' },
        { id: 'llama-3.1-8b-instant', label: 'Llama 3.1 8B Instant' },
        { id: 'deepseek-r1-distill-llama-70b', label: 'DeepSeek R1 Distill Llama 70B' },
    ],
    anthropic: [
        { id: 'claude-sonnet-4-20250514', label: 'Claude Sonnet 4' },
        { id: 'claude-3-7-sonnet-latest', label: 'Claude 3.7 Sonnet' },
        { id: 'claude-3-5-haiku-latest', label: 'Claude 3.5 Haiku' },
    ],
    gemini: [
        { id: 'gemini-2.0-flash', label: 'Gemini 2.0 Flash' },
        { id: 'gemini-1.5-pro', label: 'Gemini 1.5 Pro' },
    ],
};

const BYOK_PROVIDER_OPTIONS: Array<{ id: ByokLlmProvider; label: string }> = [
    { id: 'openai', label: 'OpenAI' },
    { id: 'groq', label: 'Groq' },
    { id: 'anthropic', label: 'Anthropic Claude' },
    { id: 'gemini', label: 'Google Gemini' },
];

function getByokModelOptions(provider: string): Array<{ id: string; label: string }> {
    return BYOK_LLM_MODEL_OPTIONS[provider as ByokLlmProvider] || BYOK_LLM_MODEL_OPTIONS.openai;
}

function getDefaultByokModel(provider: string): string {
    const options = getByokModelOptions(provider);
    return options[0]?.id || 'gpt-5-nano';
}

function normalizeByokModel(provider: string, model: string): string {
    const options = getByokModelOptions(provider);
    return options.some((entry) => entry.id === model) ? model : getDefaultByokModel(provider);
}

function formatProModelLabel(alias: string): string {
    const tokens = String(alias || '')
        .trim()
        .replace(/[^a-zA-Z0-9]+/g, ' ')
        .split(' ')
        .filter(Boolean);
    if (!tokens.length) return 'Model';
    return tokens
        .map((token) => token.charAt(0).toUpperCase() + token.slice(1).toLowerCase())
        .join(' ');
}

function normalizeProModel(model: string, options: Array<{ id: string; label: string }>): string {
    const normalized = String(model || '').trim().toLowerCase();
    if (normalized && options.some((entry) => entry.id === normalized)) {
        return normalized;
    }
    return options[0]?.id || 'default';
}

function getEffectiveProModelOptions(settings: UiSettings, proModelOptions: Array<{ id: string; label: string; helperText?: string }>) {
    const normalizedIncomingProOptions = Array.isArray(proModelOptions)
        ? proModelOptions
            .map((entry) => ({
                id: String(entry?.id || '').trim().toLowerCase(),
                label: String(entry?.label || '').trim(),
            }))
            .filter((entry) => entry.id)
        : [];
    return normalizedIncomingProOptions.length
        ? normalizedIncomingProOptions
        : [{
            id: String(settings.aiEngine.llmModel || settings.aiEngine.summaryModel || 'default').trim().toLowerCase() || 'default',
            label: formatProModelLabel(String(settings.aiEngine.llmModel || settings.aiEngine.summaryModel || 'default')),
        }];
}

function resolveByokSelectableProviders(settings: UiSettings) {
    const enabledProviderOptions = BYOK_PROVIDER_OPTIONS.filter((entry) => settings.aiEngine.apiKeys[entry.id]?.present);
    return enabledProviderOptions.length ? enabledProviderOptions : BYOK_PROVIDER_OPTIONS;
}

function resolveByokProvider(currentProvider: string, selectableProviders: Array<{ id: ByokLlmProvider; label: string }>): ByokLlmProvider {
    return selectableProviders.some((entry) => entry.id === currentProvider)
        ? currentProvider as ByokLlmProvider
        : selectableProviders[0].id;
}

function hasProviderKey(settings: UiSettings, provider: string): boolean {
    return settings.aiEngine.apiKeys[provider as ByokLlmProvider]?.present === true;
}

function resolveCloudModelMode(settings: UiSettings, provider: string): 'byok' | 'pro' {
    return hasProviderKey(settings, provider) ? 'byok' : 'pro';
}

function getByokModelChoiceValue(provider: string, model: string): string {
    return `${provider}:${model}`;
}

function getByokModelChoices(settings: UiSettings) {
    const providers = resolveByokSelectableProviders(settings);
    return providers.flatMap((provider) => {
        const hasKey = settings.aiEngine.apiKeys[provider.id]?.present;
        return getByokModelOptions(provider.id).map((model) => ({
            id: getByokModelChoiceValue(provider.id, model.id),
            provider: provider.id,
            model: model.id,
            label: `${provider.label} · ${model.label}${hasKey ? '' : ' (No key yet)'}`,
        }));
    });
}

function parseByokModelChoice(value: string, fallbackProvider: ByokLlmProvider, fallbackModel: string) {
    const [provider, ...modelParts] = String(value || '').split(':');
    const model = modelParts.join(':');
    return {
        provider: BYOK_PROVIDER_OPTIONS.some((entry) => entry.id === provider)
            ? provider as ByokLlmProvider
            : fallbackProvider,
        model: model || fallbackModel,
    };
}

export interface SettingsModelRowsProps {
    settings: UiSettings;
    proModelOptions: Array<{ id: string; label: string; helperText?: string }>;
    updateSettings: (patch: Record<string, any>) => Promise<void>;
}

export function AgentModelSettingsRows({ settings, proModelOptions, updateSettings }: SettingsModelRowsProps) {
    const byokSelectableProviders = resolveByokSelectableProviders(settings);
    const selectedLlmProvider = resolveByokProvider(settings.aiEngine.llmProvider, byokSelectableProviders);
    const effectiveMode = settings.processingModes?.aiActions === 'local'
        ? 'local'
        : resolveCloudModelMode(settings, selectedLlmProvider);
    const isProMode = effectiveMode === 'pro';
    const isLocalMode = effectiveMode === 'local';
    const localModelLabel = settings.model === 'gemma' ? 'Gemma' : 'Qwen';
    const selectClass = 'h-9 min-w-[260px] rounded-md border es-global-outline bg-transparent px-3 text-sm es-general-text disabled:opacity-60';
    const selectedLlmModel = normalizeByokModel(selectedLlmProvider, settings.aiEngine.llmModel);
    const byokLlmModelChoices = getByokModelChoices(settings);
    const selectedByokLlmChoice = getByokModelChoiceValue(selectedLlmProvider, selectedLlmModel);
    const effectiveProModelOptions = getEffectiveProModelOptions(settings, proModelOptions);
    const selectedProLlmModel = normalizeProModel(settings.aiEngine.llmModel, effectiveProModelOptions);

    return (
        <>
            <SettingsRow title="Agent model" description="Choose the model used for chat and assistant responses.">
                {isLocalMode ? (
                    <select
                        className={selectClass}
                        value={settings.model}
                        disabled
                    >
                        <option value={settings.model}>Local {localModelLabel} (On-device)</option>
                    </select>
                ) : isProMode ? (
                    <select
                        className={selectClass}
                        value={selectedProLlmModel}
                        onChange={(event) => updateSettings({ aiEngine: { llmModel: event.target.value } })}
                    >
                        {effectiveProModelOptions.map((option) => (
                            <option key={`pro-llm-model-${option.id}`} value={option.id}>
                                {option.label}
                            </option>
                        ))}
                    </select>
                ) : (
                    <select
                        className={selectClass}
                        value={selectedByokLlmChoice}
                        onChange={(event) => {
                            const choice = parseByokModelChoice(event.target.value, selectedLlmProvider, selectedLlmModel);
                            return updateSettings({
                                aiEngine: {
                                    llmProvider: choice.provider,
                                    llmModel: choice.model,
                                },
                            });
                        }}
                    >
                        {byokLlmModelChoices.map((option) => (
                            <option key={`byok-llm-model-${option.id}`} value={option.id}>
                                {option.label}
                            </option>
                        ))}
                    </select>
                )}
            </SettingsRow>
        </>
    );
}

export function SummaryModelSettingsRows({ settings, proModelOptions, updateSettings }: SettingsModelRowsProps) {
    const byokSelectableProviders = resolveByokSelectableProviders(settings);
    const selectedSummaryProvider = resolveByokProvider(settings.aiEngine.summaryProvider, byokSelectableProviders);
    const effectiveMode = settings.processingModes?.summaries === 'local'
        ? 'local'
        : resolveCloudModelMode(settings, selectedSummaryProvider);
    const isProMode = effectiveMode === 'pro';
    const isLocalMode = effectiveMode === 'local';
    const localModelLabel = settings.model === 'gemma' ? 'Gemma' : 'Qwen';
    const selectClass = 'h-9 min-w-[260px] rounded-md border es-global-outline bg-transparent px-3 text-sm es-general-text disabled:opacity-60';
    const selectedSummaryModel = normalizeByokModel(selectedSummaryProvider, settings.aiEngine.summaryModel);
    const byokSummaryModelChoices = getByokModelChoices(settings);
    const selectedByokSummaryChoice = getByokModelChoiceValue(selectedSummaryProvider, selectedSummaryModel);
    const effectiveProModelOptions = getEffectiveProModelOptions(settings, proModelOptions);
    const selectedProSummaryModel = normalizeProModel(settings.aiEngine.summaryModel, effectiveProModelOptions);

    return (
        <>
            <SettingsRow title="Summary model" description="Choose the model used to summarize recordings and long ask threads.">
                {isLocalMode ? (
                    <select
                        className={selectClass}
                        value={settings.model}
                        disabled
                    >
                        <option value={settings.model}>Local {localModelLabel} (On-device)</option>
                    </select>
                ) : isProMode ? (
                    <select
                        className={selectClass}
                        value={selectedProSummaryModel}
                        onChange={(event) => updateSettings({ aiEngine: { summaryModel: event.target.value } })}
                    >
                        {effectiveProModelOptions.map((option) => (
                            <option key={`pro-summary-model-${option.id}`} value={option.id}>
                                {option.label}
                            </option>
                        ))}
                    </select>
                ) : (
                    <select
                        className={selectClass}
                        value={selectedByokSummaryChoice}
                        onChange={(event) => {
                            const choice = parseByokModelChoice(event.target.value, selectedSummaryProvider, selectedSummaryModel);
                            return updateSettings({
                                aiEngine: {
                                    summaryProvider: choice.provider,
                                    summaryModel: choice.model,
                                },
                            });
                        }}
                    >
                        {byokSummaryModelChoices.map((option) => (
                            <option key={`byok-summary-model-${option.id}`} value={option.id}>
                                {option.label}
                            </option>
                        ))}
                    </select>
                )}
            </SettingsRow>
        </>
    );
}
