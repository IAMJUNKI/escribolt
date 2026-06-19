import React from 'react';
import type { AuthState, UiSettings } from '../types';
import { SettingsPage, SettingsSection, SettingsRow } from '../components/SettingsLayout';

export interface SettingsAIEnginePageProps {
    settings: UiSettings;
    authState: AuthState;
    proModelOptions: Array<{ id: string; label: string; helperText?: string }>;
    keyDrafts: { deepgram: string; openai: string; groq: string; anthropic: string; gemini: string };
    setKeyDrafts: React.Dispatch<React.SetStateAction<{ deepgram: string; openai: string; groq: string; anthropic: string; gemini: string }>>;
    isSavingKeys: boolean;
    saveApiKeys: () => void;
    clearSavedApiKeys: () => void;
    apiKeySaveMessage: string;
    updateSettings: (patch: Record<string, any>) => Promise<void>;
    sttPlan: any;
    llmPlan: any;
}

export default function SettingsAIEnginePage({
    settings,
    authState,
    keyDrafts,
    setKeyDrafts,
    isSavingKeys,
    saveApiKeys,
    clearSavedApiKeys,
    apiKeySaveMessage,
    updateSettings,
}: SettingsAIEnginePageProps) {
    const isProMode = settings.mode === 'pro';
    const isLocalMode = settings.mode === 'local';
    const isByokMode = settings.mode === 'byok';
    const selectClass = 'h-9 min-w-[260px] rounded-md border es-global-outline bg-transparent px-3 text-sm es-general-text disabled:opacity-60';
    const inputClass = 'h-9 w-full rounded-md border es-global-outline bg-transparent px-3 text-sm es-general-text placeholder:text-stone-500';
    const modeLabel = isLocalMode ? 'Local Mode' : isProMode ? 'PRO Mode' : 'BYOK Mode';
    const modeDescription = isLocalMode
        ? 'Processing defaults to on-device models. Workflow tabs control when a task can use cloud processing.'
        : isProMode
        ? 'Managed cloud routing is available for workflows that are set to cloud processing.'
        : 'Provider keys are stored on this device and used by workflows that are set to cloud processing.';

    const handleSttProviderChange = (value: string) => {
        const nextMode = value === 'deepgram'
            ? 'streaming'
            : 'prerecorded';
        void updateSettings({
            aiEngine: {
                sttProvider: value,
                sttTranscriptionMode: nextMode,
            },
        });
    };

    return (
        <SettingsPage
            title="AI Engine"
            description="Manage provider foundation settings. Workflow-specific model and processing choices now live in Dictation, Recordings, and Chats."
        >
            <SettingsSection title="Engine Mode">
                <SettingsRow
                    title="Current mode"
                    description={modeDescription}
                >
                    <div className="text-right">
                        <div className="text-base font-semibold es-general-text">{modeLabel}</div>
                        <div className="mt-1 text-xs es-general-secondary-text">
                            {authState.isLoggedIn ? 'Connected account' : 'Device-only session'}
                        </div>
                    </div>
                </SettingsRow>
            </SettingsSection>

            <SettingsSection title="Speech Provider">
                <SettingsRow title="Speech-to-text provider" description="Choose the base provider available to dictation and recordings.">
                    {isLocalMode ? (
                        <select
                            className={selectClass}
                            value="local"
                            disabled
                        >
                            <option value="local">Local Whisper (On-device)</option>
                        </select>
                    ) : isProMode ? (
                        <select
                            className={selectClass}
                            value="deepgram"
                            disabled
                        >
                            <option value="deepgram">Managed Deepgram (PRO)</option>
                        </select>
                    ) : (
                        <select
                            className={selectClass}
                            value={settings.aiEngine.sttProvider}
                            onChange={(event) => handleSttProviderChange(event.target.value)}
                        >
                            <option value="deepgram">Deepgram</option>
                            <option value="openai">OpenAI (REST)</option>
                            <option value="groq">Groq (REST)</option>
                        </select>
                    )}
                </SettingsRow>
            </SettingsSection>

            {isByokMode ? (
                <SettingsSection title="API Keys">
                    {BYOK_PROVIDER_FIELDS.map((field) => (
                        <SettingsRow
                            key={`api-key-${field.key}`}
                            title={field.label}
                            description={settings.aiEngine.apiKeys[field.key]?.present ? `Saved ending in ${settings.aiEngine.apiKeys[field.key].last4 || '----'}` : 'Not saved'}
                        >
                            <input
                                className={inputClass}
                                placeholder={`${field.label} API key`}
                                type="password"
                                value={keyDrafts[field.key]}
                                onChange={(event) => setKeyDrafts((prev) => ({ ...prev, [field.key]: event.target.value }))}
                            />
                        </SettingsRow>
                    ))}
                    <SettingsRow title="Key storage" description="Save or clear encrypted provider keys on this device.">
                        <div className="flex flex-wrap justify-end gap-2">
                            <button
                                className="h-9 rounded-md border es-global-outline px-3 text-sm font-medium es-general-item-hover es-general-text disabled:opacity-60"
                                onClick={saveApiKeys}
                                disabled={isSavingKeys}
                            >
                                {isSavingKeys ? 'Saving...' : 'Save API Keys'}
                            </button>
                            <button
                                className="h-9 rounded-md border es-global-outline px-3 text-sm font-medium es-general-item-hover es-general-text disabled:opacity-60"
                                onClick={clearSavedApiKeys}
                                disabled={isSavingKeys}
                            >
                                Clear Saved Keys
                            </button>
                        </div>
                        {apiKeySaveMessage ? (
                            <div className="mt-2 text-right text-xs es-general-secondary-text">{apiKeySaveMessage}</div>
                        ) : null}
                    </SettingsRow>
                </SettingsSection>
            ) : null}
        </SettingsPage>
    );
}

const BYOK_PROVIDER_FIELDS: Array<{
    key: keyof SettingsAIEnginePageProps['keyDrafts'];
    label: string;
}> = [
    { key: 'deepgram', label: 'Deepgram' },
    { key: 'openai', label: 'OpenAI' },
    { key: 'anthropic', label: 'Anthropic' },
    { key: 'gemini', label: 'Gemini' },
    { key: 'groq', label: 'Groq' },
];
