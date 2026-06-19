import React, { useCallback, useEffect, useState } from 'react';
import { Cloud, Lock, Sparkles } from 'lucide-react';
import type { AuthState, ProcessingLocation, UiSettings, UsageSummary } from '../types';
import { SettingsRow, SettingsSection } from './SettingsLayout';

const { ipcRenderer } = window.require('electron');

const DEFAULT_SHORTCUTS: NonNullable<UiSettings['shortcuts']> = {
    dictationHoldPreset: 'fn_hold',
    dictationHandsFreePreset: 'fn_space_toggle',
    quickNotePreset: 'ctrl_n',
    recordModePreset: 'ctrl_r',
};

const FALLBACK_CATALOG = {
    dictationHold: [
        { id: 'fn_hold', label: 'Fn/Globe hold', description: 'Hold Fn/Globe to talk, release to stop.' },
        { id: 'disabled', label: 'Disabled', description: 'Turn off hold-to-talk trigger.' },
    ],
    dictationHandsFree: [
        { id: 'fn_space_toggle', label: 'Fn+Space toggle', description: 'Press Fn+Space to start and press Fn to stop.' },
        { id: 'ctrl_space_toggle', label: 'Control+Space toggle', description: 'Press Control+Space to start and press again to stop.' },
        { id: 'cmd_ctrl_e_toggle', label: 'Command+Control+E toggle', description: 'Press Command+Control+E to start and press again to stop.' },
    ],
    quickNote: [
        { id: 'ctrl_n', label: 'Control+N', description: 'Capture quick note dictation.' },
        { id: 'fn_n_toggle', label: 'Fn/Globe + N', description: 'Press Fn/Globe + N to start a quick note, and press Fn to stop.' },
        { id: 'cmd_ctrl_n', label: 'Command+Control+N', description: 'Capture quick note dictation.' },
        { id: 'cmd_shift_n', label: 'Command+Shift+N', description: 'Capture quick note dictation.' },
        { id: 'opt_cmd_n', label: 'Option+Command+N', description: 'Capture quick note dictation.' },
    ],
    recordMode: [
        { id: 'ctrl_r', label: 'Control+R', description: 'Toggle record mode capture.' },
        { id: 'fn_r_toggle', label: 'Fn/Globe + R', description: 'Press Fn/Globe + R to start record mode, and press Fn to stop.' },
        { id: 'cmd_ctrl_r', label: 'Command+Control+R', description: 'Toggle record mode.' },
        { id: 'cmd_shift_r', label: 'Command+Shift+R', description: 'Toggle record mode.' },
        { id: 'opt_cmd_r', label: 'Option+Command+R', description: 'Toggle record mode.' },
    ],
};

type ShortcutCatalogEntry = {
    id: string;
    label: string;
    description: string;
};

type ShortcutCatalog = {
    dictationHold: ShortcutCatalogEntry[];
    dictationHandsFree: ShortcutCatalogEntry[];
    quickNote: ShortcutCatalogEntry[];
    recordMode: ShortcutCatalogEntry[];
};

type ShortcutCatalogKey = keyof ShortcutCatalog;
type ShortcutSettingKey = keyof NonNullable<UiSettings['shortcuts']>;
type ShortcutRuntimeKey = 'dictationHold' | 'dictationHandsFree' | 'quickNote' | 'recordMode';
export type ProcessingFeature = keyof UiSettings['processingModes'];

export function resolveShortcutCatalog(runtime: any): ShortcutCatalog {
    const catalog = runtime?.catalog;
    return {
        dictationHold: Array.isArray(catalog?.dictationHold) && catalog.dictationHold.length ? catalog.dictationHold : FALLBACK_CATALOG.dictationHold,
        dictationHandsFree: Array.isArray(catalog?.dictationHandsFree) && catalog.dictationHandsFree.length ? catalog.dictationHandsFree : FALLBACK_CATALOG.dictationHandsFree,
        quickNote: Array.isArray(catalog?.quickNote) && catalog.quickNote.length ? catalog.quickNote : FALLBACK_CATALOG.quickNote,
        recordMode: Array.isArray(catalog?.recordMode) && catalog.recordMode.length ? catalog.recordMode : FALLBACK_CATALOG.recordMode,
    };
}

function getOptionDescription(options: ShortcutCatalogEntry[], id: string): string {
    const match = options.find((entry) => entry.id === id);
    return match?.description || '';
}

function formatSecondsAsHoursMinutes(seconds: number) {
    const safeSeconds = Math.max(0, Math.round(Number(seconds) || 0));
    const totalMinutes = Math.floor(safeSeconds / 60);
    const hours = Math.floor(totalMinutes / 60);
    const minutes = totalMinutes % 60;
    return `${hours}h ${String(minutes).padStart(2, '0')}m`;
}

