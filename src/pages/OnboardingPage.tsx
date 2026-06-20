import React, { useState, useEffect } from 'react';
import { 
    Mic, 
    Accessibility, 
    CheckCircle2, 
    ChevronRight, 
    ChevronLeft, 
    Monitor,
    Check,
    Cloud,
    Lock,
    Volume2,
    HelpCircle
} from 'lucide-react';
import type { UiSettings, AuthState, Note, RecordingItem, RecordModeStatus } from '../types';
import OnboardingTutorial from './OnboardingTutorial';

const { ipcRenderer } = window.require('electron');
const COMPLETED_PRODUCT_TOUR_VERSION = 1;
const PERMISSION_ILLUSTRATION_BASE_URL = `${process.env.PUBLIC_URL || ''}/onboarding-permissions`;

export interface OnboardingPageProps {
    settings: UiSettings;
    updateSettings: (patch: Record<string, any>) => Promise<void>;
    onComplete: () => void;
    authState: AuthState;
    notes: Note[];
    recordings: RecordingItem[];
    recordModeStatus: RecordModeStatus;
}

type OnboardingStep = 'welcome' | 'permissions' | 'account' | 'tutorial';
type PermissionSubStep = 'mic' | 'accessibility' | 'screen' | 'keychain' | 'meetings';

