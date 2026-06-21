import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { AlignLeft, BookOpen, Cloud, Ear, FileText, KeyRound, Keyboard, Link2, Lock, Mic, Save, Search, Settings, Sparkles, Trash2, User, Plus, X, ExternalLink, ChevronDown, PanelLeft, PanelLeftInactive, SlidersHorizontal, Loader2, MessageCircle, Send, Upload, Unlink, Folder as FolderGlyph, FolderPlus, MoreHorizontal, Pin, PinOff, Pencil, RefreshCw } from 'lucide-react';
import {
    Briefcase, Building, Clipboard, Calendar, LayoutList, Award, Trophy, Target, Star, Bookmark, Tag,
    Code, Terminal, Cpu, Database, Globe, Wifi, Key, Shield, Unlock, PenTool, Paintbrush,
    Image as ImageIcon, Video, Music, Headphones, Volume2, Flame, MessageSquare, Mail, Share2, Users,
    Heart, Smile, Compass, MapPin, GraduationCap, School, ShoppingBag, CreditCard, Activity,
    Pill, Gift, Bell, Sun, Moon, Wind, Umbrella, TreePine, Leaf, Coffee, Wine, Pizza, Utensils,
    FolderOpen, ChevronRight
} from 'lucide-react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import remarkMath from 'remark-math';
import rehypeKatex from 'rehype-katex';
import 'katex/dist/katex.min.css';
import HoverTooltip from './components/HoverTooltip';
import MarkdownEditor from './components/MarkdownEditor';
import GlobalAskTab from './components/GlobalAskTab';
import ProductTour, { ProductTourStep } from './components/ProductTour';
import UnifiedHeader from './components/UnifiedHeader';
import type {
    AskMessage,
    GlobalAskContextOption,
    GlobalAskModelOption,
    GlobalAskModelSelection,
    GlobalAskSendPayload,
    ProgressStep,
} from './components/GlobalAskTab';
import { formatDurationCompactMs, formatDurationMs, formatTimestampLabel, formatTimeCompact } from './utils/format';
import SettingsGeneralPage from './pages/SettingsGeneralPage';
import SettingsAIEnginePage from './pages/SettingsAIEnginePage';
import SettingsAccountPage from './pages/SettingsAccountPage';
import SettingsDictationPage from './pages/SettingsDictationPage';
import SettingsQuickNotesPage from './pages/SettingsQuickNotesPage';
import SettingsRecordingsPage from './pages/SettingsRecordingsPage';
import SettingsChatsPage from './pages/SettingsChatsPage';
import SettingsShortcutsPage from './pages/SettingsShortcutsPage';
import SettingsStorageSyncPage from './pages/SettingsStorageSyncPage';
import OnboardingPage from './pages/OnboardingPage';
import {
    DEFAULT_RECORDING_SUMMARY_LANGUAGE,
    normalizeRecordingSummaryLanguageCode,
} from './utils/summaryLanguages';
import type {
    SectionId,
    RecordModeStatus, RecordModeCaptureEngine,
    RecordingNoticeLevel, UiSettings, AuthState,
    RecordingItem, RecordingNotice, SyncConflict, Note, NotesData, Folder, SidebarPinnedItem, ShortcutSettings, ChatSession,
    StickyNoteDefaultPlacement, StickyNoteColorId,
} from './types';

const colorPalette: Record<string, { color: string; bg: string }> = {
    gray: { color: 'var(--general-secondary-text, #929292)', bg: 'rgba(146, 146, 146, 0.12)' },
    red: { color: '#EF4444', bg: 'rgba(239, 68, 68, 0.12)' },
    orange: { color: '#F97316', bg: 'rgba(249, 115, 22, 0.12)' },
    yellow: { color: '#F59E0B', bg: 'rgba(245, 158, 11, 0.12)' },
    green: { color: '#10B981', bg: 'rgba(16, 185, 129, 0.12)' },
    teal: { color: '#14B8A6', bg: 'rgba(20, 184, 166, 0.12)' },
    blue: { color: '#3B82F6', bg: 'rgba(59, 130, 246, 0.12)' },
    indigo: { color: '#6366F1', bg: 'rgba(99, 102, 241, 0.12)' },
    purple: { color: '#8B5CF6', bg: 'rgba(139, 92, 246, 0.12)' },
    pink: { color: '#EC4899', bg: 'rgba(236, 72, 153, 0.12)' },
};

const folderIcons = [
    { id: 'folder', Icon: FolderGlyph, tags: ['folder', 'directory', 'default', 'box'] },
    { id: 'folder-open', Icon: FolderOpen, tags: ['folder', 'open', 'directory'] },
    { id: 'briefcase', Icon: Briefcase, tags: ['briefcase', 'work', 'job', 'business', 'office'] },
    { id: 'building', Icon: Building, tags: ['building', 'company', 'office', 'work', 'business'] },
    { id: 'clipboard', Icon: Clipboard, tags: ['clipboard', 'notes', 'tasks', 'todo', 'list'] },
    { id: 'calendar', Icon: Calendar, tags: ['calendar', 'date', 'schedule', 'event', 'time'] },
    { id: 'kanban', Icon: LayoutList, tags: ['kanban', 'board', 'tasks', 'todo', 'project'] },
    { id: 'award', Icon: Award, tags: ['award', 'trophy', 'prize', 'achievement', 'badge'] },
    { id: 'trophy', Icon: Trophy, tags: ['trophy', 'winner', 'achievement', 'prize', 'first'] },
    { id: 'target', Icon: Target, tags: ['target', 'goal', 'focus', 'aim', 'objective'] },
    { id: 'star', Icon: Star, tags: ['star', 'favorite', 'premium', 'highlight', 'bookmark'] },
    { id: 'bookmark', Icon: Bookmark, tags: ['bookmark', 'save', 'favorite', 'read'] },
    { id: 'tag', Icon: Tag, tags: ['tag', 'label', 'category', 'price'] },
    { id: 'code', Icon: Code, tags: ['code', 'programming', 'developer', 'software', 'tech'] },
    { id: 'terminal', Icon: Terminal, tags: ['terminal', 'command', 'cli', 'programming', 'code'] },
    { id: 'cpu', Icon: Cpu, tags: ['cpu', 'processor', 'tech', 'hardware', 'chip'] },
    { id: 'database', Icon: Database, tags: ['database', 'data', 'sql', 'storage', 'server'] },
    { id: 'cloud', Icon: Cloud, tags: ['cloud', 'storage', 'internet', 'network', 'online'] },
    { id: 'globe', Icon: Globe, tags: ['globe', 'world', 'earth', 'website', 'language', 'international'] },
    { id: 'wifi', Icon: Wifi, tags: ['wifi', 'network', 'connection', 'internet'] },
    { id: 'key', Icon: Key, tags: ['key', 'password', 'access', 'security', 'auth'] },
    { id: 'shield', Icon: Shield, tags: ['shield', 'security', 'safe', 'protect', 'defense'] },
    { id: 'lock', Icon: Lock, tags: ['lock', 'security', 'private', 'closed'] },
    { id: 'unlock', Icon: Unlock, tags: ['unlock', 'security', 'public', 'open'] },
    { id: 'pentool', Icon: PenTool, tags: ['pentool', 'draw', 'design', 'vector', 'art', 'creative'] },
    { id: 'paintbrush', Icon: Paintbrush, tags: ['paintbrush', 'color', 'art', 'design', 'paint'] },
    { id: 'image', Icon: ImageIcon, tags: ['image', 'photo', 'picture', 'gallery', 'art'] },
    { id: 'video', Icon: Video, tags: ['video', 'movie', 'camera', 'recording', 'film'] },
    { id: 'music', Icon: Music, tags: ['music', 'song', 'audio', 'sound'] },
    { id: 'headphones', Icon: Headphones, tags: ['headphones', 'audio', 'listen', 'music', 'sound'] },
    { id: 'mic', Icon: Mic, tags: ['mic', 'microphone', 'audio', 'voice', 'recording', 'sound'] },
    { id: 'volume', Icon: Volume2, tags: ['volume', 'sound', 'speaker', 'audio'] },
    { id: 'sparkles', Icon: Sparkles, tags: ['sparkles', 'ai', 'magic', 'clean', 'new', 'features'] },
    { id: 'flame', Icon: Flame, tags: ['flame', 'hot', 'fire', 'trending', 'popular'] },
    { id: 'message-square', Icon: MessageSquare, tags: ['message', 'chat', 'comment', 'discussion'] },
    { id: 'mail', Icon: Mail, tags: ['mail', 'email', 'letter', 'message', 'inbox'] },
    { id: 'send', Icon: Send, tags: ['send', 'message', 'paperplane', 'submit'] },
    { id: 'share', Icon: Share2, tags: ['share', 'link', 'social', 'network'] },
    { id: 'users', Icon: Users, tags: ['users', 'team', 'group', 'people', 'collaboration'] },
    { id: 'user', Icon: User, tags: ['user', 'profile', 'person', 'account', 'me'] },
    { id: 'heart', Icon: Heart, tags: ['heart', 'love', 'favorite', 'health'] },
    { id: 'smile', Icon: Smile, tags: ['smile', 'happy', 'emoji', 'face', 'fun'] },
    { id: 'compass', Icon: Compass, tags: ['compass', 'navigation', 'direction', 'travel', 'explore'] },
    { id: 'mappin', Icon: MapPin, tags: ['mappin', 'location', 'address', 'travel', 'place'] },
    { id: 'book-open', Icon: BookOpen, tags: ['book', 'read', 'learn', 'education', 'study'] },
    { id: 'graduation-cap', Icon: GraduationCap, tags: ['graduation', 'school', 'learn', 'college', 'study'] },
    { id: 'school', Icon: School, tags: ['school', 'education', 'building', 'learn'] },
    { id: 'shopping-bag', Icon: ShoppingBag, tags: ['shopping', 'bag', 'store', 'cart', 'buy'] },
    { id: 'credit-card', Icon: CreditCard, tags: ['card', 'credit', 'payment', 'money', 'finance'] },
    { id: 'activity', Icon: Activity, tags: ['activity', 'chart', 'health', 'heartbeat', 'pulse'] },
    { id: 'pill', Icon: Pill, tags: ['pill', 'health', 'medicine', 'drug'] },
    { id: 'gift', Icon: Gift, tags: ['gift', 'present', 'birthday', 'holiday', 'reward'] },
    { id: 'bell', Icon: Bell, tags: ['bell', 'notification', 'alert', 'remind'] },
    { id: 'sun', Icon: Sun, tags: ['sun', 'weather', 'light', 'day', 'warm'] },
    { id: 'moon', Icon: Moon, tags: ['moon', 'night', 'dark', 'weather', 'sleep'] },
    { id: 'wind', Icon: Wind, tags: ['wind', 'weather', 'air', 'blow'] },
    { id: 'umbrella', Icon: Umbrella, tags: ['umbrella', 'rain', 'weather', 'protect'] },
    { id: 'tree', Icon: TreePine, tags: ['tree', 'nature', 'forest', 'pine', 'green'] },
    { id: 'leaf', Icon: Leaf, tags: ['leaf', 'nature', 'plant', 'organic', 'green'] },
    { id: 'coffee', Icon: Coffee, tags: ['coffee', 'cup', 'drink', 'cafe', 'tea', 'morning'] },
    { id: 'wine', Icon: Wine, tags: ['wine', 'drink', 'glass', 'party', 'alcohol'] },
    { id: 'pizza', Icon: Pizza, tags: ['pizza', 'food', 'eat', 'dinner'] },
    { id: 'utensils', Icon: Utensils, tags: ['utensils', 'food', 'eat', 'restaurant', 'fork', 'spoon'] },
];

const folderIconMap: Record<string, React.ComponentType<any>> = {};
folderIcons.forEach((item) => {
    folderIconMap[item.id] = item.Icon;
});

const getFolderIconAndColor = (folder: any) => {
    const IconComponent = folderIconMap[folder?.iconId || 'folder'] || FolderGlyph;
    const colorStyle = folder?.colorId && colorPalette[folder.colorId]
        ? { color: colorPalette[folder.colorId].color }
        : undefined;
    return { IconComponent, colorStyle };
};

const { ipcRenderer } = window.require('electron');

// Types imported from ./types
type ApiKeyDrafts = {
    deepgram: string;
    openai: string;
    groq: string;
    anthropic: string;
    gemini: string;
};

const EMPTY_API_KEY_DRAFTS: ApiKeyDrafts = {
    deepgram: '',
    openai: '',
    groq: '',
    anthropic: '',
    gemini: '',
};

const BYOK_PROVIDER_IDS: Array<keyof ApiKeyDrafts> = ['deepgram', 'openai', 'groq', 'anthropic', 'gemini'];
const NOVA3_MONOLINGUAL_LANGUAGE_CODES = [
    'ar', 'ar-AE', 'ar-SA', 'ar-QA', 'ar-KW', 'ar-SY', 'ar-LB', 'ar-PS', 'ar-JO', 'ar-EG', 'ar-SD', 'ar-TD',
    'ar-MA', 'ar-DZ', 'ar-TN', 'ar-IQ', 'ar-IR', 'be', 'bn', 'bs', 'bg', 'ca', 'zh-HK', 'zh', 'zh-CN',
    'zh-Hans', 'zh-TW', 'zh-Hant', 'hr', 'cs', 'da', 'da-DK', 'nl', 'en', 'en-US', 'en-AU', 'en-GB',
    'en-IN', 'en-NZ', 'et', 'fi', 'nl-BE', 'fr', 'fr-CA', 'de', 'de-CH', 'el', 'gu', 'gu-IN', 'he',
    'hi', 'hu', 'id', 'it', 'ja', 'kn', 'ko', 'ko-KR', 'lv', 'lt', 'mk', 'ms', 'mr', 'no', 'fa', 'pl',
    'pt', 'pt-BR', 'pt-PT', 'ro', 'ru', 'sr', 'sk', 'sl', 'es', 'es-419', 'sv', 'sv-SE', 'tl', 'ta',
    'te', 'th', 'th-TH', 'tr', 'uk', 'ur', 'vi',
];
const NOVA3_MONOLINGUAL_LANGUAGE_CODE_LOOKUP = new Map(
    NOVA3_MONOLINGUAL_LANGUAGE_CODES.map((code) => [code.toLowerCase(), code]),
);

const EMPTY_API_KEY_META = {
    deepgram: { present: false, last4: '' },
    openai: { present: false, last4: '' },
    groq: { present: false, last4: '' },
    anthropic: { present: false, last4: '' },
    gemini: { present: false, last4: '' },
};

const DEFAULT_SHORTCUTS: ShortcutSettings = {
    dictationHoldPreset: 'fn_hold',
    dictationHandsFreePreset: 'fn_space_toggle',
    quickNotePreset: 'ctrl_n',
    recordModePreset: 'ctrl_r',
};

const STICKY_NOTE_DEFAULT_PLACEMENTS: StickyNoteDefaultPlacement[] = ['top-left', 'top-right', 'bottom-left', 'bottom-right'];
const STICKY_NOTE_COLOR_IDS: StickyNoteColorId[] = ['yellow', 'blue', 'green', 'pink'];
const CURRENT_PRODUCT_TOUR_VERSION = 1;

function normalizeStickyNoteDefaultPlacement(value: unknown): StickyNoteDefaultPlacement {
    return STICKY_NOTE_DEFAULT_PLACEMENTS.includes(value as StickyNoteDefaultPlacement)
        ? value as StickyNoteDefaultPlacement
        : 'top-right';
}

function normalizeStickyNoteColorId(value: unknown): StickyNoteColorId {
    return STICKY_NOTE_COLOR_IDS.includes(value as StickyNoteColorId)
        ? value as StickyNoteColorId
        : 'yellow';
}

const DEFAULT_SETTINGS: UiSettings = {
    mode: 'local',
    theme: 'black',
    onboardingCompleted: false,
    productTourVersionSeen: 0,
    launchAtLogin: false,
    quickNotePopupEnabled: true,
    meetingPromptEnabled: false,
    stickyNoteDefaultPlacement: 'top-right',
    stickyNoteDefaultColorId: 'yellow',
    model: 'qwen',
    aiEngine: {
        sttProvider: 'deepgram',
        llmProvider: 'openai',
        summaryProvider: 'openai',
        llmModel: 'gpt-5-nano',
        summaryModel: 'gpt-5-nano',
        sttTranscriptionMode: 'streaming',
        sttStreamingProfile: 'nova3-multilingual',
        sttNova3Language: 'en',
        sttKeyterms: [],
        sttFluxKeyterms: [],
        sttFluxLanguageHints: [],
        apiKeys: { ...EMPTY_API_KEY_META },
    },
    recordingCaptureMode: 'system-only',
    recordingSummaryLanguage: DEFAULT_RECORDING_SUMMARY_LANGUAGE,
    processingModes: {
        dictation: 'local',
        meetingTranscription: 'local',
        aiActions: 'local',
        summaries: 'local',
    },
    layout: {
        sidebarCollapsed: false,
        sidebarWidth: 288,
        pinnedExpanded: true,
        notesExpanded: true,
        recordingsExpanded: true,
        pinnedSidebarItems: [],
    },
    syncSettings: {
        autoSyncEnabled: true,
        intervalMs: 300000,
        strictPrivacyMode: false,
    },
    shortcuts: { ...DEFAULT_SHORTCUTS },
};

const DEFAULT_AUTH_STATE: AuthState = {
    isLoggedIn: false,
    plan: 'free',
    secureStorageAvailable: false,
    usingFallbackStorage: false,
    lastLoginAt: null,
};

type AppUpdateStatus = 'idle' | 'checking' | 'available' | 'downloading' | 'downloaded' | 'error';

type AppUpdateState = {
    status: AppUpdateStatus;
    supported: boolean;
    currentVersion: string;
    availableVersion: string;
    releaseName: string;
    releaseDate: string;
    progressPercent: number | null;
    errorMessage: string;
};

const DEFAULT_UPDATE_STATE: AppUpdateState = {
    status: 'idle',
    supported: false,
    currentVersion: '',
    availableVersion: '',
    releaseName: '',
    releaseDate: '',
    progressPercent: null,
    errorMessage: '',
};

const APP_UPDATE_STATUSES = new Set<AppUpdateStatus>([
    'idle',
    'checking',
    'available',
    'downloading',
    'downloaded',
    'error',
]);

function normalizeUpdateState(rawState: unknown): AppUpdateState {
    const source = rawState && typeof rawState === 'object' ? rawState as Record<string, any> : {};
    const rawStatus = String(source.status || '').trim() as AppUpdateStatus;
    const progress = Number(source.progressPercent);
    return {
        status: APP_UPDATE_STATUSES.has(rawStatus) ? rawStatus : 'idle',
        supported: source.supported === true,
        currentVersion: String(source.currentVersion || ''),
        availableVersion: String(source.availableVersion || ''),
        releaseName: String(source.releaseName || ''),
        releaseDate: String(source.releaseDate || ''),
        progressPercent: Number.isFinite(progress) ? Math.max(0, Math.min(100, progress)) : null,
        errorMessage: String(source.errorMessage || ''),
    };
}

function formatUpdateVersionLabel(version: string): string {
    const trimmed = version.trim();
    if (!trimmed) return '';
    return trimmed.toLowerCase().startsWith('v') ? trimmed : `v${trimmed}`;
}

const SIDEBAR_WIDTH_DEFAULT = 288;
const SIDEBAR_WIDTH_MIN = 220;
const SIDEBAR_WIDTH_MAX = 520;
const MAC_TRAFFIC_LIGHT_GUTTER = 80;
const TAB_WIDTH_FIXED = 188;
const RECORD_WIDGET_BAR_COUNT = 9;
const RECORD_WIDGET_IDLE_LEVEL = 0.08;
const RECORD_WIDGET_IDLE_BARS = Array.from({ length: RECORD_WIDGET_BAR_COUNT }, () => RECORD_WIDGET_IDLE_LEVEL);
const LIBRARY_TABS_STORAGE_KEY = 'escribolt_library_tabs';
const GLOBAL_ASK_DEFAULT_MODEL_OPTION_ID = 'model:auto';
const GLOBAL_ASK_BYOK_PROVIDER_OPTIONS: Array<{ id: 'openai' | 'groq' | 'anthropic' | 'gemini'; label: string }> = [
    { id: 'openai', label: 'OpenAI' },
    { id: 'groq', label: 'Groq' },
    { id: 'anthropic', label: 'Anthropic' },
    { id: 'gemini', label: 'Gemini' },
];
const GLOBAL_ASK_BYOK_MODEL_OPTIONS: Record<string, Array<{ id: string; label: string }>> = {
    openai: [
        { id: 'gpt-5-nano', label: 'GPT-5 Nano' },
        { id: 'gpt-4.1-mini', label: 'GPT-4.1 Mini' },
        { id: 'gpt-4o-mini', label: 'GPT-4o Mini' },
    ],
    groq: [
        { id: 'llama-3.3-70b-versatile', label: 'Llama 3.3 70B' },
        { id: 'llama-3.1-8b-instant', label: 'Llama 3.1 8B' },
        { id: 'deepseek-r1-distill-llama-70b', label: 'DeepSeek R1 Distill' },
    ],
    anthropic: [
        { id: 'claude-sonnet-4-20250514', label: 'Claude Sonnet 4' },
        { id: 'claude-3-7-sonnet-latest', label: 'Claude 3.7 Sonnet' },
        { id: 'claude-3-5-haiku-latest', label: 'Claude 3.5 Haiku' },
    ],
    gemini: [
        { id: 'gemini-2.0-flash', label: 'Gemini 2.0 Flash' },
        { id: 'gemini-1.5-pro', label: 'Gemini 1.5 Pro' },
    ],
};
type ProModelOption = {
    id: string;
    label: string;
    helperText: string;
    contextWindowTokens: number | null;
};

function formatProModelAliasLabel(alias: string): string {
    const parts = String(alias || '')
        .trim()
        .replace(/[^a-zA-Z0-9]+/g, ' ')
        .split(' ')
        .filter(Boolean);
    if (!parts.length) return 'Model';
    return parts
        .map((part) => part.charAt(0).toUpperCase() + part.slice(1).toLowerCase())
        .join(' ');
}

function normalizeProModelOptions(rawOptions: any, fallbackAlias: string): ProModelOption[] {
    const source = Array.isArray(rawOptions) ? rawOptions : [];
    const seen = new Set<string>();
    const normalized = source
        .map((entry) => {
            const id = String(entry?.id || '').trim().toLowerCase();
            if (!id || seen.has(id)) return null;
            seen.add(id);
            const label = String(entry?.label || '').trim() || formatProModelAliasLabel(id);
            const helperText = String(entry?.helperText || '').trim();
            const contextWindowCandidate = Number(entry?.contextWindowTokens);
            return {
                id,
                label,
                helperText: helperText || 'Managed alias',
                contextWindowTokens: Number.isFinite(contextWindowCandidate) && contextWindowCandidate > 0
                    ? Math.floor(contextWindowCandidate)
                    : null,
            };
        })
        .filter((entry): entry is ProModelOption => !!entry);

    if (normalized.length) return normalized;
    const fallbackId = String(fallbackAlias || '').trim().toLowerCase() || 'default';
    return [{
        id: fallbackId,
        label: formatProModelAliasLabel(fallbackId),
        helperText: 'Managed alias',
        contextWindowTokens: null,
    }];
}

function clampSidebarWidth(value: number): number {
    if (!Number.isFinite(value)) return SIDEBAR_WIDTH_DEFAULT;
    return Math.min(SIDEBAR_WIDTH_MAX, Math.max(SIDEBAR_WIDTH_MIN, Math.round(value)));
}

const markdownComponents = {
    a: ({ href, children, ...props }: any) => {
        const handleClick = (e: React.MouseEvent<HTMLAnchorElement>) => {
            if (href && (href.startsWith('http://') || href.startsWith('https://'))) {
                e.preventDefault();
                try {
                    const { shell } = window.require('electron');
                    shell.openExternal(href);
                } catch (err) {
                    console.error('Failed to open external URL:', err);
                }
            }
        };
        return (
            <a
                href={href}
                onClick={handleClick}
                className="text-[var(--general-eye-catch)] underline hover:opacity-80"
                {...props}
            >
                {children}
            </a>
        );
    }
};

function RecordingSummaryAnimation({ streamingSummaryText }: { streamingSummaryText: string }) {
    const hasLivePreview = streamingSummaryText.trim().length > 0;

    if (hasLivePreview) {
        return (
            <div className="w-full min-h-[220px] text-left es-summary-animation-shell" aria-live="polite">
                <div className="es-md-prose es-writing-text max-w-none [&>*:first-child]:mt-0 [&>*:first-child]:pt-0">
                    <ReactMarkdown remarkPlugins={[remarkGfm, remarkMath]} rehypePlugins={[rehypeKatex]} components={markdownComponents}>
                        {streamingSummaryText}
                    </ReactMarkdown>
                </div>
            </div>
        );
    }

    return (
        <div className="h-full min-h-[360px] flex flex-col items-center justify-center es-summary-animation-shell" aria-live="polite">
            <div className="w-full flex-1 min-h-[260px] flex flex-col items-center justify-center text-center">
                <svg className="es-summary-animation-svg" viewBox="0 0 640 300" role="img" aria-labelledby="recording-summary-animation-title">
                    <title id="recording-summary-animation-title">Generating summary</title>
                    <g className="es-summary-wave-stack">
                        <path className="es-summary-wave es-summary-wave-one" d="M48 92 C86 48 112 138 150 96 S216 50 250 98 S316 148 356 98" />
                        <path className="es-summary-wave es-summary-wave-two" d="M44 148 C82 112 116 184 154 148 S218 110 252 150 S318 190 360 148" />
                        <path className="es-summary-wave es-summary-wave-three" d="M54 204 C92 158 118 248 156 204 S222 156 258 206 S320 246 366 204" />
                    </g>

                    <g className="es-summary-bridge-lines">
                        <path d="M358 98 C388 98 398 86 424 84" />
                        <path d="M362 148 C392 148 402 148 428 148" />
                        <path d="M368 204 C396 204 404 212 430 216" />
                    </g>

                    <g className="es-summary-doc">
                        <path className="es-summary-doc-page" d="M430 54 H548 L594 100 V238 C594 252 586 260 572 260 H430 C416 260 408 252 408 238 V76 C408 62 416 54 430 54 Z" />
                        <path className="es-summary-doc-fold" d="M548 56 V100 H592" />
                        <path className="es-summary-doc-line es-summary-doc-line-one" d="M452 112 H548" />
                        <path className="es-summary-doc-line es-summary-doc-line-two" d="M452 142 H560" />
                        <path className="es-summary-doc-line es-summary-doc-line-three" d="M452 202 H552" />
                        <path className="es-summary-doc-line es-summary-doc-line-four" d="M452 232 H534" />
                        <path className="es-summary-check-box es-summary-check-box-one" d="M442 166 H462 V186 H442 Z" />
                        <path className="es-summary-check-mark es-summary-check-mark-one" d="M446 176 L452 182 L462 170" />
                        <path className="es-summary-check-box es-summary-check-box-two" d="M442 214 H462 V234 H442 Z" />
                        <path className="es-summary-check-mark es-summary-check-mark-two" d="M446 224 L452 230 L462 218" />
                        <path className="es-summary-doc-line es-summary-doc-task-one" d="M478 176 H560" />
                        <path className="es-summary-doc-line es-summary-doc-task-two" d="M478 224 H544" />
                    </g>

                    <g transform="translate(502 156)">
                        <g className="es-summary-orbit es-summary-orbit-one">
                            <circle cx="0" cy="-126" r="5" />
                            <circle cx="88" cy="48" r="4" />
                            <path d="M-108 50 L-101 50 M-104.5 46.5 L-104.5 53.5" />
                        </g>
                        <g className="es-summary-orbit es-summary-orbit-two">
                            <circle cx="-92" cy="-70" r="4" />
                            <path d="M116 -28 L124 -28 M120 -32 L120 -24" />
                            <circle cx="-36" cy="116" r="3.5" />
                        </g>
                    </g>
                </svg>
                <div className="mt-3 text-xs font-semibold uppercase tracking-[0.18em] es-summary-animation-status">
                    Analyzing transcript...
                </div>
            </div>
        </div>
    );
}



function normalizeShortcutSettings(rawShortcuts: any): ShortcutSettings {
    const next: ShortcutSettings = { ...DEFAULT_SHORTCUTS };

    const dictationHoldPreset = typeof rawShortcuts?.dictationHoldPreset === 'string'
        ? rawShortcuts.dictationHoldPreset
        : '';
    if (dictationHoldPreset === 'fn_hold' || dictationHoldPreset === 'disabled') {
        next.dictationHoldPreset = dictationHoldPreset;
    }

    const dictationHandsFreePreset = typeof rawShortcuts?.dictationHandsFreePreset === 'string'
        ? rawShortcuts.dictationHandsFreePreset
        : '';
    if (dictationHandsFreePreset === 'fn_space_toggle'
        || dictationHandsFreePreset === 'ctrl_space_toggle'
        || dictationHandsFreePreset === 'cmd_ctrl_e_toggle') {
        next.dictationHandsFreePreset = dictationHandsFreePreset;
    }

    const legacyDictationPreset = typeof rawShortcuts?.dictationPreset === 'string'
        ? rawShortcuts.dictationPreset
        : '';
    if (legacyDictationPreset === 'fn_hold_plus_fn_space') {
        next.dictationHoldPreset = 'fn_hold';
        next.dictationHandsFreePreset = 'fn_space_toggle';
    } else if (legacyDictationPreset === 'ctrl_space_toggle') {
        next.dictationHoldPreset = 'disabled';
        next.dictationHandsFreePreset = 'ctrl_space_toggle';
    } else if (legacyDictationPreset === 'cmd_ctrl_e_toggle') {
        next.dictationHoldPreset = 'disabled';
        next.dictationHandsFreePreset = 'cmd_ctrl_e_toggle';
    }

    const quickNotePreset = typeof rawShortcuts?.quickNotePreset === 'string'
        ? rawShortcuts.quickNotePreset
        : '';
    if (quickNotePreset === 'ctrl_n'
        || quickNotePreset === 'fn_n_toggle'
        || quickNotePreset === 'cmd_ctrl_n'
        || quickNotePreset === 'cmd_shift_n'
        || quickNotePreset === 'opt_cmd_n') {
        next.quickNotePreset = quickNotePreset;
    }

    const recordModePreset = typeof rawShortcuts?.recordModePreset === 'string'
        ? rawShortcuts.recordModePreset
        : '';
    if (recordModePreset === 'ctrl_r'
        || recordModePreset === 'fn_r_toggle'
        || recordModePreset === 'cmd_ctrl_r'
        || recordModePreset === 'cmd_shift_r'
        || recordModePreset === 'opt_cmd_r') {
        next.recordModePreset = recordModePreset;
    }

    return next;
}

function normalizeSttKeyterms(rawKeyterms: any, legacyKeyterms: any = []): string[] {
    const source = [
        ...(Array.isArray(rawKeyterms) ? rawKeyterms : []),
        ...(Array.isArray(legacyKeyterms) ? legacyKeyterms : []),
    ];
    const seen = new Set<string>();
    const normalized: string[] = [];
    source.forEach((entry) => {
        const clean = String(entry || '').trim().replace(/\s+/g, ' ');
        if (!clean) return;
        const dedupeKey = clean.toLowerCase();
        if (seen.has(dedupeKey)) return;
        seen.add(dedupeKey);
        normalized.push(clean);
    });
    return normalized.slice(0, 100);
}

function normalizeLegacyFluxKeyterms(rawKeyterms: any): string[] {
    return normalizeSttKeyterms(rawKeyterms);
}

function normalizeFluxLanguageHints(rawLanguageHints: any): Array<'en' | 'es' | 'fr' | 'de' | 'hi' | 'ru' | 'pt' | 'ja' | 'it' | 'nl'> {
    const source = Array.isArray(rawLanguageHints) ? rawLanguageHints : [];
    const seen = new Set<string>();
    const normalized: Array<'en' | 'es' | 'fr' | 'de' | 'hi' | 'ru' | 'pt' | 'ja' | 'it' | 'nl'> = [];
    source.forEach((entry) => {
        const normalizedCode = String(entry || '')
            .trim()
            .toLowerCase()
            .replace(/_/g, '-')
            .split('-')[0];
        if (!['en', 'es', 'fr', 'de', 'hi', 'ru', 'pt', 'ja', 'it', 'nl'].includes(normalizedCode) || seen.has(normalizedCode)) {
            return;
        }
        seen.add(normalizedCode);
        normalized.push(normalizedCode as 'en' | 'es' | 'fr' | 'de' | 'hi' | 'ru' | 'pt' | 'ja' | 'it' | 'nl');
    });
    return normalized;
}

function normalizeSttStreamingProfile(rawProfile: any): UiSettings['aiEngine']['sttStreamingProfile'] {
    return rawProfile === 'nova3-monolingual' ? 'nova3-monolingual' : 'nova3-multilingual';
}

function normalizeNova3LanguageCode(rawCode: any): string {
    const normalized = String(rawCode || '')
        .trim()
        .replace(/_/g, '-')
        .toLowerCase();
    if (!normalized) return '';

    const exact = NOVA3_MONOLINGUAL_LANGUAGE_CODE_LOOKUP.get(normalized);
    if (exact) return exact;

    const baseCode = normalized.split('-')[0] || '';
    return NOVA3_MONOLINGUAL_LANGUAGE_CODE_LOOKUP.get(baseCode) || '';
}

function resolveDefaultNova3Language(): string {
    const language = typeof navigator !== 'undefined' ? navigator.language : '';
    return normalizeNova3LanguageCode(language) || 'en';
}

function normalizeProcessingModes(rawModes: any, fallbackLocation: 'local' | 'cloud' = 'local'): UiSettings['processingModes'] {
    const source = rawModes && typeof rawModes === 'object' ? rawModes : {};
    const fallback = fallbackLocation === 'cloud' ? 'cloud' : 'local';
    const normalize = (value: any) => (value === 'cloud' || value === 'local' ? value : fallback);
    return {
        dictation: normalize(source.dictation),
        meetingTranscription: normalize(source.meetingTranscription),
        aiActions: normalize(source.aiActions),
        summaries: normalize(source.summaries ?? source.aiActions),
    };
}

function normalizeSettings(loaded: Partial<UiSettings> = {}): UiSettings {
    const rawApiKeys: any = (loaded.aiEngine as any)?.apiKeys || {};
    const normalizedApiKeys = {
        deepgram: {
            present: rawApiKeys.deepgram?.present === true,
            last4: typeof rawApiKeys.deepgram?.last4 === 'string' ? rawApiKeys.deepgram.last4.slice(-4) : '',
        },
        openai: {
            present: rawApiKeys.openai?.present === true,
            last4: typeof rawApiKeys.openai?.last4 === 'string' ? rawApiKeys.openai.last4.slice(-4) : '',
        },
        groq: {
            present: rawApiKeys.groq?.present === true,
            last4: typeof rawApiKeys.groq?.last4 === 'string' ? rawApiKeys.groq.last4.slice(-4) : '',
        },
        anthropic: {
            present: rawApiKeys.anthropic?.present === true,
            last4: typeof rawApiKeys.anthropic?.last4 === 'string' ? rawApiKeys.anthropic.last4.slice(-4) : '',
        },
        gemini: {
            present: rawApiKeys.gemini?.present === true,
            last4: typeof rawApiKeys.gemini?.last4 === 'string' ? rawApiKeys.gemini.last4.slice(-4) : '',
        },
    };

    return {
        ...DEFAULT_SETTINGS,
        ...loaded,
        productTourVersionSeen: normalizeProductTourVersionSeen(loaded),
        quickNotePopupEnabled: typeof loaded.quickNotePopupEnabled === 'boolean'
            ? !!loaded.quickNotePopupEnabled
            : DEFAULT_SETTINGS.quickNotePopupEnabled,
        meetingPromptEnabled: typeof loaded.meetingPromptEnabled === 'boolean'
            ? !!loaded.meetingPromptEnabled
            : DEFAULT_SETTINGS.meetingPromptEnabled,
        stickyNoteDefaultPlacement: normalizeStickyNoteDefaultPlacement((loaded as any).stickyNoteDefaultPlacement),
        stickyNoteDefaultColorId: normalizeStickyNoteColorId((loaded as any).stickyNoteDefaultColorId),
        aiEngine: {
            ...DEFAULT_SETTINGS.aiEngine,
            ...(loaded.aiEngine || {}),
            sttStreamingProfile: normalizeSttStreamingProfile((loaded.aiEngine as any)?.sttStreamingProfile),
            sttNova3Language: normalizeNova3LanguageCode((loaded.aiEngine as any)?.sttNova3Language) || resolveDefaultNova3Language(),
            sttKeyterms: normalizeSttKeyterms(
                (loaded.aiEngine as any)?.sttKeyterms,
                (loaded.aiEngine as any)?.sttFluxKeyterms,
            ),
            sttFluxKeyterms: normalizeLegacyFluxKeyterms((loaded.aiEngine as any)?.sttFluxKeyterms),
            sttFluxLanguageHints: normalizeFluxLanguageHints((loaded.aiEngine as any)?.sttFluxLanguageHints),
            apiKeys: normalizedApiKeys,
        },
        recordingCaptureMode: loaded.recordingCaptureMode || DEFAULT_SETTINGS.recordingCaptureMode,
        recordingSummaryLanguage: normalizeRecordingSummaryLanguageCode((loaded as any).recordingSummaryLanguage),
        processingModes: normalizeProcessingModes(
            (loaded as any).processingModes,
            'local',
        ),
        layout: {
            ...DEFAULT_SETTINGS.layout,
            ...(loaded.layout || {}),
        },
        syncSettings: {
            ...DEFAULT_SETTINGS.syncSettings,
            ...(loaded.syncSettings || {}),
        },
        shortcuts: normalizeShortcutSettings(loaded.shortcuts),
    };
}

function normalizeProductTourVersionSeen(loaded: Partial<UiSettings> = {}): number {
    const raw = (loaded as any).productTourVersionSeen;
    if (typeof raw === 'number' && Number.isFinite(raw)) {
        return Math.max(0, Math.floor(raw));
    }
    return loaded.onboardingCompleted === true
        ? CURRENT_PRODUCT_TOUR_VERSION
        : DEFAULT_SETTINGS.productTourVersionSeen;
}

function getRecordingPreviewText(entry: RecordingItem, query: string): string {
    const summary = (entry.summary || '').trim();
    const transcript = (entry.transcript || '').trim();
    const fallback = summary || transcript || 'No transcript yet.';
    const normalizedQuery = query.trim().toLowerCase();

    if (!normalizedQuery) return fallback;
    if (summary.toLowerCase().includes(normalizedQuery)) return summary;
    if (transcript.toLowerCase().includes(normalizedQuery)) return transcript;
    return fallback;
}

function getGlobalAskByokModelOptions(provider: string): Array<{ id: string; label: string }> {
    return GLOBAL_ASK_BYOK_MODEL_OPTIONS[provider] || GLOBAL_ASK_BYOK_MODEL_OPTIONS.openai;
}

function buildGlobalAskContextSelectionFromOptionId(optionId: string): { kind: 'recording' | 'note' | 'folder' | 'chat'; id?: string } | null {
    const clean = String(optionId || '').trim();
    const parts = clean.split(':');
    if (parts.length === 3 && parts[0] === 'ctx' && parts[2]) {
        if (parts[1] === 'recording') {
            return { kind: 'recording', id: parts[2] };
        }
        if (parts[1] === 'note') {
            return { kind: 'note', id: parts[2] };
        }
        if (parts[1] === 'folder') {
            return { kind: 'folder', id: parts[2] };
        }
        if (parts[1] === 'chat') {
            return { kind: 'chat', id: parts[2] };
        }
    }
    return null;
}

type LibraryFilter = 'all' | 'notes' | 'recordings' | 'chats' | 'private' | 'cloud';
type LibraryItem = {
    type: 'note' | 'recording' | 'chat';
    id: string;
    title: string;
    preview: string;
    updatedAt: number;
    createdAt: number;
    isCloudSynced: boolean;
    durationMs?: number;
    linkedNoteId?: string | null;
    sourceRecordingIds?: string[];
};
type BaseLibraryItem = Omit<LibraryItem, 'type'> & { type: 'note' | 'recording' };
type HeaderSpaceSwitcherEntry = {
    kind: 'folder' | 'note' | 'recording' | 'chat';
    id: string;
    title: string;
    updatedAt: number;
    createdAt: number;
};

type LibraryTab = {
    type: 'note' | 'recording' | 'ask';
    id: string;
};

type LibraryTabsSnapshot = {
    openTabs: LibraryTab[];
    activeTabKey: string | null;
};

type RecordingReviewNotice = {
    id: string;
    recordingId: string;
    message: string;
    createdAt: number;
};

type SyncToast = {
    id: string;
    level: 'warning' | 'error';
    code: string;
    message: string;
    createdAt: number;
};

const SETTINGS_TAB_KEYS = ['general', 'account', 'storageSync', 'dictation', 'quickNotes', 'recordings', 'chats', 'ai', 'shortcuts'] as const;
type SettingsTabKey = typeof SETTINGS_TAB_KEYS[number];
type SettingsTabMeta = {
    key: SettingsTabKey;
    label: string;
    icon: React.ComponentType<{ size?: number }>;
    visible: boolean;
    isolated?: boolean;
};

type DashboardNavigationPayload = {
    type?: 'note' | 'recording' | 'chat' | 'settings';
    id?: string;
    settingsTab?: string;
};

function resolveSettingsTabKey(rawTab: unknown): SettingsTabKey | null {
    const tab = String(rawTab || '').trim();
    return SETTINGS_TAB_KEYS.includes(tab as SettingsTabKey) ? (tab as SettingsTabKey) : null;
}

type ShortcutRuntimeOption = {
    id: string;
    label: string;
    description: string;
};

type ShortcutRuntimeActiveEntry = {
    preset?: string;
    display?: string;
    mode?: string;
    accelerator?: string;
    fallbackActive?: boolean;
    registered?: boolean;
};

type ShortcutsRuntimeStatus = {
    status: 'success' | 'error';
    message?: string;
    platform?: string;
    catalog?: {
        dictationHold?: ShortcutRuntimeOption[];
        dictationHandsFree?: ShortcutRuntimeOption[];
        quickNote?: ShortcutRuntimeOption[];
        recordMode?: ShortcutRuntimeOption[];
    };
    active?: {
        dictationHold?: ShortcutRuntimeActiveEntry;
        dictationHandsFree?: ShortcutRuntimeActiveEntry;
        quickNote?: ShortcutRuntimeActiveEntry;
        recordMode?: ShortcutRuntimeActiveEntry;
        pasteLastTranscription?: ShortcutRuntimeActiveEntry;
    };
    warnings?: string[];
    capability?: {
        fnListenerSupported: boolean;
        fnListenerEnabled: boolean;
        fnListenerAvailable: boolean;
        fnListenerReason: string;
    };
    localSpeech?: {
        isLocalRoute?: boolean;
        status?: string;
        available?: boolean;
        warming?: boolean;
        message?: string;
        stage?: string | null;
        model?: string | null;
        durationMs?: number | null;
    };
};

function getLibraryTabKey(tab: Pick<LibraryTab, 'type' | 'id'> | null | undefined): string {
    if (!tab) return '';
    return `${tab.type}:${tab.id}`;
}

function normalizeLibraryTab(rawTab: unknown): LibraryTab | null {
    if (!rawTab || typeof rawTab !== 'object') return null;
    const type = String((rawTab as any).type || '').trim();
    const id = String((rawTab as any).id || '').trim();
    if (!id) return null;
    if (type !== 'note' && type !== 'recording' && type !== 'ask') return null;
    return {
        type,
        id,
    };
}

function normalizeLibraryTabList(rawTabs: unknown): LibraryTab[] {
    const source = Array.isArray(rawTabs) ? rawTabs : [];
    const seen = new Set<string>();
    const normalized: LibraryTab[] = [];
    source.forEach((rawTab) => {
        const tab = normalizeLibraryTab(rawTab);
        if (!tab) return;
        const key = getLibraryTabKey(tab);
        if (seen.has(key)) return;
        seen.add(key);
        normalized.push(tab);
    });
    return normalized;
}

function normalizeLibraryTabKeyString(rawKey: unknown): string | null {
    if (typeof rawKey !== 'string') return null;
    const trimmed = rawKey.trim();
    if (!trimmed) return null;
    const splitIndex = trimmed.indexOf(':');
    if (splitIndex <= 0) return null;
    const type = trimmed.slice(0, splitIndex).trim();
    const id = trimmed.slice(splitIndex + 1).trim();
    if (!id) return null;
    if (type !== 'note' && type !== 'recording' && type !== 'ask') return null;
    return `${type}:${id}`;
}

function normalizeLibraryActiveTabKey(rawActiveTab: unknown): string | null {
    const direct = normalizeLibraryTabKeyString(rawActiveTab);
    if (direct) return direct;
    const tab = normalizeLibraryTab(rawActiveTab);
    return tab ? getLibraryTabKey(tab) : null;
}

function readLibraryTabsSnapshot(): { hasSnapshot: boolean; snapshot: LibraryTabsSnapshot } {
    try {
        const stored = localStorage.getItem(LIBRARY_TABS_STORAGE_KEY);
        if (stored === null) {
            return {
                hasSnapshot: false,
                snapshot: {
                    openTabs: [],
                    activeTabKey: null,
                },
            };
        }
        const parsed = JSON.parse(stored);
        if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
            return {
                hasSnapshot: false,
                snapshot: {
                    openTabs: [],
                    activeTabKey: null,
                },
            };
        }
        const rawOpenTabs = Object.prototype.hasOwnProperty.call(parsed, 'openTabs')
            ? (parsed as any).openTabs
            : (parsed as any).tabs;
        const openTabs = normalizeLibraryTabList(rawOpenTabs);
        const activeTabKey = normalizeLibraryActiveTabKey((parsed as any).activeTabKey);
        return {
            hasSnapshot: true,
            snapshot: {
                openTabs,
                activeTabKey,
            },
        };
    } catch {
        return {
            hasSnapshot: false,
            snapshot: {
                openTabs: [],
                activeTabKey: null,
            },
        };
    }
}

function writeLibraryTabsSnapshot(snapshot: LibraryTabsSnapshot): void {
    const openTabs = normalizeLibraryTabList(snapshot.openTabs);
    const openTabKeys = new Set(openTabs.map((tab) => getLibraryTabKey(tab)));
    const activeTabKey = normalizeLibraryActiveTabKey(snapshot.activeTabKey);
    const payload: LibraryTabsSnapshot = {
        openTabs,
        activeTabKey: activeTabKey && openTabKeys.has(activeTabKey) ? activeTabKey : null,
    };
    localStorage.setItem(LIBRARY_TABS_STORAGE_KEY, JSON.stringify(payload));
}

function normalizeNoteSourceRecordingIds(ids: unknown): string[] {
    const source = Array.isArray(ids) ? ids : [];
    const seen = new Set<string>();
    const normalized: string[] = [];
    source.forEach((rawId) => {
        const cleanId = String(rawId || '').trim();
        if (!cleanId || seen.has(cleanId)) return;
        seen.add(cleanId);
        normalized.push(cleanId);
    });
    return normalized;
}

function normalizeDashboardNote(note: Partial<Note> = {}): Note {
    const createdAtRaw = Number(note.createdAt || note.lastModified || Date.now());
    const createdAt = Number.isFinite(createdAtRaw) ? createdAtRaw : Date.now();
    const lastModifiedRaw = Number(note.lastModified || createdAt || Date.now());
    const lastModified = Number.isFinite(lastModifiedRaw) ? lastModifiedRaw : createdAt;
    return {
        id: typeof note.id === 'string' && note.id ? note.id : crypto.randomUUID(),
        title: typeof note.title === 'string' ? note.title : '',
        text: typeof note.text === 'string' ? note.text : '',
        isCloudSynced: typeof note.isCloudSynced === 'boolean' ? note.isCloudSynced : true,
        colorId: typeof note.colorId === 'string' ? note.colorId : 'yellow',
        folderId: typeof note.folderId === 'string' ? note.folderId : '',
        createdAt,
        lastModified,
        sourceRecordingIds: normalizeNoteSourceRecordingIds((note as any).sourceRecordingIds || []),
    };
}

function areNotesEquivalentForEdit(a: Partial<Note>, b: Partial<Note>): boolean {
    const leftSources = normalizeNoteSourceRecordingIds((a as any).sourceRecordingIds || []);
    const rightSources = normalizeNoteSourceRecordingIds((b as any).sourceRecordingIds || []);
    if (leftSources.length !== rightSources.length) return false;
    for (let index = 0; index < leftSources.length; index += 1) {
        if (leftSources[index] !== rightSources[index]) return false;
    }
    return (
        String(a.title || '') === String(b.title || '')
        && String(a.text || '') === String(b.text || '')
        && Boolean(a.isCloudSynced !== false) === Boolean(b.isCloudSynced !== false)
        && String(a.colorId || 'yellow') === String(b.colorId || 'yellow')
        && String(a.folderId || '') === String(b.folderId || '')
    );
}

function getNotePreviewText(note: Note): string {
    return String(note.text || '').replace(/\s+/g, ' ').trim() || 'Empty note.';
}

function normalizeSidebarPinnedItems(items: unknown): SidebarPinnedItem[] {
    const source = Array.isArray(items) ? items : [];
    const seen = new Set<string>();
    const normalized: SidebarPinnedItem[] = [];
    source.forEach((entry) => {
        const type = String((entry as any)?.type || '').trim();
        const id = String((entry as any)?.id || '').trim();
        if (!['note', 'recording', 'chat'].includes(type) || !id) return;
        const key = `${type}:${id}`;
        if (seen.has(key)) return;
        seen.add(key);
        normalized.push({ type: type as SidebarPinnedItem['type'], id });
    });
    return normalized;
}

type LibraryDateGroupKey = 'today' | 'pastWeek' | 'pastFourWeeks' | 'older';

const LIBRARY_DATE_GROUPS: Array<{ key: LibraryDateGroupKey; label: string }> = [
    { key: 'today', label: 'Today' },
    { key: 'pastWeek', label: 'Past week' },
    { key: 'pastFourWeeks', label: 'Past 4 weeks' },
    { key: 'older', label: 'Older' },
];

function getLibraryDateGroup(timestamp: number, now = Date.now()): LibraryDateGroupKey {
    const value = Number(timestamp || 0);
    const itemDate = new Date(Number.isFinite(value) ? value : 0);
    const today = new Date(now);
    const startOfToday = new Date(today.getFullYear(), today.getMonth(), today.getDate()).getTime();
    const startOfPastWeek = startOfToday - (7 * 24 * 60 * 60 * 1000);
    const startOfPastFourWeeks = startOfToday - (28 * 24 * 60 * 60 * 1000);
    const itemTime = itemDate.getTime();
    if (itemTime >= startOfToday) return 'today';
    if (itemTime >= startOfPastWeek) return 'pastWeek';
    if (itemTime >= startOfPastFourWeeks) return 'pastFourWeeks';
    return 'older';
}

function detectLikelyTranscriptIssue(transcript: string): string | null {
    const clean = String(transcript || '').trim();
    if (!clean) return null;

    const normalized = clean
        .toLowerCase()
        .replace(/[^a-z0-9\s]/g, ' ')
        .replace(/\s+/g, ' ')
        .trim();
    if (!normalized) return null;

    const tokens = normalized.split(' ').filter(Boolean);
    if (!tokens.length) return null;

    const shortPhrase = tokens.join(' ');
    if (tokens.length <= 3 && (shortPhrase === 'thank you' || shortPhrase === 'thanks for watching')) {
        return 'very short generic phrase';
    }

    const counts = new Map<string, number>();
    tokens.forEach((token) => {
        counts.set(token, (counts.get(token) || 0) + 1);
    });
    const mostFrequent = Math.max(...Array.from(counts.values()));
    if (tokens.length >= 8 && mostFrequent / tokens.length >= 0.75) {
        return 'high repeated-word ratio';
    }

    if (tokens.length >= 5 && counts.size <= 2) {
        return 'single word/phrase repetition';
    }

    if (tokens.length >= 4 && tokens.every((token) => token === 'ding')) {
        return 'repeated "ding" output';
    }

    for (let chunkSize = 1; chunkSize <= 3; chunkSize += 1) {
        if (tokens.length < chunkSize * 3) continue;
        const firstChunk = tokens.slice(0, chunkSize).join(' ');
        let repeats = 0;
        let index = 0;
        while (index + chunkSize <= tokens.length) {
            const chunk = tokens.slice(index, index + chunkSize).join(' ');
            if (chunk !== firstChunk) break;
            repeats += 1;
            index += chunkSize;
        }
        if (repeats >= 3) {
            return 'looped phrase repetition';
        }
    }

    return null;
}

function normalizeSyncConflict(conflict: any): SyncConflict | null {
    const entityType = String(conflict?.entityType || '').trim().toLowerCase();
    const entityId = String(conflict?.entityId || '').trim();
    if (!entityId || !['folders', 'recordings', 'notes', 'transcripts', 'chats'].includes(entityType)) {
        return null;
    }
    return {
        entityType: entityType as SyncConflict['entityType'],
        entityId,
        clientPayload: conflict?.clientPayload && typeof conflict.clientPayload === 'object' ? conflict.clientPayload : {},
        serverPayload: conflict?.serverPayload && typeof conflict.serverPayload === 'object' ? conflict.serverPayload : {},
        createdAt: Number(conflict?.createdAt || Date.now()) || Date.now(),
    };
}

function getSyncConflictKey(conflict: Pick<SyncConflict, 'entityType' | 'entityId'>): string {
    return `${conflict.entityType}:${conflict.entityId}`;
}

export default function DashboardApp() {
    const [activeSection, setActiveSection] = useState<SectionId>('library');
    const [settings, setSettings] = useState<UiSettings>(DEFAULT_SETTINGS);
    const [authState, setAuthState] = useState<AuthState>(DEFAULT_AUTH_STATE);
    const [keyDrafts, setKeyDrafts] = useState<ApiKeyDrafts>(EMPTY_API_KEY_DRAFTS);
    const [isSavingKeys, setIsSavingKeys] = useState(false);
    const [isLoading, setIsLoading] = useState(true);
    const [sttPlan, setSttPlan] = useState<any>(null);
    const [llmPlan, setLlmPlan] = useState<any>(null);
    const [proKeyStatus, setProKeyStatus] = useState<string>('');
    const [apiKeySaveMessage, setApiKeySaveMessage] = useState<string>('');
    const [recordModeStatus, setRecordModeStatus] = useState<RecordModeStatus>('idle');
    const [recordModeError, setRecordModeError] = useState<string>('');
    const [, setRecordModeMeta] = useState<string>('');
    const [recordingNotices, setRecordingNotices] = useState<RecordingNotice[]>([]);
    const [recordingReviewNotices, setRecordingReviewNotices] = useState<RecordingReviewNotice[]>([]);
    const [syncToasts, setSyncToasts] = useState<SyncToast[]>([]);
    const [syncConflicts, setSyncConflicts] = useState<SyncConflict[]>([]);
    const [resolvingSyncConflictKeys, setResolvingSyncConflictKeys] = useState<string[]>([]);
    const [resolvedSyncConflictKeys, setResolvedSyncConflictKeys] = useState<string[]>([]);
    const [isRecordingCaptureSettingsOpen, setIsRecordingCaptureSettingsOpen] = useState(false);
    const [notesData, setNotesData] = useState<NotesData>({ folders: [], notes: [] });
    const [recordings, setRecordings] = useState<RecordingItem[]>([]);
    const [chatsData, setChatsData] = useState<{ chats: ChatSession[] }>({ chats: [] });
    const [, setActiveChatSessionId] = useState<string | null>(null);
    const [globalAskContextOptionIds, setGlobalAskContextOptionIds] = useState<string[]>([]);
    const [renamingChatId, setRenamingChatId] = useState<string | null>(null);
    const [chatRenameDraft, setChatRenameDraft] = useState('');
    const [hasLoadedNotesOnce, setHasLoadedNotesOnce] = useState(false);
    const [hasLoadedRecordingsOnce, setHasLoadedRecordingsOnce] = useState(false);
    const [hasLoadedChatsOnce, setHasLoadedChatsOnce] = useState(false);
    const [selectedRecordingId, setSelectedRecordingId] = useState<string | null>(null);
    const [activeSettingsTab, setActiveSettingsTab] = useState<SettingsTabKey>('general');
    const [shortcutsRuntime, setShortcutsRuntime] = useState<ShortcutsRuntimeStatus | null>(null);
    const [isShortcutsRuntimeLoading, setIsShortcutsRuntimeLoading] = useState(false);
    const [updateState, setUpdateState] = useState<AppUpdateState>(DEFAULT_UPDATE_STATE);
    const [isUpdateButtonBusy, setIsUpdateButtonBusy] = useState(false);
    const [selectedLibraryItem, setSelectedLibraryItem] = useState<{ type: 'note' | 'recording' | 'ask'; id: string } | null>(null);
    const [openLibraryTabs, setOpenLibraryTabs] = useState<LibraryTab[]>([]);
    const [draggedTabKey, setDraggedTabKey] = useState<string | null>(null);
    const [activeLibraryTabKey, setActiveLibraryTabKey] = useState<string | null>(null);
    const [hasInitializedLibraryTabs, setHasInitializedLibraryTabs] = useState(false);
    const [hasRestoredLibraryTabs, setHasRestoredLibraryTabs] = useState(false);
    const [isDashboardWindowFullScreen, setIsDashboardWindowFullScreen] = useState(false);
    const [topBarActiveCutout, setTopBarActiveCutout] = useState<{ left: number; right: number } | null>(null);
    const [liveSidebarWidth, setLiveSidebarWidth] = useState<number | null>(null);
    const [isSidebarResizing, setIsSidebarResizing] = useState(false);
    const [libraryFilter, setLibraryFilter] = useState<LibraryFilter>('all');
    const [librarySearch, setLibrarySearch] = useState('');
    const [isLibrarySearchOpen, setIsLibrarySearchOpen] = useState(false);
    const [openedSearchFromTabs, setOpenedSearchFromTabs] = useState(false);
    const [isSettingsModalOpen, setIsSettingsModalOpen] = useState(false);
    const [isProductTourOpen, setIsProductTourOpen] = useState(false);
    const [hasAutoStartedProductTour, setHasAutoStartedProductTour] = useState(false);
    const [renamingNoteId, setRenamingNoteId] = useState<string | null>(null);
    const [noteRenameDraft, setNoteRenameDraft] = useState('');
    const [renamingFolderId, setRenamingFolderId] = useState<string | null>(null);
    const [folderRenameDraft, setFolderRenameDraft] = useState('');
    const [renamingRecordingId, setRenamingRecordingId] = useState<string | null>(null);
    const [recordingRenameDraft, setRecordingRenameDraft] = useState('');
    const [sidebarMenuTarget, setSidebarMenuTarget] = useState<{ kind: 'note' | 'recording' | 'folder' | 'pinned' | 'chat' | 'recent'; id: string } | null>(null);
    const [, setNoteMenuFolderOptionsForId] = useState<string | null>(null);
    const [activeMoveToFolderTarget, setActiveMoveToFolderTarget] = useState<{ type: 'note' | 'recording' | 'chat'; id: string } | null>(null);
    const [folderSearchQuery, setFolderSearchQuery] = useState('');
    const [customizingFolder, setCustomizingFolder] = useState<Folder | null>(null);
    const [customizingFolderName, setCustomizingFolderName] = useState('');
    const [customizingFolderIconId, setCustomizingFolderIconId] = useState('folder');
    const [customizingFolderColorId, setCustomizingFolderColorId] = useState('gray');
    const [iconSearchQuery, setIconSearchQuery] = useState('');
    const [draggingPinnedItemKey, setDraggingPinnedItemKey] = useState<string | null>(null);
    const [draggingNoteId, setDraggingNoteId] = useState<string | null>(null);
    const [noteFolderDropTargetId, setNoteFolderDropTargetId] = useState<string | null>(null);
    const [noteRowDropTargetId, setNoteRowDropTargetId] = useState<string | null>(null);
    const [expandedFolderIds, setExpandedFolderIds] = useState<Set<string>>(() => {
        try {
            const stored = localStorage.getItem('escribolt_sidebar_expanded_folders');
            const parsed = stored ? JSON.parse(stored) : [];
            if (!Array.isArray(parsed)) return new Set();
            return new Set(
                parsed
                    .map((value) => String(value || '').trim())
                    .filter(Boolean),
            );
        } catch {
            return new Set();
        }
    });

    const [recordingDateFilterStart, setRecordingDateFilterStart] = useState('');
    const [recordingDateFilterEnd, setRecordingDateFilterEnd] = useState('');
    const [recordingTranscriptDraft, setRecordingTranscriptDraft] = useState('');
    const [recordingDetailTab, setRecordingDetailTab] = useState<'transcript' | 'summary'>('transcript');
    const [recordingDraftDirty, setRecordingDraftDirty] = useState(false);
    const [recordingActionError, setRecordingActionError] = useState('');
    const [noteActionError, setNoteActionError] = useState('');
    const [isSavingRecordingDraft, setIsSavingRecordingDraft] = useState(false);
    const [isDeletingRecording, setIsDeletingRecording] = useState(false);
    const [summarizingRecordingId, setSummarizingRecordingId] = useState<string | null>(null);
    const [globalAskMessages, setGlobalAskMessages] = useState<AskMessage[]>([]);
    const [globalAskDraft, setGlobalAskDraft] = useState('');
    const [globalAskLoading, setGlobalAskLoading] = useState(false);
    const [globalAskProgressSteps, setGlobalAskProgressSteps] = useState<ProgressStep[]>([]);

    const chatsDataRef = useRef(chatsData);
    useEffect(() => {
        chatsDataRef.current = chatsData;
    }, [chatsData]);

    const activeLibraryTabKeyRef = useRef(activeLibraryTabKey);
    useEffect(() => {
        activeLibraryTabKeyRef.current = activeLibraryTabKey;
    }, [activeLibraryTabKey]);

    const globalAskMessagesRef = useRef(globalAskMessages);
    useEffect(() => {
        globalAskMessagesRef.current = globalAskMessages;
    }, [globalAskMessages]);

    const isPersistingChatRef = useRef(false);

    const persistChatSessionFromMessages = useCallback((finalMessages: AskMessage[]) => {
        const currentTabKey = activeLibraryTabKeyRef.current || '';
        if (!currentTabKey.startsWith('ask:')) return;

        const chatId = currentTabKey.substring(4);
        if (chatId === 'global') {
            if (isPersistingChatRef.current) return;
            isPersistingChatRef.current = true;

            // Unsaved new chat session, generate UUID and save!
            const newChatId = crypto.randomUUID();
            const firstUserMsg = finalMessages.find(m => m.role === 'user');
            let title = 'New Chat';
            if (firstUserMsg?.content) {
                const cleanPrompt = firstUserMsg.content.trim().split('\n')[0].slice(0, 40);
                title = cleanPrompt || 'New Chat';
            }

            const now = Date.now();
            const initialSynced = notesData.isAuthenticated === true && settings.syncSettings?.strictPrivacyMode !== true;
            const newSession: ChatSession = {
                id: newChatId,
                title,
                messages: finalMessages,
                isCloudSynced: initialSynced,
                createdAt: now,
                updatedAt: now,
                contextOptionIds: globalAskContextOptionIds,
            };

            setChatsData((previous) => ({
                ...previous,
                chats: [...previous.chats, newSession],
            }));
            
            ipcRenderer.send('save-chat', newSession);

            if (firstUserMsg?.content) {
                ipcRenderer.invoke('chat:generate-title', { firstMessage: firstUserMsg.content })
                    .then((generatedTitle: any) => {
                        if (generatedTitle && generatedTitle.trim()) {
                            const trimmedTitle = generatedTitle.trim();
                            setChatsData((previous) => ({
                                ...previous,
                                chats: previous.chats.map((c) =>
                                    c.id === newChatId ? { ...c, title: trimmedTitle } : c
                                ),
                            }));
                            ipcRenderer.send('save-chat', {
                                ...newSession,
                                title: trimmedTitle,
                                updatedAt: Date.now(),
                            });
                        }
                    })
                    .catch((err: any) => {
                        console.error('Failed to generate chat title:', err);
                    });
            }

            // Replace "global" tab with the new persistent one in openLibraryTabs
            setOpenLibraryTabs((previous) => previous.map((tab) => {
                if (tab.type === 'ask' && tab.id === 'global') {
                    return { type: 'ask', id: newChatId };
                }
                return tab;
            }));
            setActiveLibraryTabKey(`ask:${newChatId}`);
            setActiveChatSessionId(newChatId);
        } else {
            // Existing chat session, update it
            const existingChat = chatsDataRef.current.chats.find(c => c.id === chatId);
            if (existingChat) {
                const updatedSession: ChatSession = {
                    ...existingChat,
                    messages: finalMessages,
                    updatedAt: Date.now(),
                    contextOptionIds: globalAskContextOptionIds,
                };

                setChatsData((previous) => ({
                    ...previous,
                    chats: previous.chats.map((c) => c.id === chatId ? updatedSession : c),
                }));

                ipcRenderer.send('save-chat', updatedSession);
            }
        }
    }, [notesData.isAuthenticated, settings.syncSettings?.strictPrivacyMode, globalAskContextOptionIds]);

    const persistChatSessionFromMessagesRef = useRef(persistChatSessionFromMessages);
    useEffect(() => {
        persistChatSessionFromMessagesRef.current = persistChatSessionFromMessages;
    }, [persistChatSessionFromMessages]);

    useEffect(() => {
        const handleChatProgress = (_event: any, payload: { step?: string; message?: string }) => {
            const step = String(payload?.step || '').trim();
            const message = String(payload?.message || '').trim();
            if (!step || !message) return;
            setGlobalAskProgressSteps((prev) => {
                const next = [...prev];
                const existingIndex = next.findIndex((entry) => entry.step === step);
                if (existingIndex >= 0) {
                    next[existingIndex] = { step, message };
                    return next;
                }
                next.push({ step, message });
                return next;
            });
        };

        const handleChatChunk = (_event: any, chunk: string) => {
            setGlobalAskMessages((prev) => {
                const updated = [...prev];
                const lastIdx = updated.length - 1;
                if (lastIdx >= 0 && updated[lastIdx].id === 'a-streaming') {
                    updated[lastIdx] = {
                        ...updated[lastIdx],
                        content: updated[lastIdx].content + chunk,
                    };
                    return updated;
                }
                return prev;
            });
        };

        const handleChatDone = () => {
            setGlobalAskMessages((prev) => {
                const updated = [...prev];
                const lastIdx = updated.length - 1;
                if (lastIdx >= 0 && updated[lastIdx].id === 'a-streaming') {
                    const finalMsg = {
                        ...updated[lastIdx],
                        id: `a-${Date.now()}`,
                    };
                    updated[lastIdx] = finalMsg;
                    setTimeout(() => {
                        persistChatSessionFromMessagesRef.current(updated);
                    }, 0);
                    return updated;
                }
                return prev;
            });
            setGlobalAskLoading(false);
        };

        const handleChatError = (_event: any, message: string) => {
            setGlobalAskMessages((prev) => {
                const updated = [...prev];
                const lastIdx = updated.length - 1;
                if (lastIdx >= 0 && updated[lastIdx].id === 'a-streaming') {
                    const finalMsg = {
                        ...updated[lastIdx],
                        id: `a-${Date.now()}`,
                        content: updated[lastIdx].content + `\n\n**Error:** ${message}`,
                    };
                    updated[lastIdx] = finalMsg;
                    setTimeout(() => {
                        persistChatSessionFromMessagesRef.current(updated);
                    }, 0);
                    return updated;
                }
                return prev;
            });
            setGlobalAskLoading(false);
        };

        ipcRenderer.on('chat:progress', handleChatProgress);
        ipcRenderer.on('chat:chunk', handleChatChunk);
        ipcRenderer.on('chat:done', handleChatDone);
        ipcRenderer.on('chat:error', handleChatError);

        return () => {
            ipcRenderer.removeListener('chat:progress', handleChatProgress);
            ipcRenderer.removeListener('chat:chunk', handleChatChunk);
            ipcRenderer.removeListener('chat:done', handleChatDone);
            ipcRenderer.removeListener('chat:error', handleChatError);
        };
    }, []);

    const resolveCitationTitle = useCallback((kind: 'note' | 'recording', uuid: string): string | null => {
        if (kind === 'note') {
            const note = notesData.notes.find((n) => n.id === uuid);
            if (!note) return null;
            return (note as any).title || 'Untitled Note';
        }
        const rec = recordings.find((r) => r.id === uuid);
        if (!rec) return null;
        return (rec as any).title || 'Untitled Recording';
    }, [notesData.notes, recordings]);



    const [proModelOptions, setProModelOptions] = useState<ProModelOption[]>([]);
    const [globalAskModelOptionId, setGlobalAskModelOptionId] = useState(GLOBAL_ASK_DEFAULT_MODEL_OPTION_ID);
    const [recordingDeleteTarget, setRecordingDeleteTarget] = useState<{ id: string; title: string } | null>(null);
    const [noteToSyncToCloud, setNoteToSyncToCloud] = useState<Note | null>(null);
    const [recordingToSyncToCloud, setRecordingToSyncToCloud] = useState<{ id: string; title: string } | null>(null);
    const [isSelectedNoteMenuOpen, setIsSelectedNoteMenuOpen] = useState(false);
    const [isSelectedChatMenuOpen, setIsSelectedChatMenuOpen] = useState(false);
    const [isSelectedRecordingMenuOpen, setIsSelectedRecordingMenuOpen] = useState(false);
    const [activeHeaderSpaceSwitcherFolderId, setActiveHeaderSpaceSwitcherFolderId] = useState<string | null>(null);
    const [headerSpaceHoverPath, setHeaderSpaceHoverPath] = useState<string[]>([]);
    const [headerSpacePanelAnchorsByFolderId, setHeaderSpacePanelAnchorsByFolderId] = useState<Record<string, { left: number; top: number }>>({});
    const [isNoteTitleRenamePopupOpen, setIsNoteTitleRenamePopupOpen] = useState(false);
    const [noteTitleRenameDraft, setNoteTitleRenameDraft] = useState('');
    const [isChatTitleRenamePopupOpen, setIsChatTitleRenamePopupOpen] = useState(false);
    const [chatTitleRenameTargetId, setChatTitleRenameTargetId] = useState<string | null>(null);
    const [chatTitleRenameDraft, setChatTitleRenameDraft] = useState('');
    const [isRecordingTitleRenamePopupOpen, setIsRecordingTitleRenamePopupOpen] = useState(false);
    const [recordingTitleRenameDraft, setRecordingTitleRenameDraft] = useState('');
    const [streamingSummaryText, setStreamingSummaryText] = useState('');
    const streamingSummaryBufferRef = useRef('');
    const streamingSummaryFrameRef = useRef<number | null>(null);
    const skipNoteRenameBlurRef = useRef(false);
    const skipFolderRenameBlurRef = useRef(false);
    const skipRecordingRenameBlurRef = useRef(false);
    const topBarRef = useRef<HTMLDivElement | null>(null);
    const selectedNoteTitleInputRef = useRef<HTMLInputElement | null>(null);
    const selectedNoteMenuRef = useRef<HTMLDivElement | null>(null);
    const selectedChatMenuRef = useRef<HTMLDivElement | null>(null);
    const selectedRecordingMenuRef = useRef<HTMLDivElement | null>(null);
    const headerSpaceCloseTimerRef = useRef<number | null>(null);
    const tabStripViewportRef = useRef<HTMLDivElement | null>(null);
    const activeLibraryTabRef = useRef<HTMLDivElement | null>(null);
    const librarySearchPopoverRef = useRef<HTMLDivElement | null>(null);
    const sidebarItemMenuRef = useRef<HTMLDivElement | null>(null);
    const moveToFolderPopoverRef = useRef<HTMLDivElement | null>(null);
    const productTourCreatedNoteIdRef = useRef<string | null>(null);
    const closedLibraryTabsRef = useRef<LibraryTab[]>([]);
    const recordingTranscriptTextareaRef = useRef<HTMLTextAreaElement | null>(null);
    const recordModeSessionIdRef = useRef<string | null>(null);
    const recordModeStreamRef = useRef<MediaStream | null>(null);
    const recordModeRecorderRef = useRef<MediaRecorder | null>(null);
    const recordModeCaptureEngineRef = useRef<RecordModeCaptureEngine | null>(null);
    const recordModeStopRequestedRef = useRef(false);
    const loopbackUnsupportedRef = useRef(false);
    const loopbackUnsupportedReasonRef = useRef<string>('');
    const startRecordModeCaptureRef = useRef<(options?: { preapproved?: boolean }) => void>(() => undefined);
    const stopRecordModeCaptureRef = useRef<() => void>(() => undefined);
    const recordingDraftTargetIdRef = useRef<string | null>(null);
    const recordModeMeterContextRef = useRef<AudioContext | null>(null);
    const recordModeMeterSourceRef = useRef<MediaStreamAudioSourceNode | null>(null);
    const recordModeMeterAnalyserRef = useRef<AnalyserNode | null>(null);
    const recordModeMeterRafRef = useRef<number | null>(null);
    const recordingCaptureSettingsRef = useRef<HTMLDivElement | null>(null);
    const isInitialRecordingsFiredRef = useRef(false);
    const lastSeenIdsRef = useRef<Set<string>>(new Set());
    const sessionStartTimeRef = useRef<number>(Date.now());

    const cancelStreamingSummaryFrame = useCallback(() => {
        if (streamingSummaryFrameRef.current === null) return;
        window.cancelAnimationFrame(streamingSummaryFrameRef.current);
        streamingSummaryFrameRef.current = null;
    }, []);

    const flushStreamingSummaryBuffer = useCallback(() => {
        streamingSummaryFrameRef.current = null;
        const bufferedText = streamingSummaryBufferRef.current;
        if (!bufferedText) return;
        streamingSummaryBufferRef.current = '';
        setStreamingSummaryText((prev) => prev + bufferedText);
    }, []);

    const scheduleStreamingSummaryFlush = useCallback(() => {
        if (streamingSummaryFrameRef.current !== null) return;
        streamingSummaryFrameRef.current = window.requestAnimationFrame(flushStreamingSummaryBuffer);
    }, [flushStreamingSummaryBuffer]);

    const resetStreamingSummaryPreview = useCallback(() => {
        cancelStreamingSummaryFrame();
        streamingSummaryBufferRef.current = '';
        setStreamingSummaryText('');
    }, [cancelStreamingSummaryFrame]);

    const [unreadRecordingIds, setUnreadRecordingIds] = useState<Set<string>>(() => {
        try {
            const stored = localStorage.getItem('escribolt_unread_recordings');
            return stored ? new Set(JSON.parse(stored)) : new Set();
        } catch {
            return new Set();
        }
    });

    useEffect(() => {
        localStorage.setItem('escribolt_unread_recordings', JSON.stringify(Array.from(unreadRecordingIds)));
    }, [unreadRecordingIds]);

    const showAiEngineInSettings = true;
    const settingsTabItems = useMemo<SettingsTabMeta[]>(() => {
        const tabs: SettingsTabMeta[] = [
            {
                key: 'general',
                label: 'General',
                icon: Settings,
                visible: true,
            },
            {
                key: 'account',
                label: 'Account & Plan',
                icon: User,
                visible: true,
            },
            {
                key: 'storageSync',
                label: 'Storage & Sync',
                icon: Cloud,
                visible: true,
            },
            {
                key: 'dictation',
                label: 'Dictation',
                icon: Ear,
                visible: true,
            },
            {
                key: 'quickNotes',
                label: 'Quick Notes',
                icon: FileText,
                visible: true,
            },
            {
                key: 'recordings',
                label: 'Recordings',
                icon: Mic,
                visible: true,
            },
            {
                key: 'chats',
                label: 'Chats',
                icon: MessageCircle,
                visible: true,
            },
            {
                key: 'ai',
                label: 'AI Engine',
                icon: KeyRound,
                visible: showAiEngineInSettings,
            },
            {
                key: 'shortcuts',
                label: 'Shortcuts',
                icon: Keyboard,
                visible: true,
                isolated: true,
            },
        ];
        return tabs.filter((tab) => tab.visible);
    }, [showAiEngineInSettings]);
    useEffect(() => {
        if (!showAiEngineInSettings && activeSettingsTab === 'ai') {
            setActiveSettingsTab('general');
        }
    }, [showAiEngineInSettings, activeSettingsTab]);

    useEffect(() => {
        if (activeSection === 'ai' || activeSection === 'general' || activeSection === 'settings' || activeSection === 'account') {
            if (activeSection === 'ai' && showAiEngineInSettings) {
                setActiveSettingsTab('ai');
            } else if (activeSection === 'general') {
                setActiveSettingsTab('general');
            } else if (activeSection === 'account') {
                setActiveSettingsTab('account');
            }
            setIsSettingsModalOpen(true);
            setActiveSection('library');
            return;
        }
        if (activeSection === 'notes' || activeSection === 'recordings') {
            setActiveSection('library');
            setLibraryFilter(activeSection === 'notes' ? 'notes' : 'recordings');
        }
    }, [activeSection, showAiEngineInSettings]);

    useEffect(() => {
        let mounted = true;

        ipcRenderer.invoke('dashboard:get-window-state')
            .then((result: any) => {
                if (!mounted) return;
                setIsDashboardWindowFullScreen(result?.isFullScreen === true);
            })
            .catch(() => {
                if (!mounted) return;
                setIsDashboardWindowFullScreen(false);
            });

        const handleWindowState = (_event: any, payload: any = {}) => {
            setIsDashboardWindowFullScreen(payload?.isFullScreen === true);
        };

        ipcRenderer.on('dashboard:window-state', handleWindowState);
        return () => {
            mounted = false;
            ipcRenderer.removeListener('dashboard:window-state', handleWindowState);
        };
    }, []);

    useEffect(() => {
        const topBar = topBarRef.current;
        if (!topBar) return;

        const viewport = tabStripViewportRef.current;
        let rafId: number | null = null;

        const updateCutout = () => {
            const run = () => {
                const topNode = topBarRef.current;
                const activeNode = activeLibraryTabRef.current;
                if (!topNode || !activeNode || activeSection !== 'library') {
                    setTopBarActiveCutout(null);
                    return;
                }

                const topRect = topNode.getBoundingClientRect();
                const activeRect = activeNode.getBoundingClientRect();
                // Keep 1px on each side so the topbar separator visually connects with
                // the active tab's left/right outline as one continuous line.
                const nextLeft = Math.max(0, Math.floor(activeRect.left - topRect.left + 1));
                const nextRight = Math.min(Math.ceil(topRect.width), Math.max(0, Math.ceil(activeRect.right - topRect.left - 1)));

                if (!Number.isFinite(nextLeft) || !Number.isFinite(nextRight) || nextRight <= nextLeft) {
                    setTopBarActiveCutout(null);
                    return;
                }

                setTopBarActiveCutout((previous) => {
                    if (previous && previous.left === nextLeft && previous.right === nextRight) {
                        return previous;
                    }
                    return { left: nextLeft, right: nextRight };
                });
            };

            if (typeof requestAnimationFrame === 'function') {
                if (rafId !== null) cancelAnimationFrame(rafId);
                rafId = requestAnimationFrame(run);
                return;
            }
            run();
        };

        updateCutout();

        const handleScroll = () => updateCutout();
        const handleResize = () => updateCutout();

        viewport?.addEventListener('scroll', handleScroll, { passive: true });
        window.addEventListener('resize', handleResize);

        let resizeObserver: ResizeObserver | null = null;
        if (typeof ResizeObserver !== 'undefined') {
            resizeObserver = new ResizeObserver(() => updateCutout());
            resizeObserver.observe(topBar);
            if (viewport) resizeObserver.observe(viewport);
        }

        return () => {
            if (rafId !== null) cancelAnimationFrame(rafId);
            viewport?.removeEventListener('scroll', handleScroll);
            window.removeEventListener('resize', handleResize);
            resizeObserver?.disconnect();
        };
    }, [activeLibraryTabKey, activeSection, openLibraryTabs.length]);

    const stopTrackIfLive = useCallback((track: MediaStreamTrack) => {
        try {
            if (track.readyState === 'live') {
                track.stop();
            }
        } catch (_error) {
            // No-op: media tracks can race to ended during failure cleanup.
        }
    }, []);

    const pushRecordingNotice = useCallback((level: RecordingNoticeLevel, message: string) => {
        const cleanMessage = String(message || '').trim();
        if (!cleanMessage) return;

        setRecordingNotices((previous) => {
            const existing = previous.find((notice) => notice.level === level && notice.message === cleanMessage);
            const nextNotice: RecordingNotice = existing || {
                id: `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
                level,
                message: cleanMessage,
                createdAt: Date.now(),
            };
            const withoutExisting = existing
                ? previous.filter((notice) => notice.id !== existing.id)
                : previous;
            return [{ ...nextNotice, createdAt: Date.now() }, ...withoutExisting].slice(0, 6);
        });
    }, []);

    const pushSyncToast = useCallback((payload: any) => {
        const cleanMessage = String(payload?.message || '').trim();
        if (!cleanMessage) return;
        const code = String(payload?.code || 'SYNC_FAILED').trim() || 'SYNC_FAILED';
        const level: SyncToast['level'] = String(payload?.level || '').toLowerCase() === 'error' ? 'error' : 'warning';
        setSyncToasts((previous) => {
            const existing = previous.find((toast) => toast.code === code && toast.message === cleanMessage);
            const nextToast: SyncToast = existing || {
                id: `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
                level,
                code,
                message: cleanMessage,
                createdAt: Date.now(),
            };
            const withoutExisting = existing
                ? previous.filter((toast) => toast.id !== existing.id)
                : previous;
            return [{ ...nextToast, level, createdAt: Date.now() }, ...withoutExisting].slice(0, 4);
        });
    }, []);

    const dismissSyncToast = useCallback((toastId: string) => {
        setSyncToasts((previous) => previous.filter((toast) => toast.id !== toastId));
    }, []);

    const dismissRecordingNotice = useCallback((notice: RecordingNotice) => {
        setRecordingNotices((previous) => previous.filter((item) => item.id !== notice.id));
        if (notice.message === recordModeError) {
            setRecordModeError('');
        }
    }, [recordModeError]);

    const retryCloudSync = useCallback(() => {
        void ipcRenderer.invoke('sync:run-now');
    }, []);

    const openSignInForSync = useCallback(() => {
        ipcRenderer.send('open-login-flow');
    }, []);

    const pushRecordingReviewNotice = useCallback((recordingId: string, message: string) => {
        const cleanRecordingId = String(recordingId || '').trim();
        const cleanMessage = String(message || '').trim();
        if (!cleanRecordingId || !cleanMessage) return;

        setRecordingReviewNotices((previous) => {
            const existing = previous.find((notice) => (
                notice.recordingId === cleanRecordingId && notice.message === cleanMessage
            ));
            const nextNotice: RecordingReviewNotice = existing || {
                id: `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
                recordingId: cleanRecordingId,
                message: cleanMessage,
                createdAt: Date.now(),
            };
            const withoutExisting = existing
                ? previous.filter((notice) => notice.id !== existing.id)
                : previous;
            return [{ ...nextNotice, createdAt: Date.now() }, ...withoutExisting];
        });
    }, []);

    const setRecordModeErrorWithNotice = useCallback((message: string) => {
        const cleanMessage = String(message || '').trim() || 'Record mode processing failed';
        setRecordModeError(cleanMessage);
        pushRecordingNotice('error', cleanMessage);
    }, [pushRecordingNotice]);

    useEffect(() => {
        let mounted = true;
        Promise.all([
            ipcRenderer.invoke('get-ui-settings'),
            ipcRenderer.invoke('get-auth-state'),
            ipcRenderer.invoke('pro:get-model-options').catch(() => null),
            ipcRenderer.invoke('shortcuts:get-runtime').catch(() => ({ status: 'error', message: 'Failed to load shortcuts runtime.' })),
            ipcRenderer.invoke('updates:get-state').catch(() => DEFAULT_UPDATE_STATE),
        ]).then(([loadedSettings, loadedAuth, proModelsResult, shortcutsRuntimeResult, loadedUpdateState]) => {
            if (!mounted) return;
            const merged = normalizeSettings(loadedSettings as UiSettings);
            setSettings(merged);
            setAuthState({ ...DEFAULT_AUTH_STATE, ...(loadedAuth as Partial<AuthState>) });
            setUpdateState(normalizeUpdateState(loadedUpdateState));
            setShortcutsRuntime((shortcutsRuntimeResult && typeof shortcutsRuntimeResult === 'object')
                ? (shortcutsRuntimeResult as ShortcutsRuntimeStatus)
                : { status: 'error', message: 'Invalid shortcuts runtime response.' });
            const fallbackAlias = String(
                (loadedSettings as any)?.aiEngine?.llmModel
                || (loadedSettings as any)?.aiEngine?.summaryModel
                || '',
            ).trim();
            const runtimeModelOptions = normalizeProModelOptions(
                proModelsResult && proModelsResult.status === 'success'
                    ? proModelsResult.models
                    : [],
                fallbackAlias,
            );
            setProModelOptions(runtimeModelOptions);
            setIsLoading(false);
        });

        const handleExternalSettingsUpdate = (_event: any, latest: UiSettings) => {
            if (!mounted) return;
            setSettings(normalizeSettings(latest));
            ipcRenderer.invoke('shortcuts:get-runtime')
                .then((runtime: any) => {
                    if (!mounted) return;
                    if (runtime && typeof runtime === 'object') {
                        setShortcutsRuntime(runtime as ShortcutsRuntimeStatus);
                    }
                })
                .catch(() => undefined);
        };
        ipcRenderer.on('ui-settings-updated', handleExternalSettingsUpdate);

        const handleAuthStateUpdate = (_event: any, latest: AuthState) => {
            if (!mounted) return;
            setAuthState({ ...DEFAULT_AUTH_STATE, ...(latest || {}) });
            setProKeyStatus('');
        };
        ipcRenderer.on('auth-state-updated', handleAuthStateUpdate);

        const handleUpdateState = (_event: any, latest: AppUpdateState) => {
            if (!mounted) return;
            setUpdateState(normalizeUpdateState(latest));
            setIsUpdateButtonBusy(false);
        };
        ipcRenderer.on('updates:state', handleUpdateState);

        const handleLocalSttStatusChanged = (_event: any, payload: any = {}) => {
            if (!mounted || !payload?.localSpeech) return;
            setShortcutsRuntime((previous) => previous
                ? {
                    ...previous,
                    localSpeech: {
                        ...(previous.localSpeech || {}),
                        ...payload.localSpeech,
                    },
                }
                : previous);
        };
        ipcRenderer.on('runtime:local-stt-status-changed', handleLocalSttStatusChanged);

        return () => {
            mounted = false;
            ipcRenderer.removeListener('ui-settings-updated', handleExternalSettingsUpdate);
            ipcRenderer.removeListener('auth-state-updated', handleAuthStateUpdate);
            ipcRenderer.removeListener('updates:state', handleUpdateState);
            ipcRenderer.removeListener('runtime:local-stt-status-changed', handleLocalSttStatusChanged);
        };
    }, []);

    useEffect(() => {
        if (settings.mode !== 'byok') {
            setKeyDrafts(EMPTY_API_KEY_DRAFTS);
        }
    }, [settings.mode]);

    useEffect(() => {
        if (isLoading) return;
        ipcRenderer.invoke('get-stt-routing-preview', {
            intent: 'transcription',
        }).then((plan: any) => {
            setSttPlan(plan);
        }).catch(() => {
            setSttPlan(null);
        });
        ipcRenderer.invoke('get-llm-routing-preview', {
            intent: 'recording-summary',
            providerOverride: settings.aiEngine.summaryProvider,
        }).then((plan: any) => {
            setLlmPlan(plan);
        }).catch(() => {
            setLlmPlan(null);
        });
    }, [
        isLoading,
        settings.aiEngine.sttProvider,
        settings.aiEngine.sttTranscriptionMode,
        settings.aiEngine.sttStreamingProfile,
        settings.aiEngine.sttNova3Language,
        settings.aiEngine.llmProvider,
        settings.aiEngine.summaryProvider,
        settings.aiEngine.llmModel,
        settings.aiEngine.summaryModel,
        settings.processingModes.dictation,
        settings.processingModes.meetingTranscription,
        settings.processingModes.aiActions,
        settings.processingModes.summaries,
    ]);

    useEffect(() => {
        ipcRenderer.send('record-widget:sync-status', { status: recordModeStatus });
    }, [recordModeStatus]);

    useEffect(() => () => {
        ipcRenderer.send('record-widget:sync-status', { status: 'idle' });
    }, []);

    useEffect(() => {
        const handleSummaryChunk = (_event: any, { chunk }: { chunk: string }) => {
            streamingSummaryBufferRef.current += chunk;
            scheduleStreamingSummaryFlush();
        };
        ipcRenderer.on('recordings:summary-chunk', handleSummaryChunk);
        return () => {
            ipcRenderer.removeListener('recordings:summary-chunk', handleSummaryChunk);
            cancelStreamingSummaryFrame();
            streamingSummaryBufferRef.current = '';
        };
    }, [cancelStreamingSummaryFrame, scheduleStreamingSummaryFlush]);



    useEffect(() => {
        const handleSyncStatus = (_event: any, payload: any) => {
            const message = String(payload?.message || '').trim();
            if (!message) return;
            pushSyncToast(payload);
        };

        ipcRenderer.on('sync:status', handleSyncStatus);
        return () => {
            ipcRenderer.removeListener('sync:status', handleSyncStatus);
        };
    }, [pushSyncToast]);

    useEffect(() => {
        const handleCloudTrialExhausted = (_event: any, payload: any) => {
            const message = String(payload?.message || '').trim() || 'Cloud Trial Exhausted. Switched to Local processing';
            pushRecordingNotice('warning', message);
        };

        ipcRenderer.on('cloud-trial-exhausted', handleCloudTrialExhausted);
        return () => {
            ipcRenderer.removeListener('cloud-trial-exhausted', handleCloudTrialExhausted);
        };
    }, [pushRecordingNotice]);

    useEffect(() => {
        let mounted = true;

        const loadSyncConflicts = async () => {
            try {
                const result = await ipcRenderer.invoke('sync:get-conflicts');
                if (!mounted || result?.status !== 'success') return;
                const normalized = (Array.isArray(result?.conflicts) ? result.conflicts : [])
                    .map((item: unknown) => normalizeSyncConflict(item))
                    .filter(Boolean) as SyncConflict[];
                setSyncConflicts(normalized);
            } catch (_error) {
                // No-op: conflicts are optional and can arrive via event stream.
            }
        };

        const handleSyncConflict = (_event: any, payload: any) => {
            const conflict = normalizeSyncConflict(payload);
            if (!conflict) return;
            setSyncConflicts((previous) => {
                const key = `${conflict.entityType}:${conflict.entityId}`;
                const withoutCurrent = previous.filter((item) => `${item.entityType}:${item.entityId}` !== key);
                return [conflict, ...withoutCurrent]
                    .sort((a, b) => Number(b.createdAt || 0) - Number(a.createdAt || 0))
                    .slice(0, 25);
            });
        };

        const handleSyncConflictsUpdated = (_event: any, payload: any) => {
            const normalized = (Array.isArray(payload) ? payload : [])
                .map((item: unknown) => normalizeSyncConflict(item))
                .filter(Boolean) as SyncConflict[];
            setSyncConflicts(normalized);
            const keys = new Set(normalized.map((item) => getSyncConflictKey(item)));
            setResolvedSyncConflictKeys((previous) => previous.filter((key) => keys.has(key)));
            setResolvingSyncConflictKeys((previous) => previous.filter((key) => keys.has(key)));
        };

        void loadSyncConflicts();
        ipcRenderer.on('sync:conflict', handleSyncConflict);
        ipcRenderer.on('sync:conflicts-updated', handleSyncConflictsUpdated);
        return () => {
            mounted = false;
            ipcRenderer.removeListener('sync:conflict', handleSyncConflict);
            ipcRenderer.removeListener('sync:conflicts-updated', handleSyncConflictsUpdated);
        };
    }, []);

    const applyRecordingsFromSource = useCallback((
        incoming: RecordingItem[],
        preferredId: string | null = null,
        isInitial: boolean = false,
    ) => {
        const normalized = (Array.isArray(incoming) ? incoming : [])
            .map((item) => ({
                ...item,
                route: item?.route || {},
                stats: item?.stats || {},
                isCloudSynced: typeof item?.isCloudSynced === 'boolean'
                    ? item.isCloudSynced
                    : (item?.route?.mode === 'local' ? false : true),
                syncStatus: typeof item?.syncStatus === 'string'
                    ? item.syncStatus
                    : (item?.isCloudSynced === false || item?.route?.mode === 'local' ? 'pending' : 'synced'),
            }))
            .sort((a, b) => Number(b.createdAt || 0) - Number(a.createdAt || 0));

        setRecordings((prevRecordings) => {
            const isFirstLoad = !isInitialRecordingsFiredRef.current || isInitial;

            if (!isFirstLoad) {
                const newIds = normalized
                    .filter((r) => {
                        const isNewId = !lastSeenIdsRef.current.has(r.id);
                        const isRecent = Number(r.createdAt || 0) > (sessionStartTimeRef.current - 30000);
                        return isNewId && isRecent;
                    })
                    .map((r) => r.id);

                if (newIds.length > 0) {
                    setUnreadRecordingIds((currentUnread) => {
                        const updated = new Set(currentUnread);
                        newIds.forEach((id) => updated.add(id));
                        return updated;
                    });
                }
            }

            lastSeenIdsRef.current = new Set(normalized.map((r) => r.id));

            if (isInitial || normalized.length > 0) {
                isInitialRecordingsFiredRef.current = true;
            }

            return normalized;
        });
        if (isInitial) {
            setHasLoadedRecordingsOnce(true);
        }
	        setSelectedRecordingId((previous) => {
	            if (preferredId && normalized.some((entry) => entry.id === preferredId)) {
	                setSelectedLibraryItem({ type: 'recording', id: preferredId });
	                return preferredId;
	            }
            if (previous && normalized.some((entry) => entry.id === previous)) {
                return previous;
            }
            return null;
        });
    }, []);

    const refreshRecordings = useCallback(async (preferredId: string | null = null) => {
        try {
            const result = await ipcRenderer.invoke('recordings:get-all');
            if (result?.status === 'success') {
                applyRecordingsFromSource(result.recordings || [], preferredId, true);
                return;
            }
            applyRecordingsFromSource([], null, true);
        } catch (_error) {
            applyRecordingsFromSource([], null, true);
        }
    }, [applyRecordingsFromSource]);

    const refreshNotesData = useCallback(async (preferredId: string | null = null) => {
        try {
            const latest = await ipcRenderer.invoke('get-notes-data');
	            const notes: Note[] = (Array.isArray(latest?.notes) ? latest.notes : []).map((note: Partial<Note>) => normalizeDashboardNote(note));
            setNotesData({
                folders: Array.isArray(latest?.folders) ? latest.folders : [],
                notes,
                isAuthenticated: latest?.isAuthenticated === true,
            });
            if (preferredId && notes.some((note) => note.id === preferredId)) {
                setSelectedLibraryItem({ type: 'note', id: preferredId });
            }
        } finally {
            setHasLoadedNotesOnce(true);
        }
    }, []);

    const refreshChatsData = useCallback(async () => {
        try {
            const latest = await ipcRenderer.invoke('get-chats-data');
            setChatsData(latest || { chats: [] });
        } catch (_error) {
            setChatsData({ chats: [] });
        } finally {
            setHasLoadedChatsOnce(true);
        }
    }, []);

    const refreshShortcutsRuntime = useCallback(async () => {
        setIsShortcutsRuntimeLoading(true);
        try {
            const result = await ipcRenderer.invoke('shortcuts:get-runtime');
            if (result && typeof result === 'object') {
                setShortcutsRuntime(result as ShortcutsRuntimeStatus);
            } else {
                setShortcutsRuntime({ status: 'error', message: 'Invalid shortcuts runtime response.' });
            }
        } catch (error: any) {
            setShortcutsRuntime({
                status: 'error',
                message: error?.message || 'Failed to load shortcuts runtime.',
            });
        } finally {
            setIsShortcutsRuntimeLoading(false);
        }
    }, []);

    useEffect(() => {
        if (isLoading) return () => undefined;

        void refreshRecordings();
        const handleRecordingsUpdated = (_event: any, latest: any) => {
            if (Array.isArray(latest)) {
                applyRecordingsFromSource(latest || [], null, false);
                return;
            }
            applyRecordingsFromSource(latest?.recordings || [], null, false);
        };
        ipcRenderer.on('recordings-updated', handleRecordingsUpdated);
        return () => {
            ipcRenderer.removeListener('recordings-updated', handleRecordingsUpdated);
        };
    }, [applyRecordingsFromSource, isLoading, refreshRecordings]);

    useEffect(() => {
        if (isLoading) return () => undefined;

        void refreshNotesData();
        const handleNotesUpdated = (_event: any, latest: NotesData) => {
            const notes = (Array.isArray(latest?.notes) ? latest.notes : []).map((note) => normalizeDashboardNote(note));
            setNotesData({
                folders: Array.isArray(latest?.folders) ? latest.folders : [],
                notes,
                isAuthenticated: latest?.isAuthenticated === true,
            });
            setHasLoadedNotesOnce(true);
        };
        ipcRenderer.on('notes-updated', handleNotesUpdated);
        return () => {
            ipcRenderer.removeListener('notes-updated', handleNotesUpdated);
        };
    }, [isLoading, refreshNotesData]);

    useEffect(() => {
        if (isLoading) return () => undefined;

        void refreshChatsData();
        const handleChatsUpdated = (_event: any, latest: { chats: ChatSession[] }) => {
            setChatsData(latest || { chats: [] });
        };
        ipcRenderer.on('chats-updated', handleChatsUpdated);
        return () => {
            ipcRenderer.removeListener('chats-updated', handleChatsUpdated);
        };
    }, [isLoading, refreshChatsData]);

    useEffect(() => {
        if (activeLibraryTabKey && activeLibraryTabKey.startsWith('ask:')) {
            const chatId = activeLibraryTabKey.substring(4);
            if (chatId === 'global') {
                setGlobalAskMessages([]);
                setGlobalAskDraft('');
                setGlobalAskProgressSteps([]);
                setGlobalAskLoading(false);
                setActiveChatSessionId(null);
                setGlobalAskContextOptionIds([]);
            } else {
                const chat = chatsData.chats.find((c) => c.id === chatId);
                if (chat) {
                    setGlobalAskMessages(chat.messages || []);
                    setGlobalAskProgressSteps([]);
                    setGlobalAskLoading(false);
                    setActiveChatSessionId(chat.id);
                    setGlobalAskContextOptionIds((chat as any).contextOptionIds || []);
                }
            }
        }
    }, [activeLibraryTabKey, chatsData.chats]);

    const updateSettings = useCallback(async (patch: Record<string, any>) => {
        const updated = await ipcRenderer.invoke('update-ui-settings', patch);
        setSettings(normalizeSettings(updated));
        await refreshShortcutsRuntime();
    }, [refreshShortcutsRuntime]);

    const updateLayoutSettings = useCallback((patch: NonNullable<UiSettings['layout']>) => {
        void updateSettings({ layout: patch });
    }, [updateSettings]);

    const startSidebarResize = useCallback((event: React.MouseEvent<HTMLDivElement>) => {
        if (settings.layout?.sidebarCollapsed === true) return;
        event.preventDefault();
        event.stopPropagation();

        const startX = event.clientX;
        const startWidth = clampSidebarWidth(Number(settings.layout?.sidebarWidth || SIDEBAR_WIDTH_DEFAULT));
        let finalWidth = startWidth;

        setLiveSidebarWidth(startWidth);
        setIsSidebarResizing(true);

        const handlePointerMove = (moveEvent: MouseEvent) => {
            const nextWidth = clampSidebarWidth(startWidth + (moveEvent.clientX - startX));
            finalWidth = nextWidth;
            setLiveSidebarWidth(nextWidth);
        };

        const handlePointerUp = () => {
            document.removeEventListener('mousemove', handlePointerMove);
            document.removeEventListener('mouseup', handlePointerUp);
            setIsSidebarResizing(false);
            setLiveSidebarWidth(null);
            updateLayoutSettings({ sidebarWidth: finalWidth });
        };

        document.addEventListener('mousemove', handlePointerMove);
        document.addEventListener('mouseup', handlePointerUp);
    }, [settings.layout?.sidebarCollapsed, settings.layout?.sidebarWidth, updateLayoutSettings]);

    useEffect(() => {
        if (!isSidebarResizing) return;
        const previousCursor = document.body.style.cursor;
        const previousUserSelect = document.body.style.userSelect;
        document.body.style.cursor = 'col-resize';
        document.body.style.userSelect = 'none';
        return () => {
            document.body.style.cursor = previousCursor;
            document.body.style.userSelect = previousUserSelect;
        };
    }, [isSidebarResizing]);

    useEffect(() => {
        if (!isLibrarySearchOpen || isProductTourOpen) return;
        const handlePointerDown = (event: MouseEvent) => {
            const target = event.target as Node | null;
            if (target && librarySearchPopoverRef.current?.contains(target)) {
                return;
            }
            setIsLibrarySearchOpen(false);
        };
        document.addEventListener('mousedown', handlePointerDown);
        return () => {
            document.removeEventListener('mousedown', handlePointerDown);
        };
    }, [isLibrarySearchOpen, isProductTourOpen]);

    useEffect(() => {
        if (!isLibrarySearchOpen) {
            setOpenedSearchFromTabs(false);
        }
    }, [isLibrarySearchOpen]);

    useEffect(() => {
        if (!sidebarMenuTarget) return;
        const handlePointerDown = (event: MouseEvent) => {
            const target = event.target as Node | null;
            if (target && sidebarItemMenuRef.current?.contains(target)) {
                return;
            }
            setSidebarMenuTarget(null);
            setNoteMenuFolderOptionsForId(null);
        };
        document.addEventListener('mousedown', handlePointerDown);
        return () => {
            document.removeEventListener('mousedown', handlePointerDown);
        };
    }, [sidebarMenuTarget]);

    useEffect(() => {
        if (!isSelectedNoteMenuOpen) return;
        const handlePointerDown = (event: MouseEvent) => {
            const target = event.target as Node | null;
            if (target && selectedNoteMenuRef.current?.contains(target)) {
                return;
            }
            setIsSelectedNoteMenuOpen(false);
        };
        const handleKeyDown = (event: KeyboardEvent) => {
            if (event.key === 'Escape') {
                setIsSelectedNoteMenuOpen(false);
            }
        };
        document.addEventListener('mousedown', handlePointerDown);
        document.addEventListener('keydown', handleKeyDown);
        return () => {
            document.removeEventListener('mousedown', handlePointerDown);
            document.removeEventListener('keydown', handleKeyDown);
        };
    }, [isSelectedNoteMenuOpen]);

    useEffect(() => {
        if (!isSelectedChatMenuOpen) return;
        const handlePointerDown = (event: MouseEvent) => {
            const target = event.target as Node | null;
            if (target && selectedChatMenuRef.current?.contains(target)) {
                return;
            }
            setIsSelectedChatMenuOpen(false);
        };
        const handleKeyDown = (event: KeyboardEvent) => {
            if (event.key === 'Escape') {
                setIsSelectedChatMenuOpen(false);
            }
        };
        document.addEventListener('mousedown', handlePointerDown);
        document.addEventListener('keydown', handleKeyDown);
        return () => {
            document.removeEventListener('mousedown', handlePointerDown);
            document.removeEventListener('keydown', handleKeyDown);
        };
    }, [isSelectedChatMenuOpen]);

    useEffect(() => {
        if (!isSelectedRecordingMenuOpen) return;
        const handlePointerDown = (event: MouseEvent) => {
            const target = event.target as Node | null;
            if (target && selectedRecordingMenuRef.current?.contains(target)) {
                return;
            }
            setIsSelectedRecordingMenuOpen(false);
        };
        const handleKeyDown = (event: KeyboardEvent) => {
            if (event.key === 'Escape') {
                setIsSelectedRecordingMenuOpen(false);
            }
        };
        document.addEventListener('mousedown', handlePointerDown);
        document.addEventListener('keydown', handleKeyDown);
        return () => {
            document.removeEventListener('mousedown', handlePointerDown);
            document.removeEventListener('keydown', handleKeyDown);
        };
    }, [isSelectedRecordingMenuOpen]);

    useEffect(() => {
        if (!activeHeaderSpaceSwitcherFolderId) return;
        const handleKeyDown = (event: KeyboardEvent) => {
            if (event.key === 'Escape') {
                setActiveHeaderSpaceSwitcherFolderId(null);
                setHeaderSpaceHoverPath([]);
                setHeaderSpacePanelAnchorsByFolderId({});
                if (headerSpaceCloseTimerRef.current !== null) {
                    window.clearTimeout(headerSpaceCloseTimerRef.current);
                    headerSpaceCloseTimerRef.current = null;
                }
            }
        };
        document.addEventListener('keydown', handleKeyDown);
        return () => {
            document.removeEventListener('keydown', handleKeyDown);
        };
    }, [activeHeaderSpaceSwitcherFolderId]);

    useEffect(() => {
        setIsSelectedNoteMenuOpen(false);
        setIsSelectedChatMenuOpen(false);
        setIsSelectedRecordingMenuOpen(false);
        setActiveHeaderSpaceSwitcherFolderId(null);
        setHeaderSpaceHoverPath([]);
        setHeaderSpacePanelAnchorsByFolderId({});
        if (headerSpaceCloseTimerRef.current !== null) {
            window.clearTimeout(headerSpaceCloseTimerRef.current);
            headerSpaceCloseTimerRef.current = null;
        }
        setIsNoteTitleRenamePopupOpen(false);
        setIsChatTitleRenamePopupOpen(false);
        setChatTitleRenameTargetId(null);
        setIsRecordingTitleRenamePopupOpen(false);
        setRecordingToSyncToCloud(null);
    }, [selectedLibraryItem?.id, selectedLibraryItem?.type, activeLibraryTabKey]);

    useEffect(() => {
        if (!activeMoveToFolderTarget) return;
        const handlePointerDown = (event: MouseEvent) => {
            const target = event.target as Node | null;
            if (target && moveToFolderPopoverRef.current?.contains(target)) {
                return;
            }
            setActiveMoveToFolderTarget(null);
            setFolderSearchQuery('');
        };
        const handleKeyDown = (event: KeyboardEvent) => {
            if (event.key !== 'Escape') return;
            setActiveMoveToFolderTarget(null);
            setFolderSearchQuery('');
        };
        document.addEventListener('mousedown', handlePointerDown);
        document.addEventListener('keydown', handleKeyDown);
        return () => {
            document.removeEventListener('mousedown', handlePointerDown);
            document.removeEventListener('keydown', handleKeyDown);
        };
    }, [activeMoveToFolderTarget]);

    useEffect(() => {
        if (!draggingNoteId) {
            setNoteFolderDropTargetId(null);
            setNoteRowDropTargetId(null);
        }
    }, [draggingNoteId]);

    useEffect(() => {
        localStorage.setItem('escribolt_sidebar_expanded_folders', JSON.stringify(Array.from(expandedFolderIds)));
    }, [expandedFolderIds]);

    const modeLabel = useMemo(() => {
        if (authState.isLoggedIn && authState.plan === 'pro') return 'Founder Active';
        if (authState.isLoggedIn && authState.plan === 'standard') return 'Pioneer Active';
        if (authState.isLoggedIn) return 'Free Trial';
        if (settings.mode === 'byok') return 'BYOK Mode';
        return 'Free / Local Mode';
    }, [authState.isLoggedIn, authState.plan, settings.mode]);

    const selectedRecording = useMemo(
        () => recordings.find((entry) => entry.id === selectedRecordingId) || null,
        [recordings, selectedRecordingId],
    );

    const selectedNote = useMemo(
        () => (selectedLibraryItem?.type === 'note'
            ? notesData.notes.find((entry) => entry.id === selectedLibraryItem.id) || null
            : null),
        [notesData.notes, selectedLibraryItem],
    );

    const linkedNoteForSelectedRecording = useMemo(
        () => (selectedRecording?.linkedNoteId
            ? notesData.notes.find((entry) => entry.id === selectedRecording.linkedNoteId) || null
            : null),
        [notesData.notes, selectedRecording],
    );

    const allLibraryItems = useMemo<BaseLibraryItem[]>(() => {
        const recordingItems: BaseLibraryItem[] = recordings.map((entry) => ({
            type: 'recording',
            id: entry.id,
            title: (entry.title || 'Untitled recording').trim() || 'Untitled recording',
            preview: getRecordingPreviewText(entry, ''),
            updatedAt: Number(entry.updatedAt || entry.createdAt || 0),
            createdAt: Number(entry.createdAt || entry.updatedAt || 0),
            isCloudSynced: entry.isCloudSynced !== false,
            durationMs: Number(entry.stats?.durationMs || 0),
            linkedNoteId: entry.linkedNoteId || null,
        }));
        const noteItems: BaseLibraryItem[] = notesData.notes.map((note) => ({
            type: 'note',
            id: note.id,
            title: (note.title || 'Untitled note').trim() || 'Untitled note',
            preview: getNotePreviewText(note),
            updatedAt: Number(note.lastModified || note.createdAt || 0),
            createdAt: Number(note.createdAt || note.lastModified || 0),
            isCloudSynced: note.isCloudSynced !== false,
            sourceRecordingIds: normalizeNoteSourceRecordingIds(note.sourceRecordingIds || []),
        }));
        return [...recordingItems, ...noteItems]
            .sort((a, b) => Number(b.updatedAt || b.createdAt || 0) - Number(a.updatedAt || a.createdAt || 0));
    }, [notesData.notes, recordings]);

    useEffect(() => {
        if (hasRestoredLibraryTabs) return;
        if (!hasLoadedNotesOnce || !hasLoadedRecordingsOnce || !hasLoadedChatsOnce) return;

        const { hasSnapshot, snapshot } = readLibraryTabsSnapshot();
        if (!hasSnapshot) {
            setHasRestoredLibraryTabs(true);
            return;
        }

        const validItemKeys = new Set(allLibraryItems.map((item) => getLibraryTabKey(item)));
        const restoredTabs = snapshot.openTabs.filter((tab) => {
            if (tab.type === 'ask') {
                if (tab.id === 'global') return true;
                return chatsData.chats.some((c) => c.id === tab.id);
            }
            return validItemKeys.has(getLibraryTabKey(tab));
        });
        const restoredTabKeySet = new Set(restoredTabs.map((tab) => getLibraryTabKey(tab)));
        const fallbackActiveKey = restoredTabs.length ? getLibraryTabKey(restoredTabs[0]) : null;
        const restoredActiveKey = snapshot.activeTabKey && restoredTabKeySet.has(snapshot.activeTabKey)
            ? snapshot.activeTabKey
            : fallbackActiveKey;

        setOpenLibraryTabs(restoredTabs);
        setActiveLibraryTabKey(restoredActiveKey);
        if (restoredActiveKey) {
            const activeTab = restoredTabs.find((tab) => getLibraryTabKey(tab) === restoredActiveKey) || null;
            if (activeTab) {
                setSelectedLibraryItem({ type: activeTab.type, id: activeTab.id });
                if (activeTab.type === 'recording') {
                    setSelectedRecordingId(activeTab.id);
                }
            }
        } else {
            setSelectedLibraryItem(null);
            setSelectedRecordingId(null);
        }
        setHasInitializedLibraryTabs(true);
        setHasRestoredLibraryTabs(true);
    }, [allLibraryItems, hasLoadedNotesOnce, hasLoadedRecordingsOnce, hasLoadedChatsOnce, hasRestoredLibraryTabs, chatsData.chats]);

    const libraryTabs = useMemo(() => {
        const itemMap = new Map(allLibraryItems.map((item) => [getLibraryTabKey(item), item]));
        return openLibraryTabs
            .map((tab) => {
                const key = getLibraryTabKey(tab);
                if (tab.type === 'ask') {
                    const chatSession = chatsData.chats.find((c) => c.id === tab.id);
                    const title = chatSession ? (chatSession.title || 'Untitled Chat') : 'Ask';
                    return {
                        key,
                        item: tab,
                        title,
                        type: tab.type,
                        isActive: activeLibraryTabKey === key,
                    };
                }
                const item = itemMap.get(key);
                if (!item) return null;
                return {
                    key,
                    item: tab,
                    title: item.title,
                    type: tab.type,
                    isActive: activeLibraryTabKey === key,
                };
            })
            .filter(Boolean) as Array<{
                key: string;
                item: LibraryTab;
                title: string;
                type: LibraryTab['type'];
                isActive: boolean;
            }>;
    }, [activeLibraryTabKey, allLibraryItems, openLibraryTabs, chatsData.chats]);

    const libraryTabUniformWidth = TAB_WIDTH_FIXED;

    const handleTabStripWheel = useCallback((event: React.WheelEvent<HTMLDivElement>) => {
        const viewport = tabStripViewportRef.current;
        if (!viewport) return;

        if (viewport.scrollWidth <= viewport.clientWidth + 1) return;

        // Keep native pixel-based trackpad gestures untouched for smooth finger sliding.
        if (event.deltaMode === 0) return;
        if (Math.abs(event.deltaX) > 0) return;
        if (!event.deltaY) return;

        const step = event.deltaMode === 2
            ? viewport.clientWidth * 0.85
            : 18;

        event.preventDefault();
        viewport.scrollLeft += event.deltaY * step;
    }, []);

    useEffect(() => {
        const viewport = tabStripViewportRef.current;
        const activeTab = activeLibraryTabRef.current;
        if (!viewport || !activeTab || activeSection !== 'library') return;

        const viewportLeft = viewport.scrollLeft;
        const viewportRight = viewportLeft + viewport.clientWidth;
        const tabLeft = activeTab.offsetLeft;
        const tabRight = tabLeft + activeTab.offsetWidth;
        if (tabLeft >= viewportLeft && tabRight <= viewportRight) return;

        activeTab.scrollIntoView({
            behavior: 'smooth',
            block: 'nearest',
            inline: 'nearest',
        });
    }, [activeLibraryTabKey, activeSection, libraryTabs.length]);

    const filteredLibraryItems = useMemo<LibraryItem[]>(() => {
        const query = librarySearch.trim().toLowerCase();
        const dateMatchStart = recordingDateFilterStart.match(/^(\d{4})-(\d{2})-(\d{2})$/);
        const dateMatchEnd = recordingDateFilterEnd.match(/^(\d{4})-(\d{2})-(\d{2})$/);
        let startMs = 0;
        let endMs = 0;
        if (dateMatchStart) {
            const year = Number(dateMatchStart[1]);
            const monthIndex = Number(dateMatchStart[2]) - 1;
            const day = Number(dateMatchStart[3]);
            startMs = new Date(year, monthIndex, day).getTime();
        }
        if (dateMatchEnd) {
            const year = Number(dateMatchEnd[1]);
            const monthIndex = Number(dateMatchEnd[2]) - 1;
            const day = Number(dateMatchEnd[3]);
            endMs = new Date(year, monthIndex, day + 1).getTime();
        }

        const recordingItems: LibraryItem[] = recordings.map((entry) => ({
            type: 'recording',
            id: entry.id,
            title: (entry.title || 'Untitled recording').trim() || 'Untitled recording',
            preview: getRecordingPreviewText(entry, librarySearch),
            updatedAt: Number(entry.updatedAt || entry.createdAt || 0),
            createdAt: Number(entry.createdAt || entry.updatedAt || 0),
            isCloudSynced: entry.isCloudSynced !== false,
            durationMs: Number(entry.stats?.durationMs || 0),
            linkedNoteId: entry.linkedNoteId || null,
        }));
        const noteItems: LibraryItem[] = notesData.notes.map((note) => ({
            type: 'note',
            id: note.id,
            title: (note.title || 'Untitled note').trim() || 'Untitled note',
            preview: getNotePreviewText(note),
            updatedAt: Number(note.lastModified || note.createdAt || 0),
            createdAt: Number(note.createdAt || note.lastModified || 0),
            isCloudSynced: note.isCloudSynced !== false,
            sourceRecordingIds: normalizeNoteSourceRecordingIds(note.sourceRecordingIds || []),
        }));
        const chatItems: LibraryItem[] = chatsData.chats.map((chat) => {
            const lastMessage = Array.isArray(chat.messages) && chat.messages.length > 0
                ? chat.messages[chat.messages.length - 1]
                : null;
            const lastActivityTime = lastMessage?.createdAt || chat.updatedAt || chat.createdAt || 0;
            return {
                type: 'chat',
                id: chat.id,
                title: (chat.title || 'Untitled Chat').trim() || 'Untitled Chat',
                preview: String(lastMessage?.content || '').trim() || 'No messages yet.',
                updatedAt: Number(lastActivityTime),
                createdAt: Number(chat.createdAt || chat.updatedAt || 0),
                isCloudSynced: chat.isCloudSynced === true,
            };
        });

        return [...recordingItems, ...noteItems, ...chatItems].filter((entry) => {
            if (libraryFilter === 'notes' && entry.type !== 'note') return false;
            if (libraryFilter === 'recordings' && entry.type !== 'recording') return false;
            if (libraryFilter === 'chats' && entry.type !== 'chat') return false;
            if (libraryFilter === 'cloud' && !entry.isCloudSynced) return false;
            if (libraryFilter === 'private' && entry.isCloudSynced) return false;

            const searchableText = [
                entry.title,
                entry.preview,
                entry.type,
            ].join(' ').toLowerCase();
            const textMatches = !query || searchableText.includes(query);
            if (!textMatches) return false;

            if (startMs || endMs) {
                const createdAt = Number(entry.createdAt || 0);
                if (startMs && createdAt < startMs) return false;
                if (endMs && createdAt >= endMs) return false;
            }
            return true;
        }).sort((a, b) => Number(b.updatedAt || b.createdAt || 0) - Number(a.updatedAt || a.createdAt || 0));
    }, [chatsData.chats, libraryFilter, librarySearch, notesData.notes, recordingDateFilterEnd, recordingDateFilterStart, recordings]);

    const groupedLibrarySearchResults = useMemo(() => {
        const groups: Record<LibraryDateGroupKey, LibraryItem[]> = {
            today: [],
            pastWeek: [],
            pastFourWeeks: [],
            older: [],
        };
        filteredLibraryItems.forEach((item) => {
            groups[getLibraryDateGroup(item.updatedAt || item.createdAt)].push(item);
        });
        return groups;
    }, [filteredLibraryItems]);

    const sidebarNotes = useMemo(
        () => [...notesData.notes].sort((a, b) => Number(b.lastModified || b.createdAt || 0) - Number(a.lastModified || a.createdAt || 0)),
        [notesData.notes],
    );

    const sidebarRecordings = useMemo(
        () => [...recordings].sort((a, b) => Number(b.updatedAt || b.createdAt || 0) - Number(a.updatedAt || a.createdAt || 0)),
        [recordings],
    );

    const effectiveProModelOptions = useMemo<ProModelOption[]>(() => {
        const fallbackAlias = String(settings.aiEngine.llmModel || settings.aiEngine.summaryModel || '').trim();
        const normalized = normalizeProModelOptions(proModelOptions, fallbackAlias);
        const aliasesFromSettings = [settings.aiEngine.llmModel, settings.aiEngine.summaryModel]
            .map((value) => String(value || '').trim().toLowerCase())
            .filter(Boolean);
        const existing = new Set(normalized.map((entry) => entry.id));
        const merged = [...normalized];
        aliasesFromSettings.forEach((alias) => {
            if (existing.has(alias)) return;
            merged.push({
                id: alias,
                label: formatProModelAliasLabel(alias),
                helperText: 'Managed alias',
                contextWindowTokens: null,
            });
            existing.add(alias);
        });

        // Pioneer (standard) plan is restricted to Hercules
        if (authState.isLoggedIn && authState.plan === 'standard') {
            return merged.filter((entry) => entry.id === 'hercules');
        }

        return merged;
    }, [proModelOptions, settings.aiEngine.llmModel, settings.aiEngine.summaryModel, authState.isLoggedIn, authState.plan]);

    useEffect(() => {
        if (authState.isLoggedIn && authState.plan === 'standard') {
            let needsUpdate = false;
            const patch: Record<string, any> = {};
            if (settings.aiEngine.llmModel !== 'hercules') {
                patch.llmModel = 'hercules';
                needsUpdate = true;
            }
            if (settings.aiEngine.summaryModel !== 'hercules') {
                patch.summaryModel = 'hercules';
                needsUpdate = true;
            }
            if (needsUpdate) {
                void updateSettings({ aiEngine: patch });
            }
        }
    }, [authState.isLoggedIn, authState.plan, settings.aiEngine.llmModel, settings.aiEngine.summaryModel, updateSettings]);

    const globalAskModelOptions = useMemo<GlobalAskModelOption[]>(() => {
        const localModelLabel = settings.model === 'gemma' ? 'Gemma' : 'Qwen';
        const selectedAskProvider = settings.aiEngine.llmProvider as keyof UiSettings['aiEngine']['apiKeys'];
        const hasSelectedAskProviderKey = settings.aiEngine.apiKeys[selectedAskProvider]?.present === true;
        const effectiveAskMode = settings.processingModes.aiActions === 'local'
            ? 'local'
            : (hasSelectedAskProviderKey ? 'byok' : 'pro');
        if (effectiveAskMode === 'local') {
            return [
                {
                    id: GLOBAL_ASK_DEFAULT_MODEL_OPTION_ID,
                    label: 'Auto',
                    helperText: `Local ${localModelLabel}`,
                    selection: { mode: 'auto' },
                },
                {
                    id: 'model:local',
                    label: `Local ${localModelLabel}`,
                    helperText: 'On-device',
                    selection: { mode: 'local' },
                },
            ];
        }

        if (effectiveAskMode === 'pro') {
            return [
                {
                    id: GLOBAL_ASK_DEFAULT_MODEL_OPTION_ID,
                    label: 'Auto',
                    helperText: 'Managed broker',
                    selection: { mode: 'auto' },
                },
                ...effectiveProModelOptions.map((option) => ({
                    id: `model:pro:${option.id}`,
                    label: option.label,
                    helperText: option.helperText || 'Managed alias',
                    selection: { mode: 'pro', modelAlias: option.id } as GlobalAskModelSelection,
                })),
            ];
        }

        const providersWithKeys = GLOBAL_ASK_BYOK_PROVIDER_OPTIONS
            .filter((provider) => settings.aiEngine.apiKeys[provider.id]?.present);
        const byokOptions: GlobalAskModelOption[] = [];
        providersWithKeys.forEach((provider) => {
            getGlobalAskByokModelOptions(provider.id).forEach((modelOption) => {
                byokOptions.push({
                    id: `model:byok:${provider.id}:${modelOption.id}`,
                    label: `${provider.label} · ${modelOption.label}`,
                    helperText: 'BYOK',
                    selection: {
                        mode: 'byok',
                        provider: provider.id,
                        model: modelOption.id,
                    },
                });
            });
        });

        return [
            {
                id: GLOBAL_ASK_DEFAULT_MODEL_OPTION_ID,
                label: 'Auto',
                helperText: byokOptions.length ? 'Use current BYOK routing' : 'No key configured',
                selection: { mode: 'auto' },
            },
            ...byokOptions,
        ];
    }, [settings.model, settings.aiEngine.apiKeys, settings.aiEngine.llmProvider, settings.processingModes.aiActions, effectiveProModelOptions]);

    useEffect(() => {
        if (!globalAskModelOptions.some((entry) => entry.id === globalAskModelOptionId)) {
            setGlobalAskModelOptionId(globalAskModelOptions[0]?.id || GLOBAL_ASK_DEFAULT_MODEL_OPTION_ID);
        }
    }, [globalAskModelOptionId, globalAskModelOptions]);

    const selectedGlobalAskModelOption = useMemo(
        () => globalAskModelOptions.find((entry) => entry.id === globalAskModelOptionId) || globalAskModelOptions[0] || null,
        [globalAskModelOptionId, globalAskModelOptions],
    );

    const globalAskContextOptions = useMemo<GlobalAskContextOption[]>(() => {
        const rawFolderList = (Array.isArray(notesData.folders) ? notesData.folders : [])
            .map((entry) => ({
                id: String((entry as any)?.id || '').trim(),
                name: String((entry as any)?.name || '').trim() || 'Untitled folder',
                parentId: String((entry as any)?.parentId || '').trim(),
                colorId: (entry as any)?.colorId,
                iconId: (entry as any)?.iconId,
            }))
            .filter((entry) => entry.id && entry.id !== 'default');
        const folderIdSet = new Set(rawFolderList.map((folder) => folder.id));
        const folderList = rawFolderList.map((folder) => ({
            ...folder,
            parentId: folder.parentId && folder.parentId !== folder.id && folderIdSet.has(folder.parentId)
                ? folder.parentId
                : '',
        }));
        const foldersByParentId = new Map<string, typeof folderList>();
        folderList.forEach((folder) => {
            if (!foldersByParentId.has(folder.parentId)) {
                foldersByParentId.set(folder.parentId, []);
            }
            foldersByParentId.get(folder.parentId)!.push(folder);
        });
        foldersByParentId.forEach((folders) => {
            folders.sort((a, b) => a.name.localeCompare(b.name));
        });
        const orderedFolders: Array<{ folder: typeof folderList[number]; depth: number }> = [];
        const appendedFolderIds = new Set<string>();
        const appendFolderBranch = (parentId: string, depth: number, ancestry: Set<string>): void => {
            (foldersByParentId.get(parentId) || []).forEach((folder) => {
                if (appendedFolderIds.has(folder.id) || ancestry.has(folder.id)) return;
                appendedFolderIds.add(folder.id);
                orderedFolders.push({ folder, depth });
                const childAncestry = new Set(ancestry);
                childAncestry.add(folder.id);
                appendFolderBranch(folder.id, depth + 1, childAncestry);
            });
        };
        appendFolderBranch('', 0, new Set());
        folderList
            .filter((folder) => !appendedFolderIds.has(folder.id))
            .sort((a, b) => a.name.localeCompare(b.name))
            .forEach((folder) => {
                appendedFolderIds.add(folder.id);
                orderedFolders.push({ folder, depth: 0 });
                appendFolderBranch(folder.id, 1, new Set([folder.id]));
            });
        const folderNoteCountById = new Map<string, number>();
        sidebarNotes.forEach((note) => {
            const folderId = String(note.folderId || '').trim();
            if (!folderId || !folderIdSet.has(folderId)) return;
            folderNoteCountById.set(folderId, (folderNoteCountById.get(folderId) || 0) + 1);
        });

        const chatList = (Array.isArray(chatsData.chats) ? chatsData.chats : [])
            .filter((c) => c.messages && c.messages.length > 0 && c.id !== 'global');

        const itemOpts: { opt: GlobalAskContextOption; sortKey: number }[] = [];

        chatList.forEach((entry) => {
            const ts = entry.updatedAt || entry.createdAt || 0;
            itemOpts.push({
                opt: {
                    id: `ctx:chat:${entry.id}`,
                    kind: 'chat',
                    label: (entry.title || 'Untitled Chat').trim() || 'Untitled Chat',
                    helperText: formatTimeCompact(ts),
                    timestamp: ts,
                },
                sortKey: -ts,
            });
        });

        sidebarRecordings.forEach((entry) => {
            const ts = entry.createdAt || 0;
            itemOpts.push({
                opt: {
                    id: `ctx:recording:${entry.id}`,
                    kind: 'recording',
                    label: (entry.title || 'Untitled recording').trim() || 'Untitled recording',
                    helperText: formatTimeCompact(ts),
                    timestamp: ts,
                },
                sortKey: -ts,
            });
        });

        sidebarNotes.forEach((note) => {
            const ts = note.lastModified || note.createdAt || 0;
            itemOpts.push({
                opt: {
                    id: `ctx:note:${note.id}`,
                    kind: 'note',
                    label: (note.title || 'Untitled note').trim() || 'Untitled note',
                    helperText: formatTimeCompact(ts),
                    timestamp: ts,
                },
                sortKey: -ts,
            });
        });

        // Sort by date descending (newest first)
        itemOpts.sort((a, b) => a.sortKey - b.sortKey);

        const options: GlobalAskContextOption[] = itemOpts.map((i) => i.opt);

        // Folders at the end, preserving their parent-child hierarchy.
        orderedFolders.forEach(({ folder, depth }) => {
            const { IconComponent, colorStyle } = getFolderIconAndColor(folder);
            options.push({
                id: `ctx:folder:${folder.id}`,
                kind: 'folder',
                label: folder.name || 'Untitled folder',
                helperText: `${folderNoteCountById.get(folder.id) || 0} notes`,
                colorId: folder.colorId,
                iconId: folder.iconId,
                spaceIcon: IconComponent,
                spaceIconStyle: colorStyle,
                hierarchyDepth: depth,
            });
        });

        return options;
    }, [chatsData.chats, notesData.folders, sidebarNotes, sidebarRecordings]);

    useEffect(() => {
        const valid = globalAskContextOptionIds.filter((id) => globalAskContextOptions.some((entry) => entry.id === id));
        if (valid.length !== globalAskContextOptionIds.length) {
            setGlobalAskContextOptionIds(valid);
        }
    }, [globalAskContextOptionIds, globalAskContextOptions]);

    const sidebarFolders = useMemo(() => {
        const source = Array.isArray(notesData.folders) ? notesData.folders : [];
        const deduped: Folder[] = [];
        const seen = new Set<string>();
        source.forEach((rawFolder) => {
            const id = String(rawFolder?.id || '').trim();
            if (!id || id === 'default' || seen.has(id)) return;
            seen.add(id);
            const name = String(rawFolder?.name || '').trim() || 'Untitled folder';
            const rawParentId = String((rawFolder as any)?.parentId || '').trim();
            const parentId = rawParentId && rawParentId !== id && rawParentId !== 'default' ? rawParentId : '';
            const iconId = String((rawFolder as any)?.iconId || '').trim();
            const colorId = String((rawFolder as any)?.colorId || '').trim();
            deduped.push({
                id,
                name,
                parentId,
                iconId,
                colorId,
            } as Folder);
        });
        const availableFolderIds = new Set(deduped.map((folder) => folder.id));
        return deduped
            .map((folder) => {
                const parentId = String((folder as any).parentId || '').trim();
                return {
                    ...folder,
                    parentId: parentId && availableFolderIds.has(parentId) ? parentId : '',
                } as Folder;
            })
            .sort((a, b) => String(a.name || '').localeCompare(String(b.name || '')));
    }, [notesData.folders]);

    const filteredFolderIcons = useMemo(() => {
        const q = iconSearchQuery.trim().toLowerCase();
        if (!q) return folderIcons;
        return folderIcons.filter((item) =>
            item.id.toLowerCase().includes(q) ||
            item.tags.some((tag) => tag.toLowerCase().includes(q))
        );
    }, [iconSearchQuery]);

    const moveToFolderOptions = useMemo(
        () => [...sidebarFolders].sort((a, b) => String(a.name || '').localeCompare(String(b.name || ''))),
        [sidebarFolders],
    );

    const filteredMoveToFolderOptions = useMemo(() => {
        const query = folderSearchQuery.trim().toLowerCase();
        if (!query) return moveToFolderOptions;
        return moveToFolderOptions.filter((folder) => String(folder.name || '').toLowerCase().includes(query));
    }, [folderSearchQuery, moveToFolderOptions]);

    const sidebarFolderIdSet = useMemo(() => new Set(sidebarFolders.map((folder) => folder.id)), [sidebarFolders]);
    const sidebarFoldersById = useMemo(() => {
        const map = new Map<string, Folder>();
        sidebarFolders.forEach((folder) => {
            map.set(folder.id, folder);
        });
        return map;
    }, [sidebarFolders]);

    const headerSpaceEntriesByFolderId = useMemo(() => {
        const groups = new Map<string, HeaderSpaceSwitcherEntry[]>();
        const pushItem = (folderId: string, item: HeaderSpaceSwitcherEntry) => {
            if (!groups.has(folderId)) {
                groups.set(folderId, []);
            }
            groups.get(folderId)!.push(item);
        };

        sidebarFolders.forEach((folder) => {
            const parentId = String((folder as any).parentId || '').trim();
            if (!parentId || !sidebarFolderIdSet.has(parentId)) return;
            pushItem(parentId, {
                kind: 'folder',
                id: folder.id,
                title: (folder.name || 'Untitled folder').trim() || 'Untitled folder',
                updatedAt: 0,
                createdAt: 0,
            });
        });

        notesData.notes.forEach((note) => {
            const folderId = String(note.folderId || '').trim();
            if (!folderId || !sidebarFolderIdSet.has(folderId)) return;
            pushItem(folderId, {
                kind: 'note',
                id: note.id,
                title: (note.title || 'Untitled note').trim() || 'Untitled note',
                updatedAt: Number(note.lastModified || note.createdAt || 0),
                createdAt: Number(note.createdAt || note.lastModified || 0),
            });
        });

        recordings.forEach((recording) => {
            const folderId = String(recording.folderId || '').trim();
            if (!folderId || !sidebarFolderIdSet.has(folderId)) return;
            pushItem(folderId, {
                kind: 'recording',
                id: recording.id,
                title: (recording.title || 'Untitled recording').trim() || 'Untitled recording',
                updatedAt: Number(recording.updatedAt || recording.createdAt || 0),
                createdAt: Number(recording.createdAt || recording.updatedAt || 0),
            });
        });

        chatsData.chats.forEach((chat) => {
            if (!chat.id || chat.id === 'global') return;
            const folderId = String(chat.folderId || '').trim();
            if (!folderId || !sidebarFolderIdSet.has(folderId)) return;
            pushItem(folderId, {
                kind: 'chat',
                id: chat.id,
                title: (chat.title || 'Untitled Chat').trim() || 'Untitled Chat',
                updatedAt: Number(chat.updatedAt || chat.createdAt || 0),
                createdAt: Number(chat.createdAt || chat.updatedAt || 0),
            });
        });

        groups.forEach((items) => {
            items.sort((a, b) => {
                if (a.kind === 'folder' && b.kind !== 'folder') return -1;
                if (a.kind !== 'folder' && b.kind === 'folder') return 1;
                if (a.kind === 'folder' && b.kind === 'folder') {
                    return a.title.localeCompare(b.title);
                }
                const aTime = Number(a.updatedAt || a.createdAt || 0);
                const bTime = Number(b.updatedAt || b.createdAt || 0);
                if (aTime !== bTime) return bTime - aTime;
                return a.title.localeCompare(b.title);
            });
        });

        return groups;
    }, [chatsData.chats, notesData.notes, recordings, sidebarFolderIdSet, sidebarFolders]);

    const getFolderTrail = useCallback((folderId: string): Folder[] => {
        const normalizedFolderId = String(folderId || '').trim();
        if (!normalizedFolderId) return [];
        const trail: Folder[] = [];
        const seen = new Set<string>();
        let cursor = normalizedFolderId;
        while (cursor && !seen.has(cursor)) {
            seen.add(cursor);
            const folder = sidebarFoldersById.get(cursor);
            if (!folder) break;
            trail.unshift(folder);
            const parentId = String((folder as any).parentId || '').trim();
            cursor = parentId && sidebarFoldersById.has(parentId) ? parentId : '';
        }
        return trail;
    }, [sidebarFoldersById]);

    useEffect(() => {
        if (!activeHeaderSpaceSwitcherFolderId) return;
        if (sidebarFolderIdSet.has(activeHeaderSpaceSwitcherFolderId)) return;
        setActiveHeaderSpaceSwitcherFolderId(null);
        setHeaderSpaceHoverPath([]);
        setHeaderSpacePanelAnchorsByFolderId({});
        if (headerSpaceCloseTimerRef.current !== null) {
            window.clearTimeout(headerSpaceCloseTimerRef.current);
            headerSpaceCloseTimerRef.current = null;
        }
    }, [activeHeaderSpaceSwitcherFolderId, sidebarFolderIdSet]);

    const activeMoveToFolderCurrentFolderId = useMemo(() => {
        if (!activeMoveToFolderTarget) return '';
        if (activeMoveToFolderTarget.type === 'note') {
            const note = notesData.notes.find((entry) => entry.id === activeMoveToFolderTarget.id);
            const folderId = String(note?.folderId || '').trim();
            return folderId && sidebarFolderIdSet.has(folderId) ? folderId : '';
        }
        if (activeMoveToFolderTarget.type === 'recording') {
            const recording = recordings.find((entry) => entry.id === activeMoveToFolderTarget.id);
            const folderId = String(recording?.folderId || '').trim();
            return folderId && sidebarFolderIdSet.has(folderId) ? folderId : '';
        }
        const chat = chatsData.chats.find((entry) => entry.id === activeMoveToFolderTarget.id);
        const folderId = String(chat?.folderId || '').trim();
        return folderId && sidebarFolderIdSet.has(folderId) ? folderId : '';
    }, [activeMoveToFolderTarget, chatsData.chats, notesData.notes, recordings, sidebarFolderIdSet]);

    const sidebarFoldersByParentId = useMemo(() => {
        const groups = new Map<string, Folder[]>();
        sidebarFolders.forEach((folder) => {
            const parentId = String((folder as any).parentId || '').trim();
            const key = parentId && sidebarFolderIdSet.has(parentId) ? parentId : '';
            if (!groups.has(key)) {
                groups.set(key, []);
            }
            groups.get(key)!.push(folder);
        });
        return groups;
    }, [sidebarFolderIdSet, sidebarFolders]);

    const sidebarNotesByFolderId = useMemo(() => {
        const groups = new Map<string, Note[]>();
        sidebarNotes.forEach((note) => {
            const folderId = String(note.folderId || '').trim();
            const key = folderId && sidebarFolderIdSet.has(folderId) ? folderId : '';
            if (!groups.has(key)) {
                groups.set(key, []);
            }
            groups.get(key)!.push(note);
        });
        return groups;
    }, [sidebarFolderIdSet, sidebarNotes]);

    useEffect(() => {
        setExpandedFolderIds((previous) => {
            const next = new Set<string>();
            previous.forEach((folderId) => {
                if (sidebarFolderIdSet.has(folderId)) {
                    next.add(folderId);
                }
            });
            if (next.size === previous.size) return previous;
            return next;
        });
    }, [sidebarFolderIdSet]);

    const pinnedSidebarItems = useMemo(
        () => normalizeSidebarPinnedItems((settings.layout as any)?.pinnedSidebarItems),
        [settings.layout],
    );

    const pinnedNoteIdSet = useMemo(() => {
        const ids = new Set<string>();
        pinnedSidebarItems.forEach((entry) => {
            if (entry.type === 'note') ids.add(entry.id);
        });
        return ids;
    }, [pinnedSidebarItems]);

    const pinnedRecordingIdSet = useMemo(() => {
        const ids = new Set<string>();
        pinnedSidebarItems.forEach((entry) => {
            if (entry.type === 'recording') ids.add(entry.id);
        });
        return ids;
    }, [pinnedSidebarItems]);

    const pinnedFolderIdSet = useMemo(() => {
        const ids = new Set<string>();
        pinnedSidebarItems.forEach((entry) => {
            if (entry.type === 'folder') ids.add(entry.id);
        });
        return ids;
    }, [pinnedSidebarItems]);

    const pinnedChatIdSet = useMemo(() => {
        const ids = new Set<string>();
        pinnedSidebarItems.forEach((entry) => {
            if (entry.type === 'chat') ids.add(entry.id);
        });
        return ids;
    }, [pinnedSidebarItems]);

    const hiddenFolderIdsInMainSidebar = useMemo(() => {
        const hidden = new Set<string>();
        const queue = Array.from(pinnedFolderIdSet);
        while (queue.length > 0) {
            const folderId = queue.shift() || '';
            if (!folderId || hidden.has(folderId)) continue;
            hidden.add(folderId);
            const children = sidebarFoldersByParentId.get(folderId) || [];
            children.forEach((child) => {
                if (!hidden.has(child.id)) {
                    queue.push(child.id);
                }
            });
        }
        return hidden;
    }, [pinnedFolderIdSet, sidebarFoldersByParentId]);

    const visibleSidebarFolders = useMemo(
        () => sidebarFolders.filter((folder) => !hiddenFolderIdsInMainSidebar.has(folder.id)),
        [hiddenFolderIdsInMainSidebar, sidebarFolders],
    );

    const visibleSidebarFolderIdSet = useMemo(
        () => new Set(visibleSidebarFolders.map((folder) => folder.id)),
        [visibleSidebarFolders],
    );

    const visibleSidebarFoldersByParentId = useMemo(() => {
        const groups = new Map<string, Folder[]>();
        visibleSidebarFolders.forEach((folder) => {
            const parentId = String((folder as any).parentId || '').trim();
            const key = parentId && visibleSidebarFolderIdSet.has(parentId) ? parentId : '';
            if (!groups.has(key)) {
                groups.set(key, []);
            }
            groups.get(key)!.push(folder);
        });
        return groups;
    }, [visibleSidebarFolderIdSet, visibleSidebarFolders]);

    const sidebarSearchQuery = librarySearch.trim().toLowerCase();
    const isSidebarSearchActive = sidebarSearchQuery.length > 0;

    const visibleSidebarNotes = useMemo(
        () => sidebarNotes.filter((note) => {
            if (pinnedNoteIdSet.has(note.id)) return false;
            const folderId = String(note.folderId || '').trim();
            if (folderId && hiddenFolderIdsInMainSidebar.has(folderId)) return false;
            if (!sidebarSearchQuery) return true;
            const searchableText = [
                note.title,
                note.text,
            ].join(' ').toLowerCase();
            return searchableText.includes(sidebarSearchQuery);
        }),
        [hiddenFolderIdsInMainSidebar, pinnedNoteIdSet, sidebarNotes, sidebarSearchQuery],
    );

    const visibleSidebarNotesByFolderId = useMemo(() => {
        const groups = new Map<string, Note[]>();
        visibleSidebarNotes.forEach((note) => {
            const folderId = String(note.folderId || '').trim();
            const key = folderId && visibleSidebarFolderIdSet.has(folderId) ? folderId : '';
            if (!groups.has(key)) {
                groups.set(key, []);
            }
            groups.get(key)!.push(note);
        });
        return groups;
    }, [visibleSidebarFolderIdSet, visibleSidebarNotes]);

    const sidebarRecordingsByFolderId = useMemo(() => {
        const groups = new Map<string, RecordingItem[]>();
        sidebarRecordings.forEach((rec) => {
            const folderId = String(rec.folderId || '').trim();
            const key = folderId && sidebarFolderIdSet.has(folderId) ? folderId : '';
            if (!groups.has(key)) {
                groups.set(key, []);
            }
            groups.get(key)!.push(rec);
        });
        return groups;
    }, [sidebarFolderIdSet, sidebarRecordings]);

    const visibleSidebarRecordings = useMemo(
        () => sidebarRecordings.filter((entry) => {
            if (pinnedRecordingIdSet.has(entry.id)) return false;
            const folderId = String(entry.folderId || '').trim();
            if (folderId && hiddenFolderIdsInMainSidebar.has(folderId)) return false;
            if (!sidebarSearchQuery) return true;
            const searchableText = [
                entry.title,
                entry.summary,
                entry.transcript,
            ].join(' ').toLowerCase();
            return searchableText.includes(sidebarSearchQuery);
        }),
        [hiddenFolderIdsInMainSidebar, pinnedRecordingIdSet, sidebarRecordings, sidebarSearchQuery],
    );

    const visibleSidebarRecordingsByFolderId = useMemo(() => {
        const groups = new Map<string, RecordingItem[]>();
        visibleSidebarRecordings.forEach((rec) => {
            const folderId = String(rec.folderId || '').trim();
            const key = folderId && visibleSidebarFolderIdSet.has(folderId) ? folderId : '';
            if (!groups.has(key)) {
                groups.set(key, []);
            }
            groups.get(key)!.push(rec);
        });
        return groups;
    }, [visibleSidebarFolderIdSet, visibleSidebarRecordings]);

    const rootSidebarRecordings = useMemo(
        () => {
            if (isSidebarSearchActive) {
                return visibleSidebarRecordings;
            }
            return visibleSidebarRecordings.filter((entry) => {
                const folderId = String(entry.folderId || '').trim();
                if (!folderId) return true;
                return !visibleSidebarFolderIdSet.has(folderId);
            });
        },
        [isSidebarSearchActive, visibleSidebarFolderIdSet, visibleSidebarRecordings],
    );

    const visibleSidebarChats = useMemo(
        () => chatsData.chats
            .filter((chat) => {
                if (pinnedChatIdSet.has(chat.id)) return false;
                if (!isSidebarSearchActive) return true;
                const searchableText = [
                    chat.title,
                    ...(Array.isArray(chat.messages) ? chat.messages.map((entry) => entry.content || '') : []),
                ].join(' ').toLowerCase();
                return searchableText.includes(sidebarSearchQuery);
            })
            .sort((a, b) => {
                const aLastMessage = Array.isArray(a.messages) && a.messages.length > 0
                    ? a.messages[a.messages.length - 1]
                    : null;
                const bLastMessage = Array.isArray(b.messages) && b.messages.length > 0
                    ? b.messages[b.messages.length - 1]
                    : null;
                const aTime = aLastMessage?.createdAt || a.updatedAt || a.createdAt || 0;
                const bTime = bLastMessage?.createdAt || b.updatedAt || b.createdAt || 0;
                return bTime - aTime;
            }),
        [chatsData.chats, isSidebarSearchActive, pinnedChatIdSet, sidebarSearchQuery],
    );

    const pinSidebarEntity = useCallback((item: SidebarPinnedItem) => {
        if (item.type === 'folder') return;
        const key = `${item.type}:${item.id}`;
        if (pinnedSidebarItems.some((entry) => `${entry.type}:${entry.id}` === key)) return;
        updateLayoutSettings({ pinnedSidebarItems: [item, ...pinnedSidebarItems] });
    }, [pinnedSidebarItems, updateLayoutSettings]);

    const unpinSidebarEntity = useCallback((item: SidebarPinnedItem) => {
        const key = `${item.type}:${item.id}`;
        const nextPinnedItems = pinnedSidebarItems.filter((entry) => `${entry.type}:${entry.id}` !== key);
        updateLayoutSettings({ pinnedSidebarItems: nextPinnedItems });
    }, [pinnedSidebarItems, updateLayoutSettings]);

    const reorderPinnedSidebarItems = useCallback((draggedKey: string, targetKey: string) => {
        if (!draggedKey || !targetKey || draggedKey === targetKey) return;
        const fromIndex = pinnedSidebarItems.findIndex((entry) => `${entry.type}:${entry.id}` === draggedKey);
        const toIndex = pinnedSidebarItems.findIndex((entry) => `${entry.type}:${entry.id}` === targetKey);
        if (fromIndex < 0 || toIndex < 0 || fromIndex === toIndex) return;
        const nextPinnedItems = [...pinnedSidebarItems];
        const [movedItem] = nextPinnedItems.splice(fromIndex, 1);
        nextPinnedItems.splice(toIndex, 0, movedItem);
        updateLayoutSettings({ pinnedSidebarItems: nextPinnedItems });
    }, [pinnedSidebarItems, updateLayoutSettings]);

    const pinnedSidebarEntries = useMemo(() => {
        return pinnedSidebarItems.map((item) => {
            if (item.type === 'note') {
                const note = notesData.notes.find((entry) => entry.id === item.id);
                if (!note) return null;
                return {
                    item,
                    key: `${item.type}:${item.id}`,
                    title: (note.title || 'Untitled note').trim() || 'Untitled note',
                    subtitle: '',
                    isCloudSynced: note.isCloudSynced !== false,
                    durationMs: null as number | null,
                };
            }
            if (item.type === 'recording') {
                const recording = recordings.find((entry) => entry.id === item.id);
                if (!recording) return null;
                return {
                    item,
                    key: `${item.type}:${item.id}`,
                    title: (recording.title || 'Untitled recording').trim() || 'Untitled recording',
                    subtitle: '',
                    isCloudSynced: recording.isCloudSynced !== false,
                    durationMs: Number(recording.stats?.durationMs || 0),
                };
            }
            if (item.type === 'chat') {
                const chat = chatsData.chats.find((entry) => entry.id === item.id);
                if (!chat) return null;
                return {
                    item,
                    key: `${item.type}:${item.id}`,
                    title: (chat.title || 'Untitled Chat').trim() || 'Untitled Chat',
                    subtitle: '',
                    isCloudSynced: chat.isCloudSynced === true,
                    durationMs: null as number | null,
                };
            }
            const folder = sidebarFolders.find((entry) => entry.id === item.id);
            if (!folder) return null;
            return {
                item,
                key: `${item.type}:${item.id}`,
                title: (folder.name || 'Untitled folder').trim() || 'Untitled folder',
                subtitle: '',
                isCloudSynced: null as boolean | null,
                durationMs: null as number | null,
            };
        }).filter(Boolean) as Array<{
            item: SidebarPinnedItem;
            key: string;
            title: string;
            subtitle: string;
            isCloudSynced: boolean | null;
            durationMs: number | null;
        }>;
    }, [chatsData.chats, notesData.notes, pinnedSidebarItems, recordings, sidebarFolders]);

    useEffect(() => {
        if (!hasLoadedNotesOnce || !hasLoadedRecordingsOnce || !hasLoadedChatsOnce) return;
        const resolvedKeys = new Set(pinnedSidebarEntries.map((entry) => entry.key));
        const nextPinnedItems = pinnedSidebarItems.filter((entry) => resolvedKeys.has(`${entry.type}:${entry.id}`));
        if (nextPinnedItems.length !== pinnedSidebarItems.length) {
            updateLayoutSettings({ pinnedSidebarItems: nextPinnedItems });
        }
    }, [hasLoadedChatsOnce, hasLoadedNotesOnce, hasLoadedRecordingsOnce, pinnedSidebarEntries, pinnedSidebarItems, updateLayoutSettings]);

    interface RecentItem {
        type: 'note' | 'recording' | 'chat';
        id: string;
        title: string;
        isCloudSynced: boolean;
        timestamp: number;
        rawItem: Note | RecordingItem | ChatSession;
    }

    const recentItems = useMemo(() => {
        const items: RecentItem[] = [];
        notesData.notes.forEach((note) => {
            items.push({
                type: 'note',
                id: note.id,
                title: (note.title || 'Untitled note').trim() || 'Untitled note',
                isCloudSynced: note.isCloudSynced !== false,
                timestamp: note.lastModified || note.createdAt || 0,
                rawItem: note,
            });
        });
        recordings.forEach((rec) => {
            items.push({
                type: 'recording',
                id: rec.id,
                title: (rec.title || 'Untitled recording').trim() || 'Untitled recording',
                isCloudSynced: rec.isCloudSynced !== false,
                timestamp: rec.updatedAt || rec.createdAt || 0,
                rawItem: rec,
            });
        });
        chatsData.chats.forEach((chat) => {
            items.push({
                type: 'chat',
                id: chat.id,
                title: (chat.title || 'Untitled Chat').trim() || 'Untitled Chat',
                isCloudSynced: chat.isCloudSynced === true,
                timestamp: chat.updatedAt || chat.createdAt || 0,
                rawItem: chat,
            });
        });

        return items.sort((a, b) => b.timestamp - a.timestamp).slice(0, 10);
    }, [notesData.notes, recordings, chatsData.chats]);

    const openLibraryItemTab = useCallback((
        item: LibraryItem | LibraryTab | { type: 'note' | 'recording' | 'chat'; id: string },
        options: { activate?: boolean; closeSearch?: boolean } = {},
    ) => {
        const normalized: LibraryTab = item.type === 'chat'
            ? { type: 'ask', id: item.id }
            : { type: item.type, id: item.id };
        const nextTabKey = getLibraryTabKey(normalized);
        setOpenLibraryTabs((previous) => {
            if (previous.some((entry) => getLibraryTabKey(entry) === nextTabKey)) {
                return previous;
            }
            return [...previous, normalized];
        });
        setHasInitializedLibraryTabs(true);

        if (options.activate !== false) {
            setActiveLibraryTabKey(nextTabKey);
            if (normalized.type === 'ask') {
                setSelectedLibraryItem(null);
                setSelectedRecordingId(null);
            } else {
                setSelectedLibraryItem(normalized);
            }
            setActiveSection('library');
            if (normalized.type === 'recording') {
                setSelectedRecordingId(normalized.id);
                setUnreadRecordingIds((previous) => {
                    if (!previous.has(normalized.id)) return previous;
                    const updated = new Set(previous);
                    updated.delete(normalized.id);
                    return updated;
                });
            }
        }

        if (options.closeSearch !== false) {
            setIsLibrarySearchOpen(false);
        }
    }, []);

    const selectLibraryItem = useCallback((item: LibraryItem | { type: 'note' | 'recording' | 'chat'; id: string }) => {
        openLibraryItemTab(item, { activate: true, closeSearch: true });
    }, [openLibraryItemTab]);

    const openNoteFromMainProcess = useCallback((rawNoteId: string) => {
        const noteId = String(rawNoteId || '').trim();
        if (!noteId) return;
        setActiveSection('library');
        openLibraryItemTab({ type: 'note', id: noteId }, { activate: true, closeSearch: true });
        void refreshNotesData(noteId);
    }, [openLibraryItemTab, refreshNotesData]);

    const openDashboardNavigationFromMainProcess = useCallback((payload: DashboardNavigationPayload = {}) => {
        if (payload.type === 'settings') {
            const targetSettingsTab = resolveSettingsTabKey(payload.settingsTab) || 'general';
            setActiveSettingsTab(targetSettingsTab);
            setIsSettingsModalOpen(true);
            setActiveSection('library');
            if (targetSettingsTab === 'shortcuts') {
                void refreshShortcutsRuntime();
            }
            return;
        }

        const itemId = String(payload.id || '').trim();
        if (!itemId) return;

        if (payload.type === 'note') {
            openNoteFromMainProcess(itemId);
            return;
        }

        if (payload.type === 'recording') {
            setActiveSection('library');
            openLibraryItemTab({ type: 'recording', id: itemId }, { activate: true, closeSearch: true });
            void refreshRecordings(itemId);
            return;
        }

        if (payload.type === 'chat') {
            setActiveSection('library');
            openLibraryItemTab({ type: 'chat', id: itemId }, { activate: true, closeSearch: true });
            void refreshChatsData();
        }
    }, [
        openLibraryItemTab,
        openNoteFromMainProcess,
        refreshChatsData,
        refreshRecordings,
        refreshShortcutsRuntime,
    ]);

    useEffect(() => {
        let mounted = true;

        const handleOpenNote = (_event: any, payload: { noteId?: string } = {}) => {
            openNoteFromMainProcess(payload.noteId || '');
        };
        const handleDashboardNavigation = (_event: any, payload: DashboardNavigationPayload = {}) => {
            openDashboardNavigationFromMainProcess(payload);
        };

        ipcRenderer.on('dashboard:navigate', handleDashboardNavigation);
        ipcRenderer.on('dashboard:open-note', handleOpenNote);

        ipcRenderer.invoke('dashboard:consume-pending-navigation')
            .then((result: any) => {
                if (!mounted) return;
                if (result && typeof result.type === 'string') {
                    openDashboardNavigationFromMainProcess(result);
                }
            })
            .catch(() => {
                ipcRenderer.invoke('dashboard:consume-pending-note-navigation')
                    .then((result: any) => {
                        if (!mounted) return;
                        if (result && typeof result.noteId === 'string') {
                            openNoteFromMainProcess(result.noteId);
                        }
                    })
                    .catch(() => undefined);
            });

        return () => {
            mounted = false;
            ipcRenderer.removeListener('dashboard:navigate', handleDashboardNavigation);
            ipcRenderer.removeListener('dashboard:open-note', handleOpenNote);
        };
    }, [openDashboardNavigationFromMainProcess, openNoteFromMainProcess]);

    const cancelHeaderSpaceCloseTimer = useCallback(() => {
        if (headerSpaceCloseTimerRef.current !== null) {
            window.clearTimeout(headerSpaceCloseTimerRef.current);
            headerSpaceCloseTimerRef.current = null;
        }
    }, []);

    const scheduleHeaderSpaceClose = useCallback((delayMs: number = 320) => {
        cancelHeaderSpaceCloseTimer();
        headerSpaceCloseTimerRef.current = window.setTimeout(() => {
            setActiveHeaderSpaceSwitcherFolderId(null);
            setHeaderSpaceHoverPath([]);
            setHeaderSpacePanelAnchorsByFolderId({});
            headerSpaceCloseTimerRef.current = null;
        }, delayMs);
    }, [cancelHeaderSpaceCloseTimer]);

    useEffect(() => {
        return () => {
            cancelHeaderSpaceCloseTimer();
        };
    }, [cancelHeaderSpaceCloseTimer]);

    const buildHeaderTitleWithSpacePath = useCallback((params: {
        type: 'note' | 'recording' | 'chat';
        id: string;
        title: string;
        folderId?: string;
        onRenameClick?: () => void;
        renameTooltip?: string;
    }): string | React.ReactNode => {
        const itemTitle = params.title;
        const normalizedFolderId = String(params.folderId || '').trim();
        if (!normalizedFolderId) return itemTitle;
        const folder = sidebarFoldersById.get(normalizedFolderId);
        if (!folder) return itemTitle;

        const trail = getFolderTrail(normalizedFolderId);
        const rootFolder = trail.length ? trail[0] : folder;
        const leafFolder = trail.length ? trail[trail.length - 1] : folder;
        const rootFolderLabel = (rootFolder.name || 'Untitled space').trim() || 'Untitled space';
        const leafFolderLabel = (leafFolder.name || 'Untitled space').trim() || 'Untitled space';
        const folderSegments: Array<{ kind: 'folder'; id: string; label: string } | { kind: 'ellipsis' }> = [];

        if (trail.length <= 1) {
            folderSegments.push({ kind: 'folder', id: leafFolder.id, label: leafFolderLabel });
        } else if (trail.length === 2) {
            folderSegments.push({ kind: 'folder', id: rootFolder.id, label: rootFolderLabel });
            folderSegments.push({ kind: 'folder', id: leafFolder.id, label: leafFolderLabel });
        } else {
            folderSegments.push({ kind: 'folder', id: rootFolder.id, label: rootFolderLabel });
            folderSegments.push({ kind: 'ellipsis' });
            folderSegments.push({ kind: 'folder', id: leafFolder.id, label: leafFolderLabel });
        }

        const getItemIcon = (itemType: 'note' | 'recording' | 'chat') => {
            if (itemType === 'note') return FileText;
            if (itemType === 'recording') return Mic;
            return MessageCircle;
        };

        const renderSpacePanel = (folderId: string, path: string[], depth: number): React.ReactNode => {
            const folderEntries = headerSpaceEntriesByFolderId.get(folderId) || [];
            const panelFolder = sidebarFoldersById.get(folderId);
            const panelSpaceLabel = (panelFolder?.name || 'Untitled space').trim() || 'Untitled space';
            const panelPositionClass = depth === 0
                ? 'absolute left-0 top-[calc(100%+2px)]'
                : 'fixed';
            const anchoredPosition = depth > 0 ? headerSpacePanelAnchorsByFolderId[folderId] : null;

            return (
                <div
                    className={`${panelPositionClass} z-[108] w-[300px] rounded-xl border es-global-outline es-general-background shadow-2xl`}
                    role="dialog"
                    aria-label={`Items in ${panelSpaceLabel}`}
                    style={depth > 0 ? ({
                        left: anchoredPosition?.left ?? 0,
                        top: anchoredPosition?.top ?? 0,
                        visibility: anchoredPosition ? 'visible' : 'hidden',
                    }) : undefined}
                    onMouseEnter={() => {
                        cancelHeaderSpaceCloseTimer();
                        setActiveHeaderSpaceSwitcherFolderId(path[0] || folderId);
                    }}
                    onMouseLeave={() => {
                        scheduleHeaderSpaceClose();
                    }}
                >
                    {depth === 0 ? (
                        <div className="border-b es-global-separator px-3 py-2">
                            <div className="text-[10px] font-semibold uppercase tracking-wider text-stone-500">Space</div>
                            <div className="mt-0.5 text-xs font-medium es-general-text truncate">{panelSpaceLabel}</div>
                        </div>
                    ) : null}
                    <div className="max-h-80 overflow-auto p-1.5 space-y-0.5">
                        {folderEntries.length ? folderEntries.map((entry) => {
                            if (entry.kind === 'folder') {
                                const nestedPath = [...path, entry.id];
                                const hasSubmenu = (headerSpaceEntriesByFolderId.get(entry.id) || []).length > 0;
                                const isSubmenuOpen = hasSubmenu
                                    && headerSpaceHoverPath.length >= nestedPath.length
                                    && nestedPath.every((value, index) => headerSpaceHoverPath[index] === value);
                                return (
                                    <div
                                        key={`header-space-folder-${entry.id}`}
                                        className="relative"
                                        onMouseEnter={(event) => {
                                            const rect = event.currentTarget.getBoundingClientRect();
                                            setHeaderSpacePanelAnchorsByFolderId((previous) => ({
                                                ...previous,
                                                [entry.id]: {
                                                    left: rect.right + 2,
                                                    top: rect.top - 8,
                                                },
                                            }));
                                            cancelHeaderSpaceCloseTimer();
                                            setActiveHeaderSpaceSwitcherFolderId(path[0] || folderId);
                                            setHeaderSpaceHoverPath(nestedPath);
                                        }}
                                    >
                                        <div
                                            className={`w-full rounded-lg px-2.5 py-2 text-left text-xs inline-flex items-center gap-2 transition-colors ${isSubmenuOpen ? 'es-general-selected-item' : 'es-general-item-hover es-general-text'}`}
                                        >
                                            <FolderGlyph size={12} className="shrink-0 opacity-80" />
                                            <span className="min-w-0 flex-1 truncate font-medium">{entry.title}</span>
                                            <ChevronRight size={12} className="shrink-0 opacity-70" />
                                        </div>
                                        {isSubmenuOpen ? renderSpacePanel(entry.id, nestedPath, depth + 1) : null}
                                    </div>
                                );
                            }

                            const itemKind = entry.kind as 'note' | 'recording' | 'chat';
                            const IconComponent = getItemIcon(itemKind);
                            const isCurrentItem = itemKind === params.type && entry.id === params.id;
                            return (
                                <button
                                    key={`header-space-item-${itemKind}-${entry.id}`}
                                    className={`w-full rounded-lg px-2.5 py-2 text-left text-xs inline-flex items-center gap-2 transition-colors ${isCurrentItem ? 'es-general-selected-item' : 'es-general-item-hover es-general-text'}`}
                                    onMouseEnter={() => {
                                        cancelHeaderSpaceCloseTimer();
                                        setActiveHeaderSpaceSwitcherFolderId(path[0] || folderId);
                                        setHeaderSpaceHoverPath(path);
                                    }}
                                    onClick={(event) => {
                                        event.preventDefault();
                                        event.stopPropagation();
                                        cancelHeaderSpaceCloseTimer();
                                        setActiveHeaderSpaceSwitcherFolderId(null);
                                        setHeaderSpaceHoverPath([]);
                                        setHeaderSpacePanelAnchorsByFolderId({});
                                        if (isCurrentItem) return;
                                        selectLibraryItem({ type: itemKind, id: entry.id });
                                    }}
                                >
                                    <IconComponent size={12} className="shrink-0 opacity-80" />
                                    <span className="min-w-0 flex-1 truncate font-medium">{entry.title}</span>
                                </button>
                            );
                        }) : (
                            <div className="px-2.5 py-2 text-xs text-stone-500">This space is empty.</div>
                        )}
                    </div>
                </div>
            );
        };

        return (
            <div className="flex min-w-0 items-center gap-1.5 h-8">
                {folderSegments.map((segment, index) => {
                    const key = segment.kind === 'ellipsis' ? `folder-segment-ellipsis-${index}` : `folder-segment-${segment.id}-${index}`;
                    const isFolderSegment = segment.kind === 'folder';
                    const isOpen = isFolderSegment && activeHeaderSpaceSwitcherFolderId === segment.id;
                    return (
                        <React.Fragment key={key}>
                            {index > 0 ? <span className="text-xs text-stone-400">/</span> : null}
                            {segment.kind === 'ellipsis' ? (
                                <span className="text-xs text-stone-400">...</span>
                            ) : (
                                <div
                                    className="relative min-w-0"
                                    onMouseEnter={() => {
                                        cancelHeaderSpaceCloseTimer();
                                        setActiveHeaderSpaceSwitcherFolderId(segment.id);
                                        setHeaderSpaceHoverPath([segment.id]);
                                    }}
                                    onMouseLeave={() => {
                                        scheduleHeaderSpaceClose();
                                    }}
                                >
                                    <span className="inline-flex max-w-full items-center rounded-md px-1.5 h-7 text-xs font-medium text-stone-600 transition-colors hover:bg-stone-100 hover:text-stone-900">
                                        <span className="truncate max-w-[220px]">{segment.label}</span>
                                    </span>
                                    {isOpen ? renderSpacePanel(segment.id, [segment.id], 0) : null}
                                </div>
                            )}
                        </React.Fragment>
                    );
                })}

                <span className="text-xs text-stone-400">/</span>
                <button
                    type="button"
                    className="min-w-0 max-w-full shrink text-left text-sm font-medium text-stone-900 transition-opacity hover:opacity-75 h-8 inline-flex items-center"
                    onClick={params.onRenameClick}
                    title={params.renameTooltip}
                >
                    <span className="block truncate">{itemTitle}</span>
                </button>
            </div>
        );
    }, [
        activeHeaderSpaceSwitcherFolderId,
        cancelHeaderSpaceCloseTimer,
        getFolderTrail,
        headerSpacePanelAnchorsByFolderId,
        headerSpaceEntriesByFolderId,
        headerSpaceHoverPath,
        scheduleHeaderSpaceClose,
        selectLibraryItem,
        sidebarFoldersById,
    ]);

    const openAskTab = useCallback(() => {
        isPersistingChatRef.current = false;
        const askTab: LibraryTab = { type: 'ask', id: 'global' };
        const askKey = getLibraryTabKey(askTab);
        setOpenLibraryTabs((previous) => {
            if (previous.some((entry) => getLibraryTabKey(entry) === askKey)) {
                return previous;
            }
            return [...previous, askTab];
        });
        setHasInitializedLibraryTabs(true);
        setActiveLibraryTabKey(askKey);
        setSelectedLibraryItem(null);
        setSelectedRecordingId(null);
        setActiveSection('library');
        setIsLibrarySearchOpen(false);
    }, []);

    const createProductTourNote = useCallback(() => {
        const now = Date.now();
        const newNote = normalizeDashboardNote({
            id: crypto.randomUUID(),
            title: 'Untitled note',
            text: '',
            isCloudSynced: notesData.isAuthenticated === true && settings.syncSettings?.strictPrivacyMode !== true,
            colorId: settings.stickyNoteDefaultColorId,
            folderId: '',
            createdAt: now,
            lastModified: now,
            sourceRecordingIds: [],
        });
        setNotesData((previous) => ({
            ...previous,
            notes: [newNote, ...previous.notes],
        }));
        ipcRenderer.send('save-note', newNote);
        setLibraryFilter('all');
        openLibraryItemTab({ type: 'note', id: newNote.id }, { activate: true, closeSearch: true });
        return newNote.id;
    }, [
        notesData.isAuthenticated,
        openLibraryItemTab,
        settings.stickyNoteDefaultColorId,
        settings.syncSettings?.strictPrivacyMode,
    ]);

    const productTourSteps = useMemo<ProductTourStep[]>(() => {
        const holdShortcut = settings.shortcuts?.dictationHoldPreset === 'disabled'
            ? 'your dictation shortcut'
            : 'Fn/Globe';
        const quickNoteShortcut = settings.shortcuts?.quickNotePreset === 'ctrl_n'
            ? 'Control+N'
            : 'your Quick Notes shortcut';
        const recordShortcut = ({
            ctrl_r: 'Control+R',
            fn_r_toggle: 'Fn/Globe + R',
            cmd_ctrl_r: 'Command+Control+R',
            cmd_shift_r: 'Command+Shift+R',
            opt_cmd_r: 'Option+Command+R',
        } as const)[settings.shortcuts?.recordModePreset || 'ctrl_r'] || 'your recording shortcut';

        return [
            {
                id: 'workspace-library',
                targetId: 'workspace-library',
                title: 'Control your workspace',
                body: 'The sidebar keeps notes, recordings and chats in the same place. You can hide items by category, organize them in spaces or even pin them for quicker access. You can also see the latest items so you don\'t loose track of your last thoughts.',
                spotlight: { padding: 10, extendTop: 14, extendRight: -14, extendBottom: 18, extendLeft: 24 },
            },
            {
                id: 'search-entry',
                targetId: 'library-search-button',
                title: 'Search from anywhere',
                body: 'Click Search or press Command+G to find notes, recordings, chats, and spaces.',
            },
            {
                id: 'search-panel',
                targetId: 'library-search-panel',
                popoverTargetId: 'library-search-input',
                title: 'The search modal',
                body: 'Type here to search through all your work. Filter by category or date, displaying a quick content preview.',
                spotlight: { padding: 0 },
            },
            {
                id: 'ask-entry',
                targetId: 'ask-sidebar-button',
                title: 'Start a Chat',
                body: 'Click Ask or press Command+N to open a new chat thread when you want to question, summarize, or transform your content into actionable work.',
            },
            {
                id: 'ask',
                targetId: 'ask-composer',
                title: 'Ask anything',
                body: 'Here you can summarize recordings, search your notes, and answer any question. You may select specific notes, chats, spaces, or recordings as context or let the AI navigate your entire workspace.',
            },
            {
                id: 'notes-dictation',
                targetId: 'new-note-button',
                title: 'Create notes',
                body: 'In the notes section, you may create a fresh note in your library by pressing this + button. Click the highlighted area and the tour will open one for you.',
            },
            {
                id: 'note-editor',
                targetId: 'note-editor',
                title: 'Write or speak into your notes',
                body: `This is the note canvas. Type normally, or hold ${holdShortcut} in any text field to trigger dictation. Explore the command tools for formatting by typing '/' or apply formatting to selected text.`,
                spotlight: { padding: 10 },
            },
            {
                id: 'tabs-bar',
                targetId: 'tabs-bar',
                title: 'Keep work open in tabs',
                body: 'The tabs bar keeps notes, recordings, and Chats threads open side by side. Switch between work, close finished tabs, or use the + button to start something new.',
                spotlight: { padding: 0 },
            },
            {
                id: 'recordings',
                targetId: 'recording-start-button',
                title: 'Record meetings',
                body: `Press the microphone button or ${recordShortcut} to start recording when you want transcripts, summaries or to be able to recall information from meetings. You can stop the recording at any time  by pressing the stop button or ${recordShortcut} again.`,
            },
            {
                id: 'settings-privacy',
                targetId: 'settings-button',
                title: 'Tune privacy and explore',
                body: 'Settings is where you can setup your preferences, go completely Local, use API Keys or use Cloud resources. Navigate settings for recordings, Quick Notes, Dictation or handle your plan.',
                spotlight: { padding: 6, offsetY: 2 },
            },
            {
                id: 'settings-storage-sync',
                targetId: 'settings-storage-sync',
                title: 'Storage and sync defaults',
                body: 'Choose whether new notes, quick notes, recordings, and chats are stored privately on this device or synced to cloud. This default matters for privacy, but individual items can still be switched later.',
                spotlight: { padding: 10 },
            },
            {
                id: 'settings-dictation',
                targetId: 'settings-dictation',
                title: 'Dictation processing',
                body: 'This is where you can choose local or cloud processing for dictation. Local uses this computer compute power, while cloud routes speech through the configured cloud service for instant results. Hold Fn/Globe or press Fn/Globe + Space to dictate into any text field.',
                spotlight: { padding: 10 },
            },
            {
                id: 'quick-notes',
                targetId: 'quick-notes-settings',
                popoverPlacement: 'top-right',
                title: 'Quick Notes for fleeting thoughts',
                body: `Use ${quickNoteShortcut} to capture a thought without leaving your current window. Quick Notes follow your storage default, use your dictation setup for voice processing, and can be configured here for popup behavior, placement, and color.`,
            },
            {
                id: 'settings-recordings',
                targetId: 'settings-recordings',
                popoverPlacement: 'top-right',
                title: 'Recording capture and processing',
                body: 'Recordings settings cover meeting detection, capture mode, meeting transcription processing, and summaries. Use the local/cloud toggles to decide whether transcription and summaries run on this device or in the cloud.',
                spotlight: { padding: 10 },
            },
            {
                id: 'settings-chats',
                targetId: 'settings-chats',
                popoverPlacement: 'top-right',
                title: 'Chats and AI actions',
                body: 'Chats settings control where AI Chat responses are processed. Choose cloud processing, for faster and more reliable results.',
                spotlight: { padding: 10 },
            },
        ];
    }, [
        settings.shortcuts?.dictationHoldPreset,
        settings.shortcuts?.quickNotePreset,
        settings.shortcuts?.recordModePreset,
    ]);

    const handleProductTourStepEnter = useCallback((step: ProductTourStep) => {
        const settingsTabByTourStep: Partial<Record<string, SettingsTabKey>> = {
            'settings-storage-sync': 'storageSync',
            'settings-dictation': 'dictation',
            'quick-notes': 'quickNotes',
            'settings-recordings': 'recordings',
            'settings-chats': 'chats',
        };
        const targetSettingsTab = settingsTabByTourStep[step.id];
        if (targetSettingsTab) {
            setIsLibrarySearchOpen(false);
            setActiveSection('library');
            setActiveSettingsTab(targetSettingsTab);
            setIsSettingsModalOpen(true);
            return;
        }

        setIsSettingsModalOpen(false);
        setActiveSection('library');

        if (step.id === 'search-panel') {
            updateLayoutSettings({ sidebarCollapsed: false });
            setOpenedSearchFromTabs(false);
            setIsLibrarySearchOpen(true);
            return;
        }

        setIsLibrarySearchOpen(false);

        if (step.id === 'ask') {
            openAskTab();
            return;
        }

        if (step.id === 'workspace-library') {
            updateLayoutSettings({
                sidebarCollapsed: false,
                spacesExpanded: true,
                notesExpanded: true,
                recordingsExpanded: true,
                chatsExpanded: true,
            });
            return;
        }

        if (step.id === 'notes-dictation') {
            updateLayoutSettings({
                sidebarCollapsed: false,
                notesExpanded: true,
            });
            return;
        }

        if (step.id === 'note-editor' || step.id === 'tabs-bar') {
            updateLayoutSettings({
                sidebarCollapsed: false,
                notesExpanded: true,
            });
            if (productTourCreatedNoteIdRef.current) {
                selectLibraryItem({ type: 'note', id: productTourCreatedNoteIdRef.current });
            } else {
                productTourCreatedNoteIdRef.current = createProductTourNote();
            }
            return;
        }

        if (step.id === 'search-entry' || step.id === 'ask-entry') {
            updateLayoutSettings({ sidebarCollapsed: false });
            return;
        }

        if (step.id === 'recordings') {
            updateLayoutSettings({
                sidebarCollapsed: false,
                recordingsExpanded: true,
            });
            return;
        }

        if (step.id === 'settings-privacy') {
            updateLayoutSettings({ sidebarCollapsed: false });
        }
    }, [createProductTourNote, openAskTab, selectLibraryItem, updateLayoutSettings]);

    const closeProductTour = useCallback(() => {
        setIsProductTourOpen(false);
        void updateSettings({ productTourVersionSeen: CURRENT_PRODUCT_TOUR_VERSION });
    }, [updateSettings]);

    const replayProductTour = useCallback(() => {
        setIsSettingsModalOpen(false);
        setActiveSection('library');
        productTourCreatedNoteIdRef.current = null;
        setHasAutoStartedProductTour(true);
        setIsProductTourOpen(true);
    }, []);

    useEffect(() => {
        if (isLoading || hasAutoStartedProductTour || isProductTourOpen) return;
        if (settings.onboardingCompleted !== true) return;
        if (settings.productTourVersionSeen >= CURRENT_PRODUCT_TOUR_VERSION) return;

        productTourCreatedNoteIdRef.current = null;
        setHasAutoStartedProductTour(true);
        setIsProductTourOpen(true);
    }, [
        hasAutoStartedProductTour,
        isLoading,
        isProductTourOpen,
        settings.onboardingCompleted,
        settings.productTourVersionSeen,
    ]);

    const activateLibraryTab = useCallback((tab: LibraryTab) => {
        openLibraryItemTab(tab, { activate: true, closeSearch: false });
    }, [openLibraryItemTab]);

    const closeLibraryTab = useCallback((tab: LibraryTab) => {
        const closeKey = getLibraryTabKey(tab);

        setOpenLibraryTabs((previous) => {
            const closingIndex = previous.findIndex((entry) => getLibraryTabKey(entry) === closeKey);
            if (closingIndex < 0) return previous;
            const closedTab = previous[closingIndex];
            closedLibraryTabsRef.current = [
                closedTab,
                ...closedLibraryTabsRef.current.filter((entry) => getLibraryTabKey(entry) !== closeKey),
            ].slice(0, 20);
            const nextTabs = previous.filter((entry) => getLibraryTabKey(entry) !== closeKey);

            if (activeLibraryTabKey === closeKey) {
                const fallback = previous[closingIndex - 1] || previous[closingIndex + 1] || null;
                if (fallback) {
                    const fallbackKey = getLibraryTabKey(fallback);
                    setActiveLibraryTabKey(fallbackKey);
                    setActiveSection('library');
                    if (fallback.type === 'ask') {
                        setSelectedLibraryItem(null);
                        setSelectedRecordingId(null);
                    } else {
                        setSelectedLibraryItem({ type: fallback.type, id: fallback.id });
                        if (fallback.type === 'recording') {
                            setSelectedRecordingId(fallback.id);
                            setUnreadRecordingIds((previous) => {
                                if (!previous.has(fallback.id)) return previous;
                                const updated = new Set(previous);
                                updated.delete(fallback.id);
                                return updated;
                            });
                        }
                    }
                } else {
                    setActiveLibraryTabKey(null);
                    setSelectedLibraryItem(null);
                }
            }
            return nextTabs;
        });
    }, [activeLibraryTabKey]);

    const reopenLastClosedLibraryTab = useCallback(() => {
        const validKeys = new Set([
            ...allLibraryItems.map((item) => getLibraryTabKey(item)),
            ...chatsData.chats.map((chat) => getLibraryTabKey({ type: 'ask', id: chat.id })),
            getLibraryTabKey({ type: 'ask', id: 'global' }),
        ]);
        while (closedLibraryTabsRef.current.length > 0) {
            const tab = closedLibraryTabsRef.current.shift();
            if (!tab) continue;
            const tabKey = getLibraryTabKey(tab);
            if (!validKeys.has(tabKey)) continue;
            setOpenLibraryTabs((previous) => (
                previous.some((entry) => getLibraryTabKey(entry) === tabKey)
                    ? previous
                    : [...previous, tab]
            ));
            setHasInitializedLibraryTabs(true);
            setActiveLibraryTabKey(tabKey);
            setActiveSection('library');
            setIsLibrarySearchOpen(false);
            if (tab.type === 'ask') {
                setSelectedLibraryItem(null);
                setSelectedRecordingId(null);
            } else {
                setSelectedLibraryItem({ type: tab.type, id: tab.id });
                if (tab.type === 'recording') {
                    setSelectedRecordingId(tab.id);
                }
            }
            return;
        }
    }, [allLibraryItems, chatsData.chats]);

    const handleTabDragStart = useCallback((e: React.DragEvent, key: string) => {
        setDraggedTabKey(key);
        e.dataTransfer.effectAllowed = 'move';
        e.dataTransfer.setData('text/plain', key);
    }, []);

    const handleTabDragOver = useCallback((e: React.DragEvent) => {
        e.preventDefault();
    }, []);

    const handleTabDragEnter = useCallback((e: React.DragEvent, targetKey: string) => {
        if (draggedTabKey === null || draggedTabKey === targetKey) return;

        setOpenLibraryTabs((previous) => {
            const next = [...previous];
            const draggedIndex = next.findIndex((t) => getLibraryTabKey(t) === draggedTabKey);
            const targetIndex = next.findIndex((t) => getLibraryTabKey(t) === targetKey);

            if (draggedIndex < 0 || targetIndex < 0) return previous;

            const [draggedTab] = next.splice(draggedIndex, 1);
            next.splice(targetIndex, 0, draggedTab);
            return next;
        });
    }, [draggedTabKey]);

    const handleTabDragEnd = useCallback(() => {
        setDraggedTabKey(null);
    }, []);

    useEffect(() => {
        if (!selectedLibraryItem) {
            if (!openLibraryTabs.length) {
                setActiveLibraryTabKey(null);
            }
            return;
        }
        const key = getLibraryTabKey(selectedLibraryItem);
        setActiveLibraryTabKey(key);
        setOpenLibraryTabs((previous) => {
            if (previous.some((entry) => getLibraryTabKey(entry) === key)) return previous;
            return [...previous, selectedLibraryItem];
        });
    }, [openLibraryTabs.length, selectedLibraryItem]);

    useEffect(() => {
        if (!hasLoadedNotesOnce || !hasLoadedRecordingsOnce || !hasLoadedChatsOnce) return;
        const validKeys = new Set(allLibraryItems.map((item) => getLibraryTabKey(item)));
        setOpenLibraryTabs((previous) => previous.filter((entry) => {
            if (entry.type === 'ask') {
                if (entry.id === 'global') return true;
                if (activeLibraryTabKey === getLibraryTabKey(entry)) return true;
                return chatsData.chats.some((c) => c.id === entry.id);
            }
            return validKeys.has(getLibraryTabKey(entry));
        }));
    }, [activeLibraryTabKey, allLibraryItems, hasLoadedNotesOnce, hasLoadedRecordingsOnce, hasLoadedChatsOnce, chatsData.chats]);

    useEffect(() => {
        if (!hasRestoredLibraryTabs) return;
        writeLibraryTabsSnapshot({
            openTabs: openLibraryTabs,
            activeTabKey: activeLibraryTabKey,
        });
    }, [activeLibraryTabKey, hasRestoredLibraryTabs, openLibraryTabs]);

    useEffect(() => {
        const handleGlobalKeyDown = (event: KeyboardEvent) => {
            const target = event.target as HTMLElement | null;
            const isTyping = target && (
                target.tagName === 'INPUT' ||
                target.tagName === 'TEXTAREA' ||
                target.isContentEditable
            );
            if (isTyping) return;

            if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 'g') {
                event.preventDefault();
                setOpenedSearchFromTabs(false);
                setIsLibrarySearchOpen(true);
            } else if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 'n') {
                event.preventDefault();
                openAskTab();
            }
        };
        window.addEventListener('keydown', handleGlobalKeyDown);
        return () => window.removeEventListener('keydown', handleGlobalKeyDown);
    }, [openAskTab]);

    useEffect(() => {
        if (activeSection !== 'library') return;

        const validKeys = new Set(allLibraryItems.map((item) => getLibraryTabKey(item)));
        const selectedKey = getLibraryTabKey(selectedLibraryItem);

        // If an ask tab is active and still open, it's a valid state
        if (activeLibraryTabKey && activeLibraryTabKey.startsWith('ask:')) {
            const askTabOpen = openLibraryTabs.some((entry) => getLibraryTabKey(entry) === activeLibraryTabKey);
            if (askTabOpen) return;
            if (activeLibraryTabKey === 'ask:global') return; // Prevent race condition during new chat session replacement
        }

        if (selectedLibraryItem && validKeys.has(selectedKey)) {
            if (selectedLibraryItem.type === 'recording' && selectedRecordingId !== selectedLibraryItem.id) {
                setSelectedRecordingId(selectedLibraryItem.id);
            }
            return;
        }

        const validOpenTabs = openLibraryTabs.filter((entry) => {
            if (entry.type === 'ask') return true;
            return validKeys.has(getLibraryTabKey(entry));
        });
        if (validOpenTabs.length) {
            const activeTab = validOpenTabs.find((entry) => getLibraryTabKey(entry) === activeLibraryTabKey) || validOpenTabs[0];
            if (activeTab) {
                setActiveLibraryTabKey(getLibraryTabKey(activeTab));
                if (activeTab.type === 'ask') {
                    setSelectedLibraryItem(null);
                    setSelectedRecordingId(null);
                } else {
                    setSelectedLibraryItem({ type: activeTab.type, id: activeTab.id });
                    if (activeTab.type === 'recording') {
                        setSelectedRecordingId(activeTab.id);
                    }
                }
                return;
            }
        }

        if (!hasInitializedLibraryTabs) {
            const initialItem = allLibraryItems[0];
            setHasInitializedLibraryTabs(true);
            if (initialItem) {
                openLibraryItemTab(initialItem, { activate: true, closeSearch: false });
            }
            return;
        }

        if (selectedLibraryItem) {
            setSelectedLibraryItem(null);
        }
        if (activeLibraryTabKey) {
            setActiveLibraryTabKey(null);
        }
    }, [
        activeLibraryTabKey,
        activeSection,
        allLibraryItems,
        hasInitializedLibraryTabs,
        openLibraryItemTab,
        openLibraryTabs,
        selectedLibraryItem,
        selectedRecordingId,
    ]);

    const saveSelectedNote = useCallback((updatedFields: Record<string, any>) => {
        if (!selectedNote) return;
        const candidateNote = normalizeDashboardNote({
            ...selectedNote,
            ...updatedFields,
            lastModified: selectedNote.lastModified,
        });
        if (areNotesEquivalentForEdit(selectedNote, candidateNote)) {
            return;
        }
        const nextNote = normalizeDashboardNote({
            ...candidateNote,
            lastModified: Date.now(),
        });
        setNotesData((previous) => ({
            ...previous,
            notes: previous.notes.map((note) => (note.id === nextNote.id ? nextNote : note)),
        }));
        ipcRenderer.send('save-note', nextNote);
    }, [selectedNote]);

    const cancelNoteRename = useCallback(() => {
        setRenamingNoteId(null);
        setNoteRenameDraft('');
        skipNoteRenameBlurRef.current = false;
    }, []);

    const startNoteRename = useCallback((note: Note) => {
        setRenamingRecordingId(null);
        setRecordingRenameDraft('');
        setRenamingNoteId(note.id);
        setNoteRenameDraft((note.title || '').trim() || 'Untitled note');
    }, []);

    const commitNoteRename = useCallback((noteId: string) => {
        const note = notesData.notes.find((entry) => entry.id === noteId);
        if (!note) {
            cancelNoteRename();
            return;
        }
        const nextTitle = noteRenameDraft.trim() || 'Untitled note';
        const currentTitle = (note.title || '').trim() || 'Untitled note';
        if (nextTitle === currentTitle) {
            cancelNoteRename();
            return;
        }

        const candidateNote = normalizeDashboardNote({
            ...note,
            title: nextTitle,
            lastModified: note.lastModified,
        });
        if (areNotesEquivalentForEdit(note, candidateNote)) {
            cancelNoteRename();
            return;
        }

        const nextNote = normalizeDashboardNote({
            ...candidateNote,
            lastModified: Date.now(),
        });
        setNotesData((previous) => ({
            ...previous,
            notes: previous.notes.map((entry) => (entry.id === nextNote.id ? nextNote : entry)),
        }));
        ipcRenderer.send('save-note', nextNote);
        cancelNoteRename();
    }, [cancelNoteRename, noteRenameDraft, notesData.notes]);

    const applyNotePatchById = useCallback((noteId: string, patch: Partial<Note>): boolean => {
        const note = notesData.notes.find((entry) => entry.id === noteId);
        if (!note) return false;
        const candidateNote = normalizeDashboardNote({
            ...note,
            ...patch,
            lastModified: note.lastModified,
        });
        if (areNotesEquivalentForEdit(note, candidateNote)) {
            return false;
        }
        const nextNote = normalizeDashboardNote({
            ...candidateNote,
            lastModified: Date.now(),
        });
        setNotesData((previous) => ({
            ...previous,
            notes: previous.notes.map((entry) => (entry.id === nextNote.id ? nextNote : entry)),
        }));
        ipcRenderer.send('save-note', nextNote);
        return true;
    }, [notesData.notes]);

    const createNotesFolder = useCallback((parentId: string = '') => {
        const normalizedParentId = String(parentId || '').trim();
        const availableFolderIds = new Set(
            (notesData.folders || [])
                .filter((folder) => folder.id && folder.id !== 'default')
                .map((folder) => folder.id),
        );
        const parentFolderId = normalizedParentId && availableFolderIds.has(normalizedParentId) ? normalizedParentId : '';
        const existingNames = new Set(
            (notesData.folders || [])
                .filter((folder) => folder.id && folder.id !== 'default')
                .map((folder) => String(folder.name || '').trim().toLowerCase())
                .filter(Boolean),
        );
        const baseName = 'New folder';
        let nextName = baseName;
        let suffix = 2;
        while (existingNames.has(nextName.toLowerCase())) {
            nextName = `${baseName} ${suffix}`;
            suffix += 1;
        }
        ipcRenderer.send('create-folder', {
            name: nextName,
            parentId: parentFolderId,
        });
        if (parentFolderId) {
            setExpandedFolderIds((previous) => {
                const next = new Set(previous);
                next.add(parentFolderId);
                return next;
            });
        }
    }, [notesData.folders]);

    const cancelFolderRename = useCallback(() => {
        setRenamingFolderId(null);
        setFolderRenameDraft('');
        skipFolderRenameBlurRef.current = false;
    }, []);

    const startFolderRename = useCallback((folder: Folder) => {
        setRenamingNoteId(null);
        setNoteRenameDraft('');
        setRenamingRecordingId(null);
        setRecordingRenameDraft('');
        setRenamingFolderId(folder.id);
        setFolderRenameDraft((folder.name || '').trim() || 'Untitled folder');
        setSidebarMenuTarget(null);
        setNoteMenuFolderOptionsForId(null);
    }, []);

    const commitFolderRename = useCallback((folderId: string) => {
        const folder = sidebarFolders.find((entry) => entry.id === folderId);
        if (!folder) {
            cancelFolderRename();
            return;
        }
        const nextName = folderRenameDraft.trim() || 'Untitled folder';
        const currentName = (folder.name || '').trim() || 'Untitled folder';
        if (nextName === currentName) {
            cancelFolderRename();
            return;
        }
        ipcRenderer.send('rename-folder', { id: folderId, name: nextName });
        setNotesData((previous) => ({
            ...previous,
            folders: previous.folders.map((entry) => (
                entry.id === folderId ? { ...entry, name: nextName } : entry
            )),
        }));
        cancelFolderRename();
    }, [cancelFolderRename, folderRenameDraft, sidebarFolders]);

    const saveFolderCustomization = useCallback(() => {
        if (!customizingFolder) return;
        const name = customizingFolderName.trim() || 'Untitled space';
        const iconId = customizingFolderIconId;
        const colorId = customizingFolderColorId;

        ipcRenderer.send('rename-folder', {
            id: customizingFolder.id,
            name,
            iconId,
            colorId,
        });

        setNotesData((previous) => ({
            ...previous,
            folders: previous.folders.map((entry) => (
                entry.id === customizingFolder.id
                    ? { ...entry, name, iconId, colorId }
                    : entry
            )),
        }));

        setCustomizingFolder(null);
        setIconSearchQuery('');
    }, [customizingFolder, customizingFolderName, customizingFolderIconId, customizingFolderColorId]);

    const deleteFolderById = useCallback((folder: Folder) => {
        if (!folder?.id) return;
        const confirmed = window.confirm('Are you sure you want to delete this folder? The notes inside the folder will not be deleted, they will simply be released.');
        if (!confirmed) return;
        ipcRenderer.send('delete-folder', folder.id);
        const reparentTargetId = String((folder as any).parentId || '').trim();
        setNotesData((previous) => ({
            ...previous,
            folders: previous.folders
                .filter((entry) => entry.id !== folder.id)
                .map((entry) => (
                    String((entry as any).parentId || '') === folder.id
                        ? ({ ...entry, parentId: reparentTargetId } as Folder)
                        : entry
                )),
            notes: previous.notes.map((entry) => (
                entry.folderId === folder.id
                    ? normalizeDashboardNote({ ...entry, folderId: '', lastModified: entry.lastModified })
                    : entry
            )),
        }));
        setExpandedFolderIds((previous) => {
            const next = new Set(previous);
            next.delete(folder.id);
            return next;
        });
        if (noteFolderDropTargetId === folder.id) {
            setNoteFolderDropTargetId(null);
        }
        if (renamingFolderId === folder.id) {
            cancelFolderRename();
        }
    }, [cancelFolderRename, noteFolderDropTargetId, renamingFolderId]);

    const moveNoteToFolder = useCallback((noteId: string, folderId: string) => {
        const normalizedFolderId = String(folderId || '').trim();
        if (normalizedFolderId && !sidebarFolders.some((folder) => folder.id === normalizedFolderId)) {
            return;
        }
        const didUpdate = applyNotePatchById(noteId, { folderId: normalizedFolderId });
        if (didUpdate) {
            if (normalizedFolderId) {
                setExpandedFolderIds((previous) => {
                    const next = new Set(previous);
                    next.add(normalizedFolderId);
                    return next;
                });
            }
            setSidebarMenuTarget(null);
            setNoteMenuFolderOptionsForId(null);
            setActiveMoveToFolderTarget(null);
            setFolderSearchQuery('');
        }
    }, [applyNotePatchById, sidebarFolders]);

    const moveRecordingToFolder = useCallback(async (recordingId: string, folderId: string) => {
        const normalizedFolderId = String(folderId || '').trim();
        if (normalizedFolderId && !sidebarFolders.some((f) => f.id === normalizedFolderId)) {
            return;
        }
        setRecordings((prev) =>
            prev.map((rec) =>
                rec.id === recordingId ? { ...rec, folderId: normalizedFolderId } : rec
            )
        );
        try {
            await ipcRenderer.invoke('recordings:update-metadata', {
                id: recordingId,
                folderId: normalizedFolderId,
            });
            if (normalizedFolderId) {
                setExpandedFolderIds((prev) => {
                    const next = new Set(prev);
                    next.add(normalizedFolderId);
                    return next;
                });
            }
            setSidebarMenuTarget(null);
            setNoteMenuFolderOptionsForId(null);
            setActiveMoveToFolderTarget(null);
            setFolderSearchQuery('');
        } catch (e) {
            console.error(e);
            void refreshRecordings();
        }
    }, [sidebarFolders, refreshRecordings]);

    const moveChatToFolder = useCallback(async (chatId: string, folderId: string) => {
        const normalizedFolderId = String(folderId || '').trim();
        if (normalizedFolderId && !sidebarFolders.some((f) => f.id === normalizedFolderId)) {
            return;
        }
        const targetChat = chatsData.chats.find((entry) => entry.id === chatId);
        if (!targetChat) return;
        const nextSession: ChatSession = {
            ...targetChat,
            folderId: normalizedFolderId,
            updatedAt: Date.now(),
        };
        setChatsData((previous) => ({
            ...previous,
            chats: previous.chats.map((entry) => (entry.id === chatId ? nextSession : entry)),
        }));
        ipcRenderer.send('save-chat', nextSession);
        if (normalizedFolderId) {
            setExpandedFolderIds((prev) => {
                const next = new Set(prev);
                next.add(normalizedFolderId);
                return next;
            });
        }
        setSidebarMenuTarget(null);
        setNoteMenuFolderOptionsForId(null);
        setActiveMoveToFolderTarget(null);
        setFolderSearchQuery('');
    }, [chatsData.chats, sidebarFolders]);

    const openMoveToFolderPopover = useCallback((target: { type: 'note' | 'recording' | 'chat'; id: string }) => {
        setSidebarMenuTarget(null);
        setNoteMenuFolderOptionsForId(null);
        setActiveMoveToFolderTarget(target);
        setFolderSearchQuery('');
    }, []);

    const getNoteFolderIdById = useCallback((noteId: string) => {
        const note = notesData.notes.find((entry) => entry.id === noteId);
        const folderId = String(note?.folderId || '').trim();
        return folderId && sidebarFolderIdSet.has(folderId) ? folderId : '';
    }, [notesData.notes, sidebarFolderIdSet]);

    const getRecordingFolderIdById = useCallback((recordingId: string) => {
        const recording = recordings.find((entry) => entry.id === recordingId);
        const folderId = String(recording?.folderId || '').trim();
        return folderId && sidebarFolderIdSet.has(folderId) ? folderId : '';
    }, [recordings, sidebarFolderIdSet]);

    const getChatFolderIdById = useCallback((chatId: string) => {
        const chat = chatsData.chats.find((entry) => entry.id === chatId);
        const folderId = String(chat?.folderId || '').trim();
        return folderId && sidebarFolderIdSet.has(folderId) ? folderId : '';
    }, [chatsData.chats, sidebarFolderIdSet]);

    const getSidebarEntityFolderId = useCallback((target: { type: 'note' | 'recording' | 'chat'; id: string }) => {
        if (target.type === 'note') {
            return getNoteFolderIdById(target.id);
        }
        if (target.type === 'recording') {
            return getRecordingFolderIdById(target.id);
        }
        return getChatFolderIdById(target.id);
    }, [getChatFolderIdById, getNoteFolderIdById, getRecordingFolderIdById]);

    const handleMoveOrRemoveFolderAction = useCallback((target: { type: 'note' | 'recording' | 'chat'; id: string }) => {
        const currentFolderId = getSidebarEntityFolderId(target);
        if (!currentFolderId) {
            openMoveToFolderPopover(target);
            return;
        }
        if (target.type === 'note') {
            moveNoteToFolder(target.id, '');
            return;
        }
        if (target.type === 'recording') {
            void moveRecordingToFolder(target.id, '');
            return;
        }
        void moveChatToFolder(target.id, '');
    }, [getSidebarEntityFolderId, moveChatToFolder, moveNoteToFolder, moveRecordingToFolder, openMoveToFolderPopover]);

    const applyMoveToFolderSelection = useCallback((folderId: string) => {
        if (!activeMoveToFolderTarget) return;
        if (activeMoveToFolderTarget.type === 'note') {
            moveNoteToFolder(activeMoveToFolderTarget.id, folderId);
            return;
        }
        if (activeMoveToFolderTarget.type === 'recording') {
            void moveRecordingToFolder(activeMoveToFolderTarget.id, folderId);
            return;
        }
        void moveChatToFolder(activeMoveToFolderTarget.id, folderId);
    }, [activeMoveToFolderTarget, moveChatToFolder, moveNoteToFolder, moveRecordingToFolder]);

    const isFolderExpanded = useCallback((folderId: string) => expandedFolderIds.has(folderId), [expandedFolderIds]);

    const toggleFolderExpanded = useCallback((folderId: string) => {
        if (!folderId) return;
        setExpandedFolderIds((previous) => {
            const next = new Set(previous);
            if (next.has(folderId)) {
                next.delete(folderId);
            } else {
                next.add(folderId);
            }
            return next;
        });
    }, []);

    const createNewLibraryNote = useCallback((folderId: string = '') => {
        const normalizedFolderId = String(folderId || '').trim();
        const availableFolderIds = new Set(
            (notesData.folders || [])
                .filter((folder) => folder.id && folder.id !== 'default')
                .map((folder) => folder.id),
        );
        const targetFolderId = normalizedFolderId && availableFolderIds.has(normalizedFolderId) ? normalizedFolderId : '';
        const now = Date.now();
        const newNote = normalizeDashboardNote({
            id: crypto.randomUUID(),
            title: 'Untitled note',
            text: '',
            isCloudSynced: notesData.isAuthenticated === true && settings.syncSettings?.strictPrivacyMode !== true,
            colorId: settings.stickyNoteDefaultColorId,
            folderId: targetFolderId,
            createdAt: now,
            lastModified: now,
            sourceRecordingIds: [],
        });
        setNotesData((previous) => ({
            ...previous,
            notes: [newNote, ...previous.notes],
        }));
        ipcRenderer.send('save-note', newNote);
        setLibraryFilter('all');
        openLibraryItemTab({ type: 'note', id: newNote.id }, { activate: true, closeSearch: true });
        if (targetFolderId) {
            setExpandedFolderIds((previous) => {
                const next = new Set(previous);
                next.add(targetFolderId);
                return next;
            });
        }
        return newNote.id;
    }, [
        notesData.folders,
        notesData.isAuthenticated,
        openLibraryItemTab,
        settings.stickyNoteDefaultColorId,
        settings.syncSettings?.strictPrivacyMode,
    ]);

    useEffect(() => {
        const closeActiveLibraryTab = () => {
            if (openLibraryTabs.length <= 0) return;
            const activeTab = openLibraryTabs.find((tab) => getLibraryTabKey(tab) === activeLibraryTabKey)
                || openLibraryTabs[openLibraryTabs.length - 1];
            if (activeTab) {
                closeLibraryTab(activeTab);
            }
        };
        const runDashboardMenuCommand = (command: string) => {
            switch (command) {
                case 'new-note':
                    createNewLibraryNote();
                    break;
                case 'new-chat':
                    openAskTab();
                    break;
                case 'reopen-last-closed-tab':
                    reopenLastClosedLibraryTab();
                    break;
                case 'close-tab':
                    closeActiveLibraryTab();
                    break;
                default:
                    break;
            }
        };
        const handleDashboardMenuCommand = (_event: any, command: string) => {
            runDashboardMenuCommand(command);
        };

        ipcRenderer.on('dashboard:menu-command', handleDashboardMenuCommand);
        ipcRenderer.invoke('dashboard:consume-pending-menu-commands')
            .then((commands: unknown) => {
                if (!Array.isArray(commands)) return;
                commands.forEach((command) => {
                    if (typeof command === 'string') {
                        runDashboardMenuCommand(command);
                    }
                });
            })
            .catch(() => undefined);
        return () => {
            ipcRenderer.removeListener('dashboard:menu-command', handleDashboardMenuCommand);
        };
    }, [
        activeLibraryTabKey,
        closeLibraryTab,
        createNewLibraryNote,
        openAskTab,
        openLibraryTabs,
        reopenLastClosedLibraryTab,
    ]);

    const deleteNoteById = useCallback((noteId: string, title: string = 'Untitled note') => {
        if (!noteId) return;
        if (!window.confirm(`Permanently delete "${title || 'Untitled note'}"?`)) return;
        ipcRenderer.send('delete-note', noteId);
        setNotesData((previous) => ({
            ...previous,
            notes: previous.notes.filter((note) => note.id !== noteId),
        }));
        if (selectedLibraryItem?.type === 'note' && selectedLibraryItem.id === noteId) {
            setSelectedLibraryItem(null);
        }
        setSidebarMenuTarget(null);
        setNoteMenuFolderOptionsForId(null);
    }, [selectedLibraryItem]);

    const deleteChatById = useCallback((chatId: string, title: string = 'Untitled Chat') => {
        if (!chatId) return;
        if (!window.confirm(`Permanently delete "${title || 'Untitled Chat'}"?`)) return;
        ipcRenderer.send('delete-chat', chatId);
        setChatsData((previous) => ({
            ...previous,
            chats: previous.chats.filter((c) => c.id !== chatId),
        }));
        
        // If active tab was this chat, close/fallback
        const activeTabKey = `ask:${chatId}`;
        setOpenLibraryTabs((previous) => {
            const closingIndex = previous.findIndex((entry) => getLibraryTabKey(entry) === activeTabKey);
            if (closingIndex < 0) return previous;
            const nextTabs = previous.filter((entry) => getLibraryTabKey(entry) !== activeTabKey);
            if (activeLibraryTabKeyRef.current === activeTabKey) {
                const fallback = previous[closingIndex - 1] || previous[closingIndex + 1] || null;
                if (fallback) {
                    setTimeout(() => {
                        setActiveLibraryTabKey(getLibraryTabKey(fallback));
                    }, 0);
                } else {
                    setTimeout(() => {
                        setActiveLibraryTabKey(null);
                    }, 0);
                }
            }
            return nextTabs;
        });

        setSidebarMenuTarget(null);
    }, []);

    const renameChatSession = useCallback((chatId: string, newTitle: string) => {
        if (!chatId) return;
        setChatsData((previous) => {
            const updated = previous.chats.map((c) => {
                if (c.id === chatId) {
                    const chatSession = {
                        ...c,
                        title: newTitle,
                        updatedAt: Date.now(),
                    };
                    ipcRenderer.send('save-chat', chatSession);
                    return chatSession;
                }
                return c;
            });
            return { ...previous, chats: updated };
        });
    }, []);

    const toggleChatCloudSync = useCallback((chatId: string) => {
        if (!chatId) return;
        if (notesData.isAuthenticated !== true) return;
        setChatsData((previous) => {
            const updated = previous.chats.map((c) => {
                if (c.id === chatId) {
                    const nextSynced = !c.isCloudSynced;
                    const chatSession = {
                        ...c,
                        isCloudSynced: nextSynced,
                        updatedAt: Date.now(),
                    };
                    ipcRenderer.send('save-chat', chatSession);
                    return chatSession;
                }
                return c;
            });
            return { ...previous, chats: updated };
        });
    }, [notesData.isAuthenticated]);

    const startChatRename = useCallback((chat: ChatSession) => {
        setRenamingChatId(chat.id);
        setChatRenameDraft(chat.title || '');
    }, []);

    const commitChatRename = useCallback((chatId: string) => {
        if (!chatId) return;
        const trimmed = chatRenameDraft.trim();
        if (trimmed) {
            renameChatSession(chatId, trimmed);
        }
        setRenamingChatId(null);
    }, [chatRenameDraft, renameChatSession]);

    const cancelChatRename = useCallback(() => {
        setRenamingChatId(null);
    }, []);

    const openChatTitleRenamePopup = useCallback((chat: ChatSession) => {
        if (!chat?.id) return;
        setChatTitleRenameTargetId(chat.id);
        setChatTitleRenameDraft((chat.title || '').trim() || 'Untitled Chat');
        setIsChatTitleRenamePopupOpen(true);
    }, []);

    const closeChatTitleRenamePopup = useCallback(() => {
        setIsChatTitleRenamePopupOpen(false);
        setChatTitleRenameTargetId(null);
    }, []);

    const saveChatTitleFromPopup = useCallback(() => {
        if (!chatTitleRenameTargetId) return;
        const chat = chatsData.chats.find((entry) => entry.id === chatTitleRenameTargetId);
        if (!chat) {
            setIsChatTitleRenamePopupOpen(false);
            setChatTitleRenameTargetId(null);
            return;
        }
        const nextTitle = chatTitleRenameDraft.trim() || 'Untitled Chat';
        const currentTitle = (chat.title || '').trim() || 'Untitled Chat';
        if (nextTitle !== currentTitle) {
            renameChatSession(chat.id, nextTitle);
        }
        setIsChatTitleRenamePopupOpen(false);
        setChatTitleRenameTargetId(null);
    }, [chatTitleRenameDraft, chatTitleRenameTargetId, chatsData.chats, renameChatSession]);

    const renderRowThreeDotsMenu = (
        type: 'note' | 'recording' | 'chat',
        id: string,
        title: string,
        itemObj: any,
        sectionKind: 'note' | 'recording' | 'chat' | 'recent'
    ) => {
        const isMenuOpen = sidebarMenuTarget?.kind === sectionKind && sidebarMenuTarget.id === id;
        const isCurrentlyPinned = pinnedSidebarItems.some((entry) => entry.type === type && entry.id === id);

        return (
            <>
                <span className="hidden h-5 w-5 shrink-0 items-center justify-center group-hover:inline-flex group-focus-visible:inline-flex">
                    <button
                        className="inline-flex items-center justify-center h-5 w-5 rounded-md es-sidebar-item-text es-sidebar-header-action"
                        onClick={(event) => {
                            event.stopPropagation();
                            setSidebarMenuTarget({ kind: sectionKind, id });
                        }}
                        aria-label="Row menu"
                    >
                        <MoreHorizontal size={13} />
                    </button>
                </span>

                {isMenuOpen ? (
                    <div
                        ref={sidebarItemMenuRef}
                        className="absolute right-2 top-[calc(100%+4px)] z-[90] w-44 rounded-lg border es-global-outline es-general-background shadow-xl p-1"
                        onClick={(event) => event.stopPropagation()}
                    >
                        {isCurrentlyPinned ? (
                            <button
                                className="w-full rounded-md px-2 py-1.5 text-left text-xs es-general-item-hover es-general-text inline-flex items-center gap-1.5"
                                onClick={(event) => {
                                    event.stopPropagation();
                                    unpinSidebarEntity({ type, id });
                                    setSidebarMenuTarget(null);
                                }}
                            >
                                <PinOff size={12} />
                                Unpin
                            </button>
                        ) : (
                            <button
                                className="w-full rounded-md px-2 py-1.5 text-left text-xs es-general-item-hover es-general-text inline-flex items-center gap-1.5"
                                onClick={(event) => {
                                    event.stopPropagation();
                                    pinSidebarEntity({ type, id });
                                    setSidebarMenuTarget(null);
                                }}
                            >
                                <Pin size={12} />
                                Pin
                            </button>
                        )}

                        <button
                            className="w-full rounded-md px-2 py-1.5 text-left text-xs es-general-item-hover es-general-text inline-flex items-center gap-1.5"
                            onClick={(event) => {
                                event.stopPropagation();
                                handleMoveOrRemoveFolderAction({ type, id });
                                setSidebarMenuTarget(null);
                            }}
                        >
                            <FolderGlyph size={12} />
                            {getSidebarEntityFolderId({ type, id }) ? 'Move to space' : 'Add to space'}
                        </button>

                        <button
                            className="w-full rounded-md px-2 py-1.5 text-left text-xs es-general-item-hover es-general-text inline-flex items-center gap-1.5"
                            onClick={(event) => {
                                event.stopPropagation();
                                if (type === 'note') {
                                    startNoteRename(itemObj);
                                } else if (type === 'recording') {
                                    startRecordingRename(itemObj);
                                } else if (type === 'chat') {
                                    startChatRename(itemObj);
                                }
                                setSidebarMenuTarget(null);
                            }}
                        >
                            <Pencil size={12} />
                            Rename
                        </button>

                        <button
                            className="w-full rounded-md px-2 py-1.5 text-left text-xs text-red-600 hover:bg-red-50 inline-flex items-center gap-1.5"
                            onClick={(event) => {
                                event.stopPropagation();
                                if (type === 'note') {
                                    deleteNoteById(id, title);
                                } else if (type === 'recording') {
                                    void deleteRecordingWithConfirm(id, title);
                                } else if (type === 'chat') {
                                    deleteChatById(id, title);
                                }
                                setSidebarMenuTarget(null);
                            }}
                        >
                            <Trash2 size={12} />
                            Delete
                        </button>
                    </div>
                ) : null}
            </>
        );
    };

    const deleteSelectedNote = useCallback(() => {
        if (!selectedNote) return;
        deleteNoteById(selectedNote.id, selectedNote.title || 'Untitled note');
    }, [deleteNoteById, selectedNote]);

    const exportSelectedNoteByFormat = useCallback((format: 'pdf' | 'html' | 'markdown') => {
        if (!selectedNote) return;
        const channelByFormat = {
            pdf: 'export-note-pdf',
            html: 'export-note-html',
            markdown: 'export-note-markdown',
        } as const;
        const channel = channelByFormat[format];
        void ipcRenderer.invoke(channel, {
            title: selectedNote.title || 'Untitled note',
            text: selectedNote.text || '',
        });
        setIsSelectedNoteMenuOpen(false);
    }, [selectedNote]);

    const moveSelectedNoteFromMenu = useCallback(() => {
        if (!selectedNote) return;
        setIsSelectedNoteMenuOpen(false);
        openMoveToFolderPopover({ type: 'note', id: selectedNote.id });
    }, [openMoveToFolderPopover, selectedNote]);

    const renameSelectedNoteFromMenu = useCallback(() => {
        setIsSelectedNoteMenuOpen(false);
        if (!selectedNote) return;
        setNoteTitleRenameDraft((selectedNote.title || '').trim() || 'Untitled note');
        setIsNoteTitleRenamePopupOpen(true);
    }, [selectedNote]);

    const openNoteTitleRenamePopup = useCallback(() => {
        if (!selectedNote) return;
        setNoteTitleRenameDraft((selectedNote.title || '').trim() || 'Untitled note');
        setIsNoteTitleRenamePopupOpen(true);
    }, [selectedNote]);

    const closeNoteTitleRenamePopup = useCallback(() => {
        setIsNoteTitleRenamePopupOpen(false);
    }, []);

    const saveNoteTitleFromPopup = useCallback(() => {
        if (!selectedNote) return;
        const nextTitle = noteTitleRenameDraft.trim() || 'Untitled note';
        const currentTitle = (selectedNote.title || '').trim() || 'Untitled note';
        if (nextTitle !== currentTitle) {
            saveSelectedNote({ title: nextTitle });
        }
        setIsNoteTitleRenamePopupOpen(false);
        window.requestAnimationFrame(() => {
            const input = selectedNoteTitleInputRef.current;
            if (!input) return;
            input.focus();
            input.select();
        });
    }, [noteTitleRenameDraft, saveSelectedNote, selectedNote]);

    const toggleSelectedNoteCloudSync = useCallback(() => {
        if (!selectedNote || notesData.isAuthenticated !== true) return;
        if (selectedNote.isCloudSynced === false) {
            setNoteToSyncToCloud(selectedNote);
        } else {
            saveSelectedNote({ isCloudSynced: false });
        }
    }, [notesData.isAuthenticated, saveSelectedNote, selectedNote]);

    const confirmSyncNoteToCloud = useCallback(() => {
        if (!noteToSyncToCloud) return;
        saveSelectedNote({ isCloudSynced: true });
        setNoteToSyncToCloud(null);
    }, [noteToSyncToCloud, saveSelectedNote]);

    const toggleSelectedRecordingCloudSync = useCallback(async () => {
        if (!selectedRecording || notesData.isAuthenticated !== true) return;
        if (selectedRecording.isCloudSynced === false) {
            setRecordingToSyncToCloud({
                id: selectedRecording.id,
                title: (selectedRecording.title || '').trim() || 'Untitled recording',
            });
            return;
        }
        setRecordingActionError('');
        try {
            const result = await ipcRenderer.invoke('recordings:update-metadata', {
                id: selectedRecording.id,
                isCloudSynced: false,
            });
            if (result?.status !== 'success') {
                setRecordingActionError(result?.message || 'Failed to update sync preference');
                return;
            }
            await refreshRecordings(selectedRecording.id);
        } catch (error: any) {
            setRecordingActionError(error?.message || 'Failed to update sync preference');
        }
    }, [notesData.isAuthenticated, refreshRecordings, selectedRecording]);

    const confirmSyncRecordingToCloud = useCallback(async () => {
        if (!recordingToSyncToCloud) return;
        setRecordingActionError('');
        try {
            const result = await ipcRenderer.invoke('recordings:update-metadata', {
                id: recordingToSyncToCloud.id,
                isCloudSynced: true,
            });
            if (result?.status !== 'success') {
                setRecordingActionError(result?.message || 'Failed to update sync preference');
                return;
            }
            await refreshRecordings(recordingToSyncToCloud.id);
            setRecordingToSyncToCloud(null);
        } catch (error: any) {
            setRecordingActionError(error?.message || 'Failed to update sync preference');
        }
    }, [recordingToSyncToCloud, refreshRecordings]);

    const createLinkedNoteForSelectedRecording = useCallback(async () => {
        if (!selectedRecording) return;
        setRecordingActionError('');
        try {
            const result = await ipcRenderer.invoke('recordings:create-linked-note', { id: selectedRecording.id });
            if (result?.status !== 'success' || !result.note) {
                setRecordingActionError(result?.message || 'Could not create linked note.');
                return;
            }
            await Promise.all([refreshRecordings(selectedRecording.id), refreshNotesData(result.note.id)]);
            setLibraryFilter('all');
        } catch (error: any) {
            setRecordingActionError(error?.message || 'Could not create linked note.');
        }
    }, [refreshNotesData, refreshRecordings, selectedRecording]);

    const linkSelectedRecordingToNote = useCallback(async (noteId: string) => {
        if (!selectedRecording || !noteId) return;
        setRecordingActionError('');
        try {
            const result = await ipcRenderer.invoke('recordings:link-note', {
                id: selectedRecording.id,
                noteId,
            });
            if (result?.status !== 'success') {
                setRecordingActionError(result?.message || 'Could not link note.');
                return;
            }
            await Promise.all([refreshRecordings(selectedRecording.id), refreshNotesData(noteId)]);
        } catch (error: any) {
            setRecordingActionError(error?.message || 'Could not link note.');
        }
    }, [refreshNotesData, refreshRecordings, selectedRecording]);

    const unlinkSelectedRecordingNote = useCallback(async () => {
        if (!selectedRecording) return;
        setRecordingActionError('');
        try {
            const result = await ipcRenderer.invoke('recordings:unlink-note', { id: selectedRecording.id });
            if (result?.status !== 'success') {
                setRecordingActionError(result?.message || 'Could not unlink note.');
                return;
            }
            await Promise.all([refreshRecordings(selectedRecording.id), refreshNotesData()]);
        } catch (error: any) {
            setRecordingActionError(error?.message || 'Could not unlink note.');
        }
    }, [refreshNotesData, refreshRecordings, selectedRecording]);

    const resolveSyncConflict = useCallback(async (conflict: SyncConflict, resolution: 'client_wins' | 'server_wins') => {
        const conflictKey = getSyncConflictKey(conflict);
        if (resolvingSyncConflictKeys.includes(conflictKey)) return;

        setResolvingSyncConflictKeys((previous) => [...previous, conflictKey]);
        try {
            const result = await ipcRenderer.invoke('sync:resolve-conflict', {
                entityType: conflict.entityType,
                entityId: conflict.entityId,
                resolution,
            });

            if (result?.status !== 'success') {
                pushRecordingNotice('error', result?.message || 'Failed to resolve sync conflict.');
                return;
            }

            setResolvedSyncConflictKeys((previous) => {
                if (previous.includes(conflictKey)) return previous;
                return [...previous, conflictKey];
            });
            pushRecordingNotice('warning', `Sync conflict resolved for ${conflict.entityType}.`);
            window.setTimeout(() => {
                setSyncConflicts((previous) => previous.filter((item) => getSyncConflictKey(item) !== conflictKey));
                setResolvedSyncConflictKeys((previous) => previous.filter((key) => key !== conflictKey));
                setResolvingSyncConflictKeys((previous) => previous.filter((key) => key !== conflictKey));
            }, 900);
            await Promise.all([
                conflict.entityType === 'recordings' || conflict.entityType === 'transcripts'
                    ? refreshRecordings(selectedRecordingId)
                    : Promise.resolve(),
                conflict.entityType === 'folders' || conflict.entityType === 'notes'
                    ? refreshNotesData()
                    : Promise.resolve(),
                conflict.entityType === 'chats'
                    ? refreshChatsData()
                    : Promise.resolve(),
            ]);
        } catch (error: any) {
            pushRecordingNotice('error', error?.message || 'Failed to resolve sync conflict.');
        } finally {
            setResolvingSyncConflictKeys((previous) => previous.filter((key) => key !== conflictKey));
        }
    }, [pushRecordingNotice, refreshChatsData, refreshNotesData, refreshRecordings, resolvingSyncConflictKeys, selectedRecordingId]);

    const hasTranscriptForSummary = useMemo(() => {
        if (!selectedRecording) return false;
        const baseTranscript = recordingDraftDirty
            ? recordingTranscriptDraft
            : (selectedRecording.transcript || '');
        return !!baseTranscript.trim();
    }, [recordingDraftDirty, recordingTranscriptDraft, selectedRecording]);



    useEffect(() => {
        if (!selectedRecording) {
            recordingDraftTargetIdRef.current = null;
            setRecordingTranscriptDraft('');
            setRecordingDraftDirty(false);
            return;
        }

        if (recordingDraftTargetIdRef.current !== selectedRecording.id) {
            recordingDraftTargetIdRef.current = selectedRecording.id;
            setRecordingTranscriptDraft(selectedRecording.transcript || '');
            setRecordingDraftDirty(false);
            return;
        }

        if (!recordingDraftDirty) {
            setRecordingTranscriptDraft(selectedRecording.transcript || '');
        }
    }, [recordingDraftDirty, selectedRecording]);

    useEffect(() => {
        if (recordingDetailTab !== 'transcript') return;
        const textarea = recordingTranscriptTextareaRef.current;
        if (!textarea) return;
        textarea.style.height = 'auto';
        textarea.style.height = `${textarea.scrollHeight}px`;
    }, [recordingDetailTab, recordingTranscriptDraft, selectedRecording?.id]);

    useEffect(() => {
        setRecordingActionError('');
        setIsSelectedRecordingMenuOpen(false);
        setIsRecordingTitleRenamePopupOpen(false);
    }, [selectedRecordingId]);

    useEffect(() => {
        if (!isRecordingCaptureSettingsOpen) return;
        const handlePointerDown = (event: MouseEvent) => {
            if (!recordingCaptureSettingsRef.current) return;
            const target = event.target as Node | null;
            if (target && recordingCaptureSettingsRef.current.contains(target)) {
                return;
            }
            setIsRecordingCaptureSettingsOpen(false);
        };
        window.addEventListener('mousedown', handlePointerDown);
        return () => {
            window.removeEventListener('mousedown', handlePointerDown);
        };
    }, [isRecordingCaptureSettingsOpen]);

    const saveRecordingTranscriptDraft = useCallback(async () => {
        if (!selectedRecording) {
            return;
        }

        setRecordingActionError('');
        setIsSavingRecordingDraft(true);
        try {
            const result = await ipcRenderer.invoke('recordings:update-transcript', {
                id: selectedRecording.id,
                transcript: recordingTranscriptDraft,
            });
            if (result?.status !== 'success') {
                setRecordingActionError(result?.message || 'Failed to save transcript');
                return;
            }

            setRecordingDraftDirty(false);
            await refreshRecordings(selectedRecording.id);
        } catch (error: any) {
            setRecordingActionError(error?.message || 'Failed to save transcript');
        } finally {
            setIsSavingRecordingDraft(false);
        }
    }, [recordingTranscriptDraft, refreshRecordings, selectedRecording]);

    const openDeleteRecordingModal = useCallback(() => {
        if (!selectedRecording || isDeletingRecording) {
            return;
        }
        setRecordingDeleteTarget({
            id: selectedRecording.id,
            title: selectedRecording.title || 'Untitled recording',
        });
    }, [isDeletingRecording, selectedRecording]);

    const closeDeleteRecordingModal = useCallback(() => {
        if (isDeletingRecording) return;
        setRecordingDeleteTarget(null);
    }, [isDeletingRecording]);

    const deleteSelectedRecording = useCallback(async (recordingId: string) => {
        if (!recordingId || isDeletingRecording) {
            return;
        }

        const target = recordings.find((entry) => entry.id === recordingId) || selectedRecording;
        if (!target) return;

        setRecordingActionError('');
        setIsDeletingRecording(true);
        try {
            const result = await ipcRenderer.invoke('recordings:delete', {
                id: recordingId,
            });
            if (result?.status !== 'success') {
                setRecordingActionError(result?.message || 'Failed to delete recording');
                return;
            }

            const remaining = recordings.filter((entry) => entry.id !== recordingId);
            const nextPreferred = selectedRecording?.id === recordingId
                ? (remaining.length ? remaining[0].id : null)
                : (selectedRecording?.id || null);
            setRecordingDraftDirty(false);
            await refreshRecordings(nextPreferred);
        } catch (error: any) {
            setRecordingActionError(error?.message || 'Failed to delete recording');
        } finally {
            setIsDeletingRecording(false);
        }
    }, [isDeletingRecording, recordings, refreshRecordings, selectedRecording]);

    const confirmDeleteRecording = useCallback(async () => {
        if (!recordingDeleteTarget) return;
        const targetId = recordingDeleteTarget.id;
        await deleteSelectedRecording(targetId);
        setRecordingDeleteTarget(null);
    }, [deleteSelectedRecording, recordingDeleteTarget]);

    const deleteRecordingWithConfirm = useCallback(async (recordingId: string, title: string = 'Untitled recording') => {
        if (!recordingId) return;
        const confirmed = window.confirm(`Permanently delete "${title}"?`);
        if (!confirmed) return;
        await deleteSelectedRecording(recordingId);
        setSidebarMenuTarget(null);
    }, [deleteSelectedRecording]);

    const generateRecordingSummary = useCallback(async () => {
        if (!selectedRecording || summarizingRecordingId) {
            return;
        }

        setRecordingActionError('');
        let recordingId = selectedRecording.id;

        try {
            if (recordingDraftDirty) {
                const saveResult = await ipcRenderer.invoke('recordings:update-transcript', {
                    id: selectedRecording.id,
                    transcript: recordingTranscriptDraft,
                });
                if (saveResult?.status !== 'success') {
                    setRecordingActionError(saveResult?.message || 'Failed to save transcript before summary');
                    return;
                }
                setRecordingDraftDirty(false);
                recordingId = saveResult?.recording?.id || selectedRecording.id;
            }

            // Clear existing summary and switch to summary tab to show progress
            resetStreamingSummaryPreview();
            setRecordingDetailTab('summary');
            setSummarizingRecordingId(recordingId);

            const result = await ipcRenderer.invoke('recordings:generate-summary', {
                id: recordingId,
                stream: true,
            });

            if (result?.status !== 'success') {
                setRecordingActionError(result?.message || 'Failed to generate summary');
                resetStreamingSummaryPreview();
                return;
            }

            // Sync the final summary back to the list before clearing the live preview.
            await refreshRecordings(recordingId);
        } catch (error: any) {
            setRecordingActionError(error?.message || 'Failed to generate summary');
            resetStreamingSummaryPreview();
        } finally {
            setSummarizingRecordingId(null);
        }
    }, [recordingDraftDirty, recordingTranscriptDraft, refreshRecordings, resetStreamingSummaryPreview, selectedRecording, summarizingRecordingId]);

    const updateRecordingTitle = useCallback(async (newTitle: string) => {
        if (!selectedRecording) return;
        const nextTitle = newTitle.trim() || 'Untitled recording';
        const currentTitle = (selectedRecording.title || '').trim() || 'Untitled recording';
        if (nextTitle === currentTitle) return;

        // Optimistic UI update
        const updatedRecording = { ...selectedRecording, title: nextTitle };
        setRecordings(prev => prev.map(r => r.id === selectedRecording.id ? updatedRecording : r));

        try {
            const result = await ipcRenderer.invoke('recordings:update-metadata', {
                id: selectedRecording.id,
                title: nextTitle,
            });
            if (result?.status !== 'success') {
                setRecordingActionError(result?.message || 'Failed to update title');
                // Revert on failure
                await refreshRecordings(selectedRecording.id);
            }
        } catch (error: any) {
            setRecordingActionError(error?.message || 'Failed to update title');
            await refreshRecordings(selectedRecording.id);
        }
    }, [selectedRecording, refreshRecordings]);

    const openRecordingTitleRenamePopup = useCallback(() => {
        if (!selectedRecording) return;
        setRecordingTitleRenameDraft((selectedRecording.title || '').trim() || 'Untitled recording');
        setIsRecordingTitleRenamePopupOpen(true);
    }, [selectedRecording]);

    const closeRecordingTitleRenamePopup = useCallback(() => {
        setIsRecordingTitleRenamePopupOpen(false);
    }, []);

    const saveRecordingTitleFromPopup = useCallback(async () => {
        if (!selectedRecording) return;
        const nextTitle = recordingTitleRenameDraft.trim() || 'Untitled recording';
        const currentTitle = (selectedRecording.title || '').trim() || 'Untitled recording';
        if (nextTitle !== currentTitle) {
            await updateRecordingTitle(nextTitle);
        }
        setIsRecordingTitleRenamePopupOpen(false);
    }, [recordingTitleRenameDraft, selectedRecording, updateRecordingTitle]);

    const cancelRecordingRename = useCallback(() => {
        setRenamingRecordingId(null);
        setRecordingRenameDraft('');
        skipRecordingRenameBlurRef.current = false;
    }, []);

    const startRecordingRename = useCallback((recording: RecordingItem) => {
        setRenamingNoteId(null);
        setNoteRenameDraft('');
        setRenamingRecordingId(recording.id);
        setRecordingRenameDraft((recording.title || '').trim() || 'Untitled recording');
    }, []);

    const commitRecordingRename = useCallback(async (recordingId: string) => {
        const recording = recordings.find((entry) => entry.id === recordingId);
        if (!recording) {
            cancelRecordingRename();
            return;
        }
        const nextTitle = recordingRenameDraft.trim() || 'Untitled recording';
        const currentTitle = (recording.title || '').trim() || 'Untitled recording';
        if (nextTitle === currentTitle) {
            cancelRecordingRename();
            return;
        }

        setRecordings((previous) => previous.map((entry) => (
            entry.id === recordingId ? { ...entry, title: nextTitle } : entry
        )));
        setRecordingActionError('');
        try {
            const result = await ipcRenderer.invoke('recordings:update-metadata', {
                id: recordingId,
                title: nextTitle,
            });
            if (result?.status !== 'success') {
                setRecordingActionError(result?.message || 'Failed to update title');
                await refreshRecordings(selectedRecordingId);
            }
        } catch (error: any) {
            setRecordingActionError(error?.message || 'Failed to update title');
            await refreshRecordings(selectedRecordingId);
        } finally {
            cancelRecordingRename();
        }
    }, [cancelRecordingRename, recordingRenameDraft, recordings, refreshRecordings, selectedRecordingId]);

    const saveApiKeys = async () => {
        setIsSavingKeys(true);
        setApiKeySaveMessage('');
        try {
            const payloads = BYOK_PROVIDER_IDS
                .map((provider) => ({
                    provider,
                    apiKey: String(keyDrafts[provider] || '').trim(),
                }))
                .filter((entry) => entry.apiKey.length > 0);

            if (!payloads.length) {
                setApiKeySaveMessage('Enter at least one API key to save.');
                return;
            }

            const failures: string[] = [];
            for (const payload of payloads) {
                const result = await ipcRenderer.invoke('byok:set-key', payload);
                if (result?.status !== 'success') {
                    failures.push(`${payload.provider}: ${result?.message || 'save failed'}`);
                }
            }

            if (failures.length) {
                setApiKeySaveMessage(`Failed to save some keys: ${failures.join(' | ')}`);
            } else {
                setApiKeySaveMessage(`Saved ${payloads.length} API key${payloads.length === 1 ? '' : 's'}.`);
                setKeyDrafts(EMPTY_API_KEY_DRAFTS);
            }

            const latest = await ipcRenderer.invoke('get-ui-settings');
            setSettings(normalizeSettings(latest as UiSettings));
        } catch (error: any) {
            setApiKeySaveMessage(error?.message || 'Failed to save API keys.');
        } finally {
            setIsSavingKeys(false);
        }
    };

    const clearSavedApiKeys = async () => {
        setIsSavingKeys(true);
        setApiKeySaveMessage('');
        try {
            const providersToClear = BYOK_PROVIDER_IDS.filter((provider) => settings.aiEngine.apiKeys[provider]?.present === true);
            if (!providersToClear.length) {
                setApiKeySaveMessage('No saved API keys to clear.');
                return;
            }

            const failures: string[] = [];
            for (const provider of providersToClear) {
                const result = await ipcRenderer.invoke('byok:clear-key', { provider });
                if (result?.status !== 'success') {
                    failures.push(`${provider}: ${result?.message || 'clear failed'}`);
                }
            }

            if (failures.length) {
                setApiKeySaveMessage(`Failed to clear some keys: ${failures.join(' | ')}`);
            } else {
                setApiKeySaveMessage('Cleared all saved API keys.');
                setKeyDrafts(EMPTY_API_KEY_DRAFTS);
            }

            const latest = await ipcRenderer.invoke('get-ui-settings');
            setSettings(normalizeSettings(latest as UiSettings));
        } catch (error: any) {
            setApiKeySaveMessage(error?.message || 'Failed to clear API keys.');
        } finally {
            setIsSavingKeys(false);
        }
    };

    const logout = async () => {
        const latest = await ipcRenderer.invoke('logout');
        setAuthState({ ...DEFAULT_AUTH_STATE, ...(latest || {}) });
        setProKeyStatus('');
    };

    const fetchTempProKey = async () => {
        setProKeyStatus('Requesting temporary Deepgram key...');
        const result = await ipcRenderer.invoke('fetch-pro-temp-deepgram-key', {
            purpose: 'dashboard-check',
            forceRefresh: true,
        });

        if (result?.status === 'success') {
            let expiresText = 'expiration unknown';
            if (result.expiresAt) {
                const dt = typeof result.expiresAt === 'number'
                    ? new Date(result.expiresAt > 1_000_000_000_000 ? result.expiresAt : result.expiresAt * 1000)
                    : new Date(result.expiresAt);
                if (!Number.isNaN(dt.getTime())) {
                    expiresText = dt.toLocaleString();
                }
            }
            setProKeyStatus(`Temporary key fetched (${expiresText}).`);
            return;
        }

        setProKeyStatus(`Failed to fetch temporary key: ${result?.message || 'Unknown error'}`);
    };

    const stopRecordModeSystemAudioMonitor = useCallback(() => {
        if (recordModeMeterRafRef.current !== null) {
            cancelAnimationFrame(recordModeMeterRafRef.current);
            recordModeMeterRafRef.current = null;
        }

        if (recordModeMeterSourceRef.current) {
            try {
                recordModeMeterSourceRef.current.disconnect();
            } catch (_error) {
                // Ignore disconnect races during cleanup.
            }
            recordModeMeterSourceRef.current = null;
        }

        if (recordModeMeterAnalyserRef.current) {
            try {
                recordModeMeterAnalyserRef.current.disconnect();
            } catch (_error) {
                // Ignore disconnect races during cleanup.
            }
            recordModeMeterAnalyserRef.current = null;
        }

        if (recordModeMeterContextRef.current) {
            recordModeMeterContextRef.current.close().catch(() => undefined);
            recordModeMeterContextRef.current = null;
        }

        ipcRenderer.send('record-widget:sync-audio', {
            level: 0,
            bars: RECORD_WIDGET_IDLE_BARS,
        });
    }, []);

    const startRecordModeSystemAudioMonitor = useCallback((stream: MediaStream) => {
        stopRecordModeSystemAudioMonitor();

        try {
            const AudioContextCtor = (window as any).AudioContext || (window as any).webkitAudioContext;
            if (!AudioContextCtor) {
                return;
            }

            const ctx: AudioContext = new AudioContextCtor();
            const source = ctx.createMediaStreamSource(stream);
            const analyser = ctx.createAnalyser();
            analyser.fftSize = 1024;
            analyser.smoothingTimeConstant = 0.55;
            source.connect(analyser);

            recordModeMeterContextRef.current = ctx;
            recordModeMeterSourceRef.current = source;
            recordModeMeterAnalyserRef.current = analyser;

            const frequencyData = new Uint8Array(analyser.frequencyBinCount);
            const timeData = new Uint8Array(analyser.fftSize);
            const previousBars = RECORD_WIDGET_IDLE_BARS.slice(0, RECORD_WIDGET_BAR_COUNT);
            let noiseFloor = 0.01;
            let quietFrames = 0;
            let lastSentAt = 0;

            const nyquist = ctx.sampleRate / 2;
            const minHz = 120;
            const maxHz = Math.min(7200, nyquist - 100);
            const hzToBin = (hz: number) => Math.max(
                1,
                Math.min(
                    frequencyData.length - 1,
                    Math.round((hz / nyquist) * (frequencyData.length - 1)),
                ),
            );
            const bandEdges = Array.from({ length: RECORD_WIDGET_BAR_COUNT + 1 }, (_unused, i) => {
                const ratio = i / RECORD_WIDGET_BAR_COUNT;
                const hz = minHz * Math.pow(maxHz / minHz, ratio);
                return hzToBin(hz);
            });
            const bandRanges = Array.from({ length: RECORD_WIDGET_BAR_COUNT }, (_unused, i) => {
                const start = bandEdges[i];
                const end = Math.min(
                    frequencyData.length,
                    Math.max(start + 1, bandEdges[i + 1]),
                );
                return { start, end };
            });

            const update = () => {
                if (!recordModeMeterAnalyserRef.current) return;
                analyser.getByteFrequencyData(frequencyData);
                analyser.getByteTimeDomainData(timeData);

                let rmsSum = 0;
                for (let i = 0; i < timeData.length; i += 1) {
                    const centered = (timeData[i] - 128) / 128;
                    rmsSum += centered * centered;
                }
                const rms = Math.sqrt(rmsSum / timeData.length);
                if (rms < (noiseFloor + 0.03)) {
                    noiseFloor = (noiseFloor * 0.992) + (rms * 0.008);
                }
                noiseFloor = Math.max(0.004, Math.min(noiseFloor, 0.05));
                const inputLevel = Math.min(1, Math.max(0, (rms - noiseFloor - 0.0025) * 12));

                const nextBars: number[] = [];
                const rawBands: number[] = [];
                let rawMean = 0;

                for (let i = 0; i < RECORD_WIDGET_BAR_COUNT; i += 1) {
                    const { start, end } = bandRanges[i];
                    let sum = 0;
                    let peak = 0;

                    for (let j = start; j < end; j += 1) {
                        const magnitude = frequencyData[j] / 255;
                        sum += magnitude;
                        if (magnitude > peak) peak = magnitude;
                    }

                    const count = Math.max(1, end - start);
                    const average = sum / count;
                    const combined = (average * 0.7) + (peak * 0.3);
                    const normalized = Math.min(1, combined * 2.35);
                    const shaped = Math.pow(normalized, 1.28);
                    rawBands.push(shaped);
                    rawMean += shaped;
                }

                rawMean /= RECORD_WIDGET_BAR_COUNT;
                const isQuiet = inputLevel < 0.03 && rawMean < 0.08;

                if (isQuiet) {
                    quietFrames += 1;
                    for (let i = 0; i < RECORD_WIDGET_BAR_COUNT; i += 1) {
                        const target = RECORD_WIDGET_IDLE_LEVEL;
                        if (quietFrames >= 5) {
                            previousBars[i] = target;
                            nextBars.push(target);
                        } else {
                            const settled = previousBars[i] + ((target - previousBars[i]) * 0.24);
                            previousBars[i] = settled;
                            nextBars.push(settled);
                        }
                    }
                } else {
                    quietFrames = 0;
                    const centeredBands = Array.from({ length: RECORD_WIDGET_BAR_COUNT }, () => 0);
                    const centerBar = Math.floor(RECORD_WIDGET_BAR_COUNT / 2);
                    for (let sourceIndex = 0; sourceIndex < RECORD_WIDGET_BAR_COUNT; sourceIndex += 1) {
                        const targetIndex = sourceIndex === 0
                            ? centerBar
                            : (sourceIndex % 2 === 1
                                ? centerBar - Math.ceil(sourceIndex / 2)
                                : centerBar + Math.ceil(sourceIndex / 2));
                        if (targetIndex >= 0 && targetIndex < RECORD_WIDGET_BAR_COUNT) {
                            const centerDistance = Math.abs(targetIndex - centerBar) / Math.max(1, centerBar);
                            const centerWeight = 1.2 - (centerDistance * 0.28);
                            centeredBands[targetIndex] = Math.min(1, rawBands[sourceIndex] * centerWeight);
                        }
                    }

                    const spreadBands: number[] = [];
                    for (let i = 0; i < RECORD_WIDGET_BAR_COUNT; i += 1) {
                        const left = i > 0 ? centeredBands[i - 1] : centeredBands[i];
                        const right = i < RECORD_WIDGET_BAR_COUNT - 1 ? centeredBands[i + 1] : centeredBands[i];
                        const spread = Math.min(1, (centeredBands[i] * 0.64) + (left * 0.18) + (right * 0.18));
                        spreadBands.push(spread);
                    }

                    for (let i = 0; i < RECORD_WIDGET_BAR_COUNT; i += 1) {
                        const target = spreadBands[i];
                        const previous = previousBars[i];
                        const smoothing = target > previous ? 0.3 : 0.1;
                        const smoothed = previous + ((target - previous) * smoothing);
                        previousBars[i] = smoothed;
                        nextBars.push(smoothed);
                    }
                }

                const aggregate = Math.max(
                    inputLevel,
                    nextBars.reduce((acc, n) => acc + n, 0) / RECORD_WIDGET_BAR_COUNT,
                );

                const now = performance.now();
                if (now - lastSentAt >= 55) {
                    ipcRenderer.send('record-widget:sync-audio', {
                        level: aggregate,
                        bars: nextBars,
                    });
                    lastSentAt = now;
                }

                recordModeMeterRafRef.current = requestAnimationFrame(update);
            };

            update();
        } catch (_error) {
            stopRecordModeSystemAudioMonitor();
        }
    }, [stopRecordModeSystemAudioMonitor]);

    const releaseRecordModeMedia = useCallback(() => {
        stopRecordModeSystemAudioMonitor();
        const stream = recordModeStreamRef.current;
        if (stream) {
            stream.getTracks().forEach(stopTrackIfLive);
        }
        recordModeStreamRef.current = null;
        recordModeRecorderRef.current = null;
    }, [stopRecordModeSystemAudioMonitor, stopTrackIfLive]);

    const abortRecordModeSession = async () => {
        stopRecordModeSystemAudioMonitor();
        const sessionId = recordModeSessionIdRef.current;
        if (!sessionId) return;
        recordModeSessionIdRef.current = null;
        recordModeCaptureEngineRef.current = null;
        recordModeStopRequestedRef.current = false;
        try {
            await ipcRenderer.invoke('record-mode:abort-session', { sessionId });
        } catch (error: any) {
            console.error('Failed to abort record mode session:', error?.message || error);
        }
    };

    const requestRecordModeStream = async (): Promise<MediaStream> => {
        if (!navigator?.mediaDevices?.getDisplayMedia) {
            throw new Error('getDisplayMedia is not available in this renderer.');
        }

        const candidates: any[] = [
            { video: true, audio: true },
            { video: true, audio: true, systemAudio: 'include' as any },
            { video: true, audio: 'loopback' as any },
        ];

        let lastError: any = null;
        for (const constraints of candidates) {
            try {
                const stream = await navigator.mediaDevices.getDisplayMedia(constraints);
                return stream;
            } catch (error: any) {
                lastError = error;
                const message = (error?.message || '').toLowerCase();
                const notSupported = error?.name === 'NotSupportedError'
                    || message.includes('not supported')
                    || message.includes('invalid constraint')
                    || message.includes('constraint');

                if (!notSupported) {
                    throw error;
                }
            }
        }

        throw lastError || new Error('System audio loopback is not supported in this environment.');
    };

    const finalizeRecordModeSession = useCallback(async (sessionId: string) => {
        try {
            const result = await ipcRenderer.invoke('record-mode:stop-session', {
                sessionId,
            });

            recordModeSessionIdRef.current = null;
            recordModeCaptureEngineRef.current = null;
            recordModeStopRequestedRef.current = false;

            if (result?.status === 'success') {
                const route = result.route || {};
                const stats = result.stats || {};
                const durationLabel = formatDurationMs(stats.durationMs);
                const isDualTrackLabeled = route.transport === 'dual-track-labeled';
                const microphoneInfo = route.microphone || {};
                const microphoneMode = microphoneInfo.mode || 'unknown';
                const microphoneEnabledLabel = microphoneInfo.enabled ? 'on' : 'off';
                const systemBytes = Number(stats.systemBytes || 0);
                const microphoneBytes = Number(stats.microphoneBytes || 0);
                const dualTrackMeta = isDualTrackLabeled
                    ? ` · Mic: ${microphoneEnabledLabel}/${microphoneMode} · Bytes (Others/Me): ${systemBytes}/${microphoneBytes}`
                    : '';
                setRecordModeMeta(
                    `Route: ${route.provider || 'unknown'} (${route.transport || 'unknown'})${dualTrackMeta} · Duration: ${durationLabel} · Chunks: ${stats.chunkCount || 0}`
                );
                setRecordingActionError('');
	                setRecordModeStatus('done');
	                setRecordingDetailTab('summary');
                const transcriptIssue = detectLikelyTranscriptIssue(result?.recording?.transcript || result?.transcript || '');
                const completedRecordingId = String(result?.recording?.id || '').trim();
                if (transcriptIssue && completedRecordingId) {
                    pushRecordingReviewNotice(
                        completedRecordingId,
                        `Possible STT hallucination (${transcriptIssue}). Please review this transcript before using it.`
                    );
                }
                if (completedRecordingId) {
                    await refreshRecordings(completedRecordingId);
                } else {
                    await refreshRecordings();
                }
                return;
            }

            if (result?.message === 'No speech content was detected in system or microphone tracks.') {
                ipcRenderer.send('record-widget:show-speech-error-banner');
                setRecordModeStatus('idle');
                await refreshRecordings();
            } else {
                setRecordModeErrorWithNotice(result?.message || 'Record mode processing failed');
                setRecordModeStatus('error');
            }
        } catch (error: any) {
            recordModeSessionIdRef.current = null;
            recordModeCaptureEngineRef.current = null;
            recordModeStopRequestedRef.current = false;
            setRecordModeErrorWithNotice(error?.message || 'Failed to finalize record mode session');
            setRecordModeStatus('error');
        }
    }, [pushRecordingReviewNotice, refreshRecordings, setRecordModeErrorWithNotice]);

    const startRecordModeCapture = async (options: { preapproved?: boolean } = {}) => {
        if (recordModeStatus === 'capturing' || recordModeStatus === 'processing' || recordModeStatus === 'selecting') {
            return;
        }

        if (!options.preapproved) {
            const canStart = await ipcRenderer.invoke('record-mode:can-start');
            if (canStart?.status !== 'ok') {
                return;
            }
        }

        if (loopbackUnsupportedRef.current) {
            setRecordModeStatus('error');
            setRecordModeErrorWithNotice(
                loopbackUnsupportedReasonRef.current
                || 'System audio loopback is unavailable in this runtime. Restart the app after changing capture runtime settings.'
            );
            return;
        }

        setRecordModeError('');
        setRecordingActionError('');
        setRecordModeMeta('');
        setIsRecordingCaptureSettingsOpen(false);
        setRecordModeStatus('selecting');

        let stream: MediaStream | null = null;
        try {
            const prereq = await ipcRenderer.invoke('record-mode:get-capture-prereq');
            const isDarwin = !!(prereq && prereq.platform === 'darwin');
            const hasNativeHelper = !!(prereq && prereq.nativeMacLoopbackHelperAvailable);
            const allowExperimental = !!(prereq && prereq.experimentalElectronLoopbackEnabled);

            if (isDarwin && !hasNativeHelper && !allowExperimental) {
                const message = 'macOS system audio loopback is disabled by default in this build because Electron loopback is not reliable at runtime. Set ESCRIBOLT_EXPERIMENTAL_ELECTRON_MAC_LOOPBACK=1 to re-enable experimental Electron loopback, or integrate a native ScreenCaptureKit helper.';
                loopbackUnsupportedRef.current = true;
                loopbackUnsupportedReasonRef.current = message;
                setRecordModeErrorWithNotice(message);
                setRecordModeStatus('error');
                return;
            }

	            if (isDarwin && hasNativeHelper) {
	                const nativeStart = await ipcRenderer.invoke('record-mode:start-session', {
	                    captureEngine: 'native-helper',
	                    captureMic: settings.recordingCaptureMode === 'all-audio',
	                });
                if (!nativeStart || nativeStart.status !== 'success' || !nativeStart.sessionId) {
                    throw new Error(nativeStart?.message || 'Failed to initialize native record mode session');
                }

	                recordModeSessionIdRef.current = nativeStart.sessionId as string;
	                recordModeCaptureEngineRef.current = 'native-helper';
	                stopRecordModeSystemAudioMonitor();
	                setRecordModeStatus('capturing');
	                return;
	            }

            stream = await requestRecordModeStream();

            const audioTracks = stream.getAudioTracks();
            if (!audioTracks.length) {
                throw new Error('No loopback audio track was provided by the runtime.');
            }

            const startResponse = await ipcRenderer.invoke('record-mode:start-session', {
                captureEngine: 'electron-mediarecorder',
            });
            if (!startResponse || startResponse.status !== 'success' || !startResponse.sessionId) {
                throw new Error(startResponse?.message || 'Failed to initialize record mode session');
            }

            const sessionId = startResponse.sessionId as string;
            recordModeSessionIdRef.current = sessionId;
            recordModeCaptureEngineRef.current = 'electron-mediarecorder';
            recordModeStreamRef.current = stream;
            startRecordModeSystemAudioMonitor(stream);

            const mimeTypeCandidates = ['audio/webm;codecs=opus', 'audio/webm'];
            const selectedMimeType = mimeTypeCandidates.find((candidate) => {
                try {
                    return MediaRecorder.isTypeSupported(candidate);
                } catch (_error) {
                    return false;
                }
            });

            const recorder = selectedMimeType
                ? new MediaRecorder(stream, { mimeType: selectedMimeType })
                : new MediaRecorder(stream);
            recordModeRecorderRef.current = recorder;

            recorder.ondataavailable = async (event) => {
                if (!event.data || event.data.size === 0) return;
                try {
                    const arrayBuffer = await event.data.arrayBuffer();
                    ipcRenderer.send('record-mode:append-chunk', {
                        sessionId,
                        chunk: new Uint8Array(arrayBuffer),
                    });
                } catch (error: any) {
                    console.error('Failed to forward record chunk:', error?.message || error);
                }
            };

            recorder.onerror = async (event: any) => {
                recordModeStopRequestedRef.current = false;
                setRecordModeStatus('error');
                setRecordModeErrorWithNotice(event?.error?.message || 'MediaRecorder error');
                releaseRecordModeMedia();
                await abortRecordModeSession();
            };

            recorder.onstop = async () => {
                const activeSessionId = recordModeSessionIdRef.current;
                releaseRecordModeMedia();

                if (!activeSessionId) {
                    setRecordModeStatus('idle');
                    return;
                }

                await finalizeRecordModeSession(activeSessionId);
            };

            stream.getVideoTracks().forEach((track) => {
                track.addEventListener('ended', () => {
                    if (
                        recordModeRecorderRef.current
                        && recordModeRecorderRef.current.state !== 'inactive'
                        && !recordModeStopRequestedRef.current
                    ) {
                        recordModeStopRequestedRef.current = true;
                        setRecordModeStatus('processing');
                        recordModeRecorderRef.current.stop();
                    }
                });
            });

            recorder.start(1000);
            setRecordModeStatus('capturing');
        } catch (error: any) {
            stopRecordModeSystemAudioMonitor();
            if (stream) {
                stream.getTracks().forEach(stopTrackIfLive);
            }
            await abortRecordModeSession();
            const rawMessage = error?.message || 'Failed to start record mode';
            const lowered = rawMessage.toLowerCase();
            if (
                lowered.includes('not supported')
                || lowered.includes('could not start audio source')
                || error?.name === 'NotSupportedError'
                || error?.name === 'NotReadableError'
            ) {
                let diagnosticsSuffix = '';
                try {
                    const diagnostics = await ipcRenderer.invoke('record-mode:get-capture-prereq');
                    if (diagnostics && typeof diagnostics === 'object') {
                        const bits: string[] = [];
                        if (diagnostics.electronVersion) bits.push(`Electron ${diagnostics.electronVersion}`);
                        if (diagnostics.chromeVersion) bits.push(`Chromium ${diagnostics.chromeVersion}`);
                        if (diagnostics.loopbackHandlerAvailable === false) bits.push('no display-media loopback handler');
                        if (bits.length) diagnosticsSuffix = ` (${bits.join(', ')})`;

                        if (diagnostics.screenCapturePermission && diagnostics.screenCapturePermission !== 'granted' && diagnostics.screenCapturePermission !== 'not-applicable') {
                            setRecordModeErrorWithNotice(`macOS Screen Recording permission is ${diagnostics.screenCapturePermission}. Grant permission in System Settings, restart the app, and retry.`);
                            setRecordModeStatus('error');
                            return;
                        }

                        const major = Number(diagnostics.electronMajor);
                        if (Number.isFinite(major) && major > 0 && major < 32 && diagnostics.platform === 'darwin') {
                            setRecordModeErrorWithNotice(`System audio loopback is unavailable in this runtime${diagnosticsSuffix}. Upgrade Electron to a newer major release that includes ScreenCaptureKit loopback support.`);
                            setRecordModeStatus('error');
                            return;
                        }

                        if (diagnostics.platform === 'darwin' && lowered.includes('could not start audio source')) {
                            const message =
                                `macOS system audio loopback could not be started${diagnosticsSuffix}. ` +
                                'In current Electron builds this can still fail at runtime. ' +
                                'Use a native ScreenCaptureKit bridge or a virtual audio device fallback.';
                            loopbackUnsupportedRef.current = true;
                            loopbackUnsupportedReasonRef.current = message;
                            setRecordModeErrorWithNotice(message);
                            setRecordModeStatus('error');
                            return;
                        }
                    }
                } catch (_diagError) {
                    // Ignore diagnostics lookup failures to keep primary error path stable.
                }
                const message = `Could not start system audio loopback source${diagnosticsSuffix}. This is a capture/runtime issue, not FFmpeg.`;
                if (lowered.includes('could not start audio source') || error?.name === 'NotReadableError') {
                    loopbackUnsupportedRef.current = true;
                    loopbackUnsupportedReasonRef.current = message;
                }
                setRecordModeErrorWithNotice(message);
            } else {
                setRecordModeErrorWithNotice(rawMessage);
            }
            setRecordModeStatus('error');
        }
    };

    const stopRecordModeCapture = () => {
        const activeSessionId = recordModeSessionIdRef.current;
        if (recordModeCaptureEngineRef.current === 'native-helper') {
            if (!activeSessionId) {
                return;
            }
            setRecordModeStatus('processing');
            void finalizeRecordModeSession(activeSessionId);
            return;
        }

        const recorder = recordModeRecorderRef.current;
        if (!recorder || recorder.state === 'inactive' || recordModeStopRequestedRef.current) {
            return;
        }

        recordModeStopRequestedRef.current = true;
        setRecordModeStatus('processing');
        try {
            recorder.stop();
        } catch (error: any) {
            recordModeStopRequestedRef.current = false;
            setRecordModeErrorWithNotice(error?.message || 'Failed to stop record mode');
            setRecordModeStatus('error');
        }
    };

    const importRecordingAudioFile = async () => {
        if (recordModeStatus === 'capturing' || recordModeStatus === 'processing' || recordModeStatus === 'selecting') {
            return;
        }

        setIsRecordingCaptureSettingsOpen(false);
        setRecordModeError('');
        setRecordingActionError('');
        setRecordModeStatus('processing');

        try {
            const result = await ipcRenderer.invoke('recordings:import-audio-file');
            if (!result || result.status === 'cancelled') {
                setRecordModeStatus('idle');
                return;
            }

            if (result.status !== 'success') {
                throw new Error(result.message || 'Failed to import audio file');
            }

            const preferredId = result.recording?.id || null;
            await refreshRecordings(preferredId);
	            setRecordingDetailTab('summary');
            setRecordingDraftDirty(false);
            setRecordingActionError('');
            setRecordModeStatus('done');
        } catch (error: any) {
            const message = error?.message || 'Failed to import audio file';
            setRecordingActionError(message);
            pushRecordingNotice('error', message);
            setRecordModeStatus('error');
        }
    };

    startRecordModeCaptureRef.current = startRecordModeCapture;
    stopRecordModeCaptureRef.current = stopRecordModeCapture;

    useEffect(() => {
        const handleRecordModeCommandFromTray = (_event: any, payload: any = {}) => {
            const action = payload?.action === 'stop' ? 'stop' : 'start';
            if (action === 'stop') {
                stopRecordModeCaptureRef.current();
                return;
            }

            startRecordModeCaptureRef.current({
                preapproved: payload?.preapproved === true,
            });
        };

        ipcRenderer.on('record-mode:command-from-tray', handleRecordModeCommandFromTray);
        ipcRenderer.send('record-mode:command-listener-ready');
        return () => {
            ipcRenderer.removeListener('record-mode:command-from-tray', handleRecordModeCommandFromTray);
        };
    }, []);

	    useEffect(() => {
	        return () => {
	            releaseRecordModeMedia();
	            if (recordModeSessionIdRef.current) {
	                ipcRenderer.invoke('record-mode:abort-session', {
	                    sessionId: recordModeSessionIdRef.current,
	                });
	            }
	        };
	    }, [releaseRecordModeMedia]);

        const showUpdateButton = updateState.supported === true
            && !isUpdateButtonBusy
            && (updateState.status === 'available' || updateState.status === 'downloaded');
        const updateVersionLabel = formatUpdateVersionLabel(updateState.availableVersion);
        const updateButtonText = updateState.status === 'downloaded'
            ? 'Restart'
            : 'Update';
        const updateButtonTooltip = updateState.status === 'downloaded'
            ? (updateVersionLabel ? `Restart to install ${updateVersionLabel}` : 'Restart to install update')
            : (updateVersionLabel ? `Update to ${updateVersionLabel}` : 'Update');

        const handleUpdateButtonClick = useCallback(async () => {
            if (isUpdateButtonBusy || updateState.status === 'downloading') {
                return;
            }
            if (updateState.status !== 'available' && updateState.status !== 'downloaded') {
                return;
            }

            setIsUpdateButtonBusy(true);
            try {
                const channel = updateState.status === 'downloaded'
                    ? 'updates:install'
                    : 'updates:download';
                const result = await ipcRenderer.invoke(channel);
                setUpdateState(normalizeUpdateState(result));
            } catch (error: any) {
                setUpdateState((previous) => ({
                    ...previous,
                    status: 'error',
                    errorMessage: error?.message || 'Update action failed.',
                    progressPercent: null,
                }));
            } finally {
                setIsUpdateButtonBusy(false);
            }
        }, [isUpdateButtonBusy, updateState.status]);

        const renderUpdateButton = (compact = false) => {
            if (!showUpdateButton) return null;
            return (
                <HoverTooltip label={updateButtonTooltip}>
                    <button
                        type="button"
                        className={`no-drag inline-flex h-7 items-center justify-center gap-1.5 rounded-md text-[11px] font-semibold transition-all ${
                            compact ? 'px-2.5' : 'max-w-full px-2.5'
                        } hover:opacity-90 active:scale-95`}
                        onClick={handleUpdateButtonClick}
                        aria-label={updateButtonTooltip}
                        style={{
                            WebkitAppRegion: 'no-drag',
                            backgroundColor: 'var(--general-eye-catch)',
                            color: '#f8fafc',
                        } as any}
                    >
                        <span className="truncate">{updateButtonText}</span>
                    </button>
                </HoverTooltip>
            );
        };

	    const shellSidebarCollapsed = settings.layout?.sidebarCollapsed === true;
	    const shellSidebarStoredWidth = clampSidebarWidth(Number(settings.layout?.sidebarWidth || SIDEBAR_WIDTH_DEFAULT));
	    const shellSidebarExpandedWidth = liveSidebarWidth ?? shellSidebarStoredWidth;
	    const shellSidebarWidth = shellSidebarCollapsed ? 0 : shellSidebarExpandedWidth;
	    const showMacTrafficLightsInset = !isDashboardWindowFullScreen && process.platform === 'darwin';
	    const sidebarTitleInset = showMacTrafficLightsInset
	        ? Math.max(8, MAC_TRAFFIC_LIGHT_GUTTER - 12)
	        : 8;
	    const collapsedTopBarLeadingInset = shellSidebarCollapsed && showMacTrafficLightsInset
	        ? MAC_TRAFFIC_LIGHT_GUTTER
	        : 0;
	    const pinnedSectionExpanded = settings.layout?.pinnedExpanded !== false;
	    const notesSectionExpanded = settings.layout?.notesExpanded !== false;
	    const recordingsSectionExpanded = settings.layout?.recordingsExpanded !== false;
	    const recentSectionExpanded = (settings.layout as any)?.recentExpanded !== false;
	    const chatsSectionExpanded = (settings.layout as any)?.chatsExpanded !== false;
	    const spacesSectionExpanded = (settings.layout as any)?.spacesExpanded !== false;
	    const selectedNoteSourceRecordings = selectedNote
	        ? recordings.filter((entry) => normalizeNoteSourceRecordingIds(selectedNote.sourceRecordingIds || []).includes(entry.id))
	        : [];
	    const isRecordingActionBusy = isDeletingRecording || !!summarizingRecordingId || isSavingRecordingDraft;
	    const selectedNoteFolderName = selectedNote?.folderId
	        ? notesData.folders.find((folder) => folder.id === selectedNote.folderId)?.name || ''
	        : '';
	    const selectedNoteWordCount = ((String(selectedNote?.text || '').trim().match(/\S+/g)) || []).length;
	    const selectedNoteLastEditedAt = Number(selectedNote?.lastModified || selectedNote?.createdAt || 0);
	    const selectedNoteLastEditedLabel = Number.isFinite(selectedNoteLastEditedAt) && selectedNoteLastEditedAt > 0
	        ? new Date(selectedNoteLastEditedAt).toLocaleString('en-GB', {
	            day: '2-digit',
	            month: 'short',
	            year: 'numeric',
	            hour: '2-digit',
	            minute: '2-digit',
	            hour12: false,
	        })
	        : 'Unknown date';
	    const libraryFilterOptions: { key: LibraryFilter; label: string; icon: React.ComponentType<{ size?: number }> }[] = [
	        { key: 'all', label: 'All', icon: BookOpen },
	        { key: 'notes', label: 'Notes', icon: FileText },
	        { key: 'recordings', label: 'Recordings', icon: Mic },
	        { key: 'chats', label: 'Chats', icon: MessageCircle },
	        { key: 'private', label: 'Private', icon: Lock },
	        { key: 'cloud', label: 'Cloud', icon: Cloud },
	    ];

        const renderSyncToastStack = () => (
            syncToasts.length ? (
                <div className="fixed bottom-5 right-5 z-[170] flex w-[min(360px,calc(100vw-2rem))] flex-col gap-2 pointer-events-none">
                    {syncToasts.map((toast) => {
                        const isError = toast.level === 'error';
                        const isAuthToast = toast.code === 'AUTH_REQUIRED' || toast.code === 'AUTH_EXPIRED';
                        const canRetry = !isAuthToast && toast.code !== 'SYNC_CONFLICT';
                        return (
                            <div
                                key={toast.id}
                                className={`pointer-events-auto rounded-lg border px-3 py-2.5 shadow-xl ${isError ? 'border-red-200 bg-red-50 text-red-700' : 'border-amber-200 bg-amber-50 text-amber-700'}`}
                            >
                                <div className="flex items-start gap-2">
                                    <div className={`mt-0.5 flex h-6 w-6 shrink-0 items-center justify-center rounded-md ${isError ? 'bg-red-100' : 'bg-amber-100'}`}>
                                        {isAuthToast ? <User size={14} /> : <Cloud size={14} />}
                                    </div>
                                    <div className="min-w-0 flex-1">
                                        <div className="text-xs font-semibold leading-5">
                                            {isAuthToast ? 'Account required' : toast.code === 'SYNC_CONFLICT' ? 'Sync conflict' : 'Cloud sync'}
                                        </div>
                                        <div className="text-xs leading-relaxed">{toast.message}</div>
                                        {(isAuthToast || canRetry) ? (
                                            <div className="mt-2 flex items-center gap-2">
                                                {isAuthToast ? (
                                                    <button
                                                        className="inline-flex h-7 items-center gap-1.5 rounded-md bg-stone-800 px-2.5 text-[11px] font-semibold text-white hover:bg-stone-900 transition-colors"
                                                        onClick={openSignInForSync}
                                                    >
                                                        <User size={12} />
                                                        Sign in
                                                    </button>
                                                ) : null}
                                                {canRetry ? (
                                                    <button
                                                        className="inline-flex h-7 items-center gap-1.5 rounded-md border border-current/25 px-2.5 text-[11px] font-semibold hover:bg-black/5 transition-colors"
                                                        onClick={retryCloudSync}
                                                    >
                                                        <RefreshCw size={12} />
                                                        Retry
                                                    </button>
                                                ) : null}
                                            </div>
                                        ) : null}
                                    </div>
                                    <button
                                        className="inline-flex h-6 w-6 shrink-0 items-center justify-center rounded-md text-current hover:bg-black/10 transition-colors"
                                        onClick={() => dismissSyncToast(toast.id)}
                                        aria-label="Dismiss sync message"
                                    >
                                        <X size={13} strokeWidth={3} />
                                    </button>
                                </div>
                            </div>
                        );
                    })}
                </div>
            ) : null
        );

        const renderRecordingNoticeStack = () => {
            const hasNotices = recordingNotices.length > 0;
            const hasConflicts = syncConflicts.length > 0;
            if (!hasNotices && !hasConflicts) return null;

            return (
                <div className="fixed bottom-5 left-5 z-[170] flex w-[min(360px,calc(100vw-2rem))] flex-col gap-2 pointer-events-none">
                    {syncConflicts.map((conflict) => {
                        const key = getSyncConflictKey(conflict);
                        const isResolving = resolvingSyncConflictKeys.includes(key);
                        const isResolved = resolvedSyncConflictKeys.includes(key);
                        return (
                            <div
                                key={`sync-conflict-${key}`}
                                className="pointer-events-auto rounded-lg border border-amber-200 bg-amber-50 px-3 py-2.5 text-amber-700 shadow-xl"
                            >
                                <div className="flex items-start gap-2">
                                    <div className="mt-0.5 flex h-6 w-6 shrink-0 items-center justify-center rounded-md bg-amber-100">
                                        <Cloud size={14} />
                                    </div>
                                    <div className="min-w-0 flex-1">
                                        <div className="text-xs font-semibold leading-5">Sync conflict</div>
                                        <div className="text-xs leading-relaxed">Choose which version to keep.</div>
                                        <div className="mt-2 flex items-center gap-2">
                                            <button
                                                className="inline-flex h-7 items-center rounded-md border border-amber-300 px-2.5 text-[11px] font-semibold hover:bg-black/5 transition-colors disabled:opacity-50"
                                                onClick={() => void resolveSyncConflict(conflict, 'client_wins')}
                                                disabled={isResolving || isResolved}
                                            >
                                                Local
                                            </button>
                                            <button
                                                className="inline-flex h-7 items-center rounded-md border border-amber-300 px-2.5 text-[11px] font-semibold hover:bg-black/5 transition-colors disabled:opacity-50"
                                                onClick={() => void resolveSyncConflict(conflict, 'server_wins')}
                                                disabled={isResolving || isResolved}
                                            >
                                                Cloud
                                            </button>
                                        </div>
                                    </div>
                                </div>
                            </div>
                        );
                    })}
                    {recordingNotices.map((notice) => {
                        const isError = notice.level === 'error';
                        return (
                            <div
                                key={`recording-notice-${notice.id}`}
                                className={`pointer-events-auto rounded-lg border px-3 py-2.5 shadow-xl ${isError ? 'border-red-200 bg-red-50 text-red-700' : 'border-amber-200 bg-amber-50 text-amber-700'}`}
                            >
                                <div className="flex items-start gap-2">
                                    <div className={`mt-0.5 flex h-6 w-6 shrink-0 items-center justify-center rounded-md ${isError ? 'bg-red-100' : 'bg-amber-100'}`}>
                                        <Mic size={14} />
                                    </div>
                                    <div className="min-w-0 flex-1">
                                        <div className="text-xs font-semibold leading-5">
                                            {isError ? 'Recording error' : 'Recording warning'}
                                        </div>
                                        <div className="text-xs leading-relaxed">{notice.message}</div>
                                    </div>
                                    <button
                                        className="inline-flex h-6 w-6 shrink-0 items-center justify-center rounded-md text-current hover:bg-black/10 transition-colors"
                                        onClick={() => dismissRecordingNotice(notice)}
                                        aria-label="Dismiss recording message"
                                    >
                                        <X size={13} strokeWidth={3} />
                                    </button>
                                </div>
                            </div>
                        );
                    })}
                </div>
            );
        };

	    if (!isLoading && !settings.onboardingCompleted) {
        return (
            <div className={`h-screen es-dashboard es-general-text overflow-hidden es-theme-${settings.theme} es-general-background`}>
                <div style={{ height: '100vh' }}>
                    <OnboardingPage
                        settings={settings}
                        updateSettings={updateSettings}
	                        onComplete={() => {
	                            setActiveSection('library');
	                        }}
	                        authState={authState}
                        notes={notesData.notes}
                        recordings={recordings}
                        recordModeStatus={recordModeStatus}
                    />
                </div>
                {renderRecordingNoticeStack()}
                {renderSyncToastStack()}
            </div>
        );
    }

    const indentSize = 14;
    const baseIndent = 10;

    const renderNoteRow = (note: Note, depth: number): React.ReactNode => {
        const isSelected = selectedLibraryItem?.type === 'note' && selectedLibraryItem.id === note.id;
        const title = (note.title || 'Untitled note').trim() || 'Untitled note';
        const isCloudSynced = note.isCloudSynced !== false;
        const paddingLeft = `${baseIndent + depth * indentSize}px`;

        if (renamingNoteId === note.id) {
            return (
                <div
                    key={`sidebar-note-${note.id}`}
                    className={`group w-full rounded-lg px-2.5 py-1.5 text-left text-sm transition-colors ${isSelected ? 'es-sidebar-selected-item' : 'es-sidebar-item-hover es-sidebar-item-text'}`}
                    style={{ paddingLeft }}
                >
                    <div className="flex items-center gap-2 min-w-0">
                        <FileText size={13} className="shrink-0 opacity-80" />
                        <input
                            autoFocus
                            className="h-6 min-w-0 flex-1 bg-transparent border-none p-0 text-sm font-medium focus:outline-none focus:ring-0 es-general-text"
                            value={noteRenameDraft}
                            onChange={(event) => setNoteRenameDraft(event.target.value)}
                            onClick={(event) => event.stopPropagation()}
                            onKeyDown={(event) => {
                                if (event.key === 'Enter') {
                                    event.preventDefault();
                                    commitNoteRename(note.id);
                                    return;
                                }
                                if (event.key === 'Escape') {
                                    event.preventDefault();
                                    skipNoteRenameBlurRef.current = true;
                                    cancelNoteRename();
                                }
                            }}
                            onBlur={() => {
                                if (skipNoteRenameBlurRef.current) {
                                    skipNoteRenameBlurRef.current = false;
                                    return;
                                }
                                commitNoteRename(note.id);
                            }}
                        />
                    </div>
                </div>
            );
        }

        return (
            <button
                key={`sidebar-note-${note.id}`}
                className={`group relative w-full rounded-lg px-2.5 py-1.5 text-left text-sm transition-all duration-150 ${isSelected ? 'es-sidebar-selected-item' : 'es-sidebar-item-hover es-sidebar-item-text'} ${noteRowDropTargetId === note.id ? 'es-sidebar-folder-drop-target' : ''}`}
                style={{ paddingLeft }}
                onClick={() => selectLibraryItem({ type: 'note', id: note.id })}
                onDoubleClick={(event) => {
                    event.preventDefault();
                    event.stopPropagation();
                    startNoteRename(note);
                }}
                draggable
                onDragStart={(event) => {
                    event.dataTransfer.setData('text/plain', note.id);
                    setDraggingNoteId(note.id);
                }}
                onDragEnd={() => {
                    setDraggingNoteId(null);
                }}
                onDragOver={(event) => {
                    if (draggingNoteId && draggingNoteId !== note.id) {
                        event.preventDefault();
                        if (noteRowDropTargetId !== note.id) {
                            setNoteRowDropTargetId(note.id);
                        }
                    }
                }}
                onDragLeave={(event) => {
                    const related = event.relatedTarget as Node | null;
                    if (related && event.currentTarget.contains(related)) return;
                    if (noteRowDropTargetId === note.id) {
                        setNoteRowDropTargetId(null);
                    }
                }}
                onDrop={(event) => {
                    if (draggingNoteId && draggingNoteId !== note.id) {
                        event.preventDefault();
                        event.stopPropagation();
                        const targetNote = notesData.notes.find((item) => item.id === note.id);
                        moveNoteToFolder(draggingNoteId, targetNote?.folderId || '');
                        setNoteRowDropTargetId(null);
                        setDraggingNoteId(null);
                    }
                }}
            >
                <div className="flex items-center gap-2 min-w-0">
                    <span className="relative h-3.5 w-3.5 shrink-0">
                        <span className="absolute inset-0 inline-flex items-center justify-center transition-opacity group-hover:opacity-0 group-focus-visible:opacity-0">
                            <FileText size={13} className="opacity-80" />
                        </span>
                        <span className="absolute inset-0 inline-flex items-center justify-center opacity-0 transition-opacity group-hover:opacity-100 group-focus-visible:opacity-100">
                            {isCloudSynced ? (
                                <Cloud size={12} className="text-sky-500" />
                            ) : (
                                <Lock size={12} className="text-stone-400" />
                            )}
                        </span>
                    </span>
                    <span className="truncate font-medium min-w-0 flex-1">{title}</span>
                    {renderRowThreeDotsMenu('note', note.id, title, note, 'note')}
                </div>
            </button>
        );
    };

    const renderRecordingRow = (entry: RecordingItem, depth: number): React.ReactNode => {
        const isSelected = selectedLibraryItem?.type === 'recording' && selectedLibraryItem.id === entry.id;
        const title = (entry.title || '').trim() || 'Untitled recording';
        const isCloudSynced = entry.isCloudSynced !== false;
        const paddingLeft = `${baseIndent + depth * indentSize}px`;

        if (renamingRecordingId === entry.id) {
            return (
                <div
                    key={`sidebar-recording-${entry.id}`}
                    className={`group w-full rounded-lg px-2.5 py-1.5 text-left text-sm transition-colors ${isSelected ? 'es-sidebar-selected-item' : 'es-sidebar-item-hover es-sidebar-item-text'}`}
                    style={{ paddingLeft }}
                >
                    <div className="flex items-center gap-2 min-w-0">
                        <Mic size={13} className="shrink-0 opacity-80" />
                        <input
                            autoFocus
                            className="h-6 min-w-0 flex-1 bg-transparent border-none p-0 text-sm font-medium focus:outline-none focus:ring-0 es-general-text"
                            value={recordingRenameDraft}
                            onChange={(event) => setRecordingRenameDraft(event.target.value)}
                            onClick={(event) => event.stopPropagation()}
                            onKeyDown={(event) => {
                                if (event.key === 'Enter') {
                                    event.preventDefault();
                                    commitRecordingRename(entry.id);
                                    return;
                                }
                                if (event.key === 'Escape') {
                                    event.preventDefault();
                                    skipRecordingRenameBlurRef.current = true;
                                    cancelRecordingRename();
                                }
                            }}
                            onBlur={() => {
                                if (skipRecordingRenameBlurRef.current) {
                                    skipRecordingRenameBlurRef.current = false;
                                    return;
                                }
                                commitRecordingRename(entry.id);
                            }}
                        />
                    </div>
                </div>
            );
        }

        return (
            <button
                key={`sidebar-recording-${entry.id}`}
                className={`group relative w-full rounded-lg px-2.5 py-1.5 text-left text-sm transition-colors ${isSelected ? 'es-sidebar-selected-item' : 'es-sidebar-item-hover es-sidebar-item-text'}`}
                style={{ paddingLeft }}
                onClick={() => selectLibraryItem({ type: 'recording', id: entry.id })}
                onDoubleClick={(event) => {
                    event.preventDefault();
                    event.stopPropagation();
                    startRecordingRename(entry);
                }}
            >
                <div className="flex items-center gap-2 min-w-0">
                    <span className="relative h-3.5 w-3.5 shrink-0">
                        <span className="absolute inset-0 inline-flex items-center justify-center transition-opacity group-hover:opacity-0 group-focus-visible:opacity-0">
                            <Mic size={13} className="opacity-80" />
                        </span>
                        <span className="absolute inset-0 inline-flex items-center justify-center opacity-0 transition-opacity group-hover:opacity-100 group-focus-visible:opacity-100">
                            {isCloudSynced ? (
                                <Cloud size={12} className="text-sky-500" />
                            ) : (
                                <Lock size={12} className="text-stone-400" />
                            )}
                        </span>
                    </span>
                    <span className="truncate font-medium min-w-0 flex-1">{title}</span>
                    {renderRowThreeDotsMenu('recording', entry.id, title, entry, 'recording')}
                </div>
            </button>
        );
    };

    const renderFolderBranch = (parentId: string, depth: number, ancestry: Set<string>): React.ReactNode[] => {
        const children = visibleSidebarFoldersByParentId.get(parentId) || [];
        const rows: React.ReactNode[] = [];

        children.forEach((folder) => {
            if (ancestry.has(folder.id)) return;
            const isExpanded = isFolderExpanded(folder.id);
            const folderPaddingLeft = `${baseIndent + depth * indentSize}px`;
            const childAncestry = new Set(ancestry);
            childAncestry.add(folder.id);
            const childFolderRows = isExpanded ? renderFolderBranch(folder.id, depth + 1, childAncestry) : [];
            const childNotes = isExpanded ? (visibleSidebarNotesByFolderId.get(folder.id) || []) : [];
            const childRecordings = isExpanded ? (visibleSidebarRecordingsByFolderId.get(folder.id) || []) : [];
            const hasAnyChildren = childFolderRows.length > 0 || childNotes.length > 0 || childRecordings.length > 0;

            if (renamingFolderId === folder.id) {
                rows.push(
                    <div
                        key={`sidebar-folder-${folder.id}`}
                        className="group relative w-full rounded-lg px-2.5 py-1.5 text-left text-sm transition-colors es-sidebar-item-hover es-sidebar-item-text"
                        style={{ paddingLeft: folderPaddingLeft }}
                    >
                        <div className="flex items-center gap-2 min-w-0">
                            <FolderGlyph size={13} className="shrink-0 opacity-80" />
                            <input
                                autoFocus
                                className="h-6 min-w-0 flex-1 bg-transparent border-none p-0 text-sm font-medium focus:outline-none focus:ring-0 es-general-text"
                                value={folderRenameDraft}
                                onChange={(event) => setFolderRenameDraft(event.target.value)}
                                onClick={(event) => event.stopPropagation()}
                                onKeyDown={(event) => {
                                    if (event.key === 'Enter') {
                                        event.preventDefault();
                                        commitFolderRename(folder.id);
                                        return;
                                    }
                                    if (event.key === 'Escape') {
                                        event.preventDefault();
                                        skipFolderRenameBlurRef.current = true;
                                        cancelFolderRename();
                                    }
                                }}
                                onBlur={() => {
                                    if (skipFolderRenameBlurRef.current) {
                                        skipFolderRenameBlurRef.current = false;
                                        return;
                                    }
                                    commitFolderRename(folder.id);
                                }}
                            />
                        </div>
                    </div>,
                );
            } else {
                const { IconComponent, colorStyle } = getFolderIconAndColor(folder);
                rows.push(
                    <button
                        key={`sidebar-folder-${folder.id}`}
                        className={`group relative w-full rounded-lg px-2.5 py-1.5 text-left text-sm transition-all duration-150 es-sidebar-item-hover es-sidebar-item-text ${noteFolderDropTargetId === folder.id ? 'es-sidebar-folder-drop-target' : ''}`}
                        style={{ paddingLeft: folderPaddingLeft }}
                        onClick={() => {
                            setSidebarMenuTarget(null);
                            toggleFolderExpanded(folder.id);
                        }}
                        onDoubleClick={(event) => {
                            event.preventDefault();
                            event.stopPropagation();
                        }}
                        onDragOver={(event) => {
                            if (!draggingNoteId) return;
                            event.preventDefault();
                            event.dataTransfer.dropEffect = 'move';
                            if (noteFolderDropTargetId !== folder.id) {
                                setNoteFolderDropTargetId(folder.id);
                            }
                        }}
                        onDragLeave={(event) => {
                            const related = event.relatedTarget as Node | null;
                            if (related && event.currentTarget.contains(related)) return;
                            if (noteFolderDropTargetId === folder.id) {
                                setNoteFolderDropTargetId(null);
                            }
                        }}
                        onDrop={(event) => {
                            if (!draggingNoteId) return;
                            event.preventDefault();
                            event.stopPropagation();
                            moveNoteToFolder(draggingNoteId, folder.id);
                            setNoteFolderDropTargetId(null);
                            setDraggingNoteId(null);
                        }}
                    >
                        <div className="flex items-center gap-2 min-w-0">
                            <span className="relative h-3.5 w-3.5 shrink-0">
                                <span className="absolute inset-0 inline-flex items-center justify-center transition-opacity group-hover:opacity-0 group-focus-visible:opacity-0" style={colorStyle}>
                                    <IconComponent size={13} />
                                </span>
                                <span className="absolute inset-0 inline-flex items-center justify-center opacity-0 transition-opacity group-hover:opacity-100 group-focus-visible:opacity-100">
                                    <ChevronDown size={13} className={`transition-transform ${isExpanded ? '' : '-rotate-90'}`} />
                                </span>
                            </span>
                            <span className="block truncate min-w-0 flex-1">{folder.name || 'Untitled folder'}</span>
                            {noteFolderDropTargetId === folder.id ? (
                                <span className="shrink-0 text-[10px] font-semibold uppercase tracking-[0.12em] text-stone-500">Drop note</span>
                            ) : null}
                            <span className="relative h-5 w-5 shrink-0">
                                <button
                                    className="absolute inset-0 opacity-0 group-hover:opacity-100 group-focus-visible:opacity-100 inline-flex items-center justify-center rounded-md es-sidebar-item-text es-sidebar-header-action transition-opacity"
                                    onClick={(event) => {
                                        event.stopPropagation();
                                        setSidebarMenuTarget({ kind: 'folder', id: folder.id });
                                        setNoteMenuFolderOptionsForId(null);
                                    }}
                                    aria-label="Folder row menu"
                                >
                                    <MoreHorizontal size={13} />
                                </button>
                            </span>
                        </div>
                        {sidebarMenuTarget?.kind === 'folder' && sidebarMenuTarget.id === folder.id ? (
                            <div ref={sidebarItemMenuRef} className="absolute right-2 top-[calc(100%+4px)] z-[90] w-44 rounded-lg border es-global-outline es-general-background shadow-xl p-1">
                                <button
                                    className="w-full rounded-md px-2 py-1.5 text-left text-xs es-general-item-hover es-general-text inline-flex items-center gap-1.5"
                                    onClick={(event) => {
                                        event.stopPropagation();
                                        createNotesFolder(folder.id);
                                        setSidebarMenuTarget(null);
                                    }}
                                >
                                    <FolderPlus size={12} />
                                    New sub-space
                                </button>
                                <button
                                    className="w-full rounded-md px-2 py-1.5 text-left text-xs es-general-item-hover es-general-text inline-flex items-center gap-1.5"
                                    onClick={(event) => {
                                        event.stopPropagation();
                                        setCustomizingFolder(folder);
                                        setCustomizingFolderName(folder.name || '');
                                        setCustomizingFolderIconId(folder.iconId || 'folder');
                                        setCustomizingFolderColorId(folder.colorId || 'gray');
                                        setSidebarMenuTarget(null);
                                    }}
                                >
                                    <Pencil size={12} />
                                    Rename
                                </button>
                                <button
                                    className="w-full rounded-md px-2 py-1.5 text-left text-xs text-red-600 hover:bg-red-50 inline-flex items-center gap-1.5"
                                    onClick={(event) => {
                                        event.stopPropagation();
                                        deleteFolderById(folder);
                                        setSidebarMenuTarget(null);
                                    }}
                                >
                                    <Trash2 size={12} />
                                    Delete
                                </button>
                            </div>
                        ) : null}
                    </button>,
                );
            }

            if (!isExpanded) return;

            childFolderRows.forEach((row) => rows.push(row));
            childNotes.forEach((childNote) => rows.push(renderNoteRow(childNote, depth + 1)));
            childRecordings.forEach((childRecording) => rows.push(renderRecordingRow(childRecording, depth + 1)));

            if (!hasAnyChildren) {
                rows.push(
                    <div
                        key={`sidebar-folder-empty-${folder.id}`}
                        className="group w-full rounded-lg px-2.5 py-1.5 text-left text-xs italic text-stone-500/85 transition-colors es-sidebar-item-hover"
                        style={{ paddingLeft: `${baseIndent + (depth + 1) * indentSize}px` }}
                    >
                        <div className="flex items-center gap-2">
                            <span className="truncate flex-1">No items inside</span>
                            <button
                                className="h-5 w-5 opacity-0 group-hover:opacity-100 focus-visible:opacity-100 inline-flex items-center justify-center rounded-md es-sidebar-item-text es-sidebar-header-action transition-opacity"
                                onClick={(event) => {
                                    event.stopPropagation();
                                    createNewLibraryNote(folder.id);
                                }}
                                aria-label="Create note in folder"
                            >
                                <Plus size={12} />
                            </button>
                        </div>
                    </div>,
                );
            }
        });

        return rows;
    };

    return (
        <div className={`h-screen es-dashboard es-general-text overflow-hidden es-theme-${settings.theme} es-general-background`}>
            <div className="flex h-full">
                <aside
                    data-tour-id="workspace-library"
                    className={`relative es-sidebar-background flex flex-col transition-[width] duration-200 ease-out shrink-0 overflow-hidden ${shellSidebarCollapsed ? 'p-0 border-r-0' : 'px-3 pb-3 pt-0 border-r es-global-separator'}`}
                    style={{ width: shellSidebarWidth }}
                >
                    {!shellSidebarCollapsed ? (
                        <div
                            className="relative -mx-3 mb-1 h-10 select-none draggable es-header-background"
                        >
                            <div className="absolute inset-0 z-0" aria-hidden="true" />
                            <div
                                className="relative z-10 h-10 w-full flex items-center justify-end text-left select-none px-3 pointer-events-none"
                                style={{ paddingLeft: `${sidebarTitleInset}px` }}
                            >
                                <div className="pointer-events-auto min-w-0">
                                    {renderUpdateButton(false)}
                                </div>
                            </div>
                        </div>
                    ) : null}
	                    <div className="relative" ref={librarySearchPopoverRef}>
                        {isLibrarySearchOpen ? (
                                    <div className="fixed inset-0 z-[80] flex items-start sm:items-center justify-center p-4 sm:p-6" onClick={() => setIsLibrarySearchOpen(false)}>
                                        <div className="absolute inset-0 bg-black/30 backdrop-blur-[1px]" />
                                        <div
                                            data-tour-id="library-search-panel"
                                            className="relative w-[94vw] max-w-[980px] max-h-[82vh] rounded-2xl border es-global-outline es-general-background shadow-2xl overflow-hidden flex flex-col"
                                            onClick={(event) => event.stopPropagation()}
                                        >
                                            <div className="p-4 border-b es-global-separator">
                                                <div data-tour-id="library-search-input" className="relative">
                                                    <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-stone-400" />
	                                                    <input
		                                                        className="w-full search-input rounded-lg bg-transparent pl-8 pr-9 py-2.5 text-sm focus:outline-none ring-1 ring-inset border-transparent ring-[var(--global-outlines)] hover:ring-[#4CAE6B] focus:ring-[#4CAE6B] transition-all es-general-text placeholder:text-stone-500 shadow-sm"
	                                                        placeholder="Search notes and recordings..."
	                                                        value={librarySearch}
	                                                        onChange={(event) => setLibrarySearch(event.target.value)}
	                                                        autoFocus
	                                                    />
                                                    <button
                                                        className="absolute right-2 top-1/2 -translate-y-1/2 h-6 w-6 rounded-md inline-flex items-center justify-center es-general-item-hover es-general-text transition-colors"
                                                        onClick={() => setIsLibrarySearchOpen(false)}
                                                        aria-label="Close search"
                                                    >
                                                        <X size={13} />
                                                    </button>
                                                </div>
                                            </div>

                                            <div className="p-4 border-b es-global-separator space-y-3">
                                                <div className="flex items-center justify-between gap-2">
                                                    {openedSearchFromTabs ? (
                                                        <div className="flex items-center gap-2 w-full">
                                                            <button
                                                                className="flex-1 rounded-lg border es-global-outline px-3 py-1.5 text-xs font-semibold uppercase tracking-wider es-general-item-hover es-general-text transition-colors inline-flex items-center justify-center gap-1.5"
                                                                onClick={() => {
                                                                    if (!openedSearchFromTabs) return;
                                                                    createNewLibraryNote();
                                                                    setIsLibrarySearchOpen(false);
                                                                }}
                                                            >
                                                                <Plus size={12} />
                                                                Create New note
                                                            </button>
                                                            <button
                                                                className="flex-1 rounded-lg border es-global-outline px-3 py-1.5 text-xs font-semibold uppercase tracking-wider es-general-item-hover es-general-text transition-colors inline-flex items-center justify-center gap-1.5"
                                                                onClick={() => {
                                                                    if (!openedSearchFromTabs) return;
                                                                    openAskTab();
                                                                    setIsLibrarySearchOpen(false);
                                                                }}
                                                            >
                                                                <MessageCircle size={12} />
                                                                Start new Chat
                                                            </button>
                                                        </div>
                                                    ) : null}
                                                </div>

                                                <div className="flex flex-wrap gap-1.5">
                                                    {libraryFilterOptions.map((filterOption) => {
                                                        const Icon = filterOption.icon;
                                                        const selected = libraryFilter === filterOption.key;
                                                        return (
                                                            <button
                                                                key={`library-popover-filter-${filterOption.key}`}
                                                                className={`rounded-full px-2.5 py-1 text-[10px] uppercase tracking-wider border transition-colors shadow-sm inline-flex items-center gap-1.5 ${selected ? 'es-general-selected-item border-[var(--global-selected-outlines)] text-[var(--es-text)]' : 'border-[var(--global-outlines)] text-stone-500 hover:text-stone-700 es-general-item-hover'}`}
                                                                onClick={() => setLibraryFilter(filterOption.key)}
                                                            >
                                                                <Icon size={11} />
                                                                {filterOption.label}
                                                            </button>
                                                        );
                                                    })}
                                                </div>

                                        <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                                            <input
                                                type="date"
                                                className="h-8 ring-1 ring-inset border-transparent ring-[var(--global-outlines)] focus:ring-[var(--global-selected-outlines)] rounded-md px-2 py-1.5 text-xs bg-transparent outline-none es-general-text shadow-sm transition-all"
                                                value={recordingDateFilterStart}
                                                onChange={(event) => setRecordingDateFilterStart(event.target.value)}
                                                aria-label="Start date"
                                            />
                                            <input
                                                type="date"
                                                className="h-8 ring-1 ring-inset border-transparent ring-[var(--global-outlines)] focus:ring-[var(--global-selected-outlines)] rounded-md px-2 py-1.5 text-xs bg-transparent outline-none es-general-text shadow-sm transition-all"
                                                value={recordingDateFilterEnd}
                                                onChange={(event) => setRecordingDateFilterEnd(event.target.value)}
                                                aria-label="End date"
                                            />
                                        </div>

                                        {(librarySearch.trim() || recordingDateFilterStart || recordingDateFilterEnd || libraryFilter !== 'all') ? (
                                            <button
                                                className="border es-global-outline bg-transparent text-stone-500 hover:text-stone-700 text-[10px] uppercase font-medium px-2 py-1 rounded-md transition-colors shadow-sm inline-flex items-center gap-1"
                                                onClick={() => {
                                                    setLibrarySearch('');
                                                    setRecordingDateFilterStart('');
                                                    setRecordingDateFilterEnd('');
                                                    setLibraryFilter('all');
                                                }}
                                            >
                                                <X size={10} strokeWidth={3} />
                                                Clear filters
                                            </button>
                                        ) : null}
                                    </div>

                                    <div className="flex-1 min-h-0 overflow-auto p-3">
                                        {filteredLibraryItems.length ? (
                                            LIBRARY_DATE_GROUPS.map((group) => {
                                                const items = groupedLibrarySearchResults[group.key];
                                                if (!items.length) return null;
                                                return (
                                                    <div key={`library-search-group-${group.key}`} className="mb-3 last:mb-0">
                                                        <div className="px-2 py-1 text-[10px] font-semibold uppercase tracking-[0.18em] text-stone-500">{group.label}</div>
                                                        <div className="space-y-1">
	                                                            {items.map((item) => {
	                                                                const recording = item.type === 'recording' ? recordings.find((entry) => entry.id === item.id) : null;
	                                                                const isCloudSynced = item.isCloudSynced !== false;
	                                                                return (
	                                                                    <button
	                                                                        key={`library-search-result-${item.type}-${item.id}`}
	                                                                        className="group w-full rounded-xl px-2.5 py-2 text-left es-general-item-hover transition-colors"
	                                                                        onClick={() => {
	                                                                            if (item.type === 'chat') {
	                                                                                activateLibraryTab({ type: 'ask', id: item.id });
	                                                                                setIsLibrarySearchOpen(false);
	                                                                                return;
	                                                                            }
	                                                                            selectLibraryItem(item);
	                                                                        }}
	                                                                    >
	                                                                        <div className="flex items-center justify-between gap-2">
	                                                                            <div className="min-w-0 inline-flex items-center gap-2">
	                                                                                {item.type === 'note'
	                                                                                    ? <FileText size={14} className="text-stone-400" />
	                                                                                    : item.type === 'recording'
	                                                                                        ? <Mic size={14} className="text-stone-400" />
	                                                                                        : <MessageCircle size={14} className="text-stone-400" />}
	                                                                                <span className="truncate text-sm font-medium es-general-text">{item.title}</span>
	                                                                            </div>
                                                                            <div className="shrink-0 inline-flex items-center gap-1.5">
                                                                                <span className="inline-flex h-3.5 w-3.5 items-center justify-center opacity-0 transition-opacity group-hover:opacity-100 group-focus-visible:opacity-100">
                                                                                    {isCloudSynced ? (
                                                                                        <Cloud size={12} className="text-sky-500" />
                                                                                    ) : (
                                                                                        <Lock size={12} className="text-stone-400" />
                                                                                    )}
                                                                                </span>
                                                                                {recording ? <span className="text-[11px] text-stone-400 tabular-nums">{formatDurationMs(recording.stats?.durationMs)}</span> : null}
                                                                            </div>
                                                                        </div>
                                                                        <div className="mt-1 line-clamp-1 text-xs text-stone-500">{item.preview}</div>
                                                                    </button>
                                                                );
                                                            })}
                                                        </div>
                                                    </div>
                                                );
                                            })
                                        ) : (
                                            <div className="px-4 py-8 text-center text-sm text-stone-500">No library items match these filters.</div>
                                        )}
                                    </div>
                                </div>
                            </div>
	                        ) : null}
	                    </div>

                <div className="mb-2 space-y-1.5">
                        <button
                            data-tour-id="library-search-button"
                            type="button"
                            className="group h-9 w-full rounded-lg px-2.5 text-left text-sm transition-all inline-flex items-center gap-2 border border-transparent es-sidebar-item-hover es-sidebar-item-text"
                            onClick={() => {
                                setOpenedSearchFromTabs(false);
                                setIsLibrarySearchOpen(true);
                            }}
                            aria-label="Search"
                        >
                            <Search size={13} className="shrink-0 opacity-80" />
                            <span className="min-w-0 flex-1 truncate">
                                Search
                            </span>
                            <span className="opacity-0 group-hover:opacity-100 transition-opacity text-[11px] text-stone-300 font-mono tracking-wider bg-[#242424] px-1.5 py-0.5 rounded border border-[#3e3e3e] shrink-0">⌘ G</span>
                        </button>
                        <button
                            data-tour-id="ask-sidebar-button"
                            type="button"
                            className="group h-9 w-full rounded-lg px-2.5 text-left text-sm transition-all inline-flex items-center gap-2 border border-transparent es-sidebar-item-hover es-sidebar-item-text"
                            onClick={openAskTab}
                            aria-label="Ask"
                        >
                            <MessageCircle size={13} className="shrink-0 opacity-80" />
                            <span className="min-w-0 flex-1 truncate">
                                Ask
                            </span>
                            <span className="opacity-0 group-hover:opacity-100 transition-opacity text-[11px] text-stone-300 font-mono tracking-wider bg-[#242424] px-1.5 py-0.5 rounded border border-[#3e3e3e] shrink-0">⌘ N</span>
                        </button>
                    </div>

                    <div className="flex-1 min-h-0 overflow-auto pr-1 space-y-3">
		                                {pinnedSidebarEntries.length ? (
		                                    <section>
                                        <div
                                            role="button"
                                            tabIndex={0}
                                            className="h-9 group flex items-center justify-between gap-2 rounded-lg px-2 es-sidebar-item-hover es-sidebar-item-text transition-colors cursor-pointer"
                                            onClick={() => updateLayoutSettings({ pinnedExpanded: !pinnedSectionExpanded })}
                                            onKeyDown={(event) => {
                                                if (event.key === 'Enter' || event.key === ' ') {
                                                    event.preventDefault();
                                                    updateLayoutSettings({ pinnedExpanded: !pinnedSectionExpanded });
                                                }
                                            }}
                                        >
                                            <div className="min-w-0 inline-flex items-center gap-1.5 text-xs font-semibold text-[#B0B0B0] group-hover:text-[var(--es-text)] transition-colors">
                                                <span>Pinned</span>
                                                <ChevronDown size={13} className={`opacity-0 group-hover:opacity-100 transition-all ${pinnedSectionExpanded ? '' : '-rotate-90'}`} />
                                            </div>
                                        </div>
                                        {pinnedSectionExpanded ? (
	                                            <div className="mt-1 space-y-1">
	                                                {pinnedSidebarEntries.map((entry) => {
		                                                    const isSelectedLibraryItem = entry.item.type === 'chat'
		                                                        ? activeLibraryTabKey === `ask:${entry.item.id}`
		                                                        : (selectedLibraryItem?.type === 'note' || selectedLibraryItem?.type === 'recording')
		                                                            && selectedLibraryItem.type === entry.item.type
		                                                            && selectedLibraryItem.id === entry.item.id;
		                                                    const canOpen = entry.item.type !== 'folder';
		                                                    const isSyncable = entry.item.type !== 'folder';
                                                        if (entry.item.type === 'folder') {
                                                            const folder = sidebarFolders.find((item) => item.id === entry.item.id);
                                                            if (!folder) return null;

                                                            const renderPinnedNoteRow = (note: Note, depth: number, keySeed: string): React.ReactNode => {
                                                                const isSelected = selectedLibraryItem?.type === 'note' && selectedLibraryItem.id === note.id;
                                                                const title = (note.title || 'Untitled note').trim() || 'Untitled note';
                                                                const isCloudSynced = note.isCloudSynced !== false;
                                                                const paddingLeft = `${10 + depth * 14}px`;

                                                                if (renamingNoteId === note.id) {
                                                                    return (
                                                                        <div
                                                                            key={`sidebar-pinned-note-${keySeed}-${note.id}`}
                                                                            className={`group w-full rounded-lg px-2.5 py-1.5 text-left text-sm transition-colors ${isSelected ? 'es-sidebar-selected-item' : 'es-sidebar-item-hover es-sidebar-item-text'}`}
                                                                            style={{ paddingLeft }}
                                                                        >
                                                                            <div className="flex items-center gap-2 min-w-0">
                                                                                <span className="relative h-3.5 w-3.5 shrink-0">
                                                                                    <span className="absolute inset-0 inline-flex items-center justify-center transition-opacity group-hover:opacity-0 group-focus-visible:opacity-0">
                                                                                        <FileText size={13} className="opacity-80" />
                                                                                    </span>
                                                                                    <span className="absolute inset-0 inline-flex items-center justify-center opacity-0 transition-opacity group-hover:opacity-100 group-focus-visible:opacity-100">
                                                                                        {isCloudSynced ? (
                                                                                            <Cloud size={12} className="text-sky-500" />
                                                                                        ) : (
                                                                                            <Lock size={12} className="text-stone-400" />
                                                                                        )}
                                                                                    </span>
                                                                                </span>
                                                                                <input
                                                                                    autoFocus
                                                                                    className="h-6 min-w-0 flex-1 bg-transparent border-none p-0 text-sm font-medium focus:outline-none focus:ring-0 es-general-text"
                                                                                    value={noteRenameDraft}
                                                                                    onChange={(event) => setNoteRenameDraft(event.target.value)}
                                                                                    onClick={(event) => event.stopPropagation()}
                                                                                    onKeyDown={(event) => {
                                                                                        if (event.key === 'Enter') {
                                                                                            event.preventDefault();
                                                                                            commitNoteRename(note.id);
                                                                                            return;
                                                                                        }
                                                                                        if (event.key === 'Escape') {
                                                                                            event.preventDefault();
                                                                                            skipNoteRenameBlurRef.current = true;
                                                                                            cancelNoteRename();
                                                                                        }
                                                                                    }}
                                                                                    onBlur={() => {
                                                                                        if (skipNoteRenameBlurRef.current) {
                                                                                            skipNoteRenameBlurRef.current = false;
                                                                                            return;
                                                                                        }
                                                                                        commitNoteRename(note.id);
                                                                                    }}
                                                                                />
                                                                            </div>
                                                                        </div>
                                                                    );
                                                                }

                                                                return (
                                                                    <button
                                                                        key={`sidebar-pinned-note-${keySeed}-${note.id}`}
                                                                        className={`group relative w-full rounded-lg px-2.5 py-1.5 text-left text-sm transition-colors ${isSelected ? 'es-sidebar-selected-item' : 'es-sidebar-item-hover es-sidebar-item-text'} ${draggingNoteId === note.id ? 'opacity-10' : ''} ${noteRowDropTargetId === note.id ? 'es-sidebar-folder-drop-target' : ''}`}
                                                                        style={{ paddingLeft }}
                                                                        draggable
                                                                        onDragStart={(event) => {
                                                                            event.dataTransfer.effectAllowed = 'move';
                                                                            event.dataTransfer.setData('text/plain', note.id);
                                                                            setDraggingNoteId(note.id);
                                                                        }}
                                                                        onDragEnd={() => {
                                                                            setDraggingNoteId(null);
                                                                            setNoteFolderDropTargetId(null);
                                                                            setNoteRowDropTargetId(null);
                                                                        }}
                                                                        onDragOver={(event) => {
                                                                            if (!draggingNoteId || draggingNoteId === note.id) return;
                                                                            event.preventDefault();
                                                                            event.dataTransfer.dropEffect = 'move';
                                                                            if (noteRowDropTargetId !== note.id) {
                                                                                setNoteRowDropTargetId(note.id);
                                                                            }
                                                                        }}
                                                                        onDragLeave={(event) => {
                                                                            const related = event.relatedTarget as Node | null;
                                                                            if (related && event.currentTarget.contains(related)) return;
                                                                            if (noteRowDropTargetId === note.id) {
                                                                                setNoteRowDropTargetId(null);
                                                                            }
                                                                        }}
                                                                        onDrop={(event) => {
                                                                            if (!draggingNoteId || draggingNoteId === note.id) return;
                                                                            event.preventDefault();
                                                                            event.stopPropagation();
                                                                            moveNoteToFolder(draggingNoteId, note.folderId || '');
                                                                            setNoteRowDropTargetId(null);
                                                                            setNoteFolderDropTargetId(null);
                                                                            setDraggingNoteId(null);
                                                                        }}
                                                                        onClick={() => selectLibraryItem({ type: 'note', id: note.id })}
                                                                        onDoubleClick={(event) => {
                                                                            event.preventDefault();
                                                                            startNoteRename(note);
                                                                        }}
                                                                    >
                                                                        <div className="flex items-center gap-2 min-w-0">
                                                                            <span className="relative h-3.5 w-3.5 shrink-0">
                                                                                <span className="absolute inset-0 inline-flex items-center justify-center transition-opacity group-hover:opacity-0 group-focus-visible:opacity-0">
                                                                                    <FileText size={13} className="opacity-80" />
                                                                                </span>
                                                                                <span className="absolute inset-0 inline-flex items-center justify-center opacity-0 transition-opacity group-hover:opacity-100 group-focus-visible:opacity-100">
                                                                                    {isCloudSynced ? (
                                                                                        <Cloud size={12} className="text-sky-500" />
                                                                                    ) : (
                                                                                        <Lock size={12} className="text-stone-400" />
                                                                                    )}
                                                                                </span>
                                                                            </span>
                                                                            <span className="truncate text-sm min-w-0 flex-1">{title}</span>
                                                                        </div>
                                                                    </button>
                                                                );
                                                            };

                                                            const renderPinnedRecordingRow = (rec: RecordingItem, depth: number, keySeed: string): React.ReactNode => {
                                                                const isSelected = selectedLibraryItem?.type === 'recording' && selectedLibraryItem.id === rec.id;
                                                                const isUnread = unreadRecordingIds.has(rec.id) && !isSelected;
                                                                const title = (rec.title || 'Untitled recording').trim() || 'Untitled recording';
                                                                const isCloudSynced = rec.isCloudSynced !== false;
                                                                const paddingLeft = `${10 + depth * 14}px`;

                                                                if (renamingRecordingId === rec.id) {
                                                                    return (
                                                                        <div
                                                                            key={`sidebar-pinned-recording-${keySeed}-${rec.id}`}
                                                                            className={`group w-full rounded-lg px-2.5 py-1.5 text-left text-sm transition-colors ${isSelected ? 'es-sidebar-selected-item' : 'es-sidebar-item-hover es-sidebar-item-text'}`}
                                                                            style={{ paddingLeft }}
                                                                        >
                                                                            <div className="flex items-center gap-2 min-w-0">
                                                                                <span className="relative h-3.5 w-3.5 shrink-0">
                                                                                    <span className="absolute inset-0 inline-flex items-center justify-center transition-opacity group-hover:opacity-0 group-focus-visible:opacity-0">
                                                                                        <Mic size={13} className="opacity-80" />
                                                                                    </span>
                                                                                    <span className="absolute inset-0 inline-flex items-center justify-center opacity-0 transition-opacity group-hover:opacity-100 group-focus-visible:opacity-100">
                                                                                        {isCloudSynced ? (
                                                                                            <Cloud size={12} className="text-sky-500" />
                                                                                        ) : (
                                                                                            <Lock size={12} className="text-stone-400" />
                                                                                        )}
                                                                                    </span>
                                                                                </span>
                                                                                <input
                                                                                    autoFocus
                                                                                    className="h-6 min-w-0 flex-1 bg-transparent border-none p-0 text-sm font-medium focus:outline-none focus:ring-0 es-general-text"
                                                                                    value={recordingRenameDraft}
                                                                                    onChange={(event) => setRecordingRenameDraft(event.target.value)}
                                                                                    onClick={(event) => event.stopPropagation()}
                                                                                    onKeyDown={(event) => {
                                                                                        if (event.key === 'Enter') {
                                                                                            event.preventDefault();
                                                                                            void commitRecordingRename(rec.id);
                                                                                            return;
                                                                                        }
                                                                                        if (event.key === 'Escape') {
                                                                                            event.preventDefault();
                                                                                            skipRecordingRenameBlurRef.current = true;
                                                                                            cancelRecordingRename();
                                                                                        }
                                                                                    }}
                                                                                    onBlur={() => {
                                                                                        if (skipRecordingRenameBlurRef.current) {
                                                                                            skipRecordingRenameBlurRef.current = false;
                                                                                            return;
                                                                                        }
                                                                                        void commitRecordingRename(rec.id);
                                                                                    }}
                                                                                />
                                                                            </div>
                                                                        </div>
                                                                    );
                                                                }

                                                                return (
                                                                    <button
                                                                        key={`sidebar-pinned-recording-${keySeed}-${rec.id}`}
                                                                        className={`group relative w-full rounded-lg px-2.5 py-1.5 text-left text-sm transition-colors ${isSelected ? 'es-sidebar-selected-item' : 'es-sidebar-item-hover es-sidebar-item-text'}`}
                                                                        style={{ paddingLeft }}
                                                                        onClick={() => selectLibraryItem({ type: 'recording', id: rec.id })}
                                                                        onDoubleClick={(event) => {
                                                                            event.preventDefault();
                                                                            startRecordingRename(rec);
                                                                        }}
                                                                    >
                                                                        <div className="flex items-center gap-2 min-w-0">
                                                                            <span className="relative h-3.5 w-3.5 shrink-0">
                                                                                <span className="absolute inset-0 inline-flex items-center justify-center transition-opacity group-hover:opacity-0 group-focus-visible:opacity-0">
                                                                                    <Mic size={13} className="opacity-80" />
                                                                                </span>
                                                                                <span className="absolute inset-0 inline-flex items-center justify-center opacity-0 transition-opacity group-hover:opacity-100 group-focus-visible:opacity-100">
                                                                                    {isCloudSynced ? (
                                                                                        <Cloud size={12} className="text-sky-500" />
                                                                                    ) : (
                                                                                        <Lock size={12} className="text-stone-400" />
                                                                                    )}
                                                                                </span>
                                                                            </span>
                                                                            <span className="truncate text-sm min-w-0 flex-1">{title}</span>
                                                                            {isUnread ? <span className="bg-[var(--recording-new-bg)] text-[#f8fafc] text-[9px] font-bold px-1.5 py-0.5 rounded-sm tracking-wider shrink-0">NEW</span> : null}
                                                                            <span className="hidden h-5 shrink-0 items-center gap-1 group-hover:inline-flex group-focus-visible:inline-flex">
                                                                                <span className="max-w-[46px] truncate text-right text-[11px] text-stone-500 tabular-nums">
                                                                                    {formatDurationCompactMs(rec.stats?.durationMs)}
                                                                                </span>
                                                                            </span>
                                                                        </div>
                                                                    </button>
                                                                );
                                                            };

                                                            const renderPinnedFolderChildren = (folderId: string, depth: number, ancestry: Set<string>): React.ReactNode[] => {
                                                                const childFolders = sidebarFoldersByParentId.get(folderId) || [];
                                                                const childNotes = sidebarNotesByFolderId.get(folderId) || [];
                                                                const childRecordings = sidebarRecordingsByFolderId.get(folderId) || [];
                                                                const rows: React.ReactNode[] = [];

                                                                childFolders.forEach((childFolder) => {
                                                                    if (ancestry.has(childFolder.id)) return;
                                                                    const folderExpanded = isFolderExpanded(childFolder.id);
                                                                    const paddingLeft = `${10 + depth * 14}px`;

                                                                    if (renamingFolderId === childFolder.id) {
                                                                        rows.push(
                                                                            <div
                                                                                key={`sidebar-pinned-folder-child-${entry.key}-${childFolder.id}`}
                                                                                className="group relative w-full rounded-lg px-2.5 py-1.5 text-left text-sm transition-colors es-sidebar-item-hover es-sidebar-item-text"
                                                                                style={{ paddingLeft }}
                                                                            >
                                                                                <div className="flex items-center gap-2 min-w-0">
                                                                                    <FolderGlyph size={13} className="shrink-0 opacity-80" />
                                                                                    <input
                                                                                        autoFocus
                                                                                        className="h-6 min-w-0 flex-1 bg-transparent border-none p-0 text-sm font-medium focus:outline-none focus:ring-0 es-general-text"
                                                                                        value={folderRenameDraft}
                                                                                        onChange={(event) => setFolderRenameDraft(event.target.value)}
                                                                                        onClick={(event) => event.stopPropagation()}
                                                                                        onKeyDown={(event) => {
                                                                                            if (event.key === 'Enter') {
                                                                                                event.preventDefault();
                                                                                                commitFolderRename(childFolder.id);
                                                                                                return;
                                                                                            }
                                                                                            if (event.key === 'Escape') {
                                                                                                event.preventDefault();
                                                                                                skipFolderRenameBlurRef.current = true;
                                                                                                cancelFolderRename();
                                                                                            }
                                                                                        }}
                                                                                        onBlur={() => {
                                                                                            if (skipFolderRenameBlurRef.current) {
                                                                                                skipFolderRenameBlurRef.current = false;
                                                                                                return;
                                                                                            }
                                                                                            commitFolderRename(childFolder.id);
                                                                                        }}
                                                                                    />
                                                                                </div>
                                                                            </div>
                                                                        );
                                                                    } else {
                                                                        rows.push(
                                                                            <button
                                                                                key={`sidebar-pinned-folder-child-${entry.key}-${childFolder.id}`}
                                                                                className={`group relative w-full rounded-lg px-2.5 py-1.5 text-left text-sm transition-all duration-150 es-sidebar-item-hover es-sidebar-item-text ${noteFolderDropTargetId === childFolder.id ? 'es-sidebar-folder-drop-target' : ''}`}
                                                                                style={{ paddingLeft }}
                                                                                onClick={() => toggleFolderExpanded(childFolder.id)}
                                                                                onDoubleClick={(event) => {
                                                                                    event.preventDefault();
                                                                                    event.stopPropagation();
                                                                                    startFolderRename(childFolder);
                                                                                }}
                                                                                onDragOver={(event) => {
                                                                                    if (!draggingNoteId) return;
                                                                                    event.preventDefault();
                                                                                    event.dataTransfer.dropEffect = 'move';
                                                                                    if (noteFolderDropTargetId !== childFolder.id) {
                                                                                        setNoteFolderDropTargetId(childFolder.id);
                                                                                    }
                                                                                }}
                                                                                onDragLeave={(event) => {
                                                                                    const related = event.relatedTarget as Node | null;
                                                                                    if (related && event.currentTarget.contains(related)) return;
                                                                                    if (noteFolderDropTargetId === childFolder.id) {
                                                                                        setNoteFolderDropTargetId(null);
                                                                                    }
                                                                                }}
                                                                                onDrop={(event) => {
                                                                                    if (!draggingNoteId) return;
                                                                                    event.preventDefault();
                                                                                    event.stopPropagation();
                                                                                    moveNoteToFolder(draggingNoteId, childFolder.id);
                                                                                    setNoteFolderDropTargetId(null);
                                                                                    setDraggingNoteId(null);
                                                                                }}
                                                                            >
                                                                                <div className="flex items-center gap-2 min-w-0">
                                                                                    <span className="relative h-3.5 w-3.5 shrink-0">
                                                                                        <span className="absolute inset-0 inline-flex items-center justify-center transition-opacity group-hover:opacity-0 group-focus-visible:opacity-0">
                                                                                            <FolderGlyph size={13} className="opacity-80" />
                                                                                        </span>
                                                                                        <span className="absolute inset-0 inline-flex items-center justify-center opacity-0 transition-opacity group-hover:opacity-100 group-focus-visible:opacity-100">
                                                                                            <ChevronDown size={13} className={`transition-transform ${folderExpanded ? '' : '-rotate-90'}`} />
                                                                                        </span>
                                                                                    </span>
                                                                                    <span className="block truncate min-w-0 flex-1">{childFolder.name || 'Untitled folder'}</span>
                                                                                </div>
                                                                            </button>
                                                                        );
                                                                    }

                                                                    if (!folderExpanded) return;
                                                                    const childAncestry = new Set(ancestry);
                                                                    childAncestry.add(childFolder.id);
                                                                    const nestedRows = renderPinnedFolderChildren(childFolder.id, depth + 1, childAncestry);
                                                                    nestedRows.forEach((row) => rows.push(row));
                                                                });

                                                                childNotes.forEach((note) => {
                                                                    rows.push(renderPinnedNoteRow(note, depth, `${entry.key}-${folderId}`));
                                                                });

                                                                childRecordings.forEach((rec) => {
                                                                    rows.push(renderPinnedRecordingRow(rec, depth, `${entry.key}-${folderId}`));
                                                                });

                                                                return rows;
                                                            };

                                                            const folderExpanded = isFolderExpanded(entry.item.id);
                                                            const rootRows = folderExpanded ? renderPinnedFolderChildren(entry.item.id, 1, new Set([entry.item.id])) : [];
                                                            const hasContent = rootRows.length > 0;

                                                            if (renamingFolderId === folder.id) {
                                                                return (
                                                                    <div key={`sidebar-pinned-folder-${entry.key}`} className="space-y-1">
                                                                        <div
                                                                            className="group relative w-full rounded-lg px-2.5 py-1.5 text-left text-sm transition-colors es-sidebar-item-hover es-sidebar-item-text"
                                                                            style={{ paddingLeft: '10px' }}
                                                                        >
                                                                            <div className="flex items-center gap-2 min-w-0">
                                                                                <FolderGlyph size={13} className="shrink-0 opacity-80" />
                                                                                <input
                                                                                    autoFocus
                                                                                    className="h-6 min-w-0 flex-1 bg-transparent border-none p-0 text-sm font-medium focus:outline-none focus:ring-0 es-general-text"
                                                                                    value={folderRenameDraft}
                                                                                    onChange={(event) => setFolderRenameDraft(event.target.value)}
                                                                                    onClick={(event) => event.stopPropagation()}
                                                                                    onKeyDown={(event) => {
                                                                                        if (event.key === 'Enter') {
                                                                                            event.preventDefault();
                                                                                            commitFolderRename(folder.id);
                                                                                            return;
                                                                                        }
                                                                                        if (event.key === 'Escape') {
                                                                                            event.preventDefault();
                                                                                            skipFolderRenameBlurRef.current = true;
                                                                                            cancelFolderRename();
                                                                                        }
                                                                                    }}
                                                                                    onBlur={() => {
                                                                                        if (skipFolderRenameBlurRef.current) {
                                                                                            skipFolderRenameBlurRef.current = false;
                                                                                            return;
                                                                                        }
                                                                                        commitFolderRename(folder.id);
                                                                                    }}
                                                                                />
                                                                            </div>
                                                                        </div>
                                                                        {folderExpanded ? (
                                                                            <>
                                                                                {rootRows}
                                                                                {!hasContent ? (
                                                                                    <div
                                                                                        className="group w-full rounded-lg px-2.5 py-1.5 text-left text-xs italic text-stone-500/85 transition-colors es-sidebar-item-hover"
                                                                                        style={{ paddingLeft: `${10 + 14}px` }}
                                                                                    >
                                                                                        <div className="flex items-center gap-2">
                                                                                            <span className="truncate flex-1">No items inside</span>
                                                                                        </div>
                                                                                    </div>
                                                                                ) : null}
                                                                            </>
                                                                        ) : null}
                                                                    </div>
                                                                );
                                                            }

                                                            return (
                                                                <div key={`sidebar-pinned-folder-${entry.key}`} className="space-y-1">
                                                                    <button
                                                                        className={`group relative w-full rounded-lg px-2.5 py-1.5 text-left transition-colors ${draggingPinnedItemKey === entry.key ? 'opacity-70' : 'es-sidebar-item-hover es-sidebar-item-text'} ${noteFolderDropTargetId === entry.item.id ? 'es-sidebar-folder-drop-target' : ''}`}
                                                                        draggable
                                                                        onDragStart={(event) => {
                                                                            event.dataTransfer.effectAllowed = 'move';
                                                                            event.dataTransfer.setData('text/plain', entry.key);
                                                                            setDraggingPinnedItemKey(entry.key);
                                                                        }}
                                                                        onDragOver={(event) => {
                                                                            if (draggingNoteId) {
                                                                                event.preventDefault();
                                                                                event.dataTransfer.dropEffect = 'move';
                                                                                if (noteFolderDropTargetId !== entry.item.id) {
                                                                                    setNoteFolderDropTargetId(entry.item.id);
                                                                                }
                                                                                return;
                                                                            }
                                                                            event.preventDefault();
                                                                            event.dataTransfer.dropEffect = 'move';
                                                                        }}
                                                                        onDrop={(event) => {
                                                                            event.preventDefault();
                                                                            if (draggingNoteId) {
                                                                                moveNoteToFolder(draggingNoteId, entry.item.id);
                                                                                setDraggingNoteId(null);
                                                                                setNoteFolderDropTargetId(null);
                                                                                return;
                                                                            }
                                                                            if (!draggingPinnedItemKey) return;
                                                                            reorderPinnedSidebarItems(draggingPinnedItemKey, entry.key);
                                                                            setDraggingPinnedItemKey(null);
                                                                        }}
                                                                        onDragEnd={() => {
                                                                            setDraggingPinnedItemKey(null);
                                                                            setNoteFolderDropTargetId(null);
                                                                        }}
                                                                        onClick={() => {
                                                                            setSidebarMenuTarget(null);
                                                                            toggleFolderExpanded(entry.item.id);
                                                                        }}
                                                                        onDoubleClick={(event) => {
                                                                            event.preventDefault();
                                                                            event.stopPropagation();
                                                                        }}
                                                                    >
                                                                        <div className="flex items-center gap-2 min-w-0">
                                                                            <span className="relative h-3.5 w-3.5 shrink-0">
                                                                                <span className="absolute inset-0 inline-flex items-center justify-center transition-opacity group-hover:opacity-0 group-focus-visible:opacity-0">
                                                                                    <FolderGlyph size={13} className="opacity-80" />
                                                                                </span>
                                                                                <span className="absolute inset-0 inline-flex items-center justify-center opacity-0 transition-opacity group-hover:opacity-100 group-focus-visible:opacity-100">
                                                                                    <ChevronDown size={13} className={`transition-transform ${folderExpanded ? '' : '-rotate-90'}`} />
                                                                                </span>
                                                                            </span>
                                                                            <span className="truncate text-sm min-w-0 flex-1">{entry.title}</span>
                                                                            <span className="relative h-5 w-5 shrink-0">
                                                                                <span className="absolute inset-0 inline-flex items-center justify-center transition-opacity group-hover:opacity-0 group-focus-visible:opacity-0">
                                                                                    <Pin size={11} className="text-stone-500" />
                                                                                </span>
                                                                                <button
                                                                                    className="absolute inset-0 opacity-0 group-hover:opacity-100 group-focus-visible:opacity-100 inline-flex items-center justify-center rounded-md es-sidebar-item-text es-sidebar-header-action transition-opacity"
                                                                                    onClick={(event) => {
                                                                                        event.stopPropagation();
                                                                                        setSidebarMenuTarget({ kind: 'pinned', id: entry.key });
                                                                                        setNoteMenuFolderOptionsForId(null);
                                                                                    }}
                                                                                    aria-label="Pinned item menu"
                                                                                >
                                                                                    <MoreHorizontal size={13} />
                                                                                </button>
                                                                            </span>
                                                                        </div>
                                                                        {sidebarMenuTarget?.kind === 'pinned' && sidebarMenuTarget.id === entry.key ? (
                                                                            <div ref={sidebarItemMenuRef} className="absolute right-2 top-[calc(100%+4px)] z-[90] w-44 rounded-lg border es-global-outline es-general-background shadow-xl p-1" onClick={(e) => e.stopPropagation()}>
                                                                                <button
                                                                                    className="w-full rounded-md px-2 py-1.5 text-left text-xs es-general-item-hover es-general-text inline-flex items-center gap-1.5"
                                                                                    onClick={(event) => {
                                                                                        event.stopPropagation();
                                                                                        unpinSidebarEntity(entry.item);
                                                                                        setSidebarMenuTarget(null);
                                                                                    }}
                                                                                >
                                                                                    <PinOff size={12} />
                                                                                    Unpin
                                                                                </button>
                                                                                <button
                                                                                    className="w-full rounded-md px-2 py-1.5 text-left text-xs es-general-item-hover es-general-text inline-flex items-center gap-1.5"
                                                                                    onClick={(event) => {
                                                                                        event.stopPropagation();
                                                                                        setCustomizingFolder(folder);
                                                                                        setCustomizingFolderName(folder.name || '');
                                                                                        setCustomizingFolderIconId(folder.iconId || 'folder');
                                                                                        setCustomizingFolderColorId(folder.colorId || 'gray');
                                                                                        setSidebarMenuTarget(null);
                                                                                    }}
                                                                                >
                                                                                    <Pencil size={12} />
                                                                                    Rename
                                                                                </button>
                                                                            </div>
                                                                        ) : null}
                                                                    </button>
                                                                    {folderExpanded ? (
                                                                        <>
                                                                            {rootRows}
                                                                            {!hasContent ? (
                                                                                <div
                                                                                    className="group w-full rounded-lg px-2.5 py-1.5 text-left text-xs italic text-stone-500/85 transition-colors es-sidebar-item-hover"
                                                                                    style={{ paddingLeft: `${10 + 14}px` }}
                                                                                >
                                                                                    <div className="flex items-center gap-2">
                                                                                        <span className="truncate flex-1">No items inside</span>
                                                                                        <button
                                                                                            className="h-5 w-5 opacity-0 group-hover:opacity-100 focus-visible:opacity-100 inline-flex items-center justify-center rounded-md es-sidebar-item-text es-sidebar-header-action transition-opacity"
                                                                                            onClick={(event) => {
                                                                                                event.stopPropagation();
                                                                                                createNewLibraryNote(entry.item.id);
                                                                                            }}
                                                                                            aria-label="Create note in folder"
                                                                                        >
                                                                                            <Plus size={12} />
                                                                                        </button>
                                                                                    </div>
                                                                                </div>
                                                                            ) : null}
                                                                        </>
                                                                    ) : null}
                                                                </div>
                                                            );
                                                        }
	                                                    return (
	                                                        <button
	                                                            key={`sidebar-pinned-${entry.key}`}
	                                                            className={`group relative w-full rounded-lg px-2.5 py-1.5 text-left transition-colors ${isSelectedLibraryItem ? 'es-sidebar-selected-item' : 'es-sidebar-item-hover es-sidebar-item-text'} ${draggingPinnedItemKey === entry.key ? 'opacity-70' : ''}`}
	                                                            draggable
	                                                            onDragStart={(event) => {
                                                                event.dataTransfer.effectAllowed = 'move';
                                                                event.dataTransfer.setData('text/plain', entry.key);
                                                                setDraggingPinnedItemKey(entry.key);
                                                            }}
	                                                            onDragOver={(event) => {
                                                                if (draggingNoteId && entry.item.type === 'note' && draggingNoteId !== entry.item.id) {
                                                                    event.preventDefault();
                                                                    event.dataTransfer.dropEffect = 'move';
                                                                    if (noteRowDropTargetId !== entry.item.id) {
                                                                        setNoteRowDropTargetId(entry.item.id);
                                                                    }
                                                                    return;
                                                                }
	                                                                event.preventDefault();
	                                                                event.dataTransfer.dropEffect = 'move';
	                                                            }}
                                                            onDragLeave={(event) => {
                                                                const related = event.relatedTarget as Node | null;
                                                                if (related && event.currentTarget.contains(related)) return;
                                                                if (noteRowDropTargetId === entry.item.id) {
                                                                    setNoteRowDropTargetId(null);
                                                                }
                                                            }}
	                                                            onDrop={(event) => {
	                                                                event.preventDefault();
                                                                if (draggingNoteId && entry.item.type === 'note' && draggingNoteId !== entry.item.id) {
                                                                    const targetNote = notesData.notes.find((item) => item.id === entry.item.id);
                                                                    moveNoteToFolder(draggingNoteId, targetNote?.folderId || '');
                                                                    setDraggingNoteId(null);
                                                                    setNoteRowDropTargetId(null);
                                                                    return;
                                                                }
	                                                                if (!draggingPinnedItemKey) return;
	                                                                reorderPinnedSidebarItems(draggingPinnedItemKey, entry.key);
	                                                                setDraggingPinnedItemKey(null);
	                                                            }}
	                                                            onDragEnd={() => {
                                                                setDraggingPinnedItemKey(null);
                                                                setNoteRowDropTargetId(null);
                                                            }}
	                                                            onClick={() => {
	                                                                if (!canOpen) return;
	                                                                if (entry.item.type === 'chat') {
	                                                                    activateLibraryTab({ type: 'ask', id: entry.item.id });
	                                                                    return;
	                                                                }
	                                                                selectLibraryItem({ type: entry.item.type as 'note' | 'recording', id: entry.item.id });
	                                                            }}
	                                                            onDoubleClick={(event) => {
	                                                                event.preventDefault();
	                                                                if (entry.item.type === 'note') {
                                                                    const note = notesData.notes.find((item) => item.id === entry.item.id);
                                                                    if (note) startNoteRename(note);
                                                                    return;
                                                                }
	                                                                if (entry.item.type === 'recording') {
	                                                                    const recording = recordings.find((item) => item.id === entry.item.id);
	                                                                    if (recording) startRecordingRename(recording);
	                                                                    return;
	                                                                }
	                                                                if (entry.item.type === 'chat') {
	                                                                    const chat = chatsData.chats.find((item) => item.id === entry.item.id);
	                                                                    if (chat) startChatRename(chat);
	                                                                }
	                                                            }}
	                                                        >
	                                                            <div className={`flex items-center gap-2 min-w-0 ${noteRowDropTargetId === entry.item.id ? 'es-sidebar-folder-drop-target rounded-md px-1.5 py-0.5 -mx-1.5 -my-0.5' : ''}`}>
	                                                                <span className="relative h-3.5 w-3.5 shrink-0">
	                                                                    <span className="absolute inset-0 inline-flex items-center justify-center transition-opacity group-hover:opacity-0 group-focus-visible:opacity-0">
		                                                                        {entry.item.type === 'note'
		                                                                            ? <FileText size={13} className="opacity-80" />
		                                                                            : entry.item.type === 'recording'
		                                                                                ? <Mic size={13} className="opacity-80" />
		                                                                                : <MessageCircle size={13} className="opacity-80" />}
	                                                                    </span>
	                                                                    {isSyncable ? (
	                                                                        <span className="absolute inset-0 inline-flex items-center justify-center opacity-0 transition-opacity group-hover:opacity-100 group-focus-visible:opacity-100">
	                                                                            {entry.isCloudSynced ? (
	                                                                                <Cloud size={12} className="text-sky-500" />
	                                                                            ) : (
	                                                                                <Lock size={12} className="text-stone-400" />
	                                                                            )}
	                                                                        </span>
	                                                                    ) : null}
	                                                                </span>
	                                                                <span className="truncate text-sm min-w-0 flex-1">{entry.title}</span>
	                                                                {entry.item.type === 'recording' ? (
	                                                                    <span className="text-[11px] text-stone-500 tabular-nums shrink-0">{formatDurationCompactMs(entry.durationMs || 0)}</span>
	                                                                ) : null}
	                                                                <span className="relative h-5 w-5 shrink-0">
	                                                                    <span className="absolute inset-0 inline-flex items-center justify-center transition-opacity group-hover:opacity-0 group-focus-visible:opacity-0">
	                                                                        <Pin size={11} className="text-stone-500" />
	                                                                    </span>
	                                                                    <button
	                                                                        className="absolute inset-0 opacity-0 group-hover:opacity-100 group-focus-visible:opacity-100 inline-flex items-center justify-center rounded-md es-sidebar-item-text es-sidebar-header-action transition-opacity"
	                                                                        onClick={(event) => {
	                                                                            event.stopPropagation();
	                                                                            setSidebarMenuTarget({ kind: 'pinned', id: entry.key });
	                                                                            setNoteMenuFolderOptionsForId(null);
	                                                                        }}
	                                                                        aria-label="Pinned item menu"
	                                                                    >
	                                                                        <MoreHorizontal size={13} />
	                                                                    </button>
	                                                                </span>
	                                                            </div>
                                                            {sidebarMenuTarget?.kind === 'pinned' && sidebarMenuTarget.id === entry.key ? (
                                                                <div ref={sidebarItemMenuRef} className="absolute right-2 top-[calc(100%+4px)] z-[90] w-44 rounded-lg border es-global-outline es-general-background shadow-xl p-1">
                                                                    <button
                                                                        className="w-full rounded-md px-2 py-1.5 text-left text-xs es-general-item-hover es-general-text inline-flex items-center gap-1.5"
	                                                                        onClick={(event) => {
	                                                                            event.stopPropagation();
	                                                                            unpinSidebarEntity(entry.item);
	                                                                            setSidebarMenuTarget(null);
	                                                                        }}
                                                                    >
                                                                        <PinOff size={12} />
                                                                        Unpin
                                                                    </button>
                                                                    <button
                                                                        className="w-full rounded-md px-2 py-1.5 text-left text-xs es-general-item-hover es-general-text inline-flex items-center gap-1.5"
                                                                        onClick={(event) => {
                                                                            event.stopPropagation();
	                                                                            if (entry.item.type === 'note') {
	                                                                                const note = notesData.notes.find((item) => item.id === entry.item.id);
	                                                                                if (note) startNoteRename(note);
	                                                                            } else if (entry.item.type === 'recording') {
	                                                                                const recording = recordings.find((item) => item.id === entry.item.id);
	                                                                                if (recording) startRecordingRename(recording);
	                                                                            } else if (entry.item.type === 'chat') {
	                                                                                const chat = chatsData.chats.find((item) => item.id === entry.item.id);
	                                                                                if (chat) startChatRename(chat);
	                                                                            }
	                                                                            setSidebarMenuTarget(null);
	                                                                        }}
                                                                    >
                                                                        <Pencil size={12} />
                                                                        Rename
                                                                    </button>
                                                                    <button
                                                                        className="w-full rounded-md px-2 py-1.5 text-left text-xs es-general-item-hover es-general-text inline-flex items-center gap-1.5"
                                                                        onClick={(event) => {
                                                                            event.stopPropagation();
                                                                            if (entry.item.type === 'note' || entry.item.type === 'recording' || entry.item.type === 'chat') {
                                                                                handleMoveOrRemoveFolderAction({ type: entry.item.type, id: entry.item.id });
                                                                            }
	                                                                        }}
	                                                                    >
	                                                                        <FolderGlyph size={12} />
                                                                        {(entry.item.type === 'note' || entry.item.type === 'recording' || entry.item.type === 'chat')
                                                                            && getSidebarEntityFolderId({ type: entry.item.type, id: entry.item.id })
                                                                            ? 'Move to space'
                                                                            : 'Add to space'}
	                                                                    </button>
	                                                                </div>
	                                                            ) : null}
                                                        </button>
                                                    );
                                                })}
	                                            </div>
                                        ) : null}
	                                    </section>
                                    ) : null}

                                    <section>
                                        <div
                                            role="button"
                                            tabIndex={0}
                                            className="h-9 group flex items-center justify-between gap-2 rounded-lg px-2 es-sidebar-item-hover es-sidebar-item-text transition-colors cursor-pointer"
                                            onClick={() => updateLayoutSettings({ recentExpanded: !recentSectionExpanded })}
                                            onKeyDown={(event) => {
                                                if (event.key === 'Enter' || event.key === ' ') {
                                                    event.preventDefault();
                                                    updateLayoutSettings({ recentExpanded: !recentSectionExpanded });
                                                }
                                            }}
                                        >
                                            <div className="min-w-0 inline-flex items-center gap-1.5 text-xs font-semibold text-[#B0B0B0] group-hover:text-[var(--es-text)] transition-colors">
                                                <span>Recent</span>
                                                <ChevronDown size={13} className={`opacity-0 group-hover:opacity-100 transition-all ${recentSectionExpanded ? '' : '-rotate-90'}`} />
                                            </div>
                                        </div>
                                        {recentSectionExpanded ? (
                                            <div className="mt-1 space-y-1">
                                                {recentItems.length ? (
                                                    recentItems.map((item) => {
                                                        const isSelected = (() => {
                                                            if (item.type === 'chat') {
                                                                return activeLibraryTabKey === `ask:${item.id}`;
                                                            }
                                                            return selectedLibraryItem?.type === item.type && selectedLibraryItem?.id === item.id;
                                                        })();

                                                        const Icon = item.type === 'note' ? FileText : item.type === 'recording' ? Mic : MessageCircle;

                                                        return (
                                                            <button
                                                                key={`recent-${item.type}-${item.id}`}
                                                                className={`group relative w-full rounded-lg px-2.5 py-1.5 text-left text-sm transition-colors ${isSelected ? 'es-sidebar-selected-item' : 'es-sidebar-item-hover es-sidebar-item-text'}`}
                                                                onClick={() => {
                                                                    if (item.type === 'chat') {
                                                                        activateLibraryTab({ type: 'ask', id: item.id });
                                                                    } else {
                                                                        selectLibraryItem({ type: item.type, id: item.id });
                                                                    }
                                                                }}
                                                            >
                                                                <div className="flex items-center gap-2 min-w-0">
                                                                    <span className="relative h-3.5 w-3.5 shrink-0">
                                                                        <span className="absolute inset-0 inline-flex items-center justify-center transition-opacity group-hover:opacity-0 group-focus-visible:opacity-0">
                                                                            <Icon size={13} className="opacity-80" />
                                                                        </span>
                                                                        <span className="absolute inset-0 inline-flex items-center justify-center opacity-0 transition-opacity group-hover:opacity-100 group-focus-visible:opacity-100">
                                                                            {item.isCloudSynced ? (
                                                                                <Cloud size={12} className="text-sky-500" />
                                                                            ) : (
                                                                                <Lock size={12} className="text-stone-400" />
                                                                            )}
                                                                        </span>
                                                                    </span>
                                                                    <span className="truncate font-medium min-w-0 flex-1">{item.title}</span>
                                                                    {renderRowThreeDotsMenu(item.type, item.id, item.title, item.rawItem, 'recent')}
                                                                </div>
                                                            </button>
                                                        );
                                                    })
                                                ) : (
                                                    <div className="px-2.5 py-2 text-xs text-stone-500 italic">No recent items</div>
                                                )}
                                            </div>
                                        ) : null}
                                    </section>

                                    <section>
                                        <div
                                            role="button"
                                            tabIndex={0}
                                            className="h-9 group flex items-center justify-between gap-2 rounded-lg px-2 es-sidebar-item-hover es-sidebar-item-text transition-colors cursor-pointer"
                                            onClick={() => updateLayoutSettings({ spacesExpanded: !spacesSectionExpanded })}
                                            onKeyDown={(event) => {
                                                if (event.key === 'Enter' || event.key === ' ') {
                                                    event.preventDefault();
                                                    updateLayoutSettings({ spacesExpanded: !spacesSectionExpanded });
                                                }
                                            }}
                                        >
                                            <div className="min-w-0 inline-flex items-center gap-1.5 text-xs font-semibold text-[#B0B0B0] group-hover:text-[var(--es-text)] transition-colors">
                                                <span>Spaces</span>
                                                <ChevronDown size={13} className={`opacity-0 group-hover:opacity-100 transition-all ${spacesSectionExpanded ? '' : '-rotate-90'}`} />
                                            </div>
                                            <div className="shrink-0 inline-flex items-center gap-1.5">
                                                <HoverTooltip label="New Space">
                                                    <button
                                                        className="opacity-0 group-hover:opacity-100 focus-visible:opacity-100 h-7 w-7 inline-flex items-center justify-center rounded-md es-sidebar-item-text es-sidebar-header-action transition-all"
                                                        onClick={(event) => {
                                                            event.stopPropagation();
                                                            createNotesFolder();
                                                        }}
                                                        aria-label="New Space"
                                                    >
                                                        <FolderPlus size={14} />
                                                    </button>
                                                </HoverTooltip>
                                            </div>
                                        </div>
                                        {spacesSectionExpanded ? (
                                            <div className="mt-1 space-y-1">
                                                {(() => {
                                                    const rows: React.ReactNode[] = [];
                                                    if (isSidebarSearchActive) {
                                                        return null;
                                                    } else {
                                                        renderFolderBranch('', 0, new Set()).forEach((row) => rows.push(row));
                                                    }
                                                    if (!rows.length) {
                                                        return (
                                                            <div className="px-2.5 py-2 text-xs text-stone-500 italic">
                                                                No spaces yet.
                                                            </div>
                                                        );
                                                    }
                                                    return rows;
                                                })()}
                                            </div>
                                        ) : null}
                                    </section>

	                                <section>
                                    <div
                                        role="button"
                                        tabIndex={0}
                                        className="h-9 group flex items-center justify-between gap-2 rounded-lg px-2 es-sidebar-item-hover es-sidebar-item-text transition-colors cursor-pointer"
                                        onClick={() => updateLayoutSettings({ notesExpanded: !notesSectionExpanded })}
                                        onKeyDown={(event) => {
                                            if (event.key === 'Enter' || event.key === ' ') {
                                                event.preventDefault();
                                                updateLayoutSettings({ notesExpanded: !notesSectionExpanded });
                                            }
                                        }}
                                    >
                                        <div className="min-w-0 inline-flex items-center gap-1.5 text-xs font-semibold text-[#B0B0B0] group-hover:text-[var(--es-text)] transition-colors">
                                            <span>Notes</span>
                                            <ChevronDown size={13} className={`opacity-0 group-hover:opacity-100 transition-all ${notesSectionExpanded ? '' : '-rotate-90'}`} />
                                        </div>
                                        <div className="shrink-0 inline-flex items-center gap-1.5">
                                            <HoverTooltip label="New note">
	                                                <button
                                                        data-tour-id="new-note-button"
	                                                    className="opacity-0 group-hover:opacity-100 focus-visible:opacity-100 h-7 w-7 inline-flex items-center justify-center rounded-md es-sidebar-item-text es-sidebar-header-action transition-all"
                                                    onClick={(event) => {
                                                        event.stopPropagation();
                                                        createNewLibraryNote();
                                                    }}
                                                    aria-label="New note"
                                                >
                                                    <Plus size={14} />
                                                </button>
                                            </HoverTooltip>
                                        </div>
                                    </div>
	                                    {notesSectionExpanded ? (
	                                        <div className="mt-1 space-y-1">
                                                {(() => {
                                                    const indentSize = 14;
                                                    const baseIndent = 10;

                                                    const renderNoteRow = (note: Note, depth: number): React.ReactNode => {
                                                        const isSelected = selectedLibraryItem?.type === 'note' && selectedLibraryItem.id === note.id;
                                                        const title = (note.title || 'Untitled note').trim() || 'Untitled note';
                                                        const isCloudSynced = note.isCloudSynced !== false;
                                                        const paddingLeft = `${baseIndent + depth * indentSize}px`;

                                                        if (renamingNoteId === note.id) {
                                                            return (
                                                                <div
                                                                    key={`sidebar-note-${note.id}`}
                                                                    className={`group w-full rounded-lg px-2.5 py-1.5 text-left text-sm transition-colors ${isSelected ? 'es-sidebar-selected-item' : 'es-sidebar-item-hover es-sidebar-item-text'}`}
                                                                    style={{ paddingLeft }}
                                                                >
                                                                    <div className="flex items-center gap-2 min-w-0">
                                                                        <span className="relative h-3.5 w-3.5 shrink-0">
                                                                            <span className="absolute inset-0 inline-flex items-center justify-center transition-opacity group-hover:opacity-0 group-focus-visible:opacity-0">
                                                                                <FileText size={13} className="opacity-80" />
                                                                            </span>
                                                                            <span className="absolute inset-0 inline-flex items-center justify-center opacity-0 transition-opacity group-hover:opacity-100 group-focus-visible:opacity-100">
                                                                                {isCloudSynced ? (
                                                                                    <Cloud size={12} className="text-sky-500" />
                                                                                ) : (
                                                                                    <Lock size={12} className="text-stone-400" />
                                                                                )}
                                                                            </span>
                                                                        </span>
                                                                        <input
                                                                            autoFocus
                                                                            className="h-6 min-w-0 flex-1 bg-transparent border-none p-0 text-sm font-medium focus:outline-none focus:ring-0 es-general-text"
                                                                            value={noteRenameDraft}
                                                                            onChange={(event) => setNoteRenameDraft(event.target.value)}
                                                                            onClick={(event) => event.stopPropagation()}
                                                                            onKeyDown={(event) => {
                                                                                if (event.key === 'Enter') {
                                                                                    event.preventDefault();
                                                                                    commitNoteRename(note.id);
                                                                                    return;
                                                                                }
                                                                                if (event.key === 'Escape') {
                                                                                    event.preventDefault();
                                                                                    skipNoteRenameBlurRef.current = true;
                                                                                    cancelNoteRename();
                                                                                }
                                                                            }}
                                                                            onBlur={() => {
                                                                                if (skipNoteRenameBlurRef.current) {
                                                                                    skipNoteRenameBlurRef.current = false;
                                                                                    return;
                                                                                }
                                                                                commitNoteRename(note.id);
                                                                            }}
                                                                        />
                                                                    </div>
                                                                </div>
                                                            );
                                                        }

                                                        return (
                                                            <button
                                                                 key={`sidebar-note-${note.id}`}
                                                                 className={`group relative w-full rounded-lg px-2.5 py-1.5 text-left text-sm transition-colors ${isSelected ? 'es-sidebar-selected-item' : 'es-sidebar-item-hover es-sidebar-item-text'}`}
                                                                 style={{ paddingLeft }}
                                                                 onClick={() => selectLibraryItem({ type: 'note', id: note.id })}
                                                                 onDoubleClick={(event) => {
                                                                     event.preventDefault();
                                                                     startNoteRename(note);
                                                                 }}
                                                             >
                                                                <div className="flex items-center gap-2 min-w-0">
                                                                    <span className="relative h-3.5 w-3.5 shrink-0">
                                                                        <span className="absolute inset-0 inline-flex items-center justify-center transition-opacity group-hover:opacity-0 group-focus-visible:opacity-0">
                                                                            <FileText size={13} className="opacity-80" />
                                                                        </span>
                                                                        <span className="absolute inset-0 inline-flex items-center justify-center opacity-0 transition-opacity group-hover:opacity-100 group-focus-visible:opacity-100">
                                                                            {isCloudSynced ? (
                                                                                <Cloud size={12} className="text-sky-500" />
                                                                            ) : (
                                                                                <Lock size={12} className="text-stone-400" />
                                                                            )}
                                                                        </span>
                                                                    </span>
                                                                    <span className="block truncate min-w-0 flex-1">{title}</span>
	                                                                    <span className="hidden h-5 w-5 shrink-0 items-center justify-center group-hover:inline-flex group-focus-visible:inline-flex">
	                                                                        <button
	                                                                            className="inline-flex items-center justify-center h-5 w-5 rounded-md es-sidebar-item-text es-sidebar-header-action"
	                                                                            onClick={(event) => {
	                                                                                event.stopPropagation();
	                                                                                setSidebarMenuTarget({ kind: 'note', id: note.id });
	                                                                                setNoteMenuFolderOptionsForId(null);
	                                                                            }}
	                                                                            aria-label="Note row menu"
	                                                                        >
	                                                                            <MoreHorizontal size={13} />
	                                                                        </button>
	                                                                    </span>
                                                                </div>
                                                                {sidebarMenuTarget?.kind === 'note' && sidebarMenuTarget.id === note.id ? (
                                                                    <div ref={sidebarItemMenuRef} className="absolute right-2 top-[calc(100%+4px)] z-[90] w-44 rounded-lg border es-global-outline es-general-background shadow-xl p-1">
                                                                        <button
                                                                            className="w-full rounded-md px-2 py-1.5 text-left text-xs es-general-item-hover es-general-text inline-flex items-center gap-1.5"
                                                                            onClick={(event) => {
                                                                                event.stopPropagation();
                                                                                pinSidebarEntity({ type: 'note', id: note.id });
                                                                                setSidebarMenuTarget(null);
                                                                            }}
                                                                        >
                                                                            <Pin size={12} />
                                                                            Pin
                                                                        </button>
                                                                        <button
                                                                            className="w-full rounded-md px-2 py-1.5 text-left text-xs es-general-item-hover es-general-text inline-flex items-center gap-1.5"
                                                                            onClick={(event) => {
                                                                                event.stopPropagation();
                                                                                handleMoveOrRemoveFolderAction({ type: 'note', id: note.id });
                                                                            }}
                                                                        >
                                                                            <FolderGlyph size={12} />
                                                                            {getNoteFolderIdById(note.id) ? 'Move to space' : 'Add to space'}
                                                                        </button>
                                                                        <button
                                                                            className="w-full rounded-md px-2 py-1.5 text-left text-xs es-general-item-hover es-general-text inline-flex items-center gap-1.5"
                                                                            onClick={(event) => {
                                                                                event.stopPropagation();
                                                                                startNoteRename(note);
                                                                                setSidebarMenuTarget(null);
                                                                            }}
                                                                        >
                                                                            <Pencil size={12} />
                                                                            Rename
                                                                        </button>
                                                                        <button
                                                                            className="w-full rounded-md px-2 py-1.5 text-left text-xs text-red-600 hover:bg-red-50 inline-flex items-center gap-1.5"
                                                                            onClick={(event) => {
                                                                                event.stopPropagation();
                                                                                deleteNoteById(note.id, title);
                                                                            }}
                                                                        >
                                                                            <Trash2 size={12} />
                                                                            Delete
                                                                        </button>
                                                                    </div>
                                                                ) : null}
                                                            </button>
                                                        );
                                                    };

                                                    const rows: React.ReactNode[] = [];
                                                    const notesList = isSidebarSearchActive
                                                        ? visibleSidebarNotes
                                                        : (visibleSidebarNotesByFolderId.get('') || []);
                                                    const hasMoreNotes = notesList.length > 10;
                                                    const displayedNotes = notesList.slice(0, 10);
                                                    displayedNotes.forEach((note) => rows.push(renderNoteRow(note, 0)));
                                                    if (hasMoreNotes) {
                                                        rows.push(
                                                            <button
                                                                key="notes-show-more"
                                                                type="button"
                                                                className="w-full h-8 rounded-lg px-2.5 text-left text-xs transition-all inline-flex items-center gap-2 border border-transparent es-sidebar-item-hover es-sidebar-item-text opacity-70 hover:opacity-100 font-medium"
                                                                onClick={() => {
                                                                    setOpenedSearchFromTabs(false);
                                                                    setLibraryFilter('notes');
                                                                    setIsLibrarySearchOpen(true);
                                                                }}
                                                                style={{ paddingLeft: '10px' }}
                                                            >
                                                                <MoreHorizontal size={13} className="shrink-0" />
                                                                <span>Show More</span>
                                                            </button>,
                                                        );
                                                    }
                                                    if (!rows.length) {
                                                        return (
                                                            <div className="px-2.5 py-2 text-xs italic text-stone-500">
                                                                {isSidebarSearchActive ? 'No notes match this search.' : 'No notes yet.'}
                                                            </div>
                                                        );
                                                    }
                                                    return rows;
                                                })()}
		                                        </div>
	                                    ) : null}
                                </section>

                                <section>
                                    <div
                                        role="button"
                                        tabIndex={0}
                                        className="h-9 group flex items-center justify-between gap-2 rounded-lg px-2 es-sidebar-item-hover es-sidebar-item-text transition-colors cursor-pointer"
                                        onClick={() => updateLayoutSettings({ recordingsExpanded: !recordingsSectionExpanded })}
                                        onKeyDown={(event) => {
                                            if (event.key === 'Enter' || event.key === ' ') {
                                                event.preventDefault();
                                                updateLayoutSettings({ recordingsExpanded: !recordingsSectionExpanded });
                                            }
                                        }}
                                    >
                                        <div className="min-w-0 inline-flex items-center gap-1.5 text-xs font-semibold text-[#B0B0B0] group-hover:text-[var(--es-text)] transition-colors">
                                            <span>Recordings</span>
                                            <ChevronDown size={13} className={`opacity-0 group-hover:opacity-100 transition-all ${recordingsSectionExpanded ? '' : '-rotate-90'}`} />
                                        </div>
                                        <div className="shrink-0 inline-flex items-center gap-1.5">
                                            <HoverTooltip label="Upload audio file">
                                                <button
                                                    className="opacity-0 group-hover:opacity-100 focus-visible:opacity-100 h-7 w-7 inline-flex items-center justify-center rounded-md es-sidebar-item-text es-sidebar-header-action transition-all disabled:opacity-30"
                                                    onClick={(event) => {
                                                        event.stopPropagation();
                                                        void importRecordingAudioFile();
                                                    }}
                                                    disabled={recordModeStatus === 'capturing' || recordModeStatus === 'processing' || recordModeStatus === 'selecting'}
                                                    aria-label="Upload audio file"
                                                >
                                                    <Upload size={14} />
                                                </button>
                                            </HoverTooltip>
                                            <HoverTooltip label={recordModeStatus === 'capturing' ? 'Stop recording' : 'Start recording'}>
                                                <button
                                                    data-tour-id="recording-start-button"
                                                    className={`h-7 w-7 inline-flex items-center justify-center rounded-md es-sidebar-item-text es-sidebar-header-action transition-all disabled:opacity-30 ${recordModeStatus === 'capturing' ? 'opacity-100' : 'opacity-0 group-hover:opacity-100 focus-visible:opacity-100'}`}
                                                    onClick={(event) => {
                                                        event.stopPropagation();
                                                        if (recordModeStatus === 'capturing') {
                                                            stopRecordModeCapture();
                                                            return;
                                                        }
                                                        startRecordModeCapture();
                                                    }}
                                                    disabled={recordModeStatus === 'processing' || recordModeStatus === 'selecting'}
                                                    aria-label={recordModeStatus === 'capturing' ? 'Stop recording' : 'Start recording'}
                                                >
                                                    {recordModeStatus === 'capturing' ? (
                                                        <div className="h-2.5 w-2.5 rounded-sm bg-[#EF4444]" />
                                                    ) : (
                                                        <Mic size={14} />
                                                    )}
                                                </button>
                                            </HoverTooltip>
                                        </div>
                                    </div>
                                    {recordingsSectionExpanded ? (
                                        <div className="mt-1 space-y-1">
                                            {recordModeStatus === 'processing' ? (
                                                <div className="rounded-xl border border-transparent p-2 text-xs bg-stone-50 text-stone-500 inline-flex items-center gap-2 w-full">
                                                    <Loader2 size={13} className="animate-spin" />
                                                    Processing recording...
                                                </div>
                                            ) : null}


	                                            {(() => {
	                                                const hasMoreRecordings = rootSidebarRecordings.length > 10;
	                                                const displayedRecordings = rootSidebarRecordings.slice(0, 10);
	                                                if (!displayedRecordings.length) {
	                                                    return (
	                                                        <div className="px-2.5 py-2 text-xs italic text-stone-500">
	                                                            {isSidebarSearchActive ? 'No recordings match this search.' : 'No recordings yet.'}
	                                                        </div>
	                                                    );
	                                                }
	                                                return (
	                                                    <>
	                                                        {displayedRecordings.map((entry) => {
		                                                const isSelected = selectedLibraryItem?.type === 'recording' && selectedLibraryItem.id === entry.id;
		                                                const isUnread = unreadRecordingIds.has(entry.id) && !isSelected;
		                                                const title = (entry.title || 'Untitled recording').trim() || 'Untitled recording';
		                                                const isCloudSynced = entry.isCloudSynced !== false;
	                                                if (renamingRecordingId === entry.id) {
                                                    return (
                                                        <div
                                                            key={`sidebar-recording-${entry.id}`}
                                                            className={`group w-full rounded-lg px-2.5 py-1.5 text-left transition-colors ${isSelected ? 'es-sidebar-selected-item' : 'es-sidebar-item-hover es-sidebar-item-text'}`}
                                                        >
	                                                            <div className="flex items-center gap-2 min-w-0">
	                                                                <span className="relative h-3.5 w-3.5 shrink-0">
	                                                                    <span className="absolute inset-0 inline-flex items-center justify-center transition-opacity group-hover:opacity-0 group-focus-visible:opacity-0">
	                                                                        <Mic size={13} className="opacity-80" />
	                                                                    </span>
	                                                                    <span className="absolute inset-0 inline-flex items-center justify-center opacity-0 transition-opacity group-hover:opacity-100 group-focus-visible:opacity-100">
	                                                                        {isCloudSynced ? (
	                                                                            <Cloud size={12} className="text-sky-500" />
	                                                                        ) : (
	                                                                            <Lock size={12} className="text-stone-400" />
	                                                                        )}
	                                                                    </span>
	                                                                </span>
	                                                                <input
	                                                                    autoFocus
	                                                                    className="h-6 min-w-0 flex-1 bg-transparent border-none p-0 text-sm font-medium focus:outline-none focus:ring-0 es-general-text"
                                                                    value={recordingRenameDraft}
                                                                    onChange={(event) => setRecordingRenameDraft(event.target.value)}
                                                                    onClick={(event) => event.stopPropagation()}
                                                                    onKeyDown={(event) => {
                                                                        if (event.key === 'Enter') {
                                                                            event.preventDefault();
                                                                            void commitRecordingRename(entry.id);
                                                                            return;
                                                                        }
                                                                        if (event.key === 'Escape') {
                                                                            event.preventDefault();
                                                                            skipRecordingRenameBlurRef.current = true;
                                                                            cancelRecordingRename();
                                                                        }
                                                                    }}
                                                                    onBlur={() => {
                                                                        if (skipRecordingRenameBlurRef.current) {
                                                                            skipRecordingRenameBlurRef.current = false;
                                                                            return;
                                                                        }
                                                                        void commitRecordingRename(entry.id);
                                                                    }}
                                                                />
	                                                                <span className="relative h-3.5 w-[48px] shrink-0">
	                                                                    <span className="absolute inset-0 inline-flex items-center justify-end text-[11px] text-stone-500 tabular-nums">{formatDurationCompactMs(entry.stats?.durationMs)}</span>
	                                                                </span>
                                                            </div>
                                                        </div>
                                                    );
                                                }
		                                                return (
		                                                    <button
		                                                        key={`sidebar-recording-${entry.id}`}
	                                                        className={`group relative w-full rounded-lg px-2.5 py-1.5 text-left transition-colors ${isSelected ? 'es-sidebar-selected-item' : 'es-sidebar-item-hover es-sidebar-item-text'}`}
	                                                        onClick={() => selectLibraryItem({ type: 'recording', id: entry.id })}
	                                                        onDoubleClick={(event) => {
	                                                            event.preventDefault();
	                                                            startRecordingRename(entry);
	                                                        }}
	                                                    >
	                                                        <div className="flex items-center gap-2 min-w-0">
	                                                            <span className="relative h-3.5 w-3.5 shrink-0">
	                                                                <span className="absolute inset-0 inline-flex items-center justify-center transition-opacity group-hover:opacity-0 group-focus-visible:opacity-0">
	                                                                    <Mic size={13} className="opacity-80" />
	                                                                </span>
	                                                                <span className="absolute inset-0 inline-flex items-center justify-center opacity-0 transition-opacity group-hover:opacity-100 group-focus-visible:opacity-100">
	                                                                    {isCloudSynced ? (
	                                                                        <Cloud size={12} className="text-sky-500" />
	                                                                    ) : (
	                                                                        <Lock size={12} className="text-stone-400" />
	                                                                    )}
	                                                                </span>
	                                                            </span>
	                                                            <span className="truncate text-sm min-w-0 flex-1">{title}</span>
	                                                            {isUnread ? <span className="bg-[var(--recording-new-bg)] text-[#f8fafc] text-[9px] font-bold px-1.5 py-0.5 rounded-sm tracking-wider shrink-0">NEW</span> : null}
                                                            <span className="hidden h-5 shrink-0 items-center gap-1 group-hover:inline-flex group-focus-visible:inline-flex">
                                                                <span className="max-w-[46px] truncate text-right text-[11px] text-stone-500 tabular-nums">
                                                                    {formatDurationCompactMs(entry.stats?.durationMs)}
                                                                </span>
                                                                <button
                                                                    className="inline-flex items-center justify-center h-5 w-5 rounded-md es-sidebar-item-text es-sidebar-header-action"
                                                                    onClick={(event) => {
                                                                        event.stopPropagation();
                                                                        setSidebarMenuTarget({ kind: 'recording', id: entry.id });
                                                                        setNoteMenuFolderOptionsForId(null);
                                                                    }}
	                                                                    aria-label="Recording row menu"
	                                                                >
	                                                                    <MoreHorizontal size={13} />
	                                                                </button>
	                                                            </span>
	                                                        </div>
		                                                        {sidebarMenuTarget?.kind === 'recording' && sidebarMenuTarget.id === entry.id ? (
	                                                            <div ref={sidebarItemMenuRef} className="absolute right-2 top-[calc(100%+4px)] z-[90] w-44 rounded-lg border es-global-outline es-general-background shadow-xl p-1">
                                                                <button
                                                                    className="w-full rounded-md px-2 py-1.5 text-left text-xs es-general-item-hover es-general-text inline-flex items-center gap-1.5"
                                                                    onClick={(event) => {
                                                                        event.stopPropagation();
                                                                        pinSidebarEntity({ type: 'recording', id: entry.id });
                                                                        setSidebarMenuTarget(null);
                                                                    }}
                                                                >
                                                                    <Pin size={12} />
                                                                    Pin
                                                                </button>
                                                                <button
                                                                    className="w-full rounded-md px-2 py-1.5 text-left text-xs es-general-item-hover es-general-text inline-flex items-center gap-1.5"
                                                                    onClick={(event) => {
                                                                        event.stopPropagation();
                                                                        handleMoveOrRemoveFolderAction({ type: 'recording', id: entry.id });
                                                                    }}
                                                                >
                                                                    <FolderGlyph size={12} />
                                                                    {getRecordingFolderIdById(entry.id) ? 'Move to space' : 'Add to space'}
                                                                </button>
                                                                <button
                                                                    className="w-full rounded-md px-2 py-1.5 text-left text-xs es-general-item-hover es-general-text inline-flex items-center gap-1.5"
                                                                    onClick={(event) => {
                                                                        event.stopPropagation();
                                                                        startRecordingRename(entry);
	                                                                        setSidebarMenuTarget(null);
	                                                                    }}
	                                                                >
	                                                                    <Pencil size={12} />
	                                                                    Rename
	                                                                </button>
	                                                                <button
	                                                                    className="w-full rounded-md px-2 py-1.5 text-left text-xs text-red-600 hover:bg-red-50 inline-flex items-center gap-1.5"
	                                                                    onClick={(event) => {
	                                                                        event.stopPropagation();
	                                                                        void deleteRecordingWithConfirm(entry.id, title);
	                                                                    }}
	                                                                >
	                                                                    <Trash2 size={12} />
	                                                                    Delete
	                                                                </button>
	                                                            </div>
	                                                        ) : null}
	                                                    </button>
		                                                );
		                                            })}
	                                                        {hasMoreRecordings ? (
	                                                            <button
	                                                                key="recordings-show-more"
	                                                                type="button"
	                                                                className="w-full h-8 rounded-lg px-2.5 text-left text-xs transition-all inline-flex items-center gap-2 border border-transparent es-sidebar-item-hover es-sidebar-item-text opacity-70 hover:opacity-100 font-medium"
	                                                                onClick={() => {
	                                                                    setOpenedSearchFromTabs(false);
	                                                                    setLibraryFilter('recordings');
	                                                                    setIsLibrarySearchOpen(true);
	                                                                }}
	                                                                style={{ paddingLeft: '10px' }}
	                                                            >
	                                                                <MoreHorizontal size={13} className="shrink-0" />
	                                                                <span>Show More</span>
	                                                            </button>
	                                                        ) : null}
	                                                    </>
	                                                );
	                                            })()}
	                                        </div>
	                                        ) : null}
                                    </section>

                                    <section>
                                        <div
                                            role="button"
                                            tabIndex={0}
                                            className="h-9 group flex items-center justify-between gap-2 rounded-lg px-2 es-sidebar-item-hover es-sidebar-item-text transition-colors cursor-pointer"
                                            onClick={() => updateLayoutSettings({ chatsExpanded: !chatsSectionExpanded })}
                                            onKeyDown={(event) => {
                                                if (event.key === 'Enter' || event.key === ' ') {
                                                    event.preventDefault();
                                                    updateLayoutSettings({ chatsExpanded: !chatsSectionExpanded });
                                                }
                                            }}
                                        >
                                            <div className="min-w-0 inline-flex items-center gap-1.5 text-xs font-semibold text-[#B0B0B0] group-hover:text-[var(--es-text)] transition-colors">
                                                <span>Chats</span>
                                                <ChevronDown size={13} className={`opacity-0 group-hover:opacity-100 transition-all ${chatsSectionExpanded ? '' : '-rotate-90'}`} />
                                            </div>
                                        </div>
	                                        {chatsSectionExpanded ? (
	                                            <div className="mt-1 space-y-1">
	                                                {(() => {
	                                                    const chatsList = visibleSidebarChats;
	                                                    const hasMoreChats = chatsList.length > 10;
	                                                    const displayedChats = chatsList.slice(0, 10);
	                                                    return (
	                                                        <>
	                                                            {displayedChats.length ? (
	                                                                displayedChats.map((chat) => {
	                                                        const isSelected = activeLibraryTabKey === `ask:${chat.id}`;
	                                                        const isCloudSynced = chat.isCloudSynced === true;
	                                                        const title = (chat.title || 'Untitled Chat').trim() || 'Untitled Chat';

                                                        if (renamingChatId === chat.id) {
                                                            return (
                                                                <div
                                                                    key={`sidebar-chat-${chat.id}`}
                                                                    className={`group w-full rounded-lg px-2.5 py-1.5 text-left transition-colors ${isSelected ? 'es-sidebar-selected-item' : 'es-sidebar-item-hover es-sidebar-item-text'}`}
                                                                >
                                                                    <div className="flex items-center gap-2 min-w-0">
                                                                        <span className="relative h-3.5 w-3.5 shrink-0">
                                                                            <span className="absolute inset-0 inline-flex items-center justify-center transition-opacity group-hover:opacity-0 group-focus-visible:opacity-0">
                                                                                <MessageCircle size={13} className="opacity-80" />
                                                                            </span>
                                                                            <span className="absolute inset-0 inline-flex items-center justify-center opacity-0 transition-opacity group-hover:opacity-100 group-focus-visible:opacity-100">
                                                                                {isCloudSynced ? (
                                                                                    <Cloud size={12} className="text-sky-500" />
                                                                                ) : (
                                                                                    <Lock size={12} className="text-stone-400" />
                                                                                )}
                                                                            </span>
                                                                        </span>
                                                                        <input
                                                                            autoFocus
                                                                            className="h-6 min-w-0 flex-1 bg-transparent border-none p-0 text-sm font-medium focus:outline-none focus:ring-0 es-general-text"
                                                                            value={chatRenameDraft}
                                                                            onChange={(event) => setChatRenameDraft(event.target.value)}
                                                                            onClick={(event) => event.stopPropagation()}
                                                                            onKeyDown={(event) => {
                                                                                if (event.key === 'Enter') {
                                                                                    event.preventDefault();
                                                                                    commitChatRename(chat.id);
                                                                                    return;
                                                                                }
                                                                                if (event.key === 'Escape') {
                                                                                    event.preventDefault();
                                                                                    cancelChatRename();
                                                                                }
                                                                            }}
                                                                            onBlur={() => {
                                                                                commitChatRename(chat.id);
                                                                            }}
                                                                        />
                                                                    </div>
                                                                </div>
                                                            );
                                                        }

                                                        return (
                                                            <button
                                                                key={`sidebar-chat-${chat.id}`}
                                                                className={`group relative w-full rounded-lg px-2.5 py-1.5 text-left transition-colors ${isSelected ? 'es-sidebar-selected-item' : 'es-sidebar-item-hover es-sidebar-item-text'}`}
                                                                onClick={() => activateLibraryTab({ type: 'ask', id: chat.id })}
                                                                onDoubleClick={(event) => {
                                                                    event.preventDefault();
                                                                    startChatRename(chat);
                                                                }}
                                                            >
                                                                <div className="flex items-center gap-2 min-w-0">
                                                                    <span className="relative h-3.5 w-3.5 shrink-0">
                                                                        <span className="absolute inset-0 inline-flex items-center justify-center transition-opacity group-hover:opacity-0 group-focus-visible:opacity-0">
                                                                            <MessageCircle size={13} className="opacity-80" />
                                                                        </span>
                                                                        <span className="absolute inset-0 inline-flex items-center justify-center opacity-0 transition-opacity group-hover:opacity-100 group-focus-visible:opacity-100">
                                                                            {isCloudSynced ? (
                                                                                <Cloud size={12} className="text-sky-500" />
                                                                            ) : (
                                                                                <Lock size={12} className="text-stone-400" />
                                                                            )}
                                                                        </span>
                                                                    </span>
                                                                    <span className="truncate text-sm min-w-0 flex-1">{title}</span>
                                                                    {renderRowThreeDotsMenu('chat', chat.id, title, chat, 'chat')}
                                                                </div>
	                                                            </button>
	                                                        );
	                                                    })
	                                                            ) : (
	                                                                <div className="px-2.5 py-2 text-xs italic text-stone-500">
	                                                                    No chats yet.
	                                                                </div>
	                                                            )}
	                                                            {hasMoreChats ? (
	                                                                <button
	                                                                    key="chats-show-more"
	                                                                    type="button"
	                                                                    className="w-full h-8 rounded-lg px-2.5 text-left text-xs transition-all inline-flex items-center gap-2 border border-transparent es-sidebar-item-hover es-sidebar-item-text opacity-70 hover:opacity-100 font-medium"
	                                                                    onClick={() => {
	                                                                        setOpenedSearchFromTabs(false);
	                                                                        setLibraryFilter('chats');
	                                                                        setIsLibrarySearchOpen(true);
	                                                                    }}
	                                                                    style={{ paddingLeft: '10px' }}
	                                                                >
	                                                                    <MoreHorizontal size={13} className="shrink-0" />
	                                                                    <span>Show More</span>
	                                                                </button>
	                                                            ) : null}
	                                                        </>
	                                                    );
	                                                })()}
	                                            </div>
	                                        ) : null}
	                                    </section>
                    </div>

                    <div className="mt-2">
                        <HoverTooltip label="Settings" disabled={!shellSidebarCollapsed} className="w-full">
                            <button
                                data-tour-id="settings-button"
                                className={`h-9 w-full rounded-lg px-2 text-left text-sm transition-colors flex items-center gap-2 ${isSettingsModalOpen ? 'es-sidebar-selected-item' : 'es-sidebar-item-hover es-sidebar-item-text'} ${shellSidebarCollapsed ? 'justify-center' : ''}`}
                                onClick={() => {
                                    setIsSettingsModalOpen(true);
                                }}
                            >
                                <Settings size={16} />
                                {!shellSidebarCollapsed ? <span>Settings</span> : null}
                            </button>
                        </HoverTooltip>
                    </div>

                    {!shellSidebarCollapsed ? (
                        <div
                            role="separator"
                            aria-orientation="vertical"
                            className="absolute right-0 top-0 bottom-0 w-2 -mr-1 cursor-col-resize group"
                            onMouseDown={startSidebarResize}
                            title="Resize sidebar"
                        >
                            <span className="absolute right-[3px] top-0 bottom-0 w-px bg-transparent transition-colors group-hover:bg-stone-400/40" />
                        </div>
                    ) : null}
                </aside>

                {activeMoveToFolderTarget ? (
                    <div className="fixed inset-0 z-[120] flex items-start justify-center px-4 pt-24 animate-in fade-in duration-100">
                        <div className="absolute inset-0 bg-black/45 backdrop-blur-[1.5px]" onClick={() => {
                            setActiveMoveToFolderTarget(null);
                            setFolderSearchQuery('');
                        }} />
                        <div
                            ref={moveToFolderPopoverRef}
                            className="relative w-full max-w-sm rounded-xl border es-global-outline es-general-background shadow-2xl p-4 z-10 flex flex-col gap-3 animate-in fade-in zoom-in-95 duration-150"
                            role="dialog"
                            aria-modal="true"
                            aria-label="Add to Space"
                        >
                            <div className="flex items-center justify-between border-b es-global-separator pb-1.5">
                                <div className="text-xs font-semibold uppercase tracking-[0.16em] text-stone-500">
                                    Add to Space
                                </div>
                                <button
                                    onClick={() => {
                                        setActiveMoveToFolderTarget(null);
                                        setFolderSearchQuery('');
                                    }}
                                    className="h-5 w-5 inline-flex items-center justify-center rounded-md es-sidebar-item-text hover:bg-black/10 transition-colors"
                                >
                                    <X size={12} />
                                </button>
                            </div>
                            <div className="relative">
                                <Search size={13} className="pointer-events-none absolute left-2.5 top-1/2 -translate-y-1/2 text-stone-400" />
                                <input
                                    autoFocus
                                    className="h-9 w-full rounded-lg border es-global-outline bg-transparent pl-8 pr-2.5 text-xs outline-none focus:border-[var(--global-selected-outlines)] transition-colors es-general-text"
                                    placeholder="Search spaces..."
                                    value={folderSearchQuery}
                                    onChange={(event) => setFolderSearchQuery(event.target.value)}
                                />
                            </div>
                            <div className="max-h-72 overflow-y-auto pr-0.5 space-y-1 es-tab-strip-scroll">
                                {!folderSearchQuery && (
                                    <button
                                        className={`w-full rounded-lg px-2.5 py-1.5 text-left text-xs transition-colors flex items-center gap-2 ${!activeMoveToFolderCurrentFolderId ? 'es-general-selected-item font-semibold' : 'es-general-item-hover es-general-text'}`}
                                        onClick={() => applyMoveToFolderSelection('')}
                                    >
                                        <FolderOpen size={13} className="text-stone-400" />
                                        <span>No Space (Root)</span>
                                    </button>
                                )}
                                {(() => {
                                    if (folderSearchQuery) {
                                        return filteredMoveToFolderOptions.map((folderOption) => {
                                            const isCurrent = activeMoveToFolderCurrentFolderId === folderOption.id;
                                            const { IconComponent, colorStyle } = getFolderIconAndColor(folderOption);
                                            return (
                                                <button
                                                    key={`move-target-folder-${folderOption.id}`}
                                                    className={`w-full rounded-lg px-2.5 py-1.5 text-left text-xs transition-colors flex items-center gap-2 ${isCurrent ? 'es-general-selected-item font-semibold' : 'es-general-item-hover es-general-text'}`}
                                                    onClick={() => applyMoveToFolderSelection(folderOption.id)}
                                                >
                                                    <span style={colorStyle}>
                                                        <IconComponent size={13} />
                                                    </span>
                                                    <span className="truncate">{folderOption.name || 'Untitled Space'}</span>
                                                </button>
                                            );
                                        });
                                    }

                                    const renderMoveToFolderTree = (parentId: string, depth: number): React.ReactNode[] => {
                                        const list = sidebarFolders.filter((f) => String((f as any).parentId || '').trim() === parentId);
                                        const items: React.ReactNode[] = [];
                                        list.forEach((folderOption) => {
                                            const isCurrent = activeMoveToFolderCurrentFolderId === folderOption.id;
                                            const { IconComponent, colorStyle } = getFolderIconAndColor(folderOption);
                                            items.push(
                                                <button
                                                    key={`move-target-folder-${folderOption.id}`}
                                                    className={`w-full rounded-lg px-2.5 py-1.5 text-left text-xs transition-colors flex items-center gap-2 ${isCurrent ? 'es-general-selected-item font-semibold' : 'es-general-item-hover es-general-text'}`}
                                                    onClick={() => applyMoveToFolderSelection(folderOption.id)}
                                                    style={{ paddingLeft: `${10 + depth * 14}px` }}
                                                >
                                                    <span style={colorStyle}>
                                                        <IconComponent size={13} />
                                                    </span>
                                                    <span className="truncate">{folderOption.name || 'Untitled Space'}</span>
                                                </button>
                                            );
                                            renderMoveToFolderTree(folderOption.id, depth + 1).forEach((child) => items.push(child));
                                        });
                                        return items;
                                    };

                                    return renderMoveToFolderTree('', 0);
                                })()}
                                {folderSearchQuery && !filteredMoveToFolderOptions.length ? (
                                    <div className="px-2.5 py-4 text-center text-xs italic text-stone-500">No spaces found.</div>
                                ) : null}
                            </div>
                        </div>
                    </div>
                ) : null}

                {customizingFolder ? (
                    <div className="fixed inset-0 z-[130] flex items-center justify-center px-4 animate-in fade-in duration-100">
                        <div className="absolute inset-0 bg-black/60 backdrop-blur-sm" onClick={() => {
                            setCustomizingFolder(null);
                            setIconSearchQuery('');
                        }} />
                        <div className="relative w-full max-w-md rounded-xl border es-global-outline es-general-background shadow-2xl p-5 z-10 flex flex-col gap-4 animate-in fade-in zoom-in-95 duration-150">
                            <div className="flex items-center justify-between pb-1 border-b es-global-separator">
                                <div className="flex items-center gap-2">
                                    <SlidersHorizontal size={14} className="text-[var(--general-eye-catch)]" />
                                    <span className="text-sm font-semibold es-general-text">Customize Space</span>
                                </div>
                                <button
                                    onClick={() => {
                                        setCustomizingFolder(null);
                                        setIconSearchQuery('');
                                    }}
                                    className="h-6 w-6 inline-flex items-center justify-center rounded-md es-sidebar-item-text hover:bg-black/10 transition-colors"
                                >
                                    <X size={14} />
                                </button>
                            </div>

                            {/* Name Input */}
                            <div className="flex flex-col gap-1.5">
                                <label className="text-[10px] font-semibold uppercase tracking-wider text-stone-500">Space Name</label>
                                <input
                                    className="h-9 w-full rounded-lg border es-global-outline bg-transparent px-3 text-sm outline-none focus:border-[var(--global-selected-outlines)] transition-colors es-general-text"
                                    value={customizingFolderName}
                                    placeholder="Enter space name..."
                                    onChange={(e) => setCustomizingFolderName(e.target.value)}
                                />
                            </div>

                            {/* Color Selector */}
                            <div className="flex flex-col gap-1.5">
                                <label className="text-[10px] font-semibold uppercase tracking-wider text-stone-500">Theme Color</label>
                                <div className="flex flex-wrap gap-2.5">
                                    {Object.keys(colorPalette).map((colorId) => {
                                        const isSelected = colorId === customizingFolderColorId;
                                        return (
                                            <button
                                                key={colorId}
                                                onClick={() => setCustomizingFolderColorId(colorId)}
                                                className="h-6 w-6 rounded-full border transition-all hover:scale-110 flex items-center justify-center focus:outline-none"
                                                style={{
                                                    backgroundColor: colorPalette[colorId].bg,
                                                    borderColor: isSelected ? colorPalette[colorId].color : 'transparent',
                                                    borderWidth: isSelected ? '2px' : '1px',
                                                }}
                                                title={colorId}
                                            >
                                                <span className="h-3.5 w-3.5 rounded-full shadow-sm" style={{ backgroundColor: colorPalette[colorId].color }} />
                                            </button>
                                        );
                                    })}
                                </div>
                            </div>

                            {/* Icon Selector with Search */}
                            <div className="flex flex-col gap-2">
                                <div className="flex items-center justify-between">
                                    <label className="text-[10px] font-semibold uppercase tracking-wider text-stone-500">Space Icon</label>
                                    {iconSearchQuery ? (
                                        <span className="text-[10px] text-stone-500 italic">{filteredFolderIcons.length} results</span>
                                    ) : null}
                                </div>
                                <div className="relative">
                                    <Search size={12} className="pointer-events-none absolute left-2.5 top-1/2 -translate-y-1/2 text-stone-400" />
                                    <input
                                        className="h-8 w-full rounded-lg border es-global-outline bg-transparent pl-8 pr-2.5 text-xs outline-none focus:border-[var(--global-selected-outlines)] transition-colors es-general-text"
                                        placeholder="Search 60+ icons (e.g. key, code, work, task...)"
                                        value={iconSearchQuery}
                                        onChange={(e) => setIconSearchQuery(e.target.value)}
                                    />
                                </div>
                                <div className="grid grid-cols-6 gap-2 max-h-36 overflow-y-auto pr-1 p-0.5 border es-global-outline rounded-lg bg-[var(--input-background)]/20">
                                    {filteredFolderIcons.map((item) => {
                                        const IconComponent = item.Icon;
                                        const isSelected = item.id === customizingFolderIconId;
                                        return (
                                            <button
                                                key={item.id}
                                                onClick={() => setCustomizingFolderIconId(item.id)}
                                                className={`h-9 rounded-lg border flex flex-col items-center justify-center transition-all focus:outline-none ${isSelected ? 'es-global-selected-outline bg-stone-500/10 scale-[1.03]' : 'border-stone-700/20 hover:bg-stone-500/5'}`}
                                                title={item.id}
                                            >
                                                <span style={{ color: isSelected ? colorPalette[customizingFolderColorId]?.color : undefined }}>
                                                    <IconComponent size={14} />
                                                </span>
                                            </button>
                                        );
                                    })}
                                    {!filteredFolderIcons.length ? (
                                        <div className="col-span-6 py-4 text-center text-xs text-stone-500 italic">No matching icons found.</div>
                                    ) : null}
                                </div>
                            </div>

                            {/* Action Buttons */}
                            <div className="flex gap-2.5 mt-2">
                                <button
                                    onClick={() => {
                                        setCustomizingFolder(null);
                                        setIconSearchQuery('');
                                    }}
                                    className="h-9 flex-1 rounded-lg border es-global-outline es-general-text text-sm font-medium hover:bg-stone-500/5 transition-all focus:outline-none"
                                >
                                    Cancel
                                </button>
                                <button
                                    onClick={saveFolderCustomization}
                                    className="h-9 flex-1 rounded-lg bg-[var(--general-eye-catch)] text-[#f8fafc] text-sm font-semibold hover:opacity-95 active:scale-98 transition-all focus:outline-none shadow-md shadow-emerald-500/10"
                                >
                                    Save Space
                                </button>
                            </div>
                        </div>
                    </div>
                ) : null}

	                <main className="flex-1 min-w-0 flex flex-col overflow-hidden">
	                    <div
	                        ref={topBarRef}
	                        className="relative h-10 backdrop-blur es-header-background flex items-end gap-2 pr-2 select-none draggable"
	                        style={{
	                            paddingLeft: collapsedTopBarLeadingInset ? `${collapsedTopBarLeadingInset}px` : undefined,
	                        } as any}
	                    >
                        <div
                            className="pointer-events-none absolute bottom-0 left-0 right-0 h-px z-10"
                            style={topBarActiveCutout
                                ? ({
                                    backgroundImage: `linear-gradient(to right, var(--global-separator) 0, var(--global-separator) ${topBarActiveCutout.left}px, transparent ${topBarActiveCutout.left}px, transparent ${topBarActiveCutout.right}px, var(--global-separator) ${topBarActiveCutout.right}px, var(--global-separator) 100%)`,
                                } as any)
                                : ({ backgroundColor: 'var(--global-separator)' } as any)}
                            aria-hidden="true"
                        />
	                        <div className="shrink-0 pl-1 self-center inline-flex items-center gap-1">
                            <HoverTooltip label={shellSidebarCollapsed ? 'Expand sidebar' : 'Collapse sidebar'}>
                                <button
                                    className="h-7 w-7 inline-flex items-center justify-center rounded-md es-general-item-hover es-general-text transition-colors"
                                    onClick={() => updateLayoutSettings({ sidebarCollapsed: !shellSidebarCollapsed })}
                                    aria-label={shellSidebarCollapsed ? 'Expand sidebar' : 'Collapse sidebar'}
                                    style={{ WebkitAppRegion: 'no-drag' } as any}
                                >
                                    {shellSidebarCollapsed ? <PanelLeftInactive size={15} /> : <PanelLeft size={15} />}
                                </button>
                            </HoverTooltip>
                            {shellSidebarCollapsed ? renderUpdateButton(true) : null}
                        </div>

                        <span
                            className="self-center mx-1.5 h-3 w-px"
                            style={{ backgroundColor: 'color-mix(in srgb, var(--global-separator) 55%, transparent)' }}
                            aria-hidden="true"
                        />

                        <div data-tour-id="tabs-bar" className="min-w-0 flex-1 self-stretch flex items-end">
                            <div className="flex w-fit max-w-full min-w-0 items-end gap-1">
                                <div
                                    ref={tabStripViewportRef}
                                    className="min-w-0 overflow-x-auto overflow-y-hidden es-tab-strip-scroll"
                                    onWheel={handleTabStripWheel}
                                >
                                    <div className="inline-flex items-end gap-0 min-w-max pr-1">
                                    {libraryTabs.length ? libraryTabs.map((tab, index) => (
                                        <React.Fragment key={`library-tab-shell-${tab.key}`}>
                                            {index > 0 ? (
                                                <span
                                                    className="self-center mx-1.5 h-3 w-px"
                                                    style={{ backgroundColor: 'var(--global-separator)' }}
                                                    aria-hidden="true"
                                                />
                                            ) : null}
                                            <div
                                                ref={tab.isActive ? activeLibraryTabRef : undefined}
                                                role="button"
                                                tabIndex={0}
                                                className={`group relative h-10 rounded-t-lg border px-2.5 text-xs inline-flex items-center gap-1.5 transition-colors flex-none cursor-grab active:cursor-grabbing ${tab.isActive ? 'z-10 es-general-background border-[var(--global-outlines)] border-b-[var(--general-background)] text-stone-800' : 'border-transparent text-stone-500 es-topbar-tab-inactive'} ${tab.key === draggedTabKey ? 'opacity-40 border-dashed border-stone-500/50' : ''}`}
                                                title={tab.title}
                                                aria-label={tab.title}
                                                onClick={() => activateLibraryTab(tab.item)}
                                                onKeyDown={(event) => {
                                                    if (event.key === 'Enter' || event.key === ' ') {
                                                        event.preventDefault();
                                                        activateLibraryTab(tab.item);
                                                    }
                                                }}
                                                draggable={true}
                                                onDragStart={(e) => handleTabDragStart(e, tab.key)}
                                                onDragOver={handleTabDragOver}
                                                onDragEnter={(e) => handleTabDragEnter(e, tab.key)}
                                                onDragEnd={handleTabDragEnd}
                                                style={{ WebkitAppRegion: 'no-drag', width: `${libraryTabUniformWidth}px` } as any}
                                            >
                                                {tab.isActive ? (
                                                    <span
                                                        className="pointer-events-none absolute -bottom-px left-px right-px h-[2px] es-general-background"
                                                        aria-hidden="true"
                                                    />
                                                ) : null}
                                                {tab.type === 'note' ? <FileText size={12} className="shrink-0" /> : tab.type === 'ask' ? <MessageCircle size={12} className="shrink-0" /> : <Mic size={12} className="shrink-0" />}
                                                <span className="min-w-0 flex-1 truncate leading-none">{tab.title}</span>
                                                <button
                                                    className="relative ml-auto h-4 w-4 shrink-0 rounded-sm inline-flex items-center justify-center text-stone-500 hover:text-red-500 hover:bg-black/5 transition-colors opacity-0 group-hover:opacity-100"
                                                    draggable={false}
                                                    onClick={(event) => {
                                                        event.preventDefault();
                                                        event.stopPropagation();
                                                        closeLibraryTab(tab.item);
                                                    }}
                                                    type="button"
                                                    aria-label={`Close ${tab.title}`}
                                                >
                                                    <X size={11} />
                                                </button>
                                            </div>
                                        </React.Fragment>
                                    )) : (
	                                        <span className="inline-flex h-10 items-center text-xs text-stone-500 px-2">No tabs open</span>
	                                    )}
                                    </div>
                                </div>

                                <span
                                    className="self-center mx-1 h-3 w-px"
                                    style={{ backgroundColor: 'color-mix(in srgb, var(--global-separator) 55%, transparent)' }}
                                    aria-hidden="true"
                                />

                                <div className="shrink-0 pr-1 self-center">
                                    <HoverTooltip label="Open in new tab">
                                        <button
                                            data-tour-id="open-tab-button"
                                            className="h-8 w-8 rounded-md inline-flex items-center justify-center es-general-item-hover es-general-text transition-colors"
                                            onClick={() => {
                                                setOpenedSearchFromTabs(true);
                                                setIsLibrarySearchOpen(true);
                                            }}
                                            aria-label="Open in new tab"
                                            type="button"
                                            style={{ WebkitAppRegion: 'no-drag' } as any}
                                        >
                                            <Plus size={14} />
                                        </button>
                                    </HoverTooltip>
                                </div>
                            </div>
                        </div>
                    </div>

                    <div className="flex-1 overflow-hidden">
                    {isLoading ? (
                        <div className="h-full flex items-center justify-center text-stone-500">Loading dashboard...</div>
                    ) : null}

                    {!isLoading && activeSection === 'library' ? (
                        <div className="h-full flex overflow-hidden es-general-background">
                            <section className="flex-1 min-h-0 min-w-0 flex flex-col es-general-background relative">
                                {activeLibraryTabKey?.startsWith('ask:') ? ((() => {
                                    const chatId = activeLibraryTabKey.substring(4);
                                    const isPersistentChat = chatId !== 'global';
                                    const chatSession = chatsData.chats.find(c => c.id === chatId);

                                    return (
                                        <div className="flex-1 min-h-0 min-w-0 flex flex-col es-general-background relative">
	                                            {isPersistentChat && chatSession ? (
	                                                <div className="es-general-background">
	                                                    <UnifiedHeader
	                                                        title={buildHeaderTitleWithSpacePath({
                                                                type: 'chat',
                                                                id: chatSession.id,
                                                                title: (chatSession.title || 'Untitled Chat').trim() || 'Untitled Chat',
                                                                folderId: chatSession.folderId,
                                                                onRenameClick: () => openChatTitleRenamePopup(chatSession),
                                                                renameTooltip: 'Rename chat',
                                                            })}
	                                                        onRenameClick={() => openChatTitleRenamePopup(chatSession)}
	                                                        renameTooltip="Rename chat"
	                                                        isAuthenticated={notesData.isAuthenticated === true}
	                                                        isCloudSynced={chatSession.isCloudSynced === true}
	                                                        onCloudSyncToggle={() => toggleChatCloudSync(chatSession.id)}
	                                                        cloudSyncTooltip={!notesData.isAuthenticated ? 'Sign in to enable cloud sync' : chatSession.isCloudSynced === true ? 'Keep private on this device' : 'Sync this chat to cloud'}
                                                            menuRef={selectedChatMenuRef}
                                                            isMenuOpen={isSelectedChatMenuOpen}
                                                            onMenuToggle={() => setIsSelectedChatMenuOpen((previous) => !previous)}
                                                            menuTooltip="Chat actions"
                                                            menuContent={
                                                                <div
                                                                    className="absolute right-0 top-[calc(100%+6px)] z-[95] w-60 rounded-lg border es-global-outline es-general-background shadow-xl p-1.5"
                                                                    onClick={(event) => event.stopPropagation()}
                                                                >
                                                                    {pinnedSidebarItems.some((entry) => entry.type === 'chat' && entry.id === chatSession.id) ? (
                                                                        <button
                                                                            className="w-full rounded-md px-2 py-1.5 text-left text-xs es-general-item-hover es-general-text inline-flex items-center gap-1.5"
                                                                            onClick={(event) => {
                                                                                event.stopPropagation();
                                                                                unpinSidebarEntity({ type: 'chat', id: chatSession.id });
                                                                                setIsSelectedChatMenuOpen(false);
                                                                            }}
                                                                        >
                                                                            <PinOff size={12} />
                                                                            Unpin
                                                                        </button>
                                                                    ) : (
                                                                        <button
                                                                            className="w-full rounded-md px-2 py-1.5 text-left text-xs es-general-item-hover es-general-text inline-flex items-center gap-1.5"
                                                                            onClick={(event) => {
                                                                                event.stopPropagation();
                                                                                pinSidebarEntity({ type: 'chat', id: chatSession.id });
                                                                                setIsSelectedChatMenuOpen(false);
                                                                            }}
                                                                        >
                                                                            <Pin size={12} />
                                                                            Pin
                                                                        </button>
                                                                    )}
                                                                    <button
                                                                        className="w-full rounded-md px-2 py-1.5 text-left text-xs es-general-item-hover es-general-text inline-flex items-center gap-1.5"
                                                                        onClick={(event) => {
                                                                            event.stopPropagation();
                                                                            setIsSelectedChatMenuOpen(false);
                                                                            handleMoveOrRemoveFolderAction({ type: 'chat', id: chatSession.id });
                                                                        }}
                                                                    >
                                                                        <FolderGlyph size={12} />
                                                                        {chatSession.folderId ? 'Move to space' : 'Add to space'}
                                                                    </button>
                                                                    <button
                                                                        className="w-full rounded-md px-2 py-1.5 text-left text-xs es-general-item-hover es-general-text inline-flex items-center gap-1.5"
                                                                        onClick={(event) => {
                                                                            event.stopPropagation();
                                                                            setIsSelectedChatMenuOpen(false);
                                                                            openChatTitleRenamePopup(chatSession);
                                                                        }}
                                                                    >
                                                                        <Pencil size={12} />
                                                                        Rename
                                                                    </button>
                                                                    <button
                                                                        className="w-full rounded-md px-2 py-1.5 text-left text-xs text-red-600 hover:bg-red-50 inline-flex items-center gap-1.5"
                                                                        onClick={(event) => {
                                                                            event.stopPropagation();
                                                                            setIsSelectedChatMenuOpen(false);
                                                                            deleteChatById(chatSession.id, (chatSession.title || 'Untitled Chat').trim() || 'Untitled Chat');
                                                                        }}
                                                                    >
                                                                        <Trash2 size={12} />
                                                                        Delete
                                                                    </button>
                                                                    <div className="mt-1 border-t es-global-separator px-2 pt-1.5 pb-0.5 text-[11px] text-stone-500 space-y-0.5">
                                                                        <div>Last message on {(() => {
                                                                            const lastMessage = chatSession.messages && chatSession.messages.length > 0
                                                                                ? chatSession.messages[chatSession.messages.length - 1]
                                                                                : null;
                                                                            const lastMessageTime = lastMessage?.createdAt || chatSession.updatedAt || chatSession.createdAt || 0;
                                                                            return Number.isFinite(lastMessageTime) && lastMessageTime > 0
                                                                                ? new Date(lastMessageTime).toLocaleString('en-GB', {
                                                                                    day: '2-digit',
                                                                                    month: 'short',
                                                                                    year: 'numeric',
                                                                                    hour: '2-digit',
                                                                                    minute: '2-digit',
                                                                                    hour12: false,
                                                                                })
                                                                                : 'No messages';
                                                                        })()}</div>
                                                                    </div>
                                                                </div>
                                                            }
	                                                    />
	                                                </div>
	                                            ) : null}
                                            {isPersistentChat && chatSession && isChatTitleRenamePopupOpen ? (
                                                <div
                                                    className="fixed inset-0 z-[110] flex items-center justify-center bg-stone-900/35 backdrop-blur-sm p-6"
                                                    onClick={closeChatTitleRenamePopup}
                                                >
                                                    <div
                                                        className="w-full max-w-sm rounded-xl border es-global-outline es-general-background shadow-xl p-4"
                                                        onClick={(event) => event.stopPropagation()}
                                                    >
                                                        <div className="flex items-center justify-between mb-3">
                                                            <h3 className="text-sm font-semibold es-general-text">Rename chat</h3>
                                                            <HoverTooltip label="Close">
                                                                <button
                                                                    className="p-1 rounded-md text-stone-400 hover:text-stone-600 es-general-item-hover transition-colors"
                                                                    onClick={closeChatTitleRenamePopup}
                                                                >
                                                                    <X size={14} />
                                                                </button>
                                                            </HoverTooltip>
                                                        </div>
                                                        <input
                                                            autoFocus
                                                            className="h-9 w-full rounded-lg border es-global-outline bg-transparent px-3 text-sm outline-none focus:border-[var(--global-selected-outlines)]"
                                                            value={chatTitleRenameDraft}
                                                            onChange={(event) => setChatTitleRenameDraft(event.target.value)}
                                                            onKeyDown={(event) => {
                                                                if (event.key === 'Enter') {
                                                                    event.preventDefault();
                                                                    saveChatTitleFromPopup();
                                                                } else if (event.key === 'Escape') {
                                                                    event.preventDefault();
                                                                    closeChatTitleRenamePopup();
                                                                }
                                                            }}
                                                            placeholder="Untitled Chat"
                                                        />
                                                        <div className="mt-4 flex justify-end gap-2">
                                                            <button
                                                                className="px-3 py-1.5 text-xs font-semibold rounded-md border es-global-outline bg-transparent es-general-item-hover transition-colors shadow-sm"
                                                                onClick={closeChatTitleRenamePopup}
                                                            >
                                                                Cancel
                                                            </button>
                                                            <button
                                                                className="px-3 py-1.5 text-xs font-semibold rounded-md bg-stone-800 text-white hover:bg-stone-900 transition-colors shadow-sm"
                                                                onClick={saveChatTitleFromPopup}
                                                            >
                                                                Save
                                                            </button>
                                                        </div>
                                                    </div>
                                                </div>
                                            ) : null}

                                            <div className="flex-1 min-h-0 h-0 flex flex-col relative overflow-hidden">
                                                <GlobalAskTab
                                                    key={`global-ask-${activeLibraryTabKey || 'ask:global'}`}
                                                    authState={authState}
                                                    conversationKey={activeLibraryTabKey || 'ask:global'}
                                                    messages={globalAskMessages}
                                                    draft={globalAskDraft}
                                                    isLoading={globalAskLoading}
                                                    progressSteps={globalAskProgressSteps}
                                                    modelOptions={globalAskModelOptions}
                                                    selectedModelOptionId={globalAskModelOptionId}
                                                    onModelOptionChange={setGlobalAskModelOptionId}
                                                    contextOptions={globalAskContextOptions}
                                                    selectedContextOptionIds={globalAskContextOptionIds}
                                                    onContextOptionChange={setGlobalAskContextOptionIds}
                                                    onDraftChange={setGlobalAskDraft}
                                                    onSelectLibraryItem={(kind, id) => selectLibraryItem({ type: kind, id })}
                                                    resolveCitationTitle={resolveCitationTitle}
                                                    onCreateNote={(text) => {
                                                        const now = Date.now();
                                                        const lines = text.split('\n').map(l => l.trim()).filter(Boolean);
                                                        let title = 'AI Response Note';
                                                        if (lines.length > 0) {
                                                            const cleanTitle = lines[0].replace(/[#*_`[\]]/g, '').trim();
                                                            if (cleanTitle) {
                                                                title = cleanTitle.length > 50 ? cleanTitle.slice(0, 50) + '...' : cleanTitle;
                                                            }
                                                        }
                                                        const newNote = normalizeDashboardNote({
                                                            id: crypto.randomUUID(),
                                                            title,
                                                            text: text,
                                                            isCloudSynced: notesData.isAuthenticated === true && settings.syncSettings?.strictPrivacyMode !== true,
                                                            colorId: settings.stickyNoteDefaultColorId,
                                                            folderId: '',
                                                            createdAt: now,
                                                            lastModified: now,
                                                            sourceRecordingIds: [],
                                                        });
                                                        setNotesData((previous) => ({
                                                            ...previous,
                                                            notes: [newNote, ...previous.notes],
                                                        }));
                                                        ipcRenderer.send('save-note', newNote);
                                                        setLibraryFilter('all');
                                                        setSelectedLibraryItem({ type: 'note', id: newNote.id });
                                                        setActiveSection('library');
                                                    }}
                                                    onSend={(payload?: GlobalAskSendPayload) => {
                                                        const text = String(payload?.prompt ?? globalAskDraft).trim();
                                                        if (!text || globalAskLoading) return;
                                                        const historyForRequest = globalAskMessages
                                                            .slice(-16)
                                                            .map((entry) => ({
                                                                role: entry.role,
                                                                content: entry.content,
                                                                createdAt: entry.createdAt,
                                                            }));
                                                        const fallbackModelSelection = selectedGlobalAskModelOption?.selection || { mode: 'auto' as const };
                                                        const resolvedContextSelections = globalAskContextOptionIds
                                                            .map(buildGlobalAskContextSelectionFromOptionId)
                                                            .filter((entry): entry is { kind: 'recording' | 'note' | 'folder' | 'chat'; id?: string } => !!entry);
                                                        const contextSelection = payload?.contextSelection
                                                            || (resolvedContextSelections.length === 1
                                                                ? resolvedContextSelections[0]
                                                                : resolvedContextSelections);
                                                        const userMessage: AskMessage = { id: `u-${Date.now()}`, role: 'user', content: text, createdAt: Date.now() };
                                                        const streamingMessage: AskMessage = { id: 'a-streaming', role: 'assistant', content: '', createdAt: Date.now() };
                                                        setGlobalAskMessages((prev) => [...prev, userMessage, streamingMessage]);
                                                        setGlobalAskDraft('');
                                                        setGlobalAskLoading(true);
                                                        setGlobalAskProgressSteps([]);

                                                        const modelSel = payload?.modelSelection || fallbackModelSelection;
                                                        const modelOverride = modelSel.mode === 'byok'
                                                            ? modelSel.model
                                                            : modelSel.mode === 'pro'
                                                                ? modelSel.modelAlias
                                                                : undefined;
                                                        const providerOverride = modelSel.mode === 'byok' ? modelSel.provider : undefined;

                                                        ipcRenderer.send('chat:send', {
                                                            prompt: text,
                                                            chatHistory: historyForRequest,
                                                            modelOverride,
                                                            providerOverride,
                                                            contextSelection,
                                                            chatId: activeLibraryTabKey,
                                                        });
                                                    }}
                                                />
                                            </div>
                                        </div>
                                    );
                                })()) : selectedNote ? (
		                                    <>
                                        <UnifiedHeader
                                            title={buildHeaderTitleWithSpacePath({
                                                type: 'note',
                                                id: selectedNote.id,
                                                title: (selectedNote.title || '').trim() || 'Untitled note',
                                                folderId: selectedNote.folderId,
                                                onRenameClick: openNoteTitleRenamePopup,
                                                renameTooltip: 'Rename note',
                                            })}
                                            onRenameClick={openNoteTitleRenamePopup}
                                            renameTooltip="Rename note"
                                            isAuthenticated={notesData.isAuthenticated === true}
                                            isCloudSynced={selectedNote.isCloudSynced !== false}
                                            onCloudSyncToggle={toggleSelectedNoteCloudSync}
                                            cloudSyncTooltip={!notesData.isAuthenticated ? 'Sign in to enable cloud sync' : selectedNote.isCloudSynced !== false ? 'Keep private on this device' : 'Sync this note to cloud'}
                                            rightActions={
                                                <HoverTooltip label="Pop out note">
                                                    <button
                                                        className="inline-flex h-8 w-8 items-center justify-center rounded-lg bg-transparent es-general-item-hover es-general-text transition-colors"
                                                        onClick={() => ipcRenderer.send('open-sticky-note', selectedNote)}
                                                    >
                                                        <ExternalLink size={16} className="opacity-90" />
                                                    </button>
                                                </HoverTooltip>
                                            }
                                            menuRef={selectedNoteMenuRef}
                                            isMenuOpen={isSelectedNoteMenuOpen}
                                            onMenuToggle={() => setIsSelectedNoteMenuOpen((previous) => !previous)}
                                            menuTooltip="Note actions"
                                            menuContent={
                                                <div
                                                    className="absolute right-0 top-[calc(100%+6px)] z-[95] w-60 rounded-lg border es-global-outline es-general-background shadow-xl p-1.5"
                                                    onClick={(event) => event.stopPropagation()}
                                                >
                                                    {pinnedSidebarItems.some((entry) => entry.type === 'note' && entry.id === selectedNote.id) ? (
                                                        <button
                                                            className="w-full rounded-md px-2 py-1.5 text-left text-xs es-general-item-hover es-general-text inline-flex items-center gap-1.5"
                                                            onClick={(event) => {
                                                                event.stopPropagation();
                                                                unpinSidebarEntity({ type: 'note', id: selectedNote.id });
                                                                setIsSelectedNoteMenuOpen(false);
                                                            }}
                                                        >
                                                            <PinOff size={12} />
                                                            Unpin
                                                        </button>
                                                    ) : (
                                                        <button
                                                            className="w-full rounded-md px-2 py-1.5 text-left text-xs es-general-item-hover es-general-text inline-flex items-center gap-1.5"
                                                            onClick={(event) => {
                                                                event.stopPropagation();
                                                                pinSidebarEntity({ type: 'note', id: selectedNote.id });
                                                                setIsSelectedNoteMenuOpen(false);
                                                            }}
                                                        >
                                                            <Pin size={12} />
                                                            Pin
                                                        </button>
                                                    )}
                                                    <button
                                                        className="w-full rounded-md px-2 py-1.5 text-left text-xs es-general-item-hover es-general-text inline-flex items-center gap-1.5"
                                                        onClick={(event) => {
                                                            event.stopPropagation();
                                                            moveSelectedNoteFromMenu();
                                                        }}
                                                    >
                                                        <FolderGlyph size={12} />
                                                        {selectedNote?.folderId ? 'Move to space' : 'Add to space'}
                                                    </button>
                                                    <button
                                                        className="w-full rounded-md px-2 py-1.5 text-left text-xs es-general-item-hover es-general-text inline-flex items-center gap-1.5"
                                                        onClick={(event) => {
                                                            event.stopPropagation();
                                                            renameSelectedNoteFromMenu();
                                                        }}
                                                    >
                                                        <Pencil size={12} />
                                                        Rename
                                                    </button>
                                                    <div className="px-2 py-1">
                                                        <div className="text-[10px] font-semibold uppercase tracking-wider text-stone-500">Export</div>
                                                        <div className="mt-1 flex flex-col gap-1">
                                                            <button
                                                                className="rounded-md px-2 py-1 text-left text-[11px] font-medium es-general-item-hover es-general-text"
                                                                onClick={(event) => {
                                                                    event.stopPropagation();
                                                                    exportSelectedNoteByFormat('pdf');
                                                                }}
                                                            >
                                                                PDF
                                                            </button>
                                                            <button
                                                                className="rounded-md px-2 py-1 text-left text-[11px] font-medium es-general-item-hover es-general-text"
                                                                onClick={(event) => {
                                                                    event.stopPropagation();
                                                                    exportSelectedNoteByFormat('html');
                                                                }}
                                                            >
                                                                HTML
                                                            </button>
                                                            <button
                                                                className="rounded-md px-2 py-1 text-left text-[11px] font-medium es-general-item-hover es-general-text"
                                                                onClick={(event) => {
                                                                    event.stopPropagation();
                                                                    exportSelectedNoteByFormat('markdown');
                                                                }}
                                                            >
                                                                Markdown
                                                            </button>
                                                        </div>
                                                    </div>
                                                    <button
                                                        className="w-full rounded-md px-2 py-1.5 text-left text-xs text-red-600 hover:bg-red-50 inline-flex items-center gap-1.5"
                                                        onClick={(event) => {
                                                            event.stopPropagation();
                                                            setIsSelectedNoteMenuOpen(false);
                                                            deleteSelectedNote();
                                                        }}
                                                    >
                                                        <Trash2 size={12} />
                                                        Delete
                                                    </button>
                                                    <div className="mt-1 border-t es-global-separator px-2 pt-1.5 pb-0.5 text-[11px] text-stone-500 space-y-0.5">
                                                        {selectedNoteFolderName ? <div>Folder: {selectedNoteFolderName}</div> : null}
                                                        <div>Word count: {selectedNoteWordCount.toLocaleString('en-GB')}</div>
                                                        <div>Last edited on {selectedNoteLastEditedLabel}</div>
                                                    </div>
                                                </div>
                                            }
                                        />

		                                        {isNoteTitleRenamePopupOpen ? (
		                                            <div
		                                                className="fixed inset-0 z-[110] flex items-center justify-center bg-stone-900/35 backdrop-blur-sm p-6"
		                                                onClick={closeNoteTitleRenamePopup}
		                                            >
		                                                <div
		                                                    className="w-full max-w-sm rounded-xl border es-global-outline es-general-background shadow-xl p-4"
		                                                    onClick={(event) => event.stopPropagation()}
		                                                >
		                                                    <div className="flex items-center justify-between mb-3">
		                                                        <h3 className="text-sm font-semibold es-general-text">Rename note</h3>
		                                                        <HoverTooltip label="Close">
		                                                            <button
		                                                                className="p-1 rounded-md text-stone-400 hover:text-stone-600 es-general-item-hover transition-colors"
		                                                                onClick={closeNoteTitleRenamePopup}
		                                                            >
		                                                                <X size={14} />
		                                                            </button>
		                                                        </HoverTooltip>
		                                                    </div>
		                                                    <input
		                                                        autoFocus
		                                                        className="h-9 w-full rounded-lg border es-global-outline bg-transparent px-3 text-sm outline-none focus:border-[var(--global-selected-outlines)]"
		                                                        value={noteTitleRenameDraft}
		                                                        onChange={(event) => setNoteTitleRenameDraft(event.target.value)}
		                                                        onKeyDown={(event) => {
		                                                            if (event.key === 'Enter') {
		                                                                event.preventDefault();
		                                                                saveNoteTitleFromPopup();
		                                                            } else if (event.key === 'Escape') {
		                                                                event.preventDefault();
		                                                                closeNoteTitleRenamePopup();
		                                                            }
		                                                        }}
		                                                        placeholder="Untitled note"
		                                                    />
		                                                    <div className="mt-4 flex justify-end gap-2">
		                                                        <button
		                                                            className="px-3 py-1.5 text-xs font-semibold rounded-md border es-global-outline bg-transparent es-general-item-hover transition-colors shadow-sm"
		                                                            onClick={closeNoteTitleRenamePopup}
		                                                        >
		                                                            Cancel
		                                                        </button>
		                                                        <button
		                                                            className="px-3 py-1.5 text-xs font-semibold rounded-md bg-stone-800 text-white hover:bg-stone-900 transition-colors shadow-sm"
		                                                            onClick={saveNoteTitleFromPopup}
		                                                        >
		                                                            Save
		                                                        </button>
		                                                    </div>
		                                                </div>
		                                            </div>
		                                        ) : null}

		                                        {noteActionError ? (
		                                            <div className="mx-8 mt-4 text-xs text-red-700 bg-red-50 border border-red-200 rounded-lg px-3 py-2.5 flex items-start justify-between gap-2">
		                                                <span className="min-w-0">{noteActionError}</span>
	                                                <HoverTooltip label="Dismiss error">
	                                                    <button
	                                                        className="shrink-0 text-red-700 hover:opacity-80 transition-colors"
	                                                        onClick={() => setNoteActionError('')}
	                                                        aria-label="Dismiss note error"
	                                                    >
	                                                        <X size={12} strokeWidth={3} />
	                                                    </button>
	                                                </HoverTooltip>
	                                            </div>
	                                        ) : null}

	                                        {selectedNoteSourceRecordings.length ? (
	                                            <div className={`px-8 py-3 border-b es-global-separator es-general-background `}>
	                                                <div className="mx-auto max-w-4xl flex flex-wrap items-center gap-2">
	                                                    <span className="text-[10px] font-semibold uppercase tracking-[0.18em] text-stone-500">Sources</span>
	                                                    {selectedNoteSourceRecordings.map((source) => (
	                                                        <button
	                                                            key={`note-source-${source.id}`}
	                                                            className="inline-flex items-center gap-1.5 rounded-full border es-global-outline px-2.5 py-1 text-xs text-stone-600 es-general-item-hover transition-colors"
	                                                            onClick={() => selectLibraryItem({ type: 'recording', id: source.id })}
	                                                        >
	                                                            <Mic size={12} />
	                                                            <span className="max-w-[220px] truncate">{source.title || 'Untitled recording'}</span>
	                                                        </button>
	                                                    ))}
	                                                </div>
	                                            </div>
	                                        ) : null}

				                                        <div className="flex-1 min-h-0 overflow-auto px-8 py-8 es-general-background">
				                                            <div data-tour-id="note-editor" className="mx-auto max-w-4xl rounded-[28px] es-library-content-surface px-10 py-8">
			                                                <input
			                                                    ref={selectedNoteTitleInputRef}
			                                                    className="mb-6 w-full bg-transparent border-none p-0 text-4xl font-semibold tracking-tight text-stone-900 placeholder:text-stone-300 focus:outline-none focus:ring-0"
			                                                    value={selectedNote.title || ''}
			                                                    onChange={(event) => saveSelectedNote({ title: event.target.value })}
			                                                    placeholder="Untitled note"
			                                                />
			                                                <MarkdownEditor
			                                                    key={selectedNote.id}
			                                                    value={selectedNote.text || ''}
	                                                    onChange={(text) => saveSelectedNote({ text })}
	                                                    onFocus={() => ipcRenderer.send('focus-note', selectedNote.id)}
	                                                    onBlur={() => ipcRenderer.send('blur-note', selectedNote.id)}
	                                                    placeholder="Start writting or press '/' for commands."
	                                                    proseClassName="max-w-none"
	                                                />
	                                            </div>
	                                        </div>
                                    </>
                                ) : selectedRecording ? (
                                    <>
                                        <UnifiedHeader
                                            title={buildHeaderTitleWithSpacePath({
                                                type: 'recording',
                                                id: selectedRecording.id,
                                                title: (selectedRecording.title || '').trim() || 'Untitled recording',
                                                folderId: selectedRecording.folderId,
                                                onRenameClick: openRecordingTitleRenamePopup,
                                                renameTooltip: 'Rename recording',
                                            })}
                                            onRenameClick={openRecordingTitleRenamePopup}
                                            renameTooltip="Rename recording"
                                            isAuthenticated={notesData.isAuthenticated === true}
                                            isCloudSynced={selectedRecording.isCloudSynced !== false}
                                            onCloudSyncToggle={() => void toggleSelectedRecordingCloudSync()}
                                            cloudSyncTooltip={!notesData.isAuthenticated ? 'Sign in to enable cloud sync' : selectedRecording.isCloudSynced !== false ? 'Keep private on this device' : 'Sync this recording to cloud'}
                                            rightActions={
                                                <>
                                                    <div className="inline-flex h-8 items-stretch gap-0.5 rounded-lg border es-global-outline p-0.5">
                                                        <HoverTooltip label="See transcript" disabled={recordingDetailTab === 'transcript'} className="flex items-stretch">
                                                            <button
                                                                className={`px-2.5 h-full rounded-md text-[11px] font-medium transition-all duration-200 inline-flex items-center justify-center gap-1.5 ${recordingDetailTab === 'transcript' ? 'es-general-selected-item' : 'es-general-text es-general-item-hover'}`}
                                                                onClick={() => setRecordingDetailTab('transcript')}
                                                            >
                                                                <AlignLeft size={12} className={recordingDetailTab === 'transcript' ? '' : 'opacity-70'} />
                                                                {recordingDetailTab === 'transcript' && <span>Transcript</span>}
                                                            </button>
                                                        </HoverTooltip>
                                                        <HoverTooltip label="See summary" disabled={recordingDetailTab === 'summary'} className="flex items-stretch">
                                                            <button
                                                                className={`px-2.5 h-full rounded-md text-[11px] font-medium transition-all duration-200 inline-flex items-center justify-center gap-1.5 ${recordingDetailTab === 'summary' ? 'es-general-selected-item' : 'es-general-text es-general-item-hover'}`}
                                                                onClick={() => setRecordingDetailTab('summary')}
                                                            >
                                                                <Sparkles size={12} className={recordingDetailTab === 'summary' ? 'text-amber-500' : ''} />
                                                                {recordingDetailTab === 'summary' && <span>Summary</span>}
                                                            </button>
                                                        </HoverTooltip>
                                                    </div>
                                                    {recordingDetailTab === 'transcript' && recordingDraftDirty ? (
                                                        <button
                                                            className="bg-stone-800 hover:bg-stone-900 text-white font-medium text-xs px-3 h-8 rounded-lg disabled:opacity-50 transition-colors inline-flex items-center gap-1.5 shadow-sm min-w-0"
                                                            onClick={saveRecordingTranscriptDraft}
                                                            disabled={isSavingRecordingDraft || isDeletingRecording || !!summarizingRecordingId}
                                                        >
                                                            <Save size={14} />
                                                            {isSavingRecordingDraft ? 'Saving...' : 'Save Changes'}
                                                        </button>
                                                    ) : null}
                                                </>
                                            }
                                            menuRef={selectedRecordingMenuRef}
                                            isMenuOpen={isSelectedRecordingMenuOpen}
                                            onMenuToggle={() => {
                                                setIsSelectedRecordingMenuOpen((previous) => !previous);
                                            }}
                                            menuTooltip="Recording actions"
                                            menuContent={
                                                <div
                                                    className="absolute right-0 top-[calc(100%+6px)] z-[95] w-60 rounded-lg border es-global-outline es-general-background shadow-xl p-1.5"
                                                    onClick={(event) => event.stopPropagation()}
                                                >
                                                    {pinnedSidebarItems.some((entry) => entry.type === 'recording' && entry.id === selectedRecording.id) ? (
                                                        <button
                                                            className="w-full rounded-md px-2 py-1.5 text-left text-xs es-general-item-hover es-general-text inline-flex items-center gap-1.5"
                                                            onClick={(event) => {
                                                                event.stopPropagation();
                                                                unpinSidebarEntity({ type: 'recording', id: selectedRecording.id });
                                                                setIsSelectedRecordingMenuOpen(false);
                                                            }}
                                                        >
                                                            <PinOff size={12} />
                                                            Unpin
                                                        </button>
                                                    ) : (
                                                        <button
                                                            className="w-full rounded-md px-2 py-1.5 text-left text-xs es-general-item-hover es-general-text inline-flex items-center gap-1.5"
                                                            onClick={(event) => {
                                                                event.stopPropagation();
                                                                pinSidebarEntity({ type: 'recording', id: selectedRecording.id });
                                                                setIsSelectedRecordingMenuOpen(false);
                                                            }}
                                                        >
                                                            <Pin size={12} />
                                                            Pin
                                                        </button>
                                                    )}
                                                    <button
                                                        className="w-full rounded-md px-2 py-1.5 text-left text-xs es-general-item-hover es-general-text inline-flex items-center gap-1.5"
                                                        onClick={(event) => {
                                                            event.stopPropagation();
                                                            setIsSelectedRecordingMenuOpen(false);
                                                            handleMoveOrRemoveFolderAction({ type: 'recording', id: selectedRecording.id });
                                                        }}
                                                    >
                                                        <FolderGlyph size={12} />
                                                        {selectedRecording.folderId ? 'Move to space' : 'Add to space'}
                                                    </button>
                                                    <button
                                                        className="w-full rounded-md px-2 py-1.5 text-left text-xs es-general-item-hover es-general-text inline-flex items-center gap-1.5"
                                                        onClick={() => {
                                                            setIsSelectedRecordingMenuOpen(false);
                                                            openRecordingTitleRenamePopup();
                                                        }}
                                                    >
                                                        <Pencil size={12} />
                                                        Rename
                                                    </button>

                                                    {linkedNoteForSelectedRecording ? (
                                                        <button
                                                            className="w-full rounded-md px-2 py-1.5 text-left text-xs es-general-item-hover es-general-text inline-flex items-center gap-1.5"
                                                            onClick={() => {
                                                                setIsSelectedRecordingMenuOpen(false);
                                                                selectLibraryItem({ type: 'note', id: linkedNoteForSelectedRecording.id });
                                                            }}
                                                        >
                                                            <Link2 size={12} />
                                                            Open note
                                                        </button>
                                                    ) : (
                                                        <button
                                                            className="w-full rounded-md px-2 py-1.5 text-left text-xs es-general-item-hover es-general-text inline-flex items-center gap-1.5 disabled:opacity-60"
                                                            onClick={() => {
                                                                setIsSelectedRecordingMenuOpen(false);
                                                                void createLinkedNoteForSelectedRecording();
                                                            }}
                                                            disabled={isRecordingActionBusy}
                                                        >
                                                            <FileText size={12} />
                                                            Create note
                                                        </button>
                                                    )}

                                                    <div className="px-2 py-1">
                                                        <div className="mb-1 text-[10px] font-semibold uppercase tracking-wider text-stone-500">Link note</div>
                                                        <select
                                                            className="h-8 w-full rounded-md border es-global-outline bg-transparent px-2 text-xs es-general-text shadow-sm outline-none transition-colors disabled:opacity-60"
                                                            value={selectedRecording.linkedNoteId || ''}
                                                            onChange={(event) => {
                                                                const noteId = event.target.value;
                                                                if (noteId && noteId !== selectedRecording.linkedNoteId) {
                                                                    void linkSelectedRecordingToNote(noteId);
                                                                    setIsSelectedRecordingMenuOpen(false);
                                                                }
                                                            }}
                                                            disabled={!notesData.notes.length || isRecordingActionBusy}
                                                        >
                                                            <option value="">Select note...</option>
                                                            {notesData.notes.map((note) => (
                                                                <option key={`recording-note-link-option-${note.id}`} value={note.id}>
                                                                    {note.title || 'Untitled note'}
                                                                </option>
                                                            ))}
                                                        </select>
                                                    </div>

                                                    {linkedNoteForSelectedRecording ? (
                                                        <button
                                                            className="w-full rounded-md px-2 py-1.5 text-left text-xs es-general-item-hover es-general-text inline-flex items-center gap-1.5 disabled:opacity-60"
                                                            onClick={() => {
                                                                setIsSelectedRecordingMenuOpen(false);
                                                                void unlinkSelectedRecordingNote();
                                                            }}
                                                            disabled={isRecordingActionBusy}
                                                        >
                                                            <Unlink size={12} />
                                                            Unlink note
                                                        </button>
                                                    ) : null}

                                                    <button
                                                        className="w-full rounded-md px-2 py-1.5 text-left text-xs text-red-600 hover:bg-red-50 inline-flex items-center gap-1.5 disabled:opacity-60"
                                                        onClick={() => {
                                                            setIsSelectedRecordingMenuOpen(false);
                                                            openDeleteRecordingModal();
                                                        }}
                                                        disabled={isRecordingActionBusy}
                                                    >
                                                        <Trash2 size={12} />
                                                        Delete
                                                    </button>

                                                    <div className="mt-1 border-t es-global-separator px-2 pt-1.5 pb-0.5 text-[11px] text-stone-500 space-y-0.5">
                                                        <div>Recorded on {formatTimestampLabel(selectedRecording.createdAt)}</div>
                                                        <div>Length: {formatDurationMs(selectedRecording.stats?.durationMs)}</div>
                                                    </div>
                                                </div>
                                            }
                                        />

                                        {isRecordingTitleRenamePopupOpen ? (
                                            <div
                                                className="fixed inset-0 z-[110] flex items-center justify-center bg-stone-900/35 backdrop-blur-sm p-6"
                                                onClick={closeRecordingTitleRenamePopup}
                                            >
                                                <div
                                                    className="w-full max-w-sm rounded-xl border es-global-outline es-general-background shadow-xl p-4"
                                                    onClick={(event) => event.stopPropagation()}
                                                >
                                                    <div className="flex items-center justify-between mb-3">
                                                        <h3 className="text-sm font-semibold es-general-text">Rename recording</h3>
                                                        <HoverTooltip label="Close">
                                                            <button
                                                                className="p-1 rounded-md text-stone-400 hover:text-stone-600 es-general-item-hover transition-colors"
                                                                onClick={closeRecordingTitleRenamePopup}
                                                            >
                                                                <X size={14} />
                                                            </button>
                                                        </HoverTooltip>
                                                    </div>
                                                    <input
                                                        autoFocus
                                                        className="h-9 w-full rounded-lg border es-global-outline bg-transparent px-3 text-sm outline-none focus:border-[var(--global-selected-outlines)]"
                                                        value={recordingTitleRenameDraft}
                                                        onChange={(event) => setRecordingTitleRenameDraft(event.target.value)}
                                                        onKeyDown={(event) => {
                                                            if (event.key === 'Enter') {
                                                                event.preventDefault();
                                                                void saveRecordingTitleFromPopup();
                                                            } else if (event.key === 'Escape') {
                                                                event.preventDefault();
                                                                closeRecordingTitleRenamePopup();
                                                            }
                                                        }}
                                                        placeholder="Untitled recording"
                                                    />
                                                    <div className="mt-4 flex justify-end gap-2">
                                                        <button
                                                            className="px-3 py-1.5 text-xs font-semibold rounded-md border es-global-outline bg-transparent es-general-item-hover transition-colors shadow-sm"
                                                            onClick={closeRecordingTitleRenamePopup}
                                                        >
                                                            Cancel
                                                        </button>
                                                        <button
                                                            className="px-3 py-1.5 text-xs font-semibold rounded-md bg-stone-800 text-white hover:bg-stone-900 transition-colors shadow-sm"
                                                            onClick={() => void saveRecordingTitleFromPopup()}
                                                        >
                                                            Save
                                                        </button>
                                                    </div>
                                                </div>
                                            </div>
                                        ) : null}

                                        {recordingActionError ? (
                                            <div className="mx-8 mt-4 text-xs text-red-700 bg-red-50 border border-red-200 rounded-lg px-3 py-2.5 flex items-start justify-between gap-2">
                                                <span className="min-w-0">{recordingActionError}</span>
                                                <HoverTooltip label="Dismiss error">
                                                    <button
                                                        className="shrink-0 text-red-700 hover:opacity-80 transition-colors"
                                                        onClick={() => setRecordingActionError('')}
                                                        aria-label="Dismiss error"
                                                    >
                                                        <X size={12} strokeWidth={3} />
                                                    </button>
                                                </HoverTooltip>
                                            </div>
                                        ) : null}

                                        {recordingDeleteTarget ? (
                                            <div
                                                className="fixed inset-0 z-50 flex items-center justify-center bg-stone-900/40 backdrop-blur-sm p-6"
                                                onClick={closeDeleteRecordingModal}
                                            >
                                                <div
                                                    className="w-full max-w-sm rounded-xl border es-global-outline es-general-background shadow-xl p-4"
                                                    onClick={(event) => event.stopPropagation()}
                                                >
                                                    <div className="flex items-center justify-between mb-3">
                                                        <h3 className="text-sm font-semibold es-general-text">Delete recording?</h3>
                                                        <HoverTooltip label="Close" disabled={isDeletingRecording}>
                                                            <button
                                                                className="p-1 rounded-md text-stone-400 hover:text-stone-600 es-general-item-hover transition-colors"
                                                                onClick={closeDeleteRecordingModal}
                                                                disabled={isDeletingRecording}
                                                            >
                                                                <X size={14} />
                                                            </button>
                                                        </HoverTooltip>
                                                    </div>
                                                    <p className="text-xs text-stone-600">
                                                        This will permanently delete "{recordingDeleteTarget.title}". This action cannot be undone.
                                                    </p>
                                                    <div className="mt-4 flex justify-end gap-2">
                                                        <button
                                                            className="px-3 py-1.5 text-xs font-semibold rounded-md border es-global-outline bg-transparent es-general-item-hover transition-colors shadow-sm"
                                                            onClick={closeDeleteRecordingModal}
                                                            disabled={isDeletingRecording}
                                                        >
                                                            Cancel
                                                        </button>
                                                        <button
                                                            className="px-3 py-1.5 text-xs font-semibold rounded-md bg-red-600 text-white hover:bg-red-700 transition-colors shadow-sm disabled:opacity-60"
                                                            onClick={() => void confirmDeleteRecording()}
                                                            disabled={isDeletingRecording}
                                                        >
                                                            {isDeletingRecording ? 'Deleting...' : 'Delete'}
                                                        </button>
                                                    </div>
                                                </div>
                                            </div>
                                        ) : null}

                                        {recordingToSyncToCloud ? (
                                            <div
                                                className="fixed inset-0 z-50 flex items-center justify-center bg-stone-900/40 backdrop-blur-sm p-6"
                                                onClick={() => setRecordingToSyncToCloud(null)}
                                            >
                                                <div
                                                    className="w-full max-w-sm rounded-xl border es-global-outline es-general-background shadow-xl p-4"
                                                    onClick={(event) => event.stopPropagation()}
                                                >
                                                    <div className="flex items-center justify-between mb-3">
                                                        <div className="flex items-center gap-2">
                                                            <Cloud size={18} className="text-sky-500" />
                                                            <h3 className="text-sm font-semibold es-general-text">Sync recording to cloud?</h3>
                                                        </div>
                                                        <HoverTooltip label="Close">
                                                            <button
                                                                className="p-1 rounded-md text-stone-400 hover:text-stone-600 es-general-item-hover transition-colors"
                                                                onClick={() => setRecordingToSyncToCloud(null)}
                                                            >
                                                                <X size={14} />
                                                            </button>
                                                        </HoverTooltip>
                                                    </div>
                                                    <p className="text-xs text-stone-600 leading-normal">
                                                        Are you sure you want to sync "{recordingToSyncToCloud.title || 'Untitled recording'}" to the cloud? This will back up the recording and make it accessible across all your devices.
                                                    </p>
                                                    <div className="mt-4 flex justify-end gap-2">
                                                        <button
                                                            className="px-3 py-1.5 text-xs font-semibold rounded-md border es-global-outline bg-transparent es-general-item-hover transition-colors shadow-sm"
                                                            onClick={() => setRecordingToSyncToCloud(null)}
                                                        >
                                                            Cancel
                                                        </button>
                                                        <button
                                                            className="px-3 py-1.5 text-xs font-semibold rounded-md bg-sky-600 text-white hover:bg-sky-700 transition-colors shadow-sm"
                                                            onClick={() => void confirmSyncRecordingToCloud()}
                                                        >
                                                            Sync to Cloud
                                                        </button>
                                                    </div>
                                                </div>
                                            </div>
                                        ) : null}

                                        {noteToSyncToCloud ? (
                                            <div
                                                className="fixed inset-0 z-50 flex items-center justify-center bg-stone-900/40 backdrop-blur-sm p-6"
                                                onClick={() => setNoteToSyncToCloud(null)}
                                            >
                                                <div
                                                    className="w-full max-w-sm rounded-xl border es-global-outline es-general-background shadow-xl p-4"
                                                    onClick={(event) => event.stopPropagation()}
                                                >
                                                    <div className="flex items-center justify-between mb-3">
                                                        <div className="flex items-center gap-2">
                                                            <Cloud size={18} className="text-sky-500" />
                                                            <h3 className="text-sm font-semibold es-general-text">Sync note to cloud?</h3>
                                                        </div>
                                                        <HoverTooltip label="Close">
                                                            <button
                                                                className="p-1 rounded-md text-stone-400 hover:text-stone-600 es-general-item-hover transition-colors"
                                                                onClick={() => setNoteToSyncToCloud(null)}
                                                            >
                                                                <X size={14} />
                                                            </button>
                                                        </HoverTooltip>
                                                    </div>
                                                    <p className="text-xs text-stone-600 leading-normal">
                                                        Are you sure you want to sync "{noteToSyncToCloud.title || 'Untitled note'}" to the cloud? This will back up the note and make it accessible across all your devices.
                                                    </p>
                                                    <div className="mt-4 flex justify-end gap-2">
                                                        <button
                                                            className="px-3 py-1.5 text-xs font-semibold rounded-md border es-global-outline bg-transparent es-general-item-hover transition-colors shadow-sm"
                                                            onClick={() => setNoteToSyncToCloud(null)}
                                                        >
                                                            Cancel
                                                        </button>
                                                        <button
                                                            className="px-3 py-1.5 text-xs font-semibold rounded-md bg-sky-600 text-white hover:bg-sky-700 transition-colors shadow-sm"
                                                            onClick={confirmSyncNoteToCloud}
                                                        >
                                                            Sync to Cloud
                                                        </button>
                                                    </div>
                                                </div>
                                            </div>
                                        ) : null}

                                        <div className="flex-1 min-h-0 flex flex-col overflow-auto px-8 py-4">
                                            <div className="mx-auto max-w-4xl w-full rounded-[28px] es-library-content-surface px-10 py-3 pb-6">
                                                <input
                                                    className="mb-4 w-full bg-transparent border-none p-0 text-4xl font-semibold tracking-tight text-stone-900 placeholder:text-stone-300 focus:outline-none focus:ring-0 leading-none"
                                                    value={selectedRecording.title || ''}
                                                    onChange={(event) => void updateRecordingTitle(event.target.value)}
                                                    placeholder="Untitled recording"
                                                />
                                                {recordingDetailTab === 'transcript' ? (
                                                    <textarea
                                                        ref={recordingTranscriptTextareaRef}
                                                        className="w-full min-h-[120px] bg-transparent px-0 text-sm leading-relaxed resize-none overflow-hidden focus:outline-none focus:ring-0 focus:border-transparent es-writing-text"
                                                        value={recordingTranscriptDraft}
                                                        onChange={(event) => {
                                                            const nextValue = event.target.value;
                                                            setRecordingTranscriptDraft(nextValue);
                                                            setRecordingDraftDirty(nextValue !== (selectedRecording.transcript || ''));

                                                            event.target.style.height = 'auto';
                                                            event.target.style.height = `${event.target.scrollHeight}px`;
                                                        }}
                                                        placeholder="Transcript will appear here after recording."
                                                        spellCheck={false}
                                                    />
                                                ) : (
                                                    <div className="flex flex-col">
                                                        <div className="mb-4 flex justify-start">
                                                            <button
                                                                className="es-general-item-hover border es-global-outline bg-transparent font-medium text-xs px-3 py-2 rounded-lg disabled:opacity-50 transition-colors inline-flex items-center gap-1.5 shadow-sm es-general-text"
                                                                onClick={generateRecordingSummary}
                                                                disabled={!hasTranscriptForSummary || isSavingRecordingDraft || isDeletingRecording || !!summarizingRecordingId}
                                                            >
                                                                <Sparkles size={14} />
                                                                {summarizingRecordingId === selectedRecording.id ? 'Summarizing...' : 'Summarize'}
                                                            </button>
                                                        </div>
                                                        <div className="flex-1 px-0 pt-0 pb-2 text-sm leading-relaxed overflow-auto">
                                                            {summarizingRecordingId === selectedRecording.id ? (
                                                                <RecordingSummaryAnimation streamingSummaryText={streamingSummaryText} />
                                                            ) : selectedRecording.summary ? (
                                                                <div className="es-md-prose es-writing-text max-w-none [&>*:first-child]:mt-0 [&>*:first-child]:pt-0">
                                                                    <ReactMarkdown remarkPlugins={[remarkGfm, remarkMath]} rehypePlugins={[rehypeKatex]} components={markdownComponents}>
                                                                        {selectedRecording.summary}
                                                                    </ReactMarkdown>
                                                                </div>
                                                            ) : (
                                                                <div className="min-h-[120px] flex items-center justify-center text-stone-400 italic">
                                                                    No summary yet. Click summarize above to generate one.
                                                                </div>
                                                            )}
                                                            {recordingReviewNotices
                                                                .filter((notice) => notice.recordingId === selectedRecording.id)
                                                                .map((notice) => (
                                                                    <div key={notice.id} className="mt-3 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2.5 text-xs text-amber-700 flex items-start justify-between gap-2">
                                                                        <span className="min-w-0 leading-relaxed">{notice.message}</span>
                                                                        <button
                                                                            className="shrink-0 inline-flex h-5 w-5 items-center justify-center rounded-md text-current hover:bg-black/10 transition-colors"
                                                                            onClick={() => {
                                                                                setRecordingReviewNotices((previous) => previous.filter((item) => item.id !== notice.id));
                                                                            }}
                                                                            aria-label="Dismiss transcript review warning"
                                                                        >
                                                                            <X size={12} strokeWidth={3} />
                                                                        </button>
                                                                    </div>
                                                                ))}
                                                        </div>
                                                    </div>
                                                )}
                                            </div>
                                        </div>
                                    </>
	                                ) : (
	                                    <div className="h-full flex flex-col items-center justify-center text-stone-400 text-center px-8">
	                                        <BookOpen size={64} className="text-stone-300 mb-6" />
	                                        <h3 className="font-medium text-stone-500 mb-1">Nothing is selected</h3>
	                                        <p className="text-sm">Select a note or recording from the sidebar, or create something new.</p>
	                                        <button
	                                            className="mt-5 px-3 py-2 rounded-lg border es-global-outline bg-transparent es-general-item-hover es-general-text text-xs font-semibold shadow-sm inline-flex items-center gap-1.5"
	                                            onClick={() => createNewLibraryNote()}
	                                        >
	                                            <FileText size={14} />
	                                            New note
	                                        </button>
	                                    </div>
	                                )}
                            </section>
                        </div>
                    ) : null}

                    </div>
                </main>
            </div >
            {isSettingsModalOpen ? (
                <div
                    className="fixed inset-0 z-[90] flex items-center justify-center p-3 sm:p-6"
                    onClick={() => setIsSettingsModalOpen(false)}
                >
                    <div className="absolute inset-0 bg-black/30 backdrop-blur-[1px]" />
                    <div
                        className="relative rounded-2xl border es-global-outline es-general-background shadow-2xl overflow-hidden flex flex-col es-settings-shell"
                        style={{
                            width: 'min(1520px, 97vw)',
                            height: '86vh',
                        }}
                        onClick={(event) => event.stopPropagation()}
                    >
                        <div className="shrink-0 h-12 px-4 border-b es-global-separator flex items-center justify-between gap-3">
                            <div className="min-w-0 inline-flex items-center gap-2">
                                <span className="text-sm font-semibold tracking-tight es-general-text">Settings</span>
                            </div>
                            <button
                                className="h-8 w-8 rounded-md inline-flex items-center justify-center es-general-item-hover es-general-text transition-colors shrink-0"
                                onClick={() => setIsSettingsModalOpen(false)}
                                aria-label="Close settings"
                                type="button"
                            >
                                <X size={14} />
                            </button>
                        </div>

                        <div className="min-h-0 flex-1 grid grid-cols-[220px_minmax(0,1fr)]">
                            <aside className="min-h-0 border-r es-global-separator overflow-y-auto es-settings-nav-pane es-sidebar-background">
                                <div className="flex min-h-full flex-col px-2 py-2">
                                    <div className="space-y-1">
                                        {settingsTabItems.filter((tab) => !tab.isolated).map((tab) => {
                                            const Icon = tab.icon;
                                            const selected = activeSettingsTab === tab.key;
                                            return (
                                                <button
                                                    key={`settings-tab-${tab.key}`}
                                                    className={`w-full rounded-xl px-3 py-2 text-left text-sm transition-colors flex items-center gap-2 ${selected ? 'es-sidebar-selected-item' : 'es-sidebar-item-hover es-sidebar-item-text'}`}
                                                    onClick={() => setActiveSettingsTab(tab.key)}
                                                >
                                                    <Icon size={15} />
                                                    <span className="truncate">{tab.label}</span>
                                                </button>
                                            );
                                        })}
                                    </div>
                                    <div className="mt-auto space-y-1 border-t es-global-separator pt-2">
                                        {settingsTabItems.filter((tab) => tab.isolated).map((tab) => {
                                            const Icon = tab.icon;
                                            const selected = activeSettingsTab === tab.key;
                                            return (
                                                <button
                                                    key={`settings-tab-${tab.key}`}
                                                    className={`w-full rounded-xl px-3 py-2 text-left text-sm transition-colors flex items-center gap-2 ${selected ? 'es-sidebar-selected-item' : 'es-sidebar-item-hover es-sidebar-item-text'}`}
                                                    onClick={() => setActiveSettingsTab(tab.key)}
                                                >
                                                    <Icon size={15} />
                                                    <span className="truncate">{tab.label}</span>
                                                </button>
                                            );
                                        })}
                                    </div>
                                </div>
                            </aside>

                            <section className="min-w-0 min-h-0 flex flex-col es-settings-content-pane">
                                <div className="min-h-0 flex-1 overflow-y-auto">
                                    {activeSettingsTab === 'dictation' ? (
                                        <SettingsDictationPage
                                            settings={settings}
                                            authState={authState}
                                            updateSettings={updateSettings}
                                        />
                                    ) : activeSettingsTab === 'quickNotes' ? (
                                        <SettingsQuickNotesPage
                                            settings={settings}
                                            updateSettings={updateSettings}
                                        />
                                    ) : activeSettingsTab === 'recordings' ? (
                                        <SettingsRecordingsPage
                                            settings={settings}
                                            authState={authState}
                                            proModelOptions={effectiveProModelOptions}
                                            updateSettings={updateSettings}
                                        />
                                    ) : activeSettingsTab === 'chats' ? (
                                        <SettingsChatsPage
                                            settings={settings}
                                            authState={authState}
                                            proModelOptions={effectiveProModelOptions}
                                            updateSettings={updateSettings}
                                        />
                                    ) : activeSettingsTab === 'general' ? (
                                        <SettingsGeneralPage
                                            settings={settings}
                                            updateSettings={updateSettings}
                                            onReplayProductTour={replayProductTour}
                                        />
                                    ) : activeSettingsTab === 'account' ? (
                                        <SettingsAccountPage
                                            settings={settings}
                                            authState={authState}
                                            modeLabel={modeLabel}
                                            proKeyStatus={proKeyStatus}
                                            updateSettings={updateSettings}
                                            fetchTempProKey={fetchTempProKey}
                                            logout={logout}
                                        />
                                    ) : activeSettingsTab === 'storageSync' ? (
                                        <SettingsStorageSyncPage
                                            settings={settings}
                                            authState={authState}
                                            updateSettings={updateSettings}
                                        />
                                    ) : activeSettingsTab === 'shortcuts' ? (
                                        <SettingsShortcutsPage
                                            settings={settings}
                                            shortcutsRuntime={shortcutsRuntime}
                                            isRuntimeLoading={isShortcutsRuntimeLoading}
                                            updateSettings={updateSettings}
                                            refreshRuntime={refreshShortcutsRuntime}
                                        />
                                    ) : (
                                        <SettingsAIEnginePage
                                            settings={settings}
                                            authState={authState}
                                            proModelOptions={effectiveProModelOptions}
                                            keyDrafts={keyDrafts}
                                            setKeyDrafts={setKeyDrafts}
                                            isSavingKeys={isSavingKeys}
                                            saveApiKeys={saveApiKeys}
                                            clearSavedApiKeys={clearSavedApiKeys}
                                            apiKeySaveMessage={apiKeySaveMessage}
                                            updateSettings={updateSettings}
                                            sttPlan={sttPlan}
                                            llmPlan={llmPlan}
                                        />
                                    )}
                                </div>
                            </section>
                        </div>
                    </div>
                </div>
            ) : null}
            {renderRecordingNoticeStack()}
            {renderSyncToastStack()}
            <ProductTour
                isOpen={isProductTourOpen}
                steps={productTourSteps}
                theme={settings.theme}
                onStepEnter={handleProductTourStepEnter}
                onClose={closeProductTour}
            />
        </div >
    );
}
