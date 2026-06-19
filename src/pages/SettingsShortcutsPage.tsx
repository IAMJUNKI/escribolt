import React from 'react';
import type { UiSettings } from '../types';
import { SettingsPage, SettingsSection } from '../components/SettingsLayout';
import {
    PasteLastTranscriptionRow,
    ShortcutRuntimeStatusSection,
    ShortcutSelectRow,
} from '../components/SettingsWorkflowControls';

export interface SettingsShortcutsPageProps {
    settings: UiSettings;
    shortcutsRuntime: any;
    isRuntimeLoading: boolean;
    updateSettings: (patch: Record<string, any>) => Promise<void>;
    refreshRuntime: () => Promise<void>;
}

export default function SettingsShortcutsPage({
    settings,
    shortcutsRuntime,
    isRuntimeLoading,
    updateSettings,
    refreshRuntime,
}: SettingsShortcutsPageProps) {
    return (
        <SettingsPage
            title="Shortcuts"
            description="Choose how voice actions are triggered globally. Changes apply immediately and persist across restarts."
        >
            <SettingsSection title="Voice Shortcuts">
                <ShortcutSelectRow
                    settings={settings}
                    shortcutsRuntime={shortcutsRuntime}
                    updateSettings={updateSettings}
                    title="Dictation hold to talk"
                    catalogKey="dictationHold"
                    settingKey="dictationHoldPreset"
                    runtimeKey="dictationHold"
                />
                <ShortcutSelectRow
                    settings={settings}
                    shortcutsRuntime={shortcutsRuntime}
                    updateSettings={updateSettings}
                    title="Hands-free dictation"
                    catalogKey="dictationHandsFree"
                    settingKey="dictationHandsFreePreset"
                    runtimeKey="dictationHandsFree"
                />
                <ShortcutSelectRow
                    settings={settings}
                    shortcutsRuntime={shortcutsRuntime}
                    updateSettings={updateSettings}
                    title="Quick note trigger"
                    catalogKey="quickNote"
                    settingKey="quickNotePreset"
                    runtimeKey="quickNote"
                />
                <ShortcutSelectRow
                    settings={settings}
                    shortcutsRuntime={shortcutsRuntime}
                    updateSettings={updateSettings}
                    title="Record mode trigger"
                    catalogKey="recordMode"
                    settingKey="recordModePreset"
                    runtimeKey="recordMode"
                />
                <PasteLastTranscriptionRow shortcutsRuntime={shortcutsRuntime} />
            </SettingsSection>

            <ShortcutRuntimeStatusSection
                shortcutsRuntime={shortcutsRuntime}
                isRuntimeLoading={isRuntimeLoading}
                refreshRuntime={refreshRuntime}
            />
        </SettingsPage>
    );
}