export default function OnboardingPage({
    settings,
    updateSettings,
    onComplete,
    authState,
    notes,
    recordings,
    recordModeStatus,
}: OnboardingPageProps) {
    const [step, setStep] = useState<OnboardingStep>('welcome');
    const [activeSubStep, setActiveSubStep] = useState<PermissionSubStep>('mic');

    // Account step state
    const [accountChoice, setAccountChoice] = useState<'login' | 'local' | null>(null);
    const [localAuthState, setLocalAuthState] = useState<AuthState>(authState);

    // Permission states
    const [micStatus, setMicStatus] = useState<'unknown' | 'granted' | 'denied' | 'not-determined'>('unknown');
    const [micLoading, setMicLoading] = useState(false);
    
    const [accessibilityStatus, setAccessibilityStatus] = useState<'unknown' | 'granted' | 'denied'>('unknown');
    const [accessibilityLoading, setAccessibilityLoading] = useState(false);

    const [screenStatus, setScreenStatus] = useState<'unknown' | 'granted' | 'denied' | 'not-determined'>('unknown');
    const [screenLoading, setScreenLoading] = useState(false);

    const [enableMeetings, setEnableMeetings] = useState(false);
    const [meetingsStatus, setMeetingsStatus] = useState<'unknown' | 'granted' | 'denied'>('unknown');
    const [meetingsLoading, setMeetingsLoading] = useState(false);

    const [keychainStatus, setKeychainStatus] = useState<'unknown' | 'primed' | 'denied'>('unknown');
    const [keychainLoading, setKeychainLoading] = useState(false);

    // General submission state
    const [isSubmitting, setIsSubmitting] = useState(false);

    // Listen for auth state updates (when user logs in from browser)
    useEffect(() => {
        const handleAuthStateUpdate = (_event: any, latest: AuthState) => {
            setLocalAuthState(prev => ({ ...prev, ...(latest || {}) }));
            if (latest?.isLoggedIn) {
                setAccountChoice('login');
            }
        };
        ipcRenderer.on('auth-state-updated', handleAuthStateUpdate);
        return () => {
            ipcRenderer.removeListener('auth-state-updated', handleAuthStateUpdate);
        };
    }, []);

    // Polling effect for permissions check
    useEffect(() => {
        let timer: NodeJS.Timeout;
        
        const checkPermissions = async () => {
            // Check Microphone status
            try {
                const result = await ipcRenderer.invoke('microphone:get-access-status');
                const status = String(result?.status || 'unknown').toLowerCase();
                if (status === 'granted') setMicStatus('granted');
                else if (status === 'denied' || status === 'restricted') setMicStatus('denied');
                else if (status === 'not-determined') setMicStatus('not-determined');
                else setMicStatus('unknown');
            } catch (e) {
                console.error('Failed checking mic permission:', e);
            }

            // Check Accessibility status
            try {
                const result = await ipcRenderer.invoke('accessibility:get-access-status');
                const status = String(result?.status || 'unknown').toLowerCase();
                if (status === 'granted') setAccessibilityStatus('granted');
                else if (status === 'denied') setAccessibilityStatus('denied');
                else setAccessibilityStatus('unknown');
            } catch (e) {
                console.error('Failed checking accessibility permission:', e);
            }

            // Check Screen Recording status
            try {
                const result = await ipcRenderer.invoke('screen:get-access-status');
                const status = String(result?.status || 'unknown').toLowerCase();
                if (status === 'granted') setScreenStatus('granted');
                else if (status === 'denied' || status === 'restricted') setScreenStatus('denied');
                else if (status === 'not-determined') setScreenStatus('not-determined');
                else setScreenStatus('unknown');
            } catch (e) {
                console.error('Failed checking screen recording permission:', e);
            }

            // Check Keychain secure storage status
            try {
                const result = await ipcRenderer.invoke('byok:get-secure-storage-status');
                if (result?.status === 'success' && result?.secureStoragePrimed === true) {
                    setKeychainStatus('primed');
                } else if (result?.secureStorageAvailable === false) {
                    setKeychainStatus('denied');
                }
            } catch (e) {
                console.error('Failed checking keychain permission:', e);
            }

            // Check Meeting Prompt status
            try {
                const result = await ipcRenderer.invoke('meeting-prompt:request-permissions');
                if (result?.status === 'success' || result?.canEnable === true) {
                    setMeetingsStatus('granted');
                } else {
                    setMeetingsStatus('denied');
                }
            } catch (e) {
                console.error('Failed checking meeting permissions:', e);
            }
        };

        checkPermissions();

        if (step === 'permissions') {
            timer = setInterval(checkPermissions, 1000);
        }

        return () => {
            if (timer) clearInterval(timer);
        };
    }, [step]);

    // Auto-advance sub-steps as they get completed
    useEffect(() => {
        if (step === 'permissions') {
            if (micStatus === 'granted' && activeSubStep === 'mic') {
                setActiveSubStep('accessibility');
            } else if (micStatus === 'granted' && accessibilityStatus === 'granted' && activeSubStep === 'accessibility') {
                setActiveSubStep('screen');
            } else if (micStatus === 'granted' && accessibilityStatus === 'granted' && screenStatus === 'granted' && activeSubStep === 'screen') {
                setActiveSubStep('keychain');
            } else if (micStatus === 'granted' && accessibilityStatus === 'granted' && screenStatus === 'granted' && keychainStatus === 'primed' && activeSubStep === 'keychain') {
                setActiveSubStep('meetings');
            }
        }
    }, [step, micStatus, accessibilityStatus, screenStatus, keychainStatus, activeSubStep]);

    // Request mic access
    const requestMicAccess = async () => {
        setMicLoading(true);
        try {
            // Invoke main process native request directly to avoid Chromium audio device hangs
            const result = await ipcRenderer.invoke('microphone:request-access');
            const status = String(result?.status || 'unknown').toLowerCase();
            if (status === 'granted' || result?.granted === true) {
                setMicStatus('granted');
            } else {
                setMicStatus('denied');
                // Open macOS System Preferences immediately if blocked
                await ipcRenderer.invoke('microphone:open-settings');
            }
        } catch (error) {
            console.error('Failed to request mic access via IPC:', error);
            setMicStatus('denied');
            await ipcRenderer.invoke('microphone:open-settings');
        } finally {
            setMicLoading(false);
        }
    };

    // Request Accessibility permission
    const requestAccessibilityAccess = async () => {
        setAccessibilityLoading(true);
        try {
            await ipcRenderer.invoke('accessibility:request-access');
            await ipcRenderer.invoke('accessibility:open-settings');
        } catch (error) {
            console.error('Failed to request accessibility access:', error);
            setAccessibilityStatus('denied');
            await ipcRenderer.invoke('accessibility:open-settings');
        } finally {
            setAccessibilityLoading(false);
        }
    };

    // Request Screen Recording permission
    const requestScreenAccess = async () => {
        setScreenLoading(true);
        try {
            const result = await ipcRenderer.invoke('screen:request-access');
            const status = String(result?.status || 'unknown').toLowerCase();
            if (status === 'granted') {
                setScreenStatus('granted');
            } else {
                setScreenStatus('denied');
                await ipcRenderer.invoke('screen:open-settings');
            }
        } catch (error) {
            console.error('Failed to request screen recording access:', error);
            setScreenStatus('denied');
            await ipcRenderer.invoke('screen:open-settings');
        } finally {
            setScreenLoading(false);
        }
    };

    // Request Meeting prompt (Automation) permissions
    const requestMeetingsAccess = async () => {
        setMeetingsLoading(true);
        try {
            const result = await ipcRenderer.invoke('meeting-prompt:request-permissions');
            if (result?.status === 'success' || result?.canEnable === true) {
                setMeetingsStatus('granted');
                setEnableMeetings(true);
            } else {
                setMeetingsStatus('denied');
                setEnableMeetings(false);
                await ipcRenderer.invoke('meeting-prompt:open-permission-settings');
            }
        } catch (error) {
            console.error('Failed to request meeting permissions:', error);
            setMeetingsStatus('denied');
            setEnableMeetings(false);
            await ipcRenderer.invoke('meeting-prompt:open-permission-settings');
        } finally {
            setMeetingsLoading(false);
        }
    };

    // Authentication helpers
    const openBrowserAuth = () => {
        try {
            ipcRenderer.send('open-login-flow');
        } catch (error: any) {
            console.error('Failed to open browser auth:', error);
        }
    };

    const buildSetupSettingsPatch = () => {
        const finalShortcuts = {
            dictationHoldPreset: 'fn_hold',
            dictationHandsFreePreset: 'fn_space_toggle',
            quickNotePreset: 'ctrl_n',
            recordModePreset: 'ctrl_r',
        };

        const finalMode = localAuthState.isLoggedIn ? 'pro' : 'local';

        return {
            mode: finalMode,
            shortcuts: finalShortcuts,
            meetingPromptEnabled: enableMeetings,
            meetingPromptConsentGranted: enableMeetings,
        };
    };

    // Save setup choices before the hands-on tutorial so shortcuts are active.
    const saveSetupAndStartTutorial = async () => {
        setIsSubmitting(true);
        try {
            await updateSettings({
                ...buildSetupSettingsPatch(),
                onboardingCompleted: false,
            });
            setStep('tutorial');
        } catch (error) {
            console.error('Failed to save onboarding settings:', error);
        } finally {
            setIsSubmitting(false);
        }
    };

    const finishOnboarding = async () => {
        setIsSubmitting(true);
        try {
            await updateSettings({
                onboardingCompleted: true,
                productTourVersionSeen: COMPLETED_PRODUCT_TOUR_VERSION,
            });
            onComplete();
        } catch (error) {
            console.error('Failed to save onboarding settings:', error);
        } finally {
            setIsSubmitting(false);
        }
    };

    // Calculate progress percentage
    const stepProgress = {
        welcome: '25%',
        permissions: '50%',
        account: '75%',
        tutorial: '100%'
    }[step];

    // Helper to determine the active permission illustration on the right panel
    const renderActiveIllustration = () => {
        if (activeSubStep === 'mic') {
            return (
                <PermissionIllustrationImage
                    src={`${PERMISSION_ILLUSTRATION_BASE_URL}/1.png`}
                    alt="Microphone access"
                    fallback={<MicrophoneSVG status={micStatus} />}
                />
            );
        }
        if (activeSubStep === 'accessibility') {
            return (
                <PermissionIllustrationImage
                    src={`${PERMISSION_ILLUSTRATION_BASE_URL}/2.png`}
                    alt="Shortcuts and pasting access"
                    fallback={<ShortcutsSVG status={accessibilityStatus} />}
                />
            );
        }
        if (activeSubStep === 'screen') {
            return (
                <PermissionIllustrationImage
                    src={`${PERMISSION_ILLUSTRATION_BASE_URL}/3.png`}
                    alt="System audio recording access"
                    fallback={<SystemAudioSVG status={screenStatus} />}
                />
            );
        }
        if (activeSubStep === 'keychain') {
            return (
                <PermissionIllustrationImage
                    src={`${PERMISSION_ILLUSTRATION_BASE_URL}/4.png`}
                    alt="Secure keychain storage"
                    fallback={<KeychainSVG status={keychainStatus} />}
                />
            );
        }
        return (
            <PermissionIllustrationImage
                src={`${PERMISSION_ILLUSTRATION_BASE_URL}/5.png`}
                alt="Meeting detection"
                fallback={<MeetingsSVG enabled={enableMeetings} />}
            />
        );
    };

    return (
        <div className="h-full w-full flex flex-col es-general-background overflow-hidden relative">
            <style>{`
                @keyframes esFloat {
                    0%, 100% { transform: translateY(0px); }
                    50% { transform: translateY(-8px); }
                }
                .animate-float {
                    animation: esFloat 3s ease-in-out infinite;
                }
                @keyframes esPulseGlow {
                    0%, 100% { opacity: 0.15; }
                    50% { opacity: 0.35; }
                }
                .animate-pulse-glow {
                    animation: esPulseGlow 2.5s infinite ease-in-out;
                }
            `}</style>

            {/* Topbar Navigation */}
            <div className="h-10 border-b es-global-separator flex items-center justify-between px-6 bg-[#ece9e6]/20 dark:bg-[#181818]/40 draggable select-none shrink-0 z-10">
                {/* Traffic lights spacer */}
                <div className="w-20 shrink-0" />

                {/* Steps indicator */}
                <div className="flex items-center gap-1.5 md:gap-3 text-[10px] md:text-xs font-bold tracking-wider uppercase no-drag">
                    <StepIndicator label="Welcome" active={step === 'welcome'} completed={step !== 'welcome'} />
                    <ChevronRight size={10} className="text-stone-400" />
                    <StepIndicator label="Permissions" active={step === 'permissions'} completed={step === 'account' || step === 'tutorial'} />
                    <ChevronRight size={10} className="text-stone-400" />
                    <StepIndicator label="Account" active={step === 'account'} completed={step === 'tutorial'} />
                    <ChevronRight size={10} className="text-stone-400" />
                    <StepIndicator label="Tutorial" active={step === 'tutorial'} completed={false} />
                </div>

                {/* Right spacer (balance) */}
                <div className="w-20 shrink-0" />
            </div>

            {/* Progress line indicator */}
            <div className="h-[2px] w-full bg-stone-500/10 shrink-0 relative">
                <div 
                    className="absolute top-0 left-0 h-full bg-gradient-to-r from-violet-500 to-emerald-500 transition-all duration-500 ease-out" 
                    style={{ width: stepProgress }}
                />
            </div>

            {/* Content Layout */}
            {step === 'tutorial' ? (
                <OnboardingTutorial
                    notes={notes}
                    recordings={recordings}
                    recordModeStatus={recordModeStatus}
                    onBack={() => setStep('account')}
                    onComplete={() => void finishOnboarding()}
                />
            ) : (step === 'welcome' || step === 'account') ? (
                /* Welcome & Account: Centered single-panel layout */
                <div className="flex-1 flex items-center justify-center overflow-y-auto p-8">
                    <div className="w-full max-w-lg">
                        {/* Welcome Step */}
                        {step === 'welcome' && (
                            <div className="flex flex-col items-center text-center space-y-8">
                                <div className="space-y-3">
                                    <h1 className="text-2xl md:text-3xl font-extrabold es-general-text tracking-tight">
                                        Welcome to Escribolt
                                    </h1>
                                    <p className="text-xs md:text-sm es-general-secondary-text leading-relaxed max-w-md mx-auto">
                                        Escribolt turns your voice into structured writing instantly. Dictate notes, capture meetings, and write faster — all from your Mac.
                                    </p>
                                </div>

                                <div className="space-y-2 w-full">
                                    <button
                                        type="button"
                                        onClick={() => setStep('permissions')}
                                        className="w-full px-5 py-2.5 text-xs font-bold rounded-lg bg-emerald-500 hover:bg-emerald-600 text-white flex items-center justify-center gap-1.5 shadow"
                                    >
                                        Get Started <ChevronRight size={14} />
                                    </button>
                                </div>

                                <a
                                    href="https://docs.escribolt.com/getting-started/overview/"
                                    target="_blank"
                                    rel="noopener noreferrer"
                                    className="flex items-center gap-1.5 text-[11px] es-general-secondary-text hover:text-emerald-500 transition-colors"
                                >
                                    <HelpCircle size={13} />
                                    <span>Need help? Read the docs</span>
                                </a>
                            </div>
                        )}

                        {/* Account Step */}
                        {step === 'account' && (
                            <div className="flex flex-col items-center text-center space-y-8">
                                <div className="space-y-3">
                                    <h2 className="text-2xl md:text-3xl font-extrabold es-general-text tracking-tight">
                                        Get Started with Escribolt
                                    </h2>
                                    <p className="text-xs md:text-sm es-general-secondary-text leading-relaxed max-w-md mx-auto">
                                        Sign in to unlock the free trial with cloud-powered dictation, or continue locally with full privacy.
                                    </p>
                                </div>

                                <div className="space-y-3 w-full text-left">
                                    {/* Login for Free Trial */}
                                    <div
                                        onClick={() => setAccountChoice('login')}
                                        className={`p-4 rounded-xl border cursor-pointer transition-all ${
                                            accountChoice === 'login'
                                                ? 'border-emerald-500 bg-emerald-500/5 shadow-md'
                                                : 'es-global-outline hover:bg-stone-500/5'
                                        }`}
                                    >
                                        <div className="flex items-center justify-between mb-1">
                                            <div className="flex items-center gap-2">
                                                <Cloud className="text-emerald-500" size={16} />
                                                <span className="font-semibold text-xs md:text-sm es-general-text">Log In for Free Trial</span>
                                            </div>
                                            {accountChoice === 'login' && <div className="h-4 w-4 rounded-full bg-emerald-500 flex items-center justify-center"><Check size={10} className="text-white" /></div>}
                                        </div>
                                        <p className="text-[11px] es-general-secondary-text leading-snug">
                                            Ultra-fast streaming dictation with advanced AI formatting. No credit card required.
                                        </p>
                                    </div>

                                    {/* Continue Local / BYOK */}
                                    <div
                                        onClick={() => setAccountChoice('local')}
                                        className={`p-4 rounded-xl border cursor-pointer transition-all ${
                                            accountChoice === 'local'
                                                ? 'border-emerald-500 bg-emerald-500/5 shadow-md'
                                                : 'es-global-outline hover:bg-stone-500/5'
                                        }`}
                                    >
                                        <div className="flex items-center justify-between mb-1">
                                            <div className="flex items-center gap-2">
                                                <Lock className="text-violet-500" size={16} />
                                                <span className="font-semibold text-xs md:text-sm es-general-text">Continue Local / BYOK</span>
                                            </div>
                                            {accountChoice === 'local' && <div className="h-4 w-4 rounded-full bg-emerald-500 flex items-center justify-center"><Check size={10} className="text-white" /></div>}
                                        </div>
                                        <p className="text-[11px] es-general-secondary-text leading-snug">
                                            Fully offline with local Whisper models, or bring your own API keys. 100% private.
                                        </p>
                                    </div>

                                    {/* Sign In action when login is selected */}
                                    {accountChoice === 'login' && !localAuthState.isLoggedIn && (
                                        <div className="p-4 rounded-xl border es-global-outline bg-stone-500/5 flex items-center justify-between gap-4">
                                            <div className="min-w-0 flex-1">
                                                <div className="text-xs font-bold es-general-text">Escribolt Server Auth</div>
                                                <p className="text-[11px] es-general-secondary-text mt-0.5">Authorize via browser. No passwords needed.</p>
                                            </div>
                                            <button
                                                type="button"
                                                onClick={(e) => {
                                                    e.stopPropagation();
                                                    openBrowserAuth();
                                                }}
                                                className="px-3 py-1.5 text-xs font-semibold rounded-lg bg-emerald-500 hover:bg-emerald-600 text-white shadow"
                                            >
                                                Sign In
                                            </button>
                                        </div>
                                    )}

                                    {/* Logged in confirmation */}
                                    {localAuthState.isLoggedIn && (
                                        <div className="p-3 rounded-xl border border-emerald-500/20 bg-emerald-500/5 text-[11px] text-emerald-400 font-semibold flex items-center gap-2 justify-center">
                                            <CheckCircle2 size={14} />
                                            Signed in as {localAuthState.email || localAuthState.displayName || 'your account'}
                                        </div>
                                    )}
                                </div>

                                <div className="flex items-center gap-3 pt-2">
                                    <button
                                        type="button"
                                        disabled={isSubmitting}
                                        onClick={() => void saveSetupAndStartTutorial()}
                                        className="px-5 py-2 text-xs font-bold rounded-lg bg-emerald-500 hover:bg-emerald-600 text-white flex items-center gap-1.5 shadow disabled:opacity-50"
                                    >
                                        {isSubmitting ? 'Preparing...' : 'Continue to Tutorial'} <ChevronRight size={14} />
                                    </button>
                                    <button
                                        type="button"
                                        disabled={isSubmitting}
                                        onClick={() => void saveSetupAndStartTutorial()}
                                        className="px-4 py-2 text-xs font-semibold rounded-lg border es-global-outline es-general-text hover:bg-stone-500/5 disabled:opacity-50"
                                    >
                                        Skip Sign In
                                    </button>
                                </div>
                            </div>
                        )}
                    </div>
                </div>
            ) : (
                <div className="flex-1 flex flex-row overflow-hidden">
                    {/* Left Panel: Configuration Form */}
                    <div className="w-[45%] flex flex-col justify-between p-8 md:p-12 overflow-y-auto border-r es-global-separator es-general-background z-0">
                        
                        {/* Permissions step (containing sequence of all permissions) */}
                        {step === 'permissions' && (
                            <div className="flex-1 flex flex-col justify-between">
                                <div className="space-y-6">
                                    <div>
                                        <h2 className="text-2xl md:text-3xl font-extrabold es-general-text tracking-tight">
                                            Application Permissions
                                        </h2>
                                        <p className="text-xs md:text-sm es-general-secondary-text mt-2 leading-relaxed">
                                            Please configure application permissions to enable Escribolt's voice capabilities on your Mac.
                                        </p>
                                    </div>

                                    {/* Permissions stack */}
                                    <div className="space-y-4">
                                        
                                        {/* 1. Microphone Access (Mandatory) */}
                                        <div 
                                            onClick={() => {
                                                // Allow manually selecting if it's already active or completed
                                                setActiveSubStep('mic');
                                            }}
                                            className={`p-4 rounded-xl border transition-all cursor-pointer ${
                                                activeSubStep === 'mic' 
                                                    ? 'border-emerald-500 bg-emerald-500/5 shadow-sm' 
                                                    : 'es-global-outline'
                                            }`}
                                        >
                                            <div className="flex items-center justify-between">
                                                <div className="flex items-center gap-3">
                                                    <div className={`h-8 w-8 rounded-full flex items-center justify-center shrink-0 ${
                                                        micStatus === 'granted' ? 'bg-emerald-500/10 text-emerald-400' : 'bg-stone-500/10 text-stone-500'
                                                    }`}>
                                                        {micStatus === 'granted' ? <Check size={14} strokeWidth={3} /> : <Mic size={14} />}
                                                    </div>
                                                    <div>
                                                        <div className="text-xs font-bold es-general-text">1. Microphone Access</div>
                                                        <div className="text-[10px] es-general-secondary-text">Required to record dictations</div>
                                                    </div>
                                                </div>
                                                {micStatus === 'granted' ? (
                                                    <span className="text-[10px] text-emerald-400 font-bold uppercase">Allowed</span>
                                                ) : (
                                                    <span className="text-[10px] text-rose-400 font-bold uppercase">Required</span>
                                                )}
                                            </div>

                                            {activeSubStep === 'mic' && micStatus !== 'granted' && (
                                                <div className="mt-3 pt-3 border-t es-global-separator space-y-2.5">
                                                    <p className="text-[11px] es-general-secondary-text leading-snug">
                                                        {micStatus === 'denied' 
                                                            ? "macOS blocked microphone access. Click 'Open System Settings' and allow Escribolt."
                                                            : "Escribolt needs access to your mic to record and transcribe audio."}
                                                    </p>
                                                    <div className="flex gap-2">
                                                        {micStatus === 'denied' ? (
                                                            <button
                                                                type="button"
                                                                onClick={(e) => {
                                                                    e.stopPropagation();
                                                                    ipcRenderer.invoke('microphone:open-settings');
                                                                }}
                                                                className="px-3 py-1.5 text-xs font-bold rounded-lg bg-emerald-500 hover:bg-emerald-600 text-white shadow"
                                                            >
                                                                Open System Settings
                                                            </button>
                                                        ) : (
                                                            <button
                                                                type="button"
                                                                disabled={micLoading}
                                                                onClick={(e) => {
                                                                    e.stopPropagation();
                                                                    requestMicAccess();
                                                                }}
                                                                className="px-3 py-1.5 text-xs font-bold rounded-lg bg-emerald-500 hover:bg-emerald-600 text-white shadow"
                                                            >
                                                                {micLoading ? 'Requesting...' : 'Allow'}
                                                            </button>
                                                        )}
                                                    </div>
                                                </div>
                                            )}
                                        </div>

                                        {/* 2. Accessibility / Pasting (Mandatory) */}
                                        <div 
                                            onClick={() => {
                                                if (micStatus === 'granted') {
                                                    setActiveSubStep('accessibility');
                                                }
                                            }}
                                            className={`p-4 rounded-xl border transition-all ${
                                                micStatus !== 'granted' ? 'opacity-40 pointer-events-none' : 'cursor-pointer'
                                            } ${
                                                activeSubStep === 'accessibility' 
                                                    ? 'border-emerald-500 bg-emerald-500/5 shadow-sm' 
                                                    : 'es-global-outline'
                                            }`}
                                        >
                                            <div className="flex items-center justify-between">
                                                <div className="flex items-center gap-3">
                                                    <div className={`h-8 w-8 rounded-full flex items-center justify-center shrink-0 ${
                                                        accessibilityStatus === 'granted' ? 'bg-emerald-500/10 text-emerald-400' : 'bg-stone-500/10 text-stone-500'
                                                    }`}>
                                                        {accessibilityStatus === 'granted' ? <Check size={14} strokeWidth={3} /> : <Accessibility size={14} />}
                                                    </div>
                                                    <div>
                                                        <div className="text-xs font-bold es-general-text">2. Shortcuts & Pasting (Accessibility)</div>
                                                        <div className="text-[10px] es-general-secondary-text">Required to paste dictations using Fn Key</div>
                                                    </div>
                                                </div>
                                                {accessibilityStatus === 'granted' ? (
                                                    <span className="text-[10px] text-emerald-400 font-bold uppercase">Allowed</span>
                                                ) : (
                                                    <span className="text-[10px] text-rose-400 font-bold uppercase">Required</span>
                                                )}
                                            </div>

                                            {activeSubStep === 'accessibility' && accessibilityStatus !== 'granted' && (
                                                <div className="mt-3 pt-3 border-t es-global-separator space-y-2.5">
                                                    <p className="text-[11px] es-general-secondary-text leading-snug">
                                                        Allows Escribolt to type-paste text and listen to the global <strong>Fn / Globe key</strong> in the background.
                                                    </p>
                                                    <button
                                                        type="button"
                                                        disabled={accessibilityLoading}
                                                        onClick={(e) => {
                                                             e.stopPropagation();
                                                             requestAccessibilityAccess();
                                                         }}
                                                        className="px-3 py-1.5 text-xs font-bold rounded-lg bg-emerald-500 hover:bg-emerald-600 text-white shadow"
                                                    >
                                                        {accessibilityLoading ? 'Triggering Settings...' : 'Allow'}
                                                    </button>
                                                </div>
                                            )}
                                        </div>

                                        {/* 3. System Audio Recording (Mandatory) */}
                                        <div 
                                            onClick={() => {
                                                if (micStatus === 'granted' && accessibilityStatus === 'granted') {
                                                    setActiveSubStep('screen');
                                                }
                                            }}
                                            className={`p-4 rounded-xl border transition-all ${
                                                (micStatus !== 'granted' || accessibilityStatus !== 'granted') ? 'opacity-40 pointer-events-none' : 'cursor-pointer'
                                            } ${
                                                activeSubStep === 'screen' 
                                                    ? 'border-emerald-500 bg-emerald-500/5 shadow-sm' 
                                                    : 'es-global-outline'
                                            }`}
                                        >
                                            <div className="flex items-center justify-between">
                                                <div className="flex items-center gap-3">
                                                    <div className={`h-8 w-8 rounded-full flex items-center justify-center shrink-0 ${
                                                        screenStatus === 'granted' ? 'bg-emerald-500/10 text-emerald-400' : 'bg-stone-500/10 text-stone-500'
                                                    }`}>
                                                        {screenStatus === 'granted' ? <Check size={14} strokeWidth={3} /> : <Volume2 size={14} />}
                                                    </div>
                                                    <div>
                                                        <div className="text-xs font-bold es-general-text">3. System Audio Recording</div>
                                                        <div className="text-[10px] es-general-secondary-text">Required to capture meeting audio</div>
                                                    </div>
                                                </div>
                                                {screenStatus === 'granted' ? (
                                                    <span className="text-[10px] text-emerald-400 font-bold uppercase">Allowed</span>
                                                ) : (
                                                    <span className="text-[10px] text-rose-400 font-bold uppercase">Required</span>
                                                )}
                                            </div>

                                            {activeSubStep === 'screen' && screenStatus !== 'granted' && (
                                                <div className="mt-3 pt-3 border-t es-global-separator space-y-2.5">
                                                    <p className="text-[11px] es-general-secondary-text leading-snug">
                                                        Escribolt needs to capture <strong>system audio only</strong> to record meeting sound from apps like Google Meet, Zoom, and Teams. <strong>No video or screen content is recorded or transmitted.</strong>
                                                    </p>
                                                    <p className="text-[10px] es-general-secondary-text leading-snug italic">
                                                        Note: macOS may show a warning about "bypassing the system private window picker" — this is required to directly capture audio without manual window selection each time.
                                                    </p>
                                                    <div className="flex gap-2">
                                                        {screenStatus === 'denied' ? (
                                                            <button
                                                                type="button"
                                                                onClick={(e) => {
                                                                    e.stopPropagation();
                                                                    ipcRenderer.invoke('screen:open-settings');
                                                                }}
                                                                className="px-3 py-1.5 text-xs font-bold rounded-lg bg-emerald-500 hover:bg-emerald-600 text-white shadow"
                                                            >
                                                                Open System Settings
                                                            </button>
                                                        ) : (
                                                            <button
                                                                type="button"
                                                                disabled={screenLoading}
                                                                onClick={(e) => {
                                                                    e.stopPropagation();
                                                                    requestScreenAccess();
                                                                }}
                                                                className="px-3 py-1.5 text-xs font-bold rounded-lg bg-emerald-500 hover:bg-emerald-600 text-white shadow"
                                                            >
                                                                {screenLoading ? 'Requesting...' : 'Allow'}
                                                            </button>
                                                        )}
                                                    </div>
                                                </div>
                                            )}
                                        </div>

                                        {/* 4. Secure Keychain Storage (Required) */}
                                        <div 
                                            onClick={() => {
                                                if (micStatus === 'granted' && accessibilityStatus === 'granted' && screenStatus === 'granted') {
                                                    setActiveSubStep('keychain');
                                                }
                                            }}
                                            className={`p-4 rounded-xl border transition-all ${
                                                (micStatus !== 'granted' || accessibilityStatus !== 'granted' || screenStatus !== 'granted') ? 'opacity-40 pointer-events-none' : 'cursor-pointer'
                                            } ${
                                                activeSubStep === 'keychain' 
                                                    ? 'border-emerald-500 bg-emerald-500/5 shadow-sm' 
                                                    : 'es-global-outline'
                                            }`}
                                        >
                                            <div className="flex items-center justify-between">
                                                <div className="flex items-center gap-3">
                                                    <div className={`h-8 w-8 rounded-full flex items-center justify-center shrink-0 ${
                                                        keychainStatus === 'primed' ? 'bg-emerald-500/10 text-emerald-400' : 'bg-stone-500/10 text-stone-500'
                                                    }`}>
                                                        {keychainStatus === 'primed' ? <Check size={14} strokeWidth={3} /> : <Lock size={14} />}
                                                    </div>
                                                    <div>
                                                        <div className="text-xs font-bold es-general-text">4. Secure Keychain Storage</div>
                                                        <div className="text-[10px] es-general-secondary-text">Encrypts your login tokens securely</div>
                                                    </div>
                                                </div>
                                                {keychainStatus === 'primed' ? (
                                                    <span className="text-[10px] text-emerald-400 font-bold uppercase">Primed</span>
                                                ) : (
                                                    <span className="text-[10px] text-rose-400 font-bold uppercase">Required</span>
                                                )}
                                            </div>

                                            {activeSubStep === 'keychain' && keychainStatus !== 'primed' && (
                                                <div className="mt-3 pt-3 border-t es-global-separator space-y-2.5">
                                                    <p className="text-[11px] es-general-secondary-text leading-snug">
                                                        Escribolt uses your Mac's <strong>Keychain</strong> to encrypt your login tokens and API keys before saving them to disk. This means even if someone accessed your computer, they couldn't read your authentication credentials from a file.
                                                    </p>
                                                    <p className="text-[10px] es-general-secondary-text leading-snug">
                                                        Click <strong>"Prime Keychain"</strong> below, then when macOS prompts you, click <strong>"Always Allow"</strong> to grant permanent access. You won't be asked again.
                                                    </p>
                                                    <div className="flex gap-2">
                                                        <button
                                                            type="button"
                                                            disabled={keychainLoading}
                                                            onClick={async (e) => {
                                                                e.stopPropagation();
                                                                setKeychainLoading(true);
                                                                try {
                                                                    const result = await ipcRenderer.invoke('byok:prime-secure-storage');
                                                                    if (result?.status === 'success') {
                                                                        setKeychainStatus('primed');
                                                                    } else {
                                                                        setKeychainStatus('denied');
                                                                    }
                                                                } catch (error) {
                                                                    console.error('Failed to prime keychain:', error);
                                                                    setKeychainStatus('denied');
                                                                } finally {
                                                                    setKeychainLoading(false);
                                                                }
                                                            }}
                                                            className="px-3 py-1.5 text-xs font-bold rounded-lg bg-emerald-500 hover:bg-emerald-600 text-white shadow"
                                                        >
                                                            {keychainLoading ? 'Priming...' : 'Prime Keychain'}
                                                        </button>
                                                    </div>
                                                    {keychainStatus === 'denied' && (
                                                        <p className="text-[10px] text-rose-400 leading-snug">
                                                            Keychain access was denied. You can still use Escribolt, but you may be prompted to log in again after restarting the app.
                                                        </p>
                                                    )}
                                                </div>
                                            )}
                                        </div>

                                        {/* 5. Meeting Detection (Optional) */}
                                        <div 
                                            onClick={() => {
                                                if (micStatus === 'granted' && accessibilityStatus === 'granted' && screenStatus === 'granted' && keychainStatus === 'primed') {
                                                    setActiveSubStep('meetings');
                                                }
                                            }}
                                            className={`p-4 rounded-xl border transition-all ${
                                                (micStatus !== 'granted' || accessibilityStatus !== 'granted' || screenStatus !== 'granted' || keychainStatus !== 'primed') ? 'opacity-40 pointer-events-none' : 'cursor-pointer'
                                            } ${
                                                activeSubStep === 'meetings' 
                                                    ? 'border-emerald-500 bg-emerald-500/5 shadow-sm' 
                                                    : 'es-global-outline'
                                            }`}
                                        >
                                            <div className="flex items-center justify-between">
                                                <div className="flex items-center gap-3">
                                                    <div className={`h-8 w-8 rounded-full flex items-center justify-center shrink-0 ${
                                                        meetingsStatus === 'granted' && enableMeetings ? 'bg-emerald-500/10 text-emerald-400' : 'bg-stone-500/10 text-stone-500'
                                                    }`}>
                                                        {meetingsStatus === 'granted' && enableMeetings ? <Check size={14} strokeWidth={3} /> : <Monitor size={14} />}
                                                    </div>
                                                    <div>
                                                        <div className="text-xs font-bold es-general-text">5. Meeting Detection</div>
                                                        <div className="text-[10px] es-general-secondary-text">Prompts to record Google Meet, Teams, Zoom</div>
                                                    </div>
                                                </div>
                                                {enableMeetings && meetingsStatus === 'granted' ? (
                                                    <span className="text-[10px] text-emerald-400 font-bold uppercase">Enabled</span>
                                                ) : (
                                                    <span className="text-[10px] text-stone-400 font-bold uppercase">Optional</span>
                                                )}
                                            </div>

                                            {activeSubStep === 'meetings' && (
                                                <div className="mt-3 pt-3 border-t es-global-separator space-y-2.5">
                                                    <p className="text-[11px] es-general-secondary-text leading-snug">
                                                        Automatically scans browser tabs to offer meeting records. Requires Automation permission.
                                                    </p>
                                                    <div className="flex items-center justify-between py-1 bg-stone-500/5 px-2 rounded-lg border es-global-outline">
                                                        <span className="text-xs font-semibold es-general-text">Enable feature</span>
                                                        <input 
                                                            type="checkbox" 
                                                            className="h-4 w-4 cursor-pointer accent-emerald-500"
                                                            checked={enableMeetings}
                                                            onClick={(e) => e.stopPropagation()}
                                                            onChange={(e) => {
                                                                setEnableMeetings(e.target.checked);
                                                                if (e.target.checked && meetingsStatus === 'unknown') {
                                                                    requestMeetingsAccess();
                                                                }
                                                            }}
                                                        />
                                                    </div>
                                                    {enableMeetings && meetingsStatus !== 'granted' && (
                                                        <div className="flex gap-2 pt-1">
                                                            <button
                                                                type="button"
                                                                disabled={meetingsLoading}
                                                                onClick={(e) => {
                                                                    e.stopPropagation();
                                                                    requestMeetingsAccess();
                                                                }}
                                                                className="px-3 py-1.5 text-xs font-bold rounded-lg bg-emerald-500 hover:bg-emerald-600 text-white shadow"
                                                            >
                                                                {meetingsLoading ? 'Requesting...' : 'Allow'}
                                                            </button>
                                                        </div>
                                                    )}
                                                </div>
                                            )}
                                        </div>

                                    </div>
                                </div>

                                <div className="flex justify-between pt-6 border-t es-global-separator">
                                    <button
                                        type="button"
                                        onClick={() => setStep('welcome')}
                                        className="px-4 py-2 text-xs font-semibold rounded-lg border es-global-outline es-general-text hover:bg-stone-500/5 flex items-center gap-1"
                                    >
                                        <ChevronLeft size={14} /> Back
                                    </button>
                                    <button
                                        type="button"
                                        disabled={micStatus !== 'granted' || accessibilityStatus !== 'granted' || screenStatus !== 'granted' || keychainStatus !== 'primed'}
                                        onClick={() => setStep('account')}
                                        className="px-5 py-2 text-xs font-bold rounded-lg bg-emerald-500 hover:bg-emerald-600 text-white disabled:opacity-50 disabled:cursor-not-allowed flex items-center gap-1.5 shadow"
                                    >
                                        Continue <ChevronRight size={14} />
                                    </button>
                                </div>
                            </div>
                        )}
                    </div>

                    {/* Right Panel: Adaptive Graphic Illustration */}
                    <div className="flex-1 bg-[#ece9e6] dark:bg-[#1f1f1f] flex items-center justify-center p-8 relative overflow-hidden select-none">
                        <div className="absolute inset-0 bg-radial-gradient from-transparent to-black/5 dark:to-black/20 pointer-events-none" />
                        
                        <div className="z-10 flex flex-col items-center">
                            {renderActiveIllustration()}
                        </div>
                    </div>
                </div>
            )}
        </div>
    );
}