function usageLabel(usage: UsageSummary | null, quota: 'stt' | 'ai') {
    if (!usage) return '';
    if (quota === 'stt') {
        const remaining = Math.max(0, Number(usage.stt.limit || 0) - Number(usage.stt.used || 0));
        return `${formatSecondsAsHoursMinutes(remaining)} cloud transcription remaining`;
    }
    const remaining = Math.max(0, Number(usage.aiActions.limit || 0) - Number(usage.aiActions.used || 0));
    return `${remaining.toLocaleString()} AI actions remaining`;
}

function hasByokKey(settings: UiSettings, provider: string): boolean {
    const keys = settings.aiEngine?.apiKeys || {};
    return keys[provider as keyof typeof keys]?.present === true;
}

function normalizeSttByokProvider(settings: UiSettings): keyof UiSettings['aiEngine']['apiKeys'] {
    const provider = settings.aiEngine?.sttProvider;
    return provider === 'openai' || provider === 'groq' ? provider : 'deepgram';
}

export interface ShortcutSelectRowProps {
    settings: UiSettings;
    shortcutsRuntime: any;
    updateSettings: (patch: Record<string, any>) => Promise<void>;
    title: string;
    catalogKey: ShortcutCatalogKey;
    settingKey: ShortcutSettingKey;
    runtimeKey: ShortcutRuntimeKey;
}

export function ShortcutSelectRow({
    settings,
    shortcutsRuntime,
    updateSettings,
    title,
    catalogKey,
    settingKey,
    runtimeKey,
}: ShortcutSelectRowProps) {
    const catalog = resolveShortcutCatalog(shortcutsRuntime);
    const shortcuts = settings.shortcuts || DEFAULT_SHORTCUTS;
    const options = catalog[catalogKey];
    const active = shortcutsRuntime?.active || {};
    const activeDisplay = String(active?.[runtimeKey]?.display || 'Unknown');
    const fallbackActive = runtimeKey === 'dictationHandsFree' && active?.dictationHandsFree?.fallbackActive;

    return (
        <SettingsRow
            title={title}
            description={getOptionDescription(options, shortcuts[settingKey])}
            align="start"
        >
            <div className="space-y-2">
                <select
                    value={shortcuts[settingKey]}
                    className="h-9 min-w-[320px] rounded-md border es-global-outline es-general-background px-2 text-sm es-general-text"
                    onChange={(event) => {
                        void updateSettings({
                            shortcuts: {
                                ...shortcuts,
                                [settingKey]: event.target.value,
                            },
                        });
                    }}
                >
                    {options.map((option) => (
                        <option key={option.id} value={option.id}>{option.label}</option>
                    ))}
                </select>
                <p className="text-xs es-general-secondary-text">
                    Active: {activeDisplay} {fallbackActive ? '(fallback active)' : ''}
                </p>
            </div>
        </SettingsRow>
    );
}

export function PasteLastTranscriptionRow({ shortcutsRuntime }: { shortcutsRuntime: any }) {
    const active = shortcutsRuntime?.active || {};
    return (
        <SettingsRow
            title="Paste last transcription"
            description="Paste your most recent dictation again without replacing the contents of your normal system clipboard."
        >
            <div className="text-xs es-general-secondary-text">
                Active: {String(active?.pasteLastTranscription?.display || 'Cmd+Ctrl+V')}
            </div>
        </SettingsRow>
    );
}

export function ShortcutRuntimeStatusSection({
    shortcutsRuntime,
    isRuntimeLoading,
    refreshRuntime,
}: {
    shortcutsRuntime: any;
    isRuntimeLoading: boolean;
    refreshRuntime: () => Promise<void>;
}) {
    const warnings: string[] = Array.isArray(shortcutsRuntime?.warnings) ? shortcutsRuntime.warnings : [];
    const runtimeError = shortcutsRuntime?.status === 'error'
        ? String(shortcutsRuntime?.message || 'Shortcuts runtime is unavailable.')
        : '';
    const capability = shortcutsRuntime?.capability || {};

    return (
        <SettingsSection title="Shortcut Status">
            {runtimeError ? (
                <div className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-xs text-red-700">
                    {runtimeError}
                </div>
            ) : null}
            {warnings.map((warning, index) => (
                <div key={`shortcut-warning-${index}`} className="rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-800">
                    {warning}
                </div>
            ))}
            <SettingsRow
                title="Fn/Globe listener"
                description="Fn/Globe support may require macOS Accessibility/Input Monitoring permission."
            >
                <div className="text-xs es-general-secondary-text">
                    {capability?.fnListenerSupported
                        ? (capability?.fnListenerEnabled
                            ? (capability?.fnListenerAvailable ? 'Enabled' : `Unavailable (${String(capability?.fnListenerReason || 'unknown reason')})`)
                            : 'Disabled for this preset')
                        : 'Not supported on this platform'}
                </div>
            </SettingsRow>
            <div className="pt-1">
                <button
                    type="button"
                    className="h-8 rounded-md px-3 text-xs font-semibold border es-global-outline es-general-item-hover es-general-text"
                    onClick={() => { void refreshRuntime(); }}
                    disabled={isRuntimeLoading}
                >
                    {isRuntimeLoading ? 'Refreshing...' : 'Refresh status'}
                </button>
            </div>
        </SettingsSection>
    );
}

