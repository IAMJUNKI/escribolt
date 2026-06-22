import React, { useState, useEffect, useLayoutEffect, useRef, useCallback } from 'react';
import { Ear, FileText, Languages, Mic, X } from 'lucide-react';
import ProcessingModeWidget from './ProcessingModeWidget';
import {
    findNova3MonolingualLanguageLabel,
    formatNova3LanguageBadgeCode,
} from './utils/nova3Languages';
import meetsLogo from './assets/meeting-logos/meets.png';
import teamsLogo from './assets/meeting-logos/teams.png';
import zoomLogo from './assets/meeting-logos/zoom.png';

const THEMES = {
    black: {
        bg: '#0a0a0a',
        accent: '#ffffff',
        glow: 'rgba(255, 255, 255, 0.3)',
        glowStrong: 'rgba(255, 255, 255, 0.6)',
        border: 'rgba(255, 255, 255, 0.15)',
    },
    white: {
        bg: '#ffffff',
        accent: '#000000',
        glow: 'rgba(0, 0, 0, 0.1)',
        glowStrong: 'rgba(0, 0, 0, 0.3)',
        border: 'rgba(0, 0, 0, 0.1)',
    },
};

type ThemeKey = keyof typeof THEMES;
type WidgetMode = 'voice' | 'quick-note' | 'record';
type MeetingPromptState = {
    visible: boolean;
    durationMs?: number;
    meeting: {
        provider?: string;
        providerLabel?: string;
        key?: string;
        title?: string;
        url?: string;
        source?: string;
    } | null;
};

const MEETING_PROMPT_PROVIDERS: Record<string, { name: string; logo: string; alt: string }> = {
    'google-meet': {
        name: 'Meets',
        logo: meetsLogo,
        alt: 'Google Meets',
    },
    teams: {
        name: 'Teams',
        logo: teamsLogo,
        alt: 'Microsoft Teams',
    },
    zoom: {
        name: 'Zoom',
        logo: zoomLogo,
        alt: 'Zoom',
    },
};

function resolveMeetingPromptProvider(provider?: string) {
    return MEETING_PROMPT_PROVIDERS[provider || ''] || {
        name: 'Meeting',
        logo: meetsLogo,
        alt: 'Meeting',
    };
}
type DictationLanguageBadgeState = {
    mode: 'cloud-multilingual' | 'cloud-monolingual' | 'local-auto' | 'local-fixed';
    codeLabel: string;
    tooltip: string;
    visible: boolean;
};

const DEFAULT_DICTATION_LANGUAGE_BADGE: DictationLanguageBadgeState = {
    mode: 'cloud-multilingual',
    codeLabel: '',
    tooltip: 'Multilingual',
    visible: false,
};
const BAR_COUNT = 9;
const IDLE_BAR_LEVEL = 0.08;
const IDLE_BAR_LEVELS = Array.from({ length: BAR_COUNT }, () => IDLE_BAR_LEVEL);
const clamp01 = (value: number) => Math.max(0, Math.min(1, value));

function resolveDictationLanguageBadge(settings: any): DictationLanguageBadgeState {
    const aiEngine = settings && typeof settings === 'object' ? settings.aiEngine || {} : {};
    const isLocalDictation = settings?.mode === 'local' || settings?.processingModes?.dictation === 'local';
    const isStreamingDictation = !isLocalDictation
        && aiEngine.sttProvider === 'deepgram';

    if (isLocalDictation) {
        if (aiEngine.localSttLanguageMode !== 'fixed') {
            return {
                mode: 'local-auto',
                codeLabel: '',
                tooltip: 'Auto-detect',
                visible: true,
            };
        }

        const language = typeof aiEngine.localSttLanguage === 'string' && aiEngine.localSttLanguage.trim()
            ? aiEngine.localSttLanguage.trim()
            : 'en';

        return {
            mode: 'local-fixed',
            codeLabel: formatNova3LanguageBadgeCode(language),
            tooltip: `Fixed: ${findNova3MonolingualLanguageLabel(language)}`,
            visible: true,
        };
    }

    if (!isStreamingDictation) {
        return DEFAULT_DICTATION_LANGUAGE_BADGE;
    }

    if (aiEngine.sttStreamingProfile !== 'nova3-monolingual') {
        return {
            ...DEFAULT_DICTATION_LANGUAGE_BADGE,
            visible: true,
        };
    }

    const language = typeof aiEngine.sttNova3Language === 'string' && aiEngine.sttNova3Language.trim()
        ? aiEngine.sttNova3Language.trim()
        : 'en';

    return {
        mode: 'cloud-monolingual',
        codeLabel: formatNova3LanguageBadgeCode(language),
        tooltip: `Monolingual: ${findNova3MonolingualLanguageLabel(language)}`,
        visible: true,
    };
}

function buildCenteredBarsFromLevel(level: number): number[] {
    const safeLevel = clamp01(level);
    if (safeLevel < 0.015) {
        return Array.from({ length: BAR_COUNT }, () => IDLE_BAR_LEVEL);
    }

    const now = Date.now() * 0.008; // Time variable for smooth oscillation
    const mid = (BAR_COUNT - 1) / 2;

    return Array.from({ length: BAR_COUNT }, (_unused, i) => {
        // Base Gaussian prominence to keep it centered-ish
        const distance = i - mid;
        const gaussian = Math.exp(-((distance * distance) / (2 * 1.8 * 1.8)));

        // Multi-frequency wave oscillation for organic movement
        const wave1 = Math.sin(now + i * 1.7);
        const wave2 = Math.cos(now * 0.8 - i * 2.3);
        const wave3 = Math.sin(now * 1.5 + i * 0.9);
        const combinedWave = (wave1 * 0.4 + wave2 * 0.4 + wave3 * 0.2) * 0.5 + 0.5; // normalized 0 to 1

        // Jitter / high-frequency noise to simulate real-time FFT frequency bands
        const noise = Math.random() * 0.12 - 0.06;

        // Dynamic scaling factor
        const frequencyScale = 0.35 + combinedWave * 0.65 + noise;

        // Final height calculation
        const height = IDLE_BAR_LEVEL + (safeLevel * gaussian * frequencyScale * 0.95);
        return clamp01(height);
    });
}

