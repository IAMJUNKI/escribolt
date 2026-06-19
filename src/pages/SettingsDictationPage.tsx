import React from 'react';
import { AlertCircle, Check, CheckCircle2, Languages, Loader2, Plus, RefreshCw } from 'lucide-react';
import type { AuthState, SttStreamingProfile, UiSettings } from '../types';
import { SettingsPage, SettingsSection, SettingsRow } from '../components/SettingsLayout';
import {
    ProcessingLocationRow,
    useProcessingSettings,
} from '../components/SettingsWorkflowControls';
import Modal from '../components/Modal';
import {
    NOVA3_MONOLINGUAL_LANGUAGE_OPTIONS,
    findNova3MonolingualLanguageLabel,
} from '../utils/nova3Languages';

export interface SettingsDictationPageProps {
    settings: UiSettings;
    authState: AuthState;
    updateSettings: (patch: Record<string, any>) => Promise<void>;
}

type LocalSttRuntimeStatus = {
    status: string;
    available: boolean;
    warming: boolean;
    message: string;
    model?: string;
    stage?: string;
    durationMs?: number | null;
};

function normalizeKeytermsList(rawTerms: string[]): string[] {
    const source = Array.isArray(rawTerms) ? rawTerms : [];
    const deduped: string[] = [];
    const seen = new Set<string>();
    source.forEach((entry) => {
        const clean = String(entry || '').trim().replace(/\s+/g, ' ');
        if (!clean) return;
        const key = clean.toLowerCase();
        if (seen.has(key)) return;
        seen.add(key);
        deduped.push(clean);
    });
    return deduped.slice(0, 100);
}

function normalizeLocalSttStatus(raw: any): LocalSttRuntimeStatus {
    const status = typeof raw?.status === 'string' ? raw.status : 'unknown';
    const warming = raw?.warming === true || status === 'warming';
    const available = raw?.available === true || status === 'ready';
    const message = typeof raw?.message === 'string' && raw.message.trim()
        ? raw.message.trim()
        : available
            ? 'Local speech is ready.'
            : warming
                ? 'Local speech is preparing.'
                : 'Local speech status is unavailable.';

    return {
        status,
        available,
        warming,
        message,
        model: typeof raw?.model === 'string' ? raw.model : undefined,
        stage: typeof raw?.stage === 'string' ? raw.stage : undefined,
        durationMs: Number.isFinite(Number(raw?.durationMs)) ? Number(raw.durationMs) : null,
    };
}