export function useProcessingSettings({
    settings,
    authState,
    updateSettings,
}: {
    settings: UiSettings;
    authState: AuthState;
    updateSettings: (patch: Record<string, any>) => Promise<void>;
}) {
    const [usage, setUsage] = useState<UsageSummary | null>(null);
    const [message, setMessage] = useState('');
    const [transientProcessingModes, setTransientProcessingModes] = useState<Partial<Record<ProcessingFeature, ProcessingLocation>>>({});

    const fetchUsage = useCallback(async () => {
        if (!authState.isLoggedIn || !authState.accessToken) {
            setUsage(null);
            return;
        }
        try {
            const result = await ipcRenderer.invoke('fetch-usage-summary');
            if (result && !result.error) {
                setUsage(result);
            }
        } catch (_error) {
            setUsage(null);
        }
    }, [authState.isLoggedIn, authState.accessToken]);

    useEffect(() => {
        void fetchUsage();
    }, [fetchUsage]);

    const canUseCloudProcessing = (feature: ProcessingFeature) => {
        if (authState.isLoggedIn) return true;
        if (feature === 'dictation' || feature === 'meetingTranscription') {
            return hasByokKey(settings, normalizeSttByokProvider(settings));
        }
        if (feature === 'summaries') {
            return hasByokKey(settings, settings.aiEngine?.summaryProvider || '');
        }
        return hasByokKey(settings, settings.aiEngine?.llmProvider || '');
    };

    const selectProcessingLocation = async (feature: ProcessingFeature, location: ProcessingLocation) => {
        if (location === 'cloud' && !canUseCloudProcessing(feature)) {
            setMessage('Sign in or configure a BYOK key to use cloud processing.');
            ipcRenderer.send('open-login-flow');
            setTransientProcessingModes((prev) => ({ ...prev, [feature]: 'cloud' }));
            setTimeout(() => {
                setTransientProcessingModes((prev) => {
                    const next = { ...prev };
                    delete next[feature];
                    return next;
                });
            }, 600);
            return;
        }

        setMessage('');
        await updateSettings({
            processingModes: {
                [feature]: location,
            },
        });
        if (location === 'cloud') {
            void fetchUsage();
        }
    };

    const selectedProcessingLocation = (feature: ProcessingFeature) => (
        transientProcessingModes[feature] ?? settings.processingModes[feature]
    );

    return {
        usage,
        message,
        canUseCloudProcessing,
        selectedProcessingLocation,
        selectProcessingLocation,
    };
}

export function ProcessingLocationRow({
    feature,
    title,
    description,
    quota,
    usage,
    selected,
    canUseCloudProcessing,
    onSelect,
}: {
    feature: ProcessingFeature;
    title: string;
    description: string;
    quota: 'stt' | 'ai';
    usage: UsageSummary | null;
    selected: ProcessingLocation;
    canUseCloudProcessing: boolean;
    onSelect: (feature: ProcessingFeature, location: ProcessingLocation) => Promise<void>;
}) {
    const quotaLabel = selected === 'cloud' ? usageLabel(usage, quota) : '';
    return (
        <SettingsRow
            title={title}
            description={(
                <>
                    {description}
                    {quotaLabel ? (
                        <>
                            <br />
                            {quotaLabel}
                        </>
                    ) : null}
                </>
            )}
        >
            <div className="flex flex-col items-end gap-2">
                <div className="inline-flex items-center rounded-lg border es-global-outline p-0.5">
                    <button
                        type="button"
                        className={`h-8 rounded-md px-3 inline-flex items-center gap-1.5 text-xs font-semibold transition-all duration-300 ease-in-out ${selected === 'local' ? 'text-white shadow-sm' : 'es-general-item-hover es-general-text'}`}
                        onClick={() => { void onSelect(feature, 'local'); }}
                        aria-label={feature === 'aiActions' ? 'Process AI actions locally' : `Process ${title.toLowerCase()} on this device`}
                        style={{ backgroundColor: selected === 'local' ? '#4CAE6B' : 'transparent' }}
                    >
                        <Lock size={13} />
                        <span>{feature === 'aiActions' ? 'Local' : 'This device'}</span>
                    </button>
                    <button
                        type="button"
                        className={`h-8 rounded-md px-3 inline-flex items-center gap-1.5 text-xs font-semibold transition-all duration-300 ease-in-out ${selected === 'cloud' ? 'text-white shadow-sm' : 'es-general-item-hover es-general-text'} ${canUseCloudProcessing ? '' : 'opacity-70'}`}
                        onClick={() => { void onSelect(feature, 'cloud'); }}
                        aria-label={feature === 'aiActions' ? 'Process AI actions using cloud models' : `Process ${title.toLowerCase()} in the cloud`}
                        title={canUseCloudProcessing ? (feature === 'aiActions' ? 'Cloud models' : 'Cloud processing') : 'Sign in or configure a BYOK key'}
                        style={{ backgroundColor: selected === 'cloud' ? '#4CAE6B' : 'transparent' }}
                    >
                        {quota === 'ai' ? <Sparkles size={13} /> : <Cloud size={13} className={selected === 'cloud' ? '' : 'text-sky-500'} />}
                        <span>{feature === 'aiActions' ? 'Cloud models' : 'Cloud'}</span>
                    </button>
                </div>
            </div>
        </SettingsRow>
    );
}

