import React from 'react';
import type { UiSettings } from '../types';
import { SettingsPage, SettingsSection, SettingsRow, SettingsSwitch } from '../components/SettingsLayout';

export interface SettingsGeneralPageProps {
    settings: UiSettings;
    updateSettings: (patch: Record<string, any>) => Promise<void>;
    onReplayProductTour: () => void;
}

export default function SettingsGeneralPage({ settings, updateSettings, onReplayProductTour }: SettingsGeneralPageProps) {
    return (
        <SettingsPage
            title="General"
            description="Choose the basic appearance and startup behavior for this device."
        >
            <SettingsSection title="Appearance">
                <SettingsRow title="Theme" description="Choose how Escribolt should look while you work.">
                    <div className="inline-flex rounded-md border es-global-outline p-0.5">
                        {([
                            { key: 'black', label: 'Dark' },
                            { key: 'white', label: 'Light' },
                        ] as const).map((option) => {
                            const selected = settings.theme === option.key;
                            return (
                                <button
                                    key={`theme-option-${option.key}`}
                                    type="button"
                                    className={`h-8 min-w-[72px] rounded px-3 text-sm font-medium transition-colors ${selected ? 'es-general-selected-item' : 'es-general-item-hover es-general-text'}`}
                                    onClick={() => updateSettings({ theme: option.key })}
                                >
                                    {option.label}
                                </button>
                            );
                        })}
                    </div>
                </SettingsRow>
            </SettingsSection>

            <SettingsSection title="Startup">
                <SettingsRow title="Launch at login" description="Open Escribolt automatically when you sign in to this computer.">
                    <SettingsSwitch
                        checked={settings.launchAtLogin}
                        onChange={(checked) => updateSettings({ launchAtLogin: checked })}
                        ariaLabel="Launch Escribolt at login"
                    />
                </SettingsRow>
            </SettingsSection>

            <SettingsSection title="Guidance">
                <SettingsRow title="Product tour" description="Replay the guided walkthrough for the core Escribolt workflow.">
                    <button
                        type="button"
                        className="h-9 rounded-lg border es-global-outline px-3 text-sm font-semibold es-general-text es-general-item-hover transition-colors"
                        onClick={onReplayProductTour}
                    >
                        Replay product tour
                    </button>
                </SettingsRow>
            </SettingsSection>
        </SettingsPage>
    );
}