interface StepIndicatorProps {
    label: string;
    active: boolean;
    completed: boolean;
}

interface PermissionIllustrationImageProps {
    src: string;
    alt: string;
    fallback: React.ReactNode;
}

function PermissionIllustrationImage({ src, alt, fallback }: PermissionIllustrationImageProps) {
    const [failed, setFailed] = useState(false);

    useEffect(() => {
        setFailed(false);
    }, [src]);

    if (failed) {
        return <>{fallback}</>;
    }

    return (
        <img
            src={src}
            alt={alt}
            draggable={false}
            onError={() => setFailed(true)}
            className="max-h-[420px] w-full max-w-[440px] object-contain drop-shadow-2xl transition-transform duration-300 ease-out"
        />
    );
}

function StepIndicator({ label, active, completed }: StepIndicatorProps) {
    return (
        <div className="flex items-center gap-2">
            <div className={`h-5 w-5 rounded-full flex items-center justify-center text-[9px] font-bold transition-all border ${
                active 
                    ? 'bg-emerald-500 text-white border-emerald-500 shadow-md' 
                    : (completed ? 'bg-emerald-500/10 text-emerald-400 border-emerald-500/20' : 'bg-transparent text-stone-500 border-stone-500/20')
            }`}>
                {completed ? <Check size={8} strokeWidth={4} /> : null}
                {!completed && active ? <div className="h-1.5 w-1.5 rounded-full bg-white" /> : null}
            </div>
            <span className={`text-[10px] md:text-xs font-bold transition-colors ${active ? 'es-general-text' : (completed ? 'text-emerald-500' : 'text-stone-400')}`}>
                {label}
            </span>
        </div>
    );
}

