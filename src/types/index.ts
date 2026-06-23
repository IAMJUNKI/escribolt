/**
 * Shared TypeScript types used across multiple components.
 */

export type AppMode = 'local' | 'byok' | 'pro';
export type ThemeId = 'black' | 'white';
export type ThemePreference = ThemeId | 'system';
export type SttProvider = 'deepgram' | 'openai' | 'groq';
export type LlmProvider = 'openai' | 'groq' | 'anthropic' | 'gemini' | 'escribolt';
export type LlmSummaryProvider = LlmProvider;
export type SttTranscriptionMode = 'streaming' | 'prerecorded';
export type SttStreamingProfile = 'nova3-multilingual' | 'nova3-monolingual';
export type ByokProvider = 'deepgram' | 'openai' | 'groq' | 'anthropic' | 'gemini';
export type FluxLanguageHint = 'en' | 'es' | 'fr' | 'de' | 'hi' | 'ru' | 'pt' | 'ja' | 'it' | 'nl';
export type SectionId = 'library' | 'settings' | 'account' | 'notes' | 'recordings' | 'general' | 'ai';
export type RecordModeStatus = 'idle' | 'selecting' | 'capturing' | 'processing' | 'done' | 'error';
export type RecordModeCaptureEngine = 'electron-mediarecorder' | 'native-helper';
export type RecordingCaptureMode = 'system-only' | 'all-audio';
export type RecordingNoticeLevel = 'error' | 'warning';
export type ProcessingLocation = 'local' | 'cloud';
export type DictationHoldShortcutPreset = 'fn_hold' | 'disabled';
export type DictationHandsFreeShortcutPreset = 'fn_space_toggle' | 'ctrl_space_toggle' | 'cmd_ctrl_e_toggle';
export type QuickNoteShortcutPreset = 'ctrl_n' | 'fn_n_toggle' | 'cmd_ctrl_n' | 'cmd_shift_n' | 'opt_cmd_n';
export type RecordModeShortcutPreset = 'ctrl_r' | 'fn_r_toggle' | 'cmd_ctrl_r' | 'cmd_shift_r' | 'opt_cmd_r';
export type StickyNoteDefaultPlacement = 'top-left' | 'top-right' | 'bottom-left' | 'bottom-right';
export type StickyNoteColorId = 'yellow' | 'blue' | 'green' | 'pink';

export interface ShortcutSettings {
    dictationHoldPreset: DictationHoldShortcutPreset;
    dictationHandsFreePreset: DictationHandsFreeShortcutPreset;
    quickNotePreset: QuickNoteShortcutPreset;
    recordModePreset: RecordModeShortcutPreset;
}

export interface SidebarPinnedItem {
    type: 'note' | 'recording' | 'folder' | 'chat';
    id: string;
}

export interface ApiKeyMetadata {
    present: boolean;
    last4: string;
}

export interface UiSettings {
    mode: AppMode;
    theme: ThemePreference;
    effectiveTheme?: ThemeId;
    onboardingCompleted: boolean;
    productTourVersionSeen: number;
    launchAtLogin: boolean;
    quickNotePopupEnabled: boolean;
    meetingPromptEnabled: boolean;
    stickyNoteDefaultPlacement: StickyNoteDefaultPlacement;
    stickyNoteDefaultColorId: StickyNoteColorId;
    model: 'qwen' | 'gemma';
    aiEngine: {
        sttProvider: SttProvider;
        llmProvider: LlmProvider;
        summaryProvider: LlmSummaryProvider;
        llmModel: string;
        summaryModel: string;
        sttTranscriptionMode: SttTranscriptionMode;
        sttStreamingProfile: SttStreamingProfile;
        sttNova3Language: string;
        localSttLanguageMode?: 'auto' | 'fixed';
        localSttLanguage?: string;
        sttKeyterms: string[];
        sttFluxKeyterms?: string[];
        sttFluxLanguageHints?: FluxLanguageHint[];
        apiKeys: {
            deepgram: ApiKeyMetadata;
            openai: ApiKeyMetadata;
            groq: ApiKeyMetadata;
            anthropic: ApiKeyMetadata;
            gemini: ApiKeyMetadata;
        };
    };
    recordingCaptureMode?: RecordingCaptureMode;
    recordingSummaryLanguage?: string;
    processingModes: {
        dictation: ProcessingLocation;
        meetingTranscription: ProcessingLocation;
        aiActions: ProcessingLocation;
        summaries: ProcessingLocation;
    };
    layout?: {
        sidebarCollapsed?: boolean;
        sidebarWidth?: number;
        pinnedExpanded?: boolean;
        notesExpanded?: boolean;
        recordingsExpanded?: boolean;
        recentExpanded?: boolean;
        chatsExpanded?: boolean;
        spacesExpanded?: boolean;
        pinnedSidebarItems?: SidebarPinnedItem[];
    };
    syncSettings?: {
        autoSyncEnabled?: boolean;
        intervalMs?: number;
        strictPrivacyMode?: boolean;
    };
    shortcuts?: ShortcutSettings;
}