export default function SettingsDictationPage({
    settings,
    authState,
    updateSettings,
}: SettingsDictationPageProps) {
    const processing = useProcessingSettings({ settings, authState, updateSettings });
    const isLocalMode = settings.mode === 'local';
    const isDeepgramStt = settings.aiEngine.sttProvider === 'deepgram';
    const canUseStreaming = !isLocalMode && isDeepgramStt;
    const areStreamingControlsDisabled = !canUseStreaming;
    const selectedStreamingProfile: SttStreamingProfile = settings.aiEngine.sttStreamingProfile === 'nova3-monolingual'
        ? 'nova3-monolingual'
        : 'nova3-multilingual';
    const selectedNova3Language = settings.aiEngine.sttNova3Language || 'en';
    const selectedNova3LanguageLabel = findNova3MonolingualLanguageLabel(selectedNova3Language);
    const keyterms = Array.isArray(settings.aiEngine.sttKeyterms)
        ? settings.aiEngine.sttKeyterms
        : Array.isArray(settings.aiEngine.sttFluxKeyterms)
            ? settings.aiEngine.sttFluxKeyterms
            : [];
    const [isLanguagePickerOpen, setIsLanguagePickerOpen] = React.useState(false);
    const [isKeyTermsDrawerOpen, setIsKeyTermsDrawerOpen] = React.useState(false);
    const [isKeyTermsComposerOpen, setIsKeyTermsComposerOpen] = React.useState(false);
    const [newKeyTermDraft, setNewKeyTermDraft] = React.useState('');
    const [localSttStatus, setLocalSttStatus] = React.useState<LocalSttRuntimeStatus | null>(null);
    const [isLocalSttRefreshing, setIsLocalSttRefreshing] = React.useState(false);
    const inputClass = 'h-9 w-full rounded-md border es-global-outline bg-transparent px-3 text-sm es-general-text placeholder:text-stone-500';

    const refreshLocalSttStatus = React.useCallback(async (warm = false) => {
        const ipcRenderer = (window as any).require?.('electron')?.ipcRenderer;
        if (!ipcRenderer) {
            const fallback = normalizeLocalSttStatus({
                status: 'error',
                message: 'Local speech status is unavailable.',
            });
            setLocalSttStatus(fallback);
            return fallback;
        }

        setIsLocalSttRefreshing(true);
        try {
            const result = await ipcRenderer.invoke(warm ? 'runtime:warm-local-stt' : 'runtime:local-stt-status');
            const nextStatus = normalizeLocalSttStatus(result?.localStt);
            setLocalSttStatus(nextStatus);
            return nextStatus;
        } catch (error: any) {
            const nextStatus = normalizeLocalSttStatus({
                status: 'error',
                message: error?.message || 'Local speech status is unavailable.',
            });
            setLocalSttStatus(nextStatus);
            return nextStatus;
        } finally {
            setIsLocalSttRefreshing(false);
        }
    }, []);

    const setStreamingProfile = (nextProfile: SttStreamingProfile) => {
        void updateSettings({
            aiEngine: {
                sttStreamingProfile: nextProfile,
            },
        });
    };

    const selectNova3Language = (code: string) => {
        void updateSettings({
            aiEngine: {
                sttNova3Language: code,
            },
        });
        setIsLanguagePickerOpen(false);
    };

    React.useEffect(() => {
        if (canUseStreaming) return;
        setIsLanguagePickerOpen(false);
        setIsKeyTermsDrawerOpen(false);
        setIsKeyTermsComposerOpen(false);
        setNewKeyTermDraft('');
    }, [canUseStreaming]);

    React.useEffect(() => {
        if (!isLocalMode) {
            setLocalSttStatus(null);
            return undefined;
        }

        let cancelled = false;
        let pollTimer: number | undefined;

        const poll = async (warm = false) => {
            const status = await refreshLocalSttStatus(warm);
            if (!cancelled && status.warming) {
                pollTimer = window.setTimeout(() => {
                    void poll(false);
                }, 5000);
            } else if (!cancelled) {
                if (pollTimer) {
                    window.clearTimeout(pollTimer);
                    pollTimer = undefined;
                }
            }
        };

        void poll(false);

        return () => {
            cancelled = true;
            if (pollTimer) {
                window.clearTimeout(pollTimer);
            }
        };
    }, [isLocalMode, refreshLocalSttStatus]);

    const updateKeyterms = (nextTerms: string[]) => {
        const normalized = normalizeKeytermsList(nextTerms);
        void updateSettings({
            aiEngine: {
                sttKeyterms: normalized,
            },
        });
    };

    const removeKeyterm = (term: string) => {
        updateKeyterms(keyterms.filter((entry) => entry.toLowerCase() !== term.toLowerCase()));
    };

    const addKeyterm = () => {
        const cleanTerm = String(newKeyTermDraft || '').trim().replace(/\s+/g, ' ');
        if (!cleanTerm) return;
        updateKeyterms([...keyterms, cleanTerm]);
        setNewKeyTermDraft('');
    };

    const localStatusTone = localSttStatus?.available
        ? 'text-emerald-700'
        : localSttStatus?.warming
            ? 'text-amber-700'
            : localSttStatus?.status === 'error'
                ? 'text-red-700'
                : 'es-general-secondary-text';
    const LocalStatusIcon = localSttStatus?.available
        ? CheckCircle2
        : localSttStatus?.warming || isLocalSttRefreshing
            ? Loader2
            : localSttStatus?.status === 'error'
                ? AlertCircle
                : RefreshCw;
    const localStatusLabel = localSttStatus?.available
        ? 'Ready'
        : localSttStatus?.warming
            ? 'Preparing'
            : localSttStatus?.status === 'error'
                ? 'Needs Attention'
                : 'Checking';
    const localStatusDescription = localSttStatus?.message || 'Checking local speech runtime.';
    const localStatusMeta = localSttStatus?.stage && localSttStatus.warming
        ? `Stage: ${localSttStatus.stage}`
        : localSttStatus?.durationMs && localSttStatus.available
            ? `Ready in ${(localSttStatus.durationMs / 1000).toFixed(1)}s`
            : '';

    return (
        <div data-tour-id="settings-dictation">
            <SettingsPage
                title="Dictation"
                description="Control transcription routing and streaming recognition behavior."
            >
            <SettingsSection title="Processing">
                <ProcessingLocationRow
                    feature="dictation"
                    title="Live dictation"
                    description="Choose where speech from dictation shortcuts is transcribed."
                    quota="stt"
                    usage={processing.usage}
                    selected={processing.selectedProcessingLocation('dictation')}
                    canUseCloudProcessing={processing.canUseCloudProcessing('dictation')}
                    onSelect={processing.selectProcessingLocation}
                />
                {processing.message ? (
                    <div className="py-2 text-xs es-general-secondary-text">{processing.message}</div>
                ) : null}
                {isLocalMode ? (
                    <SettingsRow
                        title="Local speech"
                        description={localStatusMeta ? `${localStatusDescription} ${localStatusMeta}.` : localStatusDescription}
                    >
                        <div className="flex min-w-[260px] items-center justify-end gap-3">
                            <div className={`inline-flex items-center gap-2 text-sm font-medium ${localStatusTone}`}>
                                <LocalStatusIcon
                                    size={16}
                                    className={localSttStatus?.warming || isLocalSttRefreshing ? 'animate-spin' : undefined}
                                />
                                <span>{localStatusLabel}</span>
                            </div>
                            {!localSttStatus?.available ? (
                                <button
                                    type="button"
                                    className="h-8 rounded-md border es-global-outline px-3 inline-flex items-center gap-1.5 text-xs font-medium es-general-item-hover es-general-text disabled:opacity-60 disabled:cursor-not-allowed"
                                    onClick={() => {
                                        void refreshLocalSttStatus(true);
                                    }}
                                    disabled={isLocalSttRefreshing || localSttStatus?.warming}
                                >
                                    <RefreshCw size={13} />
                                    <span>{localSttStatus?.status === 'error' ? 'Retry' : 'Prepare'}</span>
                                </button>
                            ) : null}
                        </div>
                    </SettingsRow>
                ) : null}
            </SettingsSection>

            {canUseStreaming ? (
                <SettingsSection title="Recognition">
                    <SettingsRow
                        title="Streaming profile"
                        description="Choose multilingual if you constantly switch languages when dictating, choose monolingual for a bit more accuracy."
                        align="start"
                    >
                        <div
                            className={`min-w-[320px] space-y-3 text-right ${areStreamingControlsDisabled ? 'opacity-60' : ''}`}
                            title={areStreamingControlsDisabled ? 'Only available for Deepgram cloud dictation' : undefined}
                        >
                            <div className="flex justify-end">
                                <div className="inline-flex items-center rounded-lg border es-global-outline p-0.5">
                                    <button
                                        type="button"
                                        className={`h-8 rounded-md px-3 inline-flex items-center gap-1.5 text-xs font-semibold transition-colors ${
                                            selectedStreamingProfile === 'nova3-multilingual' && canUseStreaming
                                                ? 'text-white shadow-sm'
                                                : 'es-general-item-hover es-general-text'
                                        }`}
                                        onClick={() => setStreamingProfile('nova3-multilingual')}
                                        disabled={areStreamingControlsDisabled}
                                        aria-label="Use Nova-3 multilingual streaming"
                                        style={selectedStreamingProfile === 'nova3-multilingual' && canUseStreaming ? { backgroundColor: '#4CAE6B' } : undefined}
                                    >
                                        <Languages size={13} />
                                        <span>Multilingual</span>
                                    </button>
                                    <button
                                        type="button"
                                        className={`h-8 rounded-md px-3 inline-flex items-center gap-1.5 text-xs font-semibold transition-colors ${
                                            selectedStreamingProfile === 'nova3-monolingual' && canUseStreaming
                                                ? 'text-white shadow-sm'
                                                : 'es-general-item-hover es-general-text'
                                        }`}
                                        onClick={() => setStreamingProfile('nova3-monolingual')}
                                        disabled={areStreamingControlsDisabled}
                                        aria-label="Use Nova-3 monolingual streaming"
                                        style={selectedStreamingProfile === 'nova3-monolingual' && canUseStreaming ? { backgroundColor: '#4CAE6B' } : undefined}
                                    >
                                        <Check size={13} />
                                        <span>Monolingual</span>
                                    </button>
                                </div>
                            </div>

                            {selectedStreamingProfile === 'nova3-monolingual' ? (
                                <div className="flex flex-wrap items-center justify-end gap-2">
                                    <div className="text-sm es-general-text">
                                        {selectedNova3LanguageLabel} <span className="es-general-secondary-text">({selectedNova3Language})</span>
                                    </div>
                                    <button
                                        type="button"
                                        className="h-9 rounded-md border es-global-outline px-3 text-sm font-medium es-general-item-hover es-general-text disabled:opacity-60 disabled:cursor-not-allowed"
                                        onClick={() => setIsLanguagePickerOpen(true)}
                                        disabled={areStreamingControlsDisabled}
                                    >
                                        Choose Language
                                    </button>
                                </div>
                            ) : null}
                        </div>
                    </SettingsRow>

                    <SettingsRow
                        title="Key Terms"
                        description="Improve recognition for product names, acronyms, proper nouns, and domain vocabulary. Escribolt is included automatically."
                        align="start"
                    >
                        <div
                            className={`min-w-[320px] space-y-3 ${areStreamingControlsDisabled ? 'opacity-60' : ''}`}
                            title={areStreamingControlsDisabled ? 'Only available for Deepgram cloud dictation' : undefined}
                        >
                            <div className="flex flex-wrap items-center justify-end gap-2">
                                <button
                                    type="button"
                                    className="h-8 rounded-md border es-global-outline px-3 inline-flex items-center gap-1.5 text-xs font-medium es-general-item-hover es-general-text disabled:opacity-60 disabled:cursor-not-allowed"
                                    onClick={() => setIsKeyTermsComposerOpen((current) => !current)}
                                    disabled={areStreamingControlsDisabled}
                                >
                                    <Plus size={13} />
                                    <span>{isKeyTermsComposerOpen ? 'Hide Add' : 'Add Key Term'}</span>
                                </button>
                                <button
                                    type="button"
                                    className="h-8 rounded-md border es-global-outline px-3 text-xs font-medium es-general-item-hover es-general-text disabled:opacity-60 disabled:cursor-not-allowed"
                                    onClick={() => setIsKeyTermsDrawerOpen((current) => !current)}
                                    disabled={areStreamingControlsDisabled}
                                >
                                    {isKeyTermsDrawerOpen ? 'Hide Terms' : `Show Terms (${keyterms.length})`}
                                </button>
                            </div>

                            {isKeyTermsComposerOpen ? (
                                <div className="rounded-lg border es-global-outline p-3">
                                    <div className="flex flex-col gap-2 sm:flex-row">
                                        <input
                                            className={`${inputClass} sm:min-w-[220px]`}
                                            placeholder="Add a key term"
                                            value={newKeyTermDraft}
                                            onChange={(event) => setNewKeyTermDraft(event.target.value)}
                                            onKeyDown={(event) => {
                                                if (event.key === 'Enter') {
                                                    event.preventDefault();
                                                    addKeyterm();
                                                }
                                            }}
                                            disabled={areStreamingControlsDisabled}
                                        />
                                        <button
                                            type="button"
                                            className="h-9 rounded-md border es-global-outline px-3 text-sm font-medium es-general-item-hover es-general-text disabled:opacity-60 disabled:cursor-not-allowed"
                                            onClick={addKeyterm}
                                            disabled={areStreamingControlsDisabled || !String(newKeyTermDraft || '').trim()}
                                        >
                                            Add
                                        </button>
                                    </div>
                                </div>
                            ) : null}

                            {isKeyTermsDrawerOpen ? (
                                <div className="rounded-lg border es-global-outline p-3">
                                    {keyterms.length ? (
                                        <div className="flex flex-wrap gap-2">
                                            {keyterms.map((term) => (
                                                <span key={`stt-keyterm-${term}`} className="inline-flex items-center gap-2 rounded-full border es-global-outline px-2 py-1 text-xs es-general-text">
                                                    <span>{term}</span>
                                                    <button
                                                        type="button"
                                                        className="text-xs font-semibold es-general-secondary-text opacity-80 transition-opacity hover:opacity-100 disabled:opacity-60 disabled:cursor-not-allowed"
                                                        onClick={() => removeKeyterm(term)}
                                                        aria-label={`Remove key term ${term}`}
                                                        disabled={areStreamingControlsDisabled}
                                                    >
                                                        Remove
                                                    </button>
                                                </span>
                                            ))}
                                        </div>
                                    ) : (
                                        <div className="text-xs es-general-secondary-text">No key terms yet.</div>
                                    )}
                                </div>
                            ) : null}
                        </div>
                    </SettingsRow>
                </SettingsSection>
            ) : null}

            <Modal
                open={isLanguagePickerOpen && canUseStreaming}
                onClose={() => setIsLanguagePickerOpen(false)}
                title="Nova-3 Language"
                className="max-w-3xl"
            >
                <div className="max-h-[520px] overflow-auto pr-1">
                    <div className="grid grid-cols-1 gap-2 sm:grid-cols-2 lg:grid-cols-3">
                        {NOVA3_MONOLINGUAL_LANGUAGE_OPTIONS.map((entry) => {
                            const isSelected = selectedNova3Language === entry.code;
                            return (
                                <button
                                    key={`modal-nova3-language-${entry.code}`}
                                    type="button"
                                    className={`min-h-[54px] rounded-lg border px-3 py-2 text-left text-sm transition-colors ${
                                        isSelected
                                            ? 'border-emerald-600 bg-emerald-600 text-white'
                                            : 'es-global-outline es-general-background es-general-item-hover es-general-text'
                                    }`}
                                    onClick={() => selectNova3Language(entry.code)}
                                >
                                    <div className="font-medium">{entry.label}</div>
                                    <div className={`text-xs ${isSelected ? 'text-white/80' : 'es-general-secondary-text'}`}>{entry.code}</div>
                                </button>
                            );
                        })}
                    </div>
                </div>
                <div className="mt-5 flex items-center justify-end gap-2">
                    <button
                        type="button"
                        className="h-9 rounded-md border es-global-outline px-3 text-sm font-medium es-general-item-hover es-general-text"
                        onClick={() => setIsLanguagePickerOpen(false)}
                    >
                        Done
                    </button>
                </div>
            </Modal>
            </SettingsPage>
        </div>
    );
}