/* --- Inline SVGs definitions --- */

function KeychainSVG({ status }: { status: string }) {
    const isPrimed = status === 'primed';
    return (
        <svg viewBox="0 0 400 400" className="w-64 h-64 md:w-80 md:h-80" fill="none" xmlns="http://www.w3.org/2000/svg">
            <circle cx="200" cy="200" r="140" fill={isPrimed ? "#10B981" : "#8B5CF6"} opacity="0.04" />
            <circle cx="200" cy="200" r="100" fill={isPrimed ? "#10B981" : "#8B5CF6"} opacity="0.08" />
            
            <g transform="translate(150, 100)">
                <rect x="10" y="50" width="80" height="70" rx="10" fill={isPrimed ? "#10B981" : "#8B5CF6"} opacity="0.15" stroke={isPrimed ? "#10B981" : "#8B5CF6"} strokeWidth="3" />
                <circle cx="50" cy="30" r="28" fill="none" stroke={isPrimed ? "#10B981" : "#8B5CF6"} strokeWidth="4" />
                <circle cx="50" cy="30" r="10" fill={isPrimed ? "#10B981" : "#8B5CF6"} opacity="0.3" />
                <rect x="35" y="80" width="30" height="20" rx="3" fill={isPrimed ? "#10B981" : "#8B5CF6"} opacity="0.4" />
            </g>
            
            {isPrimed && (
                <g transform="translate(185, 270)">
                    <circle cx="15" cy="15" r="18" fill="#10B981" />
                    <path d="M9 15 L 13 19 L 21 11" stroke="white" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" />
                </g>
            )}
            
            {!isPrimed && (
                <g transform="translate(185, 270)">
                    <circle cx="15" cy="15" r="18" fill="#8B5CF6" />
                    <path d="M15 9 L15 21" stroke="white" strokeWidth="2.5" strokeLinecap="round" />
                    <path d="M9 15 L21 15" stroke="white" strokeWidth="2.5" strokeLinecap="round" />
                </g>
            )}
        </svg>
    );
}

