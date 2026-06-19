import React from 'react';
import type { AuthState, UiSettings } from '../types';
import { SettingsPage, SettingsSection } from '../components/SettingsLayout';
import { AgentModelSettingsRows } from '../components/SettingsModelControls';
import {
    ProcessingLocationRow,
    useProcessingSettings,
} from '../components/SettingsWorkflowControls';

export interface SettingsChatsPageProps {
    settings: UiSettings;
    authState: AuthState;
    proModelOptions: Array<{ id: string; label: string; helperText?: string }>;
    updateSettings: (patch: Record<string, any>) => Promise<void>;
}

export default function SettingsChatsPage({
    settings,
    authState,
    proModelOptions,
    updateSettings,
}: SettingsChatsPageProps) {
    const processing = useProcessingSettings({ settings, authState, updateSettings });

    return (
        <div data-tour-id="settings-chats">
            <SettingsPage
                title="Chats"
                description="Control how Ask and chat responses run, and which model they use."
            >
                <SettingsSection title="Processing">
                    <ProcessingLocationRow
                        feature="aiActions"
                        title="AI actions"
                        description="Choose where Ask and transcript-based assistant responses run."
                        quota="ai"
                        usage={processing.usage}
                        selected={processing.selectedProcessingLocation('aiActions')}
                        canUseCloudProcessing={processing.canUseCloudProcessing('aiActions')}
                        onSelect={processing.selectProcessingLocation}
                    />
                    {processing.message ? (
                        <div className="py-2 text-xs es-general-secondary-text">{processing.message}</div>
                    ) : null}
                </SettingsSection>

                <SettingsSection title="Agent Model">
                    <AgentModelSettingsRows
                        settings={settings}
                        proModelOptions={proModelOptions}
                        updateSettings={updateSettings}
                    />
                </SettingsSection>
            </SettingsPage>
        </div>
    );
}