export function useStorageDefaultSettings({
    settings,
    authState,
    updateSettings,
}: {
    settings: UiSettings;
    authState: AuthState;
    updateSettings: (patch: Record<string, any>) => Promise<void>;
}) {
    const [message, setMessage] = useState('');
    const [transientCloudStorageActive, setTransientCloudStorageActive] = useState<boolean | null>(null);
    const isStorageLocalByDefault = settings.syncSettings?.strictPrivacyMode === true;
    const isCloudStorageDefaultActive = authState.isLoggedIn && !isStorageLocalByDefault;
    const isCloudStorageActive = transientCloudStorageActive !== null ? transientCloudStorageActive : isCloudStorageDefaultActive;

    const selectStorageDefault = async (targetStorage: 'local' | 'cloud') => {
        if (targetStorage === 'cloud' && !authState.isLoggedIn) {
            setMessage('Sign in to use cloud library storage.');
            ipcRenderer.send('open-login-flow');
            setTransientCloudStorageActive(true);
            setTimeout(() => {
                setTransientCloudStorageActive(null);
            }, 600);
            return;
        }

        setMessage('');
        await updateSettings({
            syncSettings: {
                ...(settings.syncSettings || {}),
                strictPrivacyMode: targetStorage === 'local',
            },
        });
    };

    return {
        message,
        isCloudStorageActive,
        selectStorageDefault,
    };
}

export function StorageDefaultRow({
    title,
    description,
    authState,
    isCloudStorageActive,
    onSelect,
}: {
    title: string;
    description: string;
    authState: AuthState;
    isCloudStorageActive: boolean;
    onSelect: (targetStorage: 'local' | 'cloud') => Promise<void>;
}) {
    return (
        <SettingsRow
            title={title}
            description={description}
        >
            <div className="inline-flex items-center rounded-lg border es-global-outline p-0.5">
                <button
                    type="button"
                    className={`h-8 rounded-md px-3 inline-flex items-center gap-1.5 text-xs font-semibold transition-all duration-300 ease-in-out ${!isCloudStorageActive ? 'text-white shadow-sm' : 'es-general-item-hover es-general-text'}`}
                    onClick={() => { void onSelect('local'); }}
                    aria-label="Save new content to device storage by default"
                    style={{ backgroundColor: !isCloudStorageActive ? '#4CAE6B' : 'transparent' }}
                >
                    <Lock size={13} />
                    <span>Device Storage</span>
                </button>
                <button
                    type="button"
                    className={`h-8 rounded-md px-3 inline-flex items-center gap-1.5 text-xs font-semibold transition-all duration-300 ease-in-out ${isCloudStorageActive ? 'text-white shadow-sm' : 'es-general-item-hover es-general-text'}`}
                    onClick={() => { void onSelect('cloud'); }}
                    aria-label={authState.isLoggedIn ? 'Save new content to cloud storage by default' : 'Sign in to use cloud storage'}
                    title={authState.isLoggedIn ? 'Cloud storage' : 'Sign in to use cloud storage'}
                    style={{ backgroundColor: isCloudStorageActive ? '#4CAE6B' : 'transparent' }}
                >
                    <Cloud size={13} className={!isCloudStorageActive ? 'text-sky-500' : ''} />
                    <span>Cloud Storage</span>
                </button>
            </div>
        </SettingsRow>
    );
}