function MicrophoneSVG({ status }: { status: string }) {
    const isGranted = status === 'granted';
    return (
        <svg viewBox="0 0 400 400" className="w-64 h-64 md:w-80 md:h-80" fill="none" xmlns="http://www.w3.org/2000/svg">
            <circle cx="200" cy="200" r="140" fill={isGranted ? "#10B981" : "#8B5CF6"} opacity="0.04" />
            <circle cx="200" cy="200" r="100" fill={isGranted ? "#10B981" : "#8B5CF6"} opacity="0.08" />
            
            <g transform="translate(165, 120)" stroke={isGranted ? "#10B981" : "#8B5CF6"} strokeWidth="7" strokeLinecap="round" strokeLinejoin="round" className="animate-float">
                <rect x="18" y="0" width="34" height="65" rx="17" fill={isGranted ? "rgba(16, 185, 129, 0.15)" : "rgba(139, 92, 246, 0.08)"} strokeWidth="5" />
                <line x1="26" y1="18" x2="44" y2="18" strokeWidth="2" opacity="0.4" />
                <line x1="26" y1="32" x2="44" y2="32" strokeWidth="2" opacity="0.4" />
                <line x1="26" y1="46" x2="44" y2="46" strokeWidth="2" opacity="0.4" />
                
                <path d="M5 40 C 5 65, 65 65, 65 40" strokeWidth="5" />
                <line x1="35" y1="70" x2="35" y2="105" strokeWidth="7" />
                <line x1="15" y1="105" x2="55" y2="105" strokeWidth="7" />
            </g>
            
            {isGranted ? (
                <g stroke="#10B981" strokeWidth="4" strokeLinecap="round" opacity="0.7">
                    <path d="M120 180 A 80 80 0 0 0 120 220" />
                    <path d="M100 160 A 110 110 0 0 0 100 240" strokeWidth="2.5" opacity="0.4" />
                    <path d="M280 180 A 80 80 0 0 1 280 220" />
                    <path d="M300 160 A 110 110 0 0 1 300 240" strokeWidth="2.5" opacity="0.4" />
                </g>
            ) : (
                <g stroke="#8B5CF6" strokeWidth="3" strokeLinecap="round" opacity="0.5">
                    <path d="M135 190 A 60 60 0 0 0 135 210" />
                    <path d="M265 190 A 60 60 0 0 1 265 210" />
                </g>
            )}
            
            <g transform="translate(185, 270)">
                <circle cx="15" cy="15" r="18" fill={isGranted ? "#10B981" : "#EF4444"} />
                {isGranted ? (
                    <path d="M9 15 L 13 19 L 21 11" stroke="white" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" />
                ) : (
                    <path d="M10 10 L 20 20 M 20 10 L 10 20" stroke="white" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" />
                )}
            </g>
        </svg>
    );
}

