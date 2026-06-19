import React from 'react';
import type { StickyNoteColorId, StickyNoteDefaultPlacement, UiSettings } from '../types';
import { SettingsPage, SettingsSection, SettingsRow, SettingsSwitch } from '../components/SettingsLayout';

export interface SettingsQuickNotesPageProps {
    settings: UiSettings;
    updateSettings: (patch: Record<string, any>) => Promise<void>;
}

const STICKY_PLACEMENT_OPTIONS: Array<{ key: StickyNoteDefaultPlacement; label: string }> = [
    { key: 'top-left', label: 'Top left' },
    { key: 'top-right', label: 'Top right' },
    { key: 'bottom-left', label: 'Bottom left' },
    { key: 'bottom-right', label: 'Bottom right' },
];

const STICKY_COLOR_OPTIONS: Array<{ key: StickyNoteColorId; label: string; swatch: string; border: string }> = [
    { key: 'yellow', label: 'Yellow', swatch: '#fef08a', border: '#eab308' },
    { key: 'blue', label: 'Blue', swatch: '#bfdbfe', border: '#3b82f6' },
    { key: 'green', label: 'Green', swatch: '#bbf7d0', border: '#22c55e' },
    { key: 'pink', label: 'Pink', swatch: '#fbcfe8', border: '#ec4899' },
];

export default function SettingsQuickNotesPage({
    settings,
    updateSettings,
}: SettingsQuickNotesPageProps) {
    return (
        <div data-tour-id="quick-notes-settings">
            <SettingsPage
                title="Quick Notes"
                description="Control sticky popups and default behavior for new quick notes."
            >
                <SettingsSection title="Sticky Notes">
                    <SettingsRow
                        title="Show quick note popup"
                        description="When enabled, quick notes appear as floating popups until you close them. When disabled, you'll get a macOS notification instead."
                    >
                        <SettingsSwitch
                            checked={settings.quickNotePopupEnabled !== false}
                            onChange={(checked) => updateSettings({ quickNotePopupEnabled: checked })}
                            ariaLabel="Show quick note popup"
                        />
                    </SettingsRow>
                    <SettingsRow
                        title="Default popup position"
                        description="Used for the first sticky note, or after the app restarts before a sticky note has been moved."
                        align="start"
                    >
                        <div className="grid grid-cols-2 gap-1 rounded-md border es-global-outline p-0.5">
                            {STICKY_PLACEMENT_OPTIONS.map((option) => {
                                const selected = settings.stickyNoteDefaultPlacement === option.key;
                                return (
                                    <button
                                        key={`sticky-placement-${option.key}`}
                                        type="button"
                                        className={`h-8 min-w-[112px] rounded px-3 text-sm font-medium transition-colors ${selected ? 'es-general-selected-item' : 'es-general-item-hover es-general-text'}`}
                                        onClick={() => updateSettings({ stickyNoteDefaultPlacement: option.key })}
                                    >
                                        {option.label}
                                    </button>
                                );
                            })}
                        </div>
                    </SettingsRow>
                    <SettingsRow
                        title="Default sticky color"
                        description="Used for new sticky notes. Existing notes keep their saved color."
                        align="start"
                    >
                        <div className="grid grid-cols-2 gap-1 rounded-md border es-global-outline p-0.5">
                            {STICKY_COLOR_OPTIONS.map((option) => {
                                const selected = settings.stickyNoteDefaultColorId === option.key;
                                return (
                                    <button
                                        key={`sticky-color-${option.key}`}
                                        type="button"
                                        className={`h-8 min-w-[112px] rounded px-2.5 text-sm font-medium transition-colors inline-flex items-center justify-start gap-2 ${selected ? 'es-general-selected-item' : 'es-general-item-hover es-general-text'}`}
                                        onClick={() => updateSettings({ stickyNoteDefaultColorId: option.key })}
                                    >
                                        <span
                                            className="h-4 w-4 rounded-full border shadow-sm"
                                            style={{ backgroundColor: option.swatch, borderColor: option.border }}
                                        />
                                        {option.label}
                                    </button>
                                );
                            })}
                        </div>
                    </SettingsRow>
                </SettingsSection>
            </SettingsPage>
        </div>
    );
}