const App: React.FC = () => {
    const [status, setStatus] = useState<'idle' | 'listening' | 'processing' | 'result'>('idle');
    const [widgetMode, setWidgetMode] = useState<WidgetMode>('voice');
    const [theme, setTheme] = useState<ThemeKey>('black');
    const [audioLevel, setAudioLevel] = useState(0);
    const [barLevels, setBarLevels] = useState<number[]>(IDLE_BAR_LEVELS);
    const [recordElapsedSeconds, setRecordElapsedSeconds] = useState(0);
    const [languageBadge, setLanguageBadge] = useState<DictationLanguageBadgeState>(DEFAULT_DICTATION_LANGUAGE_BADGE);
    const [isLanguageBadgeHovering, setIsLanguageBadgeHovering] = useState(false);
    const [meetingPrompt, setMeetingPrompt] = useState<MeetingPromptState>({ visible: false, meeting: null });
    const recordStartRef = useRef<number | null>(null);
    const containerRef = useRef<HTMLDivElement>(null);
    const pillRef = useRef<HTMLDivElement>(null);
    const lastPillXRef = useRef<number | null>(null);
    const lastPillYRef = useRef<number | null>(null);

    // Consolidated Promo/Error Banner State
    const [bannerState, setBannerState] = useState({
        visible: false,
        text: "Tired of waiting? Get faster responses with PRO."
    });
    const slowCountRef = useRef(0);
    const subsequentSlowsRef = useRef(0);
    const nextWaitRef = useRef(0);
    const isLocalDictationRef = useRef(true);
    const processingTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
    const bannerTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);

    const setBannerVisibility = useCallback((visible: boolean, text?: string) => {
        if (window.require) {
            window.require('electron').ipcRenderer.send('promo-banner:intent', { visible });
        }
        setBannerState(prev => ({
            visible,
            text: text || prev.text,
        }));
    }, []);

    const dismissBanner = useCallback(() => {
        if (bannerTimeoutRef.current) {
            clearTimeout(bannerTimeoutRef.current);
            bannerTimeoutRef.current = null;
        }
        setBannerVisibility(false);
    }, [setBannerVisibility]);

    const triggerPromoBanner = useCallback((message: string) => {
        setBannerVisibility(true, message);
        if (bannerTimeoutRef.current) {
            clearTimeout(bannerTimeoutRef.current);
        }
        bannerTimeoutRef.current = setTimeout(() => {
            bannerTimeoutRef.current = null;
            setBannerVisibility(false);
        }, 4000);
    }, [setBannerVisibility]);

    const handleSlowProcessingDetected = useCallback(() => {
        const slowCount = slowCountRef.current;
        console.log('[PROMO BANNER DIAGNOSTICS] handleSlowProcessingDetected called. current slowCount:', slowCount);
        const msg = "Tired of waiting? Get faster responses with PRO.";
        if (slowCount === 0) {
            triggerPromoBanner(msg);
            slowCountRef.current = 1;
            nextWaitRef.current = Math.floor(Math.random() * (7 - 4 + 1)) + 4;
            subsequentSlowsRef.current = 0;
            console.log('[PROMO BANNER DIAGNOSTICS] 1st slow dictation banner triggered. nextWait threshold generated:', nextWaitRef.current);
        } else {
            subsequentSlowsRef.current += 1;
            console.log('[PROMO BANNER DIAGNOSTICS] Subsequent slow count:', subsequentSlowsRef.current, 'out of nextWait:', nextWaitRef.current);
            if (subsequentSlowsRef.current === nextWaitRef.current) {
                triggerPromoBanner(msg);
                nextWaitRef.current = Math.floor(Math.random() * (7 - 4 + 1)) + 4;
                subsequentSlowsRef.current = 0;
                console.log('[PROMO BANNER DIAGNOSTICS] Threshold met! Banner triggered. new nextWait generated:', nextWaitRef.current);
            }
        }
    }, [triggerPromoBanner]);

    const syncWidgetSettingsFromSnapshot = useCallback((settings: any, context: string) => {
        if (!settings) return;
        const isLocal = settings.mode === 'local' || settings.processingModes?.dictation === 'local';
        isLocalDictationRef.current = isLocal;
        setLanguageBadge(resolveDictationLanguageBadge(settings));
        console.log('[PROMO BANNER DIAGNOSTICS]', `${context}: Loaded settings.`, 'isLocal:', isLocal, 'mode:', settings.mode, 'dictation:', settings.processingModes?.dictation);
    }, []);

    const fetchWidgetSettings = useCallback((context: string) => {
        if (!window.require) return;
        const { ipcRenderer } = window.require('electron');
        ipcRenderer.invoke('get-ui-settings').then((settings: any) => {
            syncWidgetSettingsFromSnapshot(settings, context);
        }).catch((err: any) => {
            console.error('[PROMO BANNER DIAGNOSTICS]', `${context}: Failed to fetch settings:`, err);
        });
    }, [syncWidgetSettingsFromSnapshot]);

    useEffect(() => {
        if (!window.require) return;
        const { ipcRenderer } = window.require('electron');
        if (!containerRef.current) return;

        const resizeObserver = new ResizeObserver((entries) => {
            if (!entries.length) return;
            const rect = entries[0].target.getBoundingClientRect();
            
            let pillX = 0;
            let pillY = 0;
            let shiftX = 0;
            let shiftY = 0;

            if (pillRef.current && containerRef.current) {
                const containerRect = containerRef.current.getBoundingClientRect();
                const pillRect = pillRef.current.getBoundingClientRect();
                pillX = Math.round(pillRect.left - containerRect.left);
                pillY = Math.round(pillRect.top - containerRect.top);

                if (lastPillXRef.current !== null) {
                    shiftX = lastPillXRef.current - pillX;
                }
                if (lastPillYRef.current !== null) {
                    shiftY = lastPillYRef.current - pillY;
                }

                lastPillXRef.current = pillX;
                lastPillYRef.current = pillY;
            } else {
                lastPillXRef.current = null;
                lastPillYRef.current = null;
            }

            ipcRenderer.send('record-widget:resize', {
                width: Math.ceil(rect.width),
                height: Math.ceil(rect.height),
                shiftX,
                shiftY,
            });
        });

        resizeObserver.observe(containerRef.current);
        return () => {
            resizeObserver.disconnect();
        };
    }, []);

    const t = THEMES[theme];
    const isListening = status === 'listening';
    const isProcessing = status === 'processing';
    const isRecordListening = isListening && widgetMode === 'record';

    const resetRecordTimer = () => {
        recordStartRef.current = null;
        setRecordElapsedSeconds(0);
    };

    const startRecordTimerIfNeeded = () => {
        if (recordStartRef.current === null) {
            recordStartRef.current = Date.now();
            setRecordElapsedSeconds(0);
        }
    };

    useEffect(() => {
        if (window.require) {
            const { ipcRenderer } = window.require('electron');

            const handleStartListening = (_event: any, mode?: string) => {
                dismissBanner();
                fetchWidgetSettings('Start listening');
                if (mode === 'record') {
                    setWidgetMode('record');
                    startRecordTimerIfNeeded();
                } else {
                    setWidgetMode(mode === 'quick-note' ? 'quick-note' : 'voice');
                    resetRecordTimer();
                }
                setStatus('listening');
            };
            const handleProcessing = (_event: any, mode?: string) => {
                if (mode === 'record') {
                    setWidgetMode('record');
                }
                setStatus('processing');
                fetchWidgetSettings('Processing');
            };
            const handleTranscriptionResult = (_event: any, _text: string) => {
                setWidgetMode('voice');
                resetRecordTimer();
                setStatus('result');
            };
            const handleReset = () => {
                setWidgetMode('voice');
                resetRecordTimer();
                setStatus('idle');
            };
            const handleSetTheme = (_event: any, newTheme: string) => {
                if (newTheme in THEMES) setTheme(newTheme as ThemeKey);
            };
            const handleRecordModeWidgetStatus = (_event: any, payload: { status?: string } = {}) => {
                const nextStatus = payload?.status || 'idle';
                if (nextStatus === 'capturing') {
                    dismissBanner();
                    setWidgetMode('record');
                    startRecordTimerIfNeeded();
                    setStatus('listening');
                    return;
                }
                if (nextStatus === 'processing') {
                    setWidgetMode('record');
                    setStatus('processing');
                    return;
                }
                setWidgetMode('voice');
                resetRecordTimer();
                setStatus('idle');
            };
            const handleRecordModeSystemAudio = (_event: any, payload: { level?: number; bars?: number[] } = {}) => {
                const incomingLevel = Number(payload?.level);
                const level = Number.isFinite(incomingLevel) ? clamp01(incomingLevel) : 0;
                const bars = buildCenteredBarsFromLevel(level);

                while (bars.length < BAR_COUNT) {
                    bars.push(IDLE_BAR_LEVEL);
                }

                const levelBoosted = clamp01(level * 1.25);
                const barsBoosted = bars.map((value) => clamp01(
                    IDLE_BAR_LEVEL + ((value - IDLE_BAR_LEVEL) * 1.38),
                ));

                setAudioLevel(levelBoosted);
                setBarLevels(barsBoosted);
            };
            const handleMeetingPromptState = (_event: any, payload: MeetingPromptState = { visible: false, meeting: null }) => {
                setMeetingPrompt({
                    visible: !!payload?.visible && !!payload?.meeting,
                    durationMs: Number.isFinite(payload?.durationMs) ? payload.durationMs : undefined,
                    meeting: payload?.meeting || null,
                });
            };

            const handleShowErrorBanner = (_event: any, payload: { message?: string; dismissPill?: boolean } = {}) => {
                if (payload.dismissPill !== false) {
                    setWidgetMode('voice');
                    resetRecordTimer();
                    setStatus('idle');
                }
                triggerPromoBanner(payload.message || 'Dictation failed. Please try again.');
            };
            const handleUiSettingsUpdated = (_event: any, latestSettings: any) => {
                syncWidgetSettingsFromSnapshot(latestSettings, 'Settings update');
            };

            ipcRenderer.on('start-listening', handleStartListening);
            ipcRenderer.on('processing', handleProcessing);
            ipcRenderer.on('transcription-result', handleTranscriptionResult);
            ipcRenderer.on('reset', handleReset);
            ipcRenderer.on('set-theme', handleSetTheme);
            ipcRenderer.on('record-mode:status', handleRecordModeWidgetStatus);
            ipcRenderer.on('record-mode:system-audio', handleRecordModeSystemAudio);
            ipcRenderer.on('record-mode:show-error-banner', handleShowErrorBanner);
            ipcRenderer.on('meeting-prompt:state', handleMeetingPromptState);
            ipcRenderer.on('ui-settings-updated', handleUiSettingsUpdated);
            ipcRenderer.send('meeting-prompt:ready');

            return () => {
                ipcRenderer.removeListener('start-listening', handleStartListening);
                ipcRenderer.removeListener('processing', handleProcessing);
                ipcRenderer.removeListener('transcription-result', handleTranscriptionResult);
                ipcRenderer.removeListener('reset', handleReset);
                ipcRenderer.removeListener('set-theme', handleSetTheme);
                ipcRenderer.removeListener('record-mode:status', handleRecordModeWidgetStatus);
                ipcRenderer.removeListener('record-mode:system-audio', handleRecordModeSystemAudio);
                ipcRenderer.removeListener('record-mode:show-error-banner', handleShowErrorBanner);
                ipcRenderer.removeListener('meeting-prompt:state', handleMeetingPromptState);
                ipcRenderer.removeListener('ui-settings-updated', handleUiSettingsUpdated);
            };
        }
    }, [dismissBanner, fetchWidgetSettings, syncWidgetSettingsFromSnapshot, triggerPromoBanner]);

    // Fetch UI settings on mount
    useEffect(() => {
        fetchWidgetSettings('Mount');
    }, [fetchWidgetSettings]);

    // Report committed banner visibility after React updates the transparent window.
    useLayoutEffect(() => {
        if (window.require) {
            window.require('electron').ipcRenderer.send('promo-banner:rendered-state', {
                visible: bannerState.visible,
            });
        }
    }, [bannerState.visible]);

    const handleCloseBanner = () => {
        dismissBanner();
    };

    const dismissMeetingPrompt = () => {
        const key = meetingPrompt.meeting?.key || '';
        setMeetingPrompt({ visible: false, meeting: null });
        if (window.require) {
            window.require('electron').ipcRenderer.send('meeting-prompt:dismiss', { key });
        }
    };

    const startMeetingRecording = () => {
        const key = meetingPrompt.meeting?.key || '';
        setMeetingPrompt({ visible: false, meeting: null });
        if (window.require) {
            window.require('electron').ipcRenderer.send('meeting-prompt:start-recording', { key });
        }
    };

    // Dictation processing 2-second timer
    useEffect(() => {
        if (processingTimerRef.current) {
            clearTimeout(processingTimerRef.current);
            processingTimerRef.current = null;
        }

        if (status === 'processing') {
            console.log('[PROMO BANNER DIAGNOSTICS] Status transitioned to processing. Timer started. widgetMode:', widgetMode, 'isLocal:', isLocalDictationRef.current);
            processingTimerRef.current = setTimeout(() => {
                console.log('[PROMO BANNER DIAGNOSTICS] 2-second timer fired. isLocal:', isLocalDictationRef.current);
                if (isLocalDictationRef.current && widgetMode === 'voice') {
                    handleSlowProcessingDetected();
                }
            }, 2000);
        }

        return () => {
            if (processingTimerRef.current) {
                clearTimeout(processingTimerRef.current);
            }
        };
    }, [handleSlowProcessingDetected, status, widgetMode]);

    // Reset layout coordinate trackers when widget goes idle
    useEffect(() => {
        if (status === 'idle') {
            lastPillXRef.current = null;
            lastPillYRef.current = null;
        }
    }, [status]);

    useEffect(() => {
        if (!languageBadge.visible) {
            setIsLanguageBadgeHovering(false);
        }
    }, [languageBadge.visible]);

    // Cleanup all timers on unmount
    useEffect(() => {
        return () => {
            if (bannerTimeoutRef.current) {
                clearTimeout(bannerTimeoutRef.current);
            }
            if (processingTimerRef.current) {
                clearTimeout(processingTimerRef.current);
            }
        };
    }, []);

    useEffect(() => {
        if (!(isListening && widgetMode === 'record')) {
            return () => undefined;
        }

        const tick = () => {
            const startedAt = recordStartRef.current;
            if (startedAt === null) return;
            setRecordElapsedSeconds(Math.max(0, Math.floor((Date.now() - startedAt) / 1000)));
        };

        tick();
        const intervalId = window.setInterval(tick, 250);
        return () => {
            window.clearInterval(intervalId);
        };
    }, [isListening, widgetMode]);

    useEffect(() => {
        let mounted = true;
        let stream: MediaStream | null = null;
        let audioContext: AudioContext | null = null;
        let sourceNode: MediaStreamAudioSourceNode | null = null;
        let analyser: AnalyserNode | null = null;
        let rafId: number | null = null;

        const cleanup = () => {
            if (rafId !== null) {
                cancelAnimationFrame(rafId);
                rafId = null;
            }
            if (sourceNode) {
                try {
                    sourceNode.disconnect();
                } catch (_error) {
                    // Ignore disconnect races.
                }
                sourceNode = null;
            }
            if (analyser) {
                try {
                    analyser.disconnect();
                } catch (_error) {
                    // Ignore disconnect races.
                }
                analyser = null;
            }
            if (audioContext) {
                audioContext.close().catch(() => undefined);
                audioContext = null;
            }
            if (stream) {
                stream.getTracks().forEach((track) => track.stop());
                stream = null;
            }
            if (mounted) {
                setAudioLevel(0);
                setBarLevels(IDLE_BAR_LEVELS);
            }
        };

        if (!isListening) {
            cleanup();
            return () => undefined;
        }
        if (widgetMode === 'record') {
            return () => undefined;
        }

        const startMeter = async () => {
            try {
                if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
                    return;
                }

                stream = await navigator.mediaDevices.getUserMedia({
                    audio: {
                        echoCancellation: false,
                        noiseSuppression: false,
                        autoGainControl: false,
                    } as MediaTrackConstraints,
                    video: false,
                });
                if (!mounted) {
                    cleanup();
                    return;
                }

                const AudioContextCtor = (window as any).AudioContext || (window as any).webkitAudioContext;
                if (!AudioContextCtor) {
                    return;
                }

                const ctx: AudioContext = new AudioContextCtor();
                audioContext = ctx;
                sourceNode = ctx.createMediaStreamSource(stream);
                analyser = ctx.createAnalyser();
                analyser.fftSize = 1024;
                analyser.smoothingTimeConstant = 0.55;
                sourceNode.connect(analyser);

                const frequencyData = new Uint8Array(analyser.frequencyBinCount);
                const timeData = new Uint8Array(analyser.fftSize);
                const previousBars = IDLE_BAR_LEVELS.slice(0, BAR_COUNT);
                let noiseFloor = 0.01;
                let quietFrames = 0;

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
                const bandEdges = Array.from({ length: BAR_COUNT + 1 }, (_unused, i) => {
                    const ratio = i / BAR_COUNT;
                    const hz = minHz * Math.pow(maxHz / minHz, ratio);
                    return hzToBin(hz);
                });
                const bandRanges = Array.from({ length: BAR_COUNT }, (_unused, i) => {
                    const start = bandEdges[i];
                    const end = Math.min(
                        frequencyData.length,
                        Math.max(start + 1, bandEdges[i + 1]),
                    );
                    return { start, end };
                });
                const update = () => {
                    if (!mounted || !analyser) return;
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

                    for (let i = 0; i < BAR_COUNT; i += 1) {
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

                    rawMean /= BAR_COUNT;
                    const isQuiet = inputLevel < 0.03 && rawMean < 0.08;

                    if (isQuiet) {
                        quietFrames += 1;
                        for (let i = 0; i < BAR_COUNT; i += 1) {
                            const target = IDLE_BAR_LEVEL;
                            if (quietFrames >= 5) {
                                previousBars[i] = target;
                                nextBars.push(target);
                            } else {
                                const settled = previousBars[i] + ((target - previousBars[i]) * 0.24);
                                previousBars[i] = settled;
                                nextBars.push(settled);
                            }
                        }
                        setBarLevels(nextBars);
                        setAudioLevel(0);
                        rafId = requestAnimationFrame(update);
                        return;
                    }
                    quietFrames = 0;

                    // Map lower-frequency energy toward the center bars so the dominant movement is central.
                    const centeredBands = Array.from({ length: BAR_COUNT }, () => 0);
                    const centerBar = Math.floor(BAR_COUNT / 2);
                    for (let sourceIndex = 0; sourceIndex < BAR_COUNT; sourceIndex += 1) {
                        const targetIndex = sourceIndex === 0
                            ? centerBar
                            : (sourceIndex % 2 === 1
                                ? centerBar - Math.ceil(sourceIndex / 2)
                                : centerBar + Math.ceil(sourceIndex / 2));
                        if (targetIndex >= 0 && targetIndex < BAR_COUNT) {
                            const centerDistance = Math.abs(targetIndex - centerBar) / Math.max(1, centerBar);
                            const centerWeight = 1.2 - (centerDistance * 0.28);
                            centeredBands[targetIndex] = Math.min(1, rawBands[sourceIndex] * centerWeight);
                        }
                    }

                    const spreadBands: number[] = [];
                    for (let i = 0; i < BAR_COUNT; i += 1) {
                        const left = i > 0 ? centeredBands[i - 1] : centeredBands[i];
                        const right = i < BAR_COUNT - 1 ? centeredBands[i + 1] : centeredBands[i];
                        const spread = Math.min(1, (centeredBands[i] * 0.64) + (left * 0.18) + (right * 0.18));
                        spreadBands.push(spread);
                    }

                    for (let i = 0; i < BAR_COUNT; i += 1) {
                        const target = spreadBands[i];
                        const previous = previousBars[i];
                        const smoothing = target > previous ? 0.42 : 0.14;
                        const smoothed = previous + ((target - previous) * smoothing);
                        previousBars[i] = smoothed;
                        nextBars.push(smoothed);
                    }

                    const aggregate = Math.max(
                        inputLevel,
                        nextBars.reduce((acc, n) => acc + n, 0) / BAR_COUNT,
                    );
                    setBarLevels(nextBars);
                    setAudioLevel(aggregate);

                    rafId = requestAnimationFrame(update);
                };

                update();
            } catch (_error) {
                if (mounted) {
                    setAudioLevel(0);
                    setBarLevels(IDLE_BAR_LEVELS);
                }
            }
        };

        startMeter();
        return () => {
            mounted = false;
            cleanup();
        };
    }, [isListening, widgetMode]);

    const handleDragMouseDown = (e: React.MouseEvent) => {
        if (e.button !== 0) return;
        const target = e.target as HTMLElement;
        if (target.closest('.no-drag')) return;

        e.preventDefault();

        if (window.require) {
            const { ipcRenderer } = window.require('electron');
            
            const initialWinX = window.screenX;
            const initialWinY = window.screenY;
            const startMouseX = e.screenX;
            const startMouseY = e.screenY;

            const handleMouseMove = (moveEvent: MouseEvent) => {
                const deltaX = moveEvent.screenX - startMouseX;
                const deltaY = moveEvent.screenY - startMouseY;
                ipcRenderer.send('window-move', {
                    x: initialWinX + deltaX,
                    y: initialWinY + deltaY,
                });
            };

            const handleMouseUp = () => {
                document.removeEventListener('mousemove', handleMouseMove);
                document.removeEventListener('mouseup', handleMouseUp);
            };

            document.addEventListener('mousemove', handleMouseMove);
            document.addEventListener('mouseup', handleMouseUp);
        }
    };

    const shouldShowMainPill = isListening || isProcessing;
    const shouldShowMeetingPrompt = meetingPrompt.visible && !!meetingPrompt.meeting && !shouldShowMainPill;
    const meetingProvider = resolveMeetingPromptProvider(meetingPrompt.meeting?.provider);
    const meetingPromptDurationMs = Number.isFinite(meetingPrompt.durationMs)
        ? Math.max(1000, meetingPrompt.durationMs || 4000)
        : 4000;
    const shouldShowLanguageBadge = shouldShowMainPill && widgetMode !== 'record' && languageBadge.visible;
    const languageBadgeInlineLabel = languageBadge.mode === 'cloud-multilingual'
        ? 'Multilingual'
        : languageBadge.mode === 'local-auto'
            ? 'Auto-detect'
            : languageBadge.tooltip.replace(/^(Monolingual|Fixed):\s*/, '');
    const shouldShowLanguageIcon = languageBadge.mode === 'cloud-multilingual' || languageBadge.mode === 'local-auto';

    const recordTimerLabel = `${Math.floor(recordElapsedSeconds / 60).toString().padStart(2, '0')}:${(recordElapsedSeconds % 60).toString().padStart(2, '0')}`;

    return (
        <div
            ref={containerRef}
            className={`es-theme-${theme} w-[400px] h-[220px] bg-transparent select-none overflow-visible relative`}
        >
            <style>{`
                @keyframes shrinkWidth {
                    from { transform: scaleX(1); }
                    to { transform: scaleX(0); }
                }
            `}</style>

            <div
                className="absolute bottom-4 right-[225px] no-drag z-10 transition-all duration-300 ease-in-out"
                style={{
                    opacity: isRecordListening ? 1 : 0,
                    transform: isRecordListening ? 'translateY(0) scale(1)' : 'translateY(8px) scale(0.9)',
                    pointerEvents: isRecordListening ? 'auto' : 'none',
                }}
                onMouseEnter={() => {
                    if (window.require) {
                        window.require('electron').ipcRenderer.send('record-widget:set-ignore-mouse-events', false);
                    }
                }}
                onMouseLeave={() => {
                    if (window.require) {
                        window.require('electron').ipcRenderer.send('record-widget:set-ignore-mouse-events', true, { forward: true });
                    }
                }}
            >
                <ProcessingModeWidget theme={theme} />
            </div>

            <div
                className="absolute bottom-4 left-[250px] w-[280px] -translate-x-1/2 no-drag z-30 transition-all duration-200 ease-out"
                aria-live="polite"
                style={{
                    opacity: shouldShowMeetingPrompt ? 1 : 0,
                    transform: shouldShowMeetingPrompt ? 'translate(-50%, 0) scale(1)' : 'translate(-50%, 8px) scale(0.96)',
                    pointerEvents: shouldShowMeetingPrompt ? 'auto' : 'none',
                }}
                onMouseEnter={() => {
                    if (window.require) {
                        window.require('electron').ipcRenderer.send('record-widget:set-ignore-mouse-events', false);
                    }
                }}
                onMouseLeave={() => {
                    if (window.require) {
                        window.require('electron').ipcRenderer.send('record-widget:set-ignore-mouse-events', true, { forward: true });
                    }
                }}
            >
                <div
                    className="rounded-xl border relative overflow-hidden shadow-lg select-none"
                    style={{
                        backgroundColor: t.bg,
                        borderColor: t.border,
                        color: t.accent,
                        width: '280px',
                        borderWidth: '1px',
                    }}
                >
                    <button
                        type="button"
                        className="absolute right-1.5 top-1.5 z-10 h-5 w-5 rounded-full inline-flex items-center justify-center opacity-60 transition-colors hover:bg-stone-500/10 hover:opacity-100"
                        aria-label="Dismiss meeting prompt"
                        style={{ color: t.accent }}
                        onClick={dismissMeetingPrompt}
                    >
                        <X size={11} />
                    </button>
                    <div className="flex items-center gap-3 px-3 py-2.5 pr-8">
                        <div className="flex h-9 w-9 shrink-0 items-center justify-center">
                            <img
                                src={meetingProvider.logo}
                                alt={meetingProvider.alt}
                                className="h-7 w-7 object-contain"
                                draggable={false}
                            />
                        </div>
                        <div className="min-w-0 flex-1 truncate text-sm font-semibold leading-tight">
                            {meetingProvider.name}
                        </div>
                        <button
                            type="button"
                            className="h-8 shrink-0 rounded-md bg-[#4CAE6B] px-3 text-xs font-semibold text-white transition-all hover:opacity-90 active:scale-95"
                            onClick={startMeetingRecording}
                        >
                            Start Recording
                        </button>
                    </div>
                    {shouldShowMeetingPrompt && (
                        <div className="w-full h-[2px] bg-stone-500/10 absolute bottom-0 left-0 overflow-hidden">
                            <div
                                key={`meeting-prompt-progress-${meetingPrompt.meeting?.key || 'unknown'}`}
                                className="h-full bg-[#4CAE6B] origin-left"
                                style={{
                                    animation: `shrinkWidth ${meetingPromptDurationMs}ms linear forwards`,
                                }}
                                onAnimationEnd={dismissMeetingPrompt}
                            />
                        </div>
                    )}
                </div>
            </div>

            {/* Banner anchor stays fixed even after its related pill has finished. */}
            <div
                className="absolute left-[250px] w-[280px] -translate-x-1/2 no-drag z-20 transition-all duration-200"
                style={{
                    bottom: shouldShowMeetingPrompt ? '88px' : '74px',
                    pointerEvents: bannerState.visible ? 'auto' : 'none',
                }}
                onMouseEnter={() => {
                    if (window.require) {
                        window.require('electron').ipcRenderer.send('record-widget:set-ignore-mouse-events', false);
                    }
                }}
                onMouseLeave={() => {
                    if (window.require) {
                        window.require('electron').ipcRenderer.send('record-widget:set-ignore-mouse-events', true, { forward: true });
                    }
                }}
            >
                <div
                    className="rounded-xl border relative overflow-hidden flex flex-col gap-1.5 shadow-lg select-none transition-opacity duration-150 ease-out"
                    aria-hidden={!bannerState.visible}
                    style={{
                        backgroundColor: t.bg,
                        borderColor: t.border,
                        color: theme === 'black' ? '#ffffff' : '#000000',
                        width: '280px',
                        opacity: bannerState.visible ? 1 : 0,
                        padding: '10px',
                        borderWidth: '1px',
                    }}
                >
                    <div className="flex items-start justify-between gap-2">
                        <span className="text-[11px] leading-snug font-semibold pr-4">
                            {bannerState.text}
                        </span>
                        <button
                            onClick={handleCloseBanner}
                            className="h-4.5 w-4.5 shrink-0 rounded-full inline-flex items-center justify-center hover:bg-stone-500/10 transition-all cursor-pointer opacity-60 hover:opacity-100"
                            aria-label="Dismiss"
                            style={{ color: t.accent }}
                        >
                            <X size={11} />
                        </button>
                    </div>
                    {bannerState.visible && (
                        <div className="w-full h-[2px] bg-stone-500/10 absolute bottom-0 left-0 overflow-hidden">
                            <div
                                className="h-full bg-[#4CAE6B] origin-left"
                                style={{
                                    animation: 'shrinkWidth 4000ms linear forwards'
                                }}
                            />
                        </div>
                    )}
                </div>
            </div>

            {/* Main recording / dictation pill uses a separate fixed anchor. */}
            <div
                className="flex flex-col items-center overflow-visible w-[280px] h-max cursor-default absolute bottom-2 left-[250px] -translate-x-1/2"
                onMouseDown={handleDragMouseDown}
                onMouseEnter={() => {
                    if (window.require) {
                        window.require('electron').ipcRenderer.send('record-widget:set-ignore-mouse-events', false);
                    }
                }}
                onMouseLeave={() => {
                    if (window.require) {
                        window.require('electron').ipcRenderer.send('record-widget:set-ignore-mouse-events', true, { forward: true });
                    }
                }}
            >
                {shouldShowMainPill && (
                    <div
                        className="relative h-[50px] w-[130px] overflow-visible"
                    >
                        {shouldShowLanguageBadge ? (
                            <div
                                className="absolute top-1/2 z-30 flex -translate-y-1/2 items-center overflow-visible select-none pointer-events-auto no-drag"
                                style={{ right: 'calc(100% + 12px)' }}
                                onMouseEnter={() => {
                                    setIsLanguageBadgeHovering(true);
                                    if (window.require) {
                                        window.require('electron').ipcRenderer.send('record-widget:set-ignore-mouse-events', false);
                                    }
                                }}
                                onMouseMove={() => setIsLanguageBadgeHovering(true)}
                                onMouseLeave={() => {
                                    setIsLanguageBadgeHovering(false);
                                    if (window.require) {
                                        window.require('electron').ipcRenderer.send('record-widget:set-ignore-mouse-events', true, { forward: true });
                                    }
                                }}
                                onPointerEnter={() => {
                                    setIsLanguageBadgeHovering(true);
                                    if (window.require) {
                                        window.require('electron').ipcRenderer.send('record-widget:set-ignore-mouse-events', false);
                                    }
                                }}
                                onPointerLeave={() => {
                                    setIsLanguageBadgeHovering(false);
                                    if (window.require) {
                                        window.require('electron').ipcRenderer.send('record-widget:set-ignore-mouse-events', true, { forward: true });
                                    }
                                }}
                            >
                                <div
                                    className="pointer-events-none absolute left-1/2 top-[-12px] whitespace-nowrap rounded-md px-1.5 py-[2px] text-[10px] font-medium leading-none transition-all duration-300 ease-in-out shrink-0"
                                    style={{
                                        backgroundColor: t.bg,
                                        border: `1px solid ${t.border}`,
                                        color: t.accent,
                                        opacity: isLanguageBadgeHovering ? 1 : 0,
                                        transform: isLanguageBadgeHovering ? 'translate(-50%, 0)' : 'translate(-50%, 4px)',
                                        zIndex: 40,
                                    }}
                                >
                                    {languageBadge.tooltip}
                                </div>
                                <div
                                    className="flex h-8 items-center overflow-hidden rounded-full border text-[10px] font-bold leading-none transition-all duration-300 ease-in-out"
                                    aria-label={languageBadge.tooltip}
                                    title={languageBadge.tooltip}
                                    style={{
                                        backgroundColor: t.bg,
                                        borderColor: t.border,
                                        color: t.accent,
                                        boxShadow: 'none',
                                        width: isLanguageBadgeHovering ? '146px' : '32px',
                                        gap: isLanguageBadgeHovering ? '6px' : '0px',
                                        paddingLeft: isLanguageBadgeHovering ? '3px' : '0px',
                                        paddingRight: isLanguageBadgeHovering ? '8px' : '0px',
                                    }}
                                >
                                    <span className="flex h-8 w-8 shrink-0 items-center justify-center">
                                        {shouldShowLanguageIcon ? (
                                            <Languages className="h-4 w-4" strokeWidth={2.4} />
                                        ) : (
                                            <span className="block w-full text-center uppercase leading-none">{languageBadge.codeLabel}</span>
                                        )}
                                    </span>
                                    <span
                                        className="min-w-0 truncate text-left normal-case transition-all duration-300 ease-in-out"
                                        style={{
                                            opacity: isLanguageBadgeHovering ? 1 : 0,
                                            width: isLanguageBadgeHovering ? '100px' : '0px',
                                        }}
                                    >
                                        {languageBadgeInlineLabel}
                                    </span>
                                </div>
                            </div>
                        ) : null}

                        <div
                            ref={pillRef}
                            className="flex items-center px-1.5 w-[130px] h-[50px] overflow-visible rounded-xl"
                            style={{
                                boxShadow: 'none',
                                background: t.bg,
                                border: `1px solid ${t.border}`,
                                color: 'white',
                            }}
                        >
                            <button
                                type="button"
                                className="flex items-center justify-center w-7 h-7 rounded-full shrink-0 no-drag hover:bg-red-500/20 active:scale-95 transition-all"
                                onClick={(e) => {
                                    e.stopPropagation();
                                    if (isRecordListening && window.require) {
                                        const { ipcRenderer } = window.require('electron');
                                        ipcRenderer.send('record-widget:stop-recording');
                                    }
                                }}
                                style={{
                                    backgroundColor: isRecordListening ? 'rgba(255, 255, 255, 0.08)' : t.accent,
                                    color: isRecordListening ? '#ffffff' : (theme === 'black' ? '#0a0a0a' : '#fff'),
                                    boxShadow: 'none',
                                    border: isRecordListening ? '1px solid rgba(255, 255, 255, 0.2)' : 'none',
                                }}
                            >
                                {isRecordListening ? (
                                    <div className="w-[10px] h-[10px] rounded-[2px]" style={{ backgroundColor: '#ef4444' }} />
                                ) : isListening ? (
                                    widgetMode === 'quick-note'
                                        ? <FileText className="w-3.5 h-3.5" strokeWidth={2.5} />
                                        : <Ear className="w-3.5 h-3.5" strokeWidth={2.5} />
                                ) : isProcessing ? (
                                    <svg className="w-3.5 h-3.5 animate-spin" viewBox="0 0 24 24" fill="none">
                                        <circle cx="12" cy="12" r="9" stroke="currentColor" strokeWidth="2.5" strokeOpacity="0.2" />
                                        <path d="M12 3a9 9 0 0 1 9 9" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" />
                                    </svg>
                                ) : (
                                    <Mic className="w-3.5 h-3.5" strokeWidth={2} />
                                )}
                            </button>

                            {/* Right Content */}
                            <div className={`flex-1 flex items-center ${isRecordListening ? 'justify-center' : 'justify-start'} h-full px-3 overflow-hidden`}>
                                {isListening ? (
                                    <div className={`w-full ${isRecordListening ? 'flex flex-col items-center justify-center gap-[2px] h-full' : 'flex items-center justify-center gap-[3px] h-5'}`}>
                                        <div className="flex items-center justify-center gap-[3px] h-8">
                                            {barLevels.map((level, i) => {
                                                const quiet = audioLevel < 0.03;
                                                const size = quiet
                                                    ? 4
                                                    : Math.round(4 + (Math.pow(Math.max(0, Math.min(1, level)), 1.45) * 30));

                                                return (
                                                    <div
                                                        key={i}
                                                        className="rounded-full"
                                                        style={{
                                                            width: '4px',
                                                            height: `${size}px`,
                                                            backgroundColor: isRecordListening ? '#f87171' : t.accent,
                                                            opacity: quiet ? 0.52 : (0.42 + (Math.pow(level, 0.75) * 0.58)),
                                                            transformOrigin: 'center',
                                                            transition: 'height 72ms linear, width 72ms linear, opacity 90ms linear',
                                                            animation: 'none',
                                                            animationDelay: '0s',
                                                        }}
                                                    />
                                                );
                                            })}
                                        </div>
                                    </div>
                                ) : isProcessing ? (
                                    <span
                                        className="text-[11px] uppercase font-bold tracking-widest"
                                        style={{
                                            color: t.accent,
                                            animation: 'pulse 1.2s ease-in-out infinite',
                                        }}
                                    >
                                        Thinking…
                                    </span>
                                ) : (
                                    <></>
                                )}
                            </div>
                        </div>

                        {isRecordListening ? (
                            <div
                                className="absolute left-1/2 bottom-0 z-20 flex h-4 -translate-x-1/2 translate-y-1/2 items-center rounded-md px-2 text-[9px] font-semibold tracking-[0.14em] tabular-nums no-drag"
                                style={{
                                    color: 'rgba(255, 255, 255, 0.84)',
                                    background: 'rgba(16, 16, 16, 0.96)',
                                    border: '1px solid rgba(255, 255, 255, 0.18)',
                                }}
                            >
                                {recordTimerLabel}
                            </div>
                        ) : null}
                    </div>
                )}
                {isRecordListening ? (
                    <div
                        aria-hidden="true"
                        className="-mt-2 flex h-4 items-center rounded-md px-2 text-[9px] font-semibold tracking-[0.14em] tabular-nums opacity-0 pointer-events-none"
                    >
                        {recordTimerLabel}
                    </div>
                ) : null}
            </div>
        </div>
    );
};

export default App;