function ShortcutsSVG({ status }: { status: string }) {
    const isGranted = status === 'granted';
    return (
        <svg viewBox="0 0 400 400" className="w-64 h-64 md:w-80 md:h-80" fill="none" xmlns="http://www.w3.org/2000/svg">
            <circle cx="200" cy="200" r="140" fill={isGranted ? "#10B981" : "#8B5CF6"} opacity="0.04" />
            
            <g transform="translate(80, 150)">
                <rect width="240" height="110" rx="10" fill="#262629" stroke="#4B4B50" strokeWidth="3.5" />
                
                <rect x="70" y="80" width="100" height="18" rx="3.5" fill="#151516" />
                
                <rect x="15" y="80" width="22" height="18" rx="3.5" fill={isGranted ? "#10B981" : "#A855F7"} stroke={isGranted ? "#10B981" : "#C084FC"} strokeWidth="1" className={isGranted ? "" : "animate-pulse-glow"} />
                <circle cx="26" cy="89" r="4.5" stroke="white" strokeWidth="0.8" />
                <line x1="26" y1="84.5" x2="26" y2="93.5" stroke="white" strokeWidth="0.8" />
                <line x1="21.5" y1="89" x2="30.5" y2="89" stroke="white" strokeWidth="0.8" />
                
                <rect x="42" y="80" width="22" height="18" rx="3.5" fill="#151516" />
                <rect x="176" y="80" width="22" height="18" rx="3.5" fill="#151516" />
                <rect x="203" y="80" width="22" height="18" rx="3.5" fill="#151516" />
                
                <g fill="#151516">
                    <rect x="15" y="15" width="20" height="14" rx="2.5" />
                    <rect x="40" y="15" width="20" height="14" rx="2.5" />
                    <rect x="65" y="15" width="20" height="14" rx="2.5" />
                    <rect x="90" y="15" width="20" height="14" rx="2.5" />
                    <rect x="115" y="15" width="20" height="14" rx="2.5" />
                    <rect x="140" y="15" width="20" height="14" rx="2.5" />
                    <rect x="165" y="15" width="20" height="14" rx="2.5" />
                    <rect x="190" y="15" width="35" height="14" rx="2.5" fill="#3E3E42" />
                    
                    <rect x="15" y="36" width="30" height="14" rx="2.5" fill="#3E3E42" />
                    <rect x="50" y="36" width="20" height="14" rx="2.5" />
                    <rect x="75" y="36" width="20" height="14" rx="2.5" />
                    <rect x="100" y="36" width="20" height="14" rx="2.5" />
                    <rect x="125" y="36" width="20" height="14" rx="2.5" />
                    <rect x="150" y="36" width="20" height="14" rx="2.5" />
                    <rect x="175" y="36" width="50" height="14" rx="2.5" fill="#3E3E42" />
                    
                    <rect x="15" y="58" width="36" height="14" rx="2.5" fill="#3E3E42" />
                    <rect x="56" y="58" width="20" height="14" rx="2.5" />
                    <rect x="81" y="58" width="20" height="14" rx="2.5" />
                    <rect x="106" y="58" width="20" height="14" rx="2.5" />
                    <rect x="131" y="58" width="20" height="14" rx="2.5" />
                    <rect x="156" y="58" width="20" height="14" rx="2.5" />
                    <rect x="181" y="58" width="44" height="14" rx="2.5" fill="#3E3E42" />
                </g>
            </g>
            
            <g transform="translate(170, 50)" className="animate-float">
                <rect width="60" height="75" rx="8" fill="white" stroke={isGranted ? "#10B981" : "#8B5CF6"} strokeWidth="2.5" className="shadow-lg" />
                <line x1="12" y1="18" x2="48" y2="18" stroke={isGranted ? "#10B981" : "#8B5CF6"} strokeWidth="2.5" strokeLinecap="round" />
                <line x1="12" y1="30" x2="40" y2="30" stroke="#8E8E93" strokeWidth="2.5" strokeLinecap="round" />
                <line x1="12" y1="42" x2="44" y2="42" stroke="#8E8E93" strokeWidth="2.5" strokeLinecap="round" />
                <line x1="12" y1="54" x2="30" y2="54" stroke="#8E8E93" strokeWidth="2.5" strokeLinecap="round" />
                <rect x="22" y="-3" width="16" height="6" rx="1.5" fill="#8E8E93" />
            </g>
            
            <path d="M225 110 L 225 132 M 225 132 L 221 127 M 225 132 L 229 127" stroke={isGranted ? "#10B981" : "#8B5CF6"} strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
    );
}

