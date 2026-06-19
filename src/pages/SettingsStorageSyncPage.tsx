import React from 'react';
import type { AuthState, UiSettings } from '../types';
import { SettingsPage, SettingsSection } from '../components/SettingsLayout';
import {
    StorageDefaultRow,
    useStorageDefaultSettings,
} from '../components/SettingsWorkflowControls';

export interface SettingsStorageSyncPageProps {
    settings: UiSettings;
    authState: AuthState;
    updateSettings: (patch: Record<string, any>) => Promise<void>;
}

export default function SettingsStorageSyncPage({
    settings,
    authState,
    updateSettings,
}: SettingsStorageSyncPageProps) {
    const storage = useStorageDefaultSettings({ settings, authState, updateSettings });

    return (
        <div data-tour-id="settings-storage-sync">
            <SettingsPage
                title="Storage & Sync"
                description="Control the shared storage default for newly created library items."
            >
                <SettingsSection title="Default Storage">
                    <StorageDefaultRow
                        title="New library items"
                        description={authState.isLoggedIn
                            ? 'This shared default controls whether new notes, quick notes, recordings, and chats start synced or private on this device.'
                            : 'Cloud storage requires sign in. Existing local content stays on this device.'}
                        authState={authState}
                        isCloudStorageActive={storage.isCloudStorageActive}
                        onSelect={storage.selectStorageDefault}
                    />
                    {storage.message ? (
                        <div className="py-2 text-xs es-general-secondary-text">{storage.message}</div>
                    ) : null}
                </SettingsSection>
            </SettingsPage>
        </div>
    );
}
