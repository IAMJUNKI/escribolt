import React from 'react';
import type { AuthState, UiSettings } from '../types';
import { SettingsPage, SettingsSection, SettingsRow, SettingsSwitch } from '../components/SettingsLayout';
import { SummaryModelSettingsRows } from '../components/SettingsModelControls';
import {
    ProcessingLocationRow,
    useProcessingSettings,
} from '../components/SettingsWorkflowControls';
import Modal from '../components/Modal';
import {
    RECORDING_SUMMARY_LANGUAGE_OPTIONS,
    normalizeRecordingSummaryLanguageCode,
} from '../utils/summaryLanguages';

export interface SettingsRecordingsPageProps {
    settings: UiSettings;
    authState: AuthState;
    proModelOptions: Array<{ id: string; label: string; helperText?: string }>;
    updateSettings: (patch: Record<string, any>) => Promise<void>;
}

export default function SettingsRecordingsPage({
    settings,
    authState,
    proModelOptions,
    updateSettings,
}: SettingsRecordingsPageProps) {
    const processing = useProcessingSettings({ settings, authState, updateSettings });
    const recordingCaptureMode = settings.recordingCaptureMode || 'system-only';
    const recordingSummaryLanguage = normalizeRecordingSummaryLanguageCode(settings.recordingSummaryLanguage);
    const selectClass = 'h-9 min-w-[260px] rounded-md border es-global-outline bg-transparent px-3 text-sm es-general-text';
    const [meetingPromptModalOpen, setMeetingPromptModalOpen] = React.useState(false);
    const [meetingPromptPermissionMessage, setMeetingPromptPermissionMessage] = React.useState('');
    const [meetingPromptRequesting, setMeetingPromptRequesting] = React.useState(false);

    const disableMeetingPrompt = React.useCallback(async () => {
        setMeetingPromptModalOpen(false);
        setMeetingPromptPermissionMessage('');
        await updateSettings({
            meetingPromptEnabled: false,
            meetingPromptConsentGranted: false,
        });
    }, [updateSettings]);

    const requestMeetingPromptPermissions = React.useCallback(async () => {
        setMeetingPromptRequesting(true);
        setMeetingPromptPermissionMessage('');
        try {
            const ipcRenderer = (window as any).require?.('electron')?.ipcRenderer;
            const result = ipcRenderer
                ? await ipcRenderer.invoke('meeting-prompt:request-permissions')
                : { canEnable: true, status: 'success' };

            if (result && result.canEnable === false) {
                setMeetingPromptPermissionMessage(
                    result.message || 'macOS did not grant the permissions needed for meeting detection.',
                );
                return;
            }

            await updateSettings({
                meetingPromptConsentGranted: true,
                meetingPromptEnabled: true,
            });
            setMeetingPromptModalOpen(false);
        } catch (error) {
            setMeetingPromptPermissionMessage(
                error instanceof Error ? error.message : 'Unable to request meeting prompt permissions.',
            );
        } finally {
            setMeetingPromptRequesting(false);
        }
    }, [updateSettings]);

    const openMeetingPromptPermissionSettings = React.useCallback(async () => {
        try {
            const ipcRenderer = (window as any).require?.('electron')?.ipcRenderer;
            if (ipcRenderer) {
                await ipcRenderer.invoke('meeting-prompt:open-permission-settings');
            }
        } catch (error) {
            setMeetingPromptPermissionMessage(
                error instanceof Error ? error.message : 'Unable to open macOS Privacy & Security settings.',
            );
        }
    }, []);

    const handleMeetingPromptToggle = React.useCallback(async (checked: boolean) => {
        if (!checked) {
            await disableMeetingPrompt();
            return;
        }
        setMeetingPromptPermissionMessage('');
        setMeetingPromptModalOpen(true);
    }, [disableMeetingPrompt]);

    return (
        <>
            <div data-tour-id="settings-recordings">
                <SettingsPage
                    title="Recordings"
                    description="Control audio capture, transcription processing, and summaries."
                >
                <SettingsSection title="Audio Capture">
                    <SettingsRow title="Show meeting recording prompt" description="Show a small prompt when Escribolt detects an active Zoom, Google Meet, or Microsoft Teams meeting in a browser.">
                        <SettingsSwitch
                            checked={settings.meetingPromptEnabled === true}
                            onChange={(checked) => { void handleMeetingPromptToggle(checked); }}
                            ariaLabel="Show meeting recording prompt"
                        />
                    </SettingsRow>
                    <SettingsRow title="Capture mode" description="Select whether recordings include only system audio or all available audio.">
                        <div className="inline-flex rounded-md border es-global-outline p-0.5">
                            {([
                                {
                                    key: 'system-only',
                                    title: 'System only',
                                },
                                {
                                    key: 'all-audio',
                                    title: 'All audio',
                                },
                            ] as const).map((option) => {
                                const selected = recordingCaptureMode === option.key;
                                return (
                                    <button
                                        key={`recording-capture-option-${option.key}`}
                                        type="button"
                                        className={`h-8 min-w-[112px] rounded px-3 text-sm font-medium transition-colors ${selected ? 'es-general-selected-item' : 'es-general-item-hover es-general-text'}`}
                                        onClick={() => void updateSettings({ recordingCaptureMode: option.key })}
                                    >
                                        {option.title}
                                    </button>
                                );
                            })}
                        </div>
                    </SettingsRow>
                </SettingsSection>

                <SettingsSection title="Processing">
                    <ProcessingLocationRow
                        feature="meetingTranscription"
                        title="Meeting transcription"
                        description="Recording audio stays on this computer while capture is active. This applies when recording stops."
                        quota="stt"
                        usage={processing.usage}
                        selected={processing.selectedProcessingLocation('meetingTranscription')}
                        canUseCloudProcessing={processing.canUseCloudProcessing('meetingTranscription')}
                        onSelect={processing.selectProcessingLocation}
                    />
                    {processing.message ? (
                        <div className="py-2 text-xs es-general-secondary-text">{processing.message}</div>
                    ) : null}
                </SettingsSection>

                <SettingsSection title="Summaries">
                    <ProcessingLocationRow
                        feature="summaries"
                        title="Summaries"
                        description="Choose where recording summaries are generated."
                        quota="ai"
                        usage={processing.usage}
                        selected={processing.selectedProcessingLocation('summaries')}
                        canUseCloudProcessing={processing.canUseCloudProcessing('summaries')}
                        onSelect={processing.selectProcessingLocation}
                    />
                    {processing.message ? (
                        <div className="py-2 text-xs es-general-secondary-text">{processing.message}</div>
                    ) : null}
                    <SettingsRow title="Summary language" description="Always write recording summaries in this language.">
                        <select
                            className={selectClass}
                            value={recordingSummaryLanguage}
                            onChange={(event) => {
                                void updateSettings({ recordingSummaryLanguage: event.target.value });
                            }}
                        >
                            {RECORDING_SUMMARY_LANGUAGE_OPTIONS.map((option) => (
                                <option key={`recording-summary-language-${option.code}`} value={option.code}>
                                    {option.label}
                                </option>
                            ))}
                        </select>
                    </SettingsRow>
                    <SummaryModelSettingsRows
                        settings={settings}
                        proModelOptions={proModelOptions}
                        updateSettings={updateSettings}
                    />
                </SettingsSection>
                </SettingsPage>
            </div>
            <Modal
                open={meetingPromptModalOpen}
                onClose={() => {
                    if (!meetingPromptRequesting) {
                        setMeetingPromptModalOpen(false);
                        setMeetingPromptPermissionMessage('');
                    }
                }}
                title="Enable meeting prompt"
            >
                <div className="space-y-4">
                    <p className="text-sm leading-relaxed es-general-secondary-text">
                        Escribolt can show a small popup when you enter a browser meeting in Zoom, Microsoft Teams, or Google Meet, so you do not forget to record when you need to.
                    </p>
                    <p className="text-sm leading-relaxed es-general-secondary-text">
                        Recording never starts automatically. The popup only offers Start recording and Dismiss, and this setting can be disabled at any time.
                    </p>
                    <p className="text-sm leading-relaxed es-general-secondary-text">
                        macOS needs permission for Escribolt to inspect the active window and browser tab URL. This is only used to recognize supported meeting pages.
                    </p>
                    {meetingPromptPermissionMessage ? (
                        <div className="rounded-md border border-red-500/30 bg-red-500/10 px-3 py-2 text-xs leading-relaxed text-red-200">
                            <div>{meetingPromptPermissionMessage}</div>
                            <button
                                type="button"
                                className="mt-2 h-8 rounded-md bg-red-500/20 px-2.5 text-xs font-semibold text-red-100 transition-colors hover:bg-red-500/30"
                                onClick={() => { void openMeetingPromptPermissionSettings(); }}
                            >
                                Open Privacy Settings
                            </button>
                        </div>
                    ) : null}
                    <div className="flex justify-end gap-2 pt-1">
                        <button
                            type="button"
                            className="h-9 rounded-md px-3 text-sm font-semibold transition-colors hover:bg-stone-500/10 es-general-text"
                            disabled={meetingPromptRequesting}
                            onClick={() => {
                                setMeetingPromptModalOpen(false);
                                setMeetingPromptPermissionMessage('');
                            }}
                        >
                            Close
                        </button>
                        <button
                            type="button"
                            className="h-9 rounded-md bg-[#4CAE6B] px-3 text-sm font-semibold text-white transition-all hover:opacity-90 disabled:opacity-60"
                            disabled={meetingPromptRequesting}
                            onClick={() => { void requestMeetingPromptPermissions(); }}
                        >
                            {meetingPromptRequesting ? 'Requesting...' : 'Continue'}
                        </button>
                    </div>
                </div>
            </Modal>
        </>
    );
}