function MeetingsSVG({ enabled }: { enabled: boolean }) {
    return (
        <svg viewBox="0 0 400 400" className="w-64 h-64 md:w-80 md:h-80" fill="none" xmlns="http://www.w3.org/2000/svg">
            <circle cx="200" cy="200" r="140" fill={enabled ? "#10B981" : "#8B5CF6"} opacity="0.04" />
            
            <g transform="translate(60, 110)">
                <rect width="280" height="180" rx="8" fill="#1C1C1E" stroke="#3A3A3C" strokeWidth="3" className="shadow-2xl" />
                <path d="M0 8 C0 3.58 3.58 0 8 0 L 272 0 C 276.42 0 280 3.58 280 8 L 280 25 L 0 25 Z" fill="#2C2C2E" />
                <circle cx="12" cy="12" r="3" fill="#FF5F56" />
                <circle cx="22" cy="12" r="3" fill="#FFBD2E" />
                <circle cx="32" cy="12" r="3" fill="#27C93F" />
                <rect x="60" y="5" width="160" height="14" rx="7" fill="#1C1C1E" />
                <circle cx="68" cy="12" r="2.5" fill="#10B981" />
                
                <rect x="15" y="40" width="115" height="70" rx="4" fill="#2C2C2E" />
                <circle cx="72" cy="70" r="12" fill="#48484A" />
                <path d="M 57 95 C 57 85, 87 85, 87 95" fill="#48484A" />
                
                <rect x="150" y="40" width="115" height="70" rx="4" fill="#2C2C2E" />
                <circle cx="207" cy="70" r="12" fill="#48484A" />
                <path d="M 192 95 C 192 85, 222 85, 222 95" fill="#48484A" />
                
                {enabled && (
                    <g transform="translate(35, 95)" className="animate-float">
                        <rect width="210" height="65" rx="6" fill="#10B981" className="shadow-xl" />
                        <text x="15" y="25" fill="white" fontSize="10" fontWeight="bold" fontFamily="-apple-system, sans-serif">Google Meet Detected</text>
                        <text x="15" y="42" fill="rgba(255, 255, 255, 0.8)" fontSize="8.5" fontFamily="-apple-system, sans-serif">Click to record and summarize meeting...</text>
                        <circle cx="190" cy="32" r="9" fill="rgba(255, 255, 255, 0.2)" />
                        <path d="M 187 32 L 193 32" stroke="white" strokeWidth="1.2" />
                    </g>
                )}
            </g>
        </svg>
    );
}