export interface AuthState {
    isLoggedIn: boolean;
    plan: 'free' | 'standard' | 'pro';
    email?: string;
    displayName?: string;
    accessToken?: string;
    refreshToken?: string;
    secureStorageAvailable: boolean;
    usingFallbackStorage: boolean;
    lastLoginAt: number | null;
}

export interface UsageQuota {
    used: number;
    limit: number;
    unit: string;
    percentUsed: number;
}

export interface UsageSummary {
    billingMonth: string;
    billingPeriodStart?: number | null;
    billingPeriodEnd?: number | null;
    meterMode?: 'pro' | 'trial' | 'none';
    plan: string;
    stt: UsageQuota;
    aiActions: UsageQuota;
    cloudAccess?: boolean;
    trialEligible?: boolean;
    trialRemaining?: {
        sttSeconds: number;
        aiActions: number;
    };
    deviceIdRequiredForTrial?: boolean;
}



export interface RecordingItem {
    id: string;
    title: string;
    transcript: string;
    summary: string;
    isCloudSynced: boolean;
    syncStatus?: 'synced' | 'pending' | 'failed';
    syncedAt?: number | null;
    summaryUpdatedAt: number | null;
    createdAt: number;
    updatedAt: number;
    route: {
        provider?: string;
        mode?: string;
        transport?: string;
    };
    stats: {
        chunkCount?: number;
        totalBytes?: number;
        durationMs?: number;
    };
    linkedNoteId?: string | null;
    folderId?: string;
}

export interface RecordingNotice {
    id: string;
    level: RecordingNoticeLevel;
    message: string;
    createdAt: number;
}

export interface SyncConflict {
    entityType: 'folders' | 'recordings' | 'notes' | 'transcripts' | 'chats';
    entityId: string;
    clientPayload: Record<string, any>;
    serverPayload: Record<string, any>;
    createdAt: number;
}

export interface Note {
    id: string;
    title?: string;
    text?: string;
    isCloudSynced?: boolean;
    syncStatus?: 'synced' | 'pending' | 'failed';
    colorId: string;
    folderId: string;
    createdAt: number;
    lastModified: number;
    syncedAt?: number | null;
    sourceRecordingIds?: string[];
}

export interface Folder {
    id: string;
    name: string;
    parentId?: string;
    iconId?: string;
    colorId?: string;
    isCloudSynced?: boolean;
    syncStatus?: 'synced' | 'pending' | 'failed';
    createdAt?: number;
    updatedAt?: number;
    version?: number;
    deletedAt?: number | null;
    syncedAt?: number | null;
}

export interface NotesData {
    folders: Folder[];
    notes: Note[];
    isAuthenticated?: boolean;
}

export interface AskMessage {
    id: string;
    role: 'user' | 'assistant';
    content: string;
    createdAt: number;
}

export interface ChatSession {
    id: string;
    title: string;
    messages: AskMessage[];
    isCloudSynced: boolean;
    syncStatus?: 'synced' | 'pending' | 'failed';
    createdAt: number;
    updatedAt: number;
    version?: number;
    deletedAt?: number | null;
    syncedAt?: number | null;
    folderId?: string;
    contextOptionIds?: string[];
}