function SystemAudioSVG({ status }: { status: string }) {
    const isGranted = status === 'granted';
    return (
        <svg viewBox="0 0 400 400" className="w-64 h-64 md:w-80 md:h-80" fill="none" xmlns="http://www.w3.org/2000/svg">
            <circle cx="200" cy="200" r="140" fill={isGranted ? "#10B981" : "#8B5CF6"} opacity="0.04" />
            <circle cx="200" cy="200" r="100" fill={isGranted ? "#10B981" : "#8B5CF6"} opacity="0.08" />
            
            <g transform="translate(155, 130)" className="animate-float">
                <path d="M45 0 L45 140" stroke={isGranted ? "#10B981" : "#8B5CF6"} strokeWidth="4" strokeLinecap="round" />
                <path d="M25 30 L25 110" stroke={isGranted ? "#10B981" : "#8B5CF6"} strokeWidth="4" strokeLinecap="round" opacity="0.7" />
                <path d="M5 50 L5 90" stroke={isGranted ? "#10B981" : "#8B5CF6"} strokeWidth="4" strokeLinecap="round" opacity="0.5" />
                <path d="M65 30 L65 110" stroke={isGranted ? "#10B981" : "#8B5CF6"} strokeWidth="4" strokeLinecap="round" opacity="0.7" />
                <path d="M85 50 L85 90" stroke={isGranted ? "#10B981" : "#8B5CF6"} strokeWidth="4" strokeLinecap="round" opacity="0.5" />
            </g>
            
            <g transform="translate(160, 280)">
                <rect width="80" height="50" rx="8" fill={isGranted ? "#10B981" : "#8B5CF6"} opacity="0.15" stroke={isGranted ? "#10B981" : "#8B5CF6"} strokeWidth="2" />
                <circle cx="25" cy="25" r="8" fill={isGranted ? "#10B981" : "#8B5CF6"} />
                <circle cx="55" cy="25" r="8" fill={isGranted ? "#10B981" : "#8B5CF6"} />
                <path d="M20 40 L60 40" stroke={isGranted ? "#10B981" : "#8B5CF6"} strokeWidth="2" strokeLinecap="round" />
            </g>
            
            <g transform="translate(185, 340)">
                <circle cx="15" cy="15" r="18" fill={isGranted ? "#10B981" : "#EF4444"} />
                {isGranted ? (
                    <path d="M9 15 L 13 19 L 21 11" stroke="white" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" />
                ) : (
                    <path d="M10 10 L 20 20 M 20 10 L 10 20" stroke="white" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" />
                )}
            </g>
        </svg>
    );
}
