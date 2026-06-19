import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
    Check,
    ChevronLeft,
    ChevronRight,
    Ear,
    FileText,
    Mic,
    Play,
    RefreshCw,
    Settings,
    Sparkles,
    Square,
} from 'lucide-react';
import type { Note, RecordingItem, RecordModeStatus } from '../types';

const { ipcRenderer } = window.require('electron');

type TutorialStepId = 'mic' | 'dictation' | 'recording' | 'summary' | 'quick-note';
type TutorialCompletion = Record<TutorialStepId, boolean>;
type VoiceActionStatus = {
    mode?: 'dictation' | 'quick-note';
    state?: 'listening' | 'processing' | 'idle' | 'error';
    source?: string;
    message?: string;
};
type ShortcutRuntimeStatus = {
    active?: {
        dictationHold?: { display?: string };
        dictationHandsFree?: { display?: string };
        quickNote?: { display?: string };
        recordMode?: { display?: string };
    };
    localSpeech?: {
        isLocalRoute?: boolean;
        available?: boolean;
        warming?: boolean;
        status?: string;
        message?: string;
    };
};

interface OnboardingTutorialProps {
    notes: Note[];
    recordings: RecordingItem[];
    recordModeStatus: RecordModeStatus;
    onBack: () => void;
    onComplete: () => void | Promise<void>;
}

const TUTORIAL_STEPS: Array<{ id: TutorialStepId; label: string; kicker: string }> = [
    { id: 'mic', label: 'Test your microphone', kicker: 'Input' },
    { id: 'dictation', label: 'Try dictation', kicker: 'Command' },
    { id: 'recording', label: 'Record a sample', kicker: 'Meeting' },
    { id: 'summary', label: 'Generate a summary', kicker: 'AI' },
    { id: 'quick-note', label: 'Try quick notes', kicker: 'Capture' },
];

const EMPTY_COMPLETION: TutorialCompletion = {
    mic: false,
    dictation: false,
    recording: false,
    summary: false,
    'quick-note': false,
};

const METER_BAR_COUNT = 13;
const IDLE_METER_BARS = Array.from({ length: METER_BAR_COUNT }, () => 0.08);
const SAMPLE_AUDIO_URL = `${process.env.PUBLIC_URL || ''}/audio/onboarding-recording-sample.mp3`;

function clamp01(value: number) {
    return Math.max(0, Math.min(1, value));
}

function formatRecordingStatus(status: RecordModeStatus) {
    if (status === 'capturing') return 'Recording sample audio';
    if (status === 'processing') return 'Generating transcript';
    if (status === 'selecting') return 'Choosing audio source';
    if (status === 'done') return 'Recording saved';
    if (status === 'error') return 'Recording needs attention';
    return 'Waiting for shortcut';
}

function normalizeShortcutLabel(label: string | undefined, fallback: string) {
    const clean = String(label || '').trim();
    if (!clean || clean.toLowerCase() === 'unavailable') return fallback;
    return clean;
}

function cleanDictationActionLabel(label: string | undefined) {
    return normalizeShortcutLabel(label, '')
        .replace(/\/Globe/g, '')
        .replace(/\s+(hold|toggle)$/i, '')
        .replace(/\s*\+\s*/g, '+')
        .trim();
}

function formatDictationTutorialLabel(active: ShortcutRuntimeStatus['active'] | undefined) {
    const holdLabel = cleanDictationActionLabel(active?.dictationHold?.display);
    const handsFreeLabel = cleanDictationActionLabel(active?.dictationHandsFree?.display);
    const hasHoldShortcut = Boolean(holdLabel) && !/disabled|unavailable/i.test(holdLabel);
    const hasHandsFreeShortcut = Boolean(handsFreeLabel) && !/disabled|unavailable/i.test(handsFreeLabel);

    if (hasHoldShortcut && hasHandsFreeShortcut) {
        return `Hold ${holdLabel} or press ${handsFreeLabel}`;
    }
    if (hasHandsFreeShortcut) {
        return `Press ${handsFreeLabel}`;
    }
    if (hasHoldShortcut) {
        return `Hold ${holdLabel}`;
    }
    return 'Hold Fn or press Fn+Space';
}

export default function OnboardingTutorial({
    notes,
    recordings,
    recordModeStatus,
    onBack,
    onComplete,
}: OnboardingTutorialProps) {
    const [activeStep, setActiveStep] = useState<TutorialStepId>('mic');
    const [completion, setCompletion] = useState<TutorialCompletion>(EMPTY_COMPLETION);
    const [voiceStatus, setVoiceStatus] = useState<VoiceActionStatus>({});
    const [shortcutsRuntime, setShortcutsRuntime] = useState<ShortcutRuntimeStatus | null>(null);
    const [micDevices, setMicDevices] = useState<MediaDeviceInfo[]>([]);
    const [selectedMicDeviceId, setSelectedMicDeviceId] = useState('');
    const [micBars, setMicBars] = useState<number[]>(IDLE_METER_BARS);
    const [micMeterActive, setMicMeterActive] = useState(false);
    const [micMeterError, setMicMeterError] = useState('');
    const [micRetryKey, setMicRetryKey] = useState(0);
    const [dictationText, setDictationText] = useState('');
    const [samplePlaybackState, setSamplePlaybackState] = useState<'idle' | 'playing' | 'played'>('idle');
    const [samplePlaybackError, setSamplePlaybackError] = useState('');
    const [tutorialRecordingId, setTutorialRecordingId] = useState<string | null>(null);
    const [summaryText, setSummaryText] = useState('');
    const [summaryError, setSummaryError] = useState('');
    const [isGeneratingSummary, setIsGeneratingSummary] = useState(false);
    const [tutorialQuickNoteId, setTutorialQuickNoteId] = useState<string | null>(null);

    const dictationInputRef = useRef<HTMLTextAreaElement | null>(null);
    const recordingBaselineIdsRef = useRef<Set<string>>(new Set(recordings.map((recording) => recording.id)));
    const noteBaselineIdsRef = useRef<Set<string>>(new Set(notes.map((note) => note.id)));
    const renamedRecordingIdsRef = useRef<Set<string>>(new Set());
    const renamedNoteIdsRef = useRef<Set<string>>(new Set());
    const sampleAudioRef = useRef<HTMLAudioElement | null>(null);

    const activeIndex = TUTORIAL_STEPS.findIndex((step) => step.id === activeStep);
    const activeStepMeta = TUTORIAL_STEPS[activeIndex] || TUTORIAL_STEPS[0];
    const tutorialRecording = tutorialRecordingId
        ? recordings.find((recording) => recording.id === tutorialRecordingId) || null
        : null;
    const tutorialQuickNote = tutorialQuickNoteId
        ? notes.find((note) => note.id === tutorialQuickNoteId) || null
        : null;

    const shortcutLabels = useMemo(() => {
        const active = shortcutsRuntime?.active || {};
        return {
            dictation: formatDictationTutorialLabel(active),
            record: normalizeShortcutLabel(active.recordMode?.display, 'Control+R'),
            quickNote: normalizeShortcutLabel(active.quickNote?.display, 'Control+N'),
        };
    }, [shortcutsRuntime]);
    const localSpeechPreparing = shortcutsRuntime?.localSpeech?.isLocalRoute === true
        && shortcutsRuntime?.localSpeech?.available !== true;

    const markComplete = useCallback((stepId: TutorialStepId) => {
        setCompletion((previous) => previous[stepId] ? previous : { ...previous, [stepId]: true });
    }, []);

    const refreshShortcutsRuntime = useCallback(async (options: { refreshLocalSpeech?: boolean } = {}) => {
        try {
            if (options.refreshLocalSpeech) {
                await ipcRenderer.invoke('runtime:local-stt-status').catch(() => null);
            }
            const result = await ipcRenderer.invoke('shortcuts:get-runtime');
            const nextRuntime = result && typeof result === 'object' ? result as ShortcutRuntimeStatus : null;
            setShortcutsRuntime(nextRuntime);
            return nextRuntime;
        } catch (_error) {
            setShortcutsRuntime(null);
            return null;
        }
    }, []);

    const selectStep = useCallback((stepId: TutorialStepId) => {
        if (stepId === 'recording') {
            recordingBaselineIdsRef.current = new Set(recordings.map((recording) => recording.id));
            setSamplePlaybackState('idle');
            setSamplePlaybackError('');
        }
        if (stepId === 'quick-note') {
            noteBaselineIdsRef.current = new Set(notes.map((note) => note.id));
        }
        if (stepId === 'summary') {
            setSummaryError('');
            setSummaryText(tutorialRecording?.summary || '');
        }
        setActiveStep(stepId);
    }, [notes, recordings, tutorialRecording?.summary]);

    const goNext = useCallback(() => {
        const nextStep = TUTORIAL_STEPS[activeIndex + 1];
        if (!nextStep) {
            onComplete();
            return;
        }
        selectStep(nextStep.id);
    }, [activeIndex, onComplete, selectStep]);

    const goBack = useCallback(() => {
        const previousStep = TUTORIAL_STEPS[activeIndex - 1];
        if (!previousStep) {
            onBack();
            return;
        }
        selectStep(previousStep.id);
    }, [activeIndex, onBack, selectStep]);

    useEffect(() => {
        void refreshShortcutsRuntime({ refreshLocalSpeech: true });
    }, [refreshShortcutsRuntime]);

    useEffect(() => {
        if (!localSpeechPreparing) return () => undefined;

        let cancelled = false;
        let pollTimer: number | undefined;

        const pollRuntime = async () => {
            const runtime = await refreshShortcutsRuntime({ refreshLocalSpeech: true });
            if (cancelled) return;
            const localSpeech = runtime?.localSpeech;
            if (localSpeech?.isLocalRoute === true && localSpeech.available !== true) {
                pollTimer = window.setTimeout(() => {
                    void pollRuntime();
                }, 5000);
            }
        };

        pollTimer = window.setTimeout(() => {
            void pollRuntime();
        }, 1500);

        return () => {
            cancelled = true;
            if (pollTimer) {
                window.clearTimeout(pollTimer);
            }
        };
    }, [localSpeechPreparing, refreshShortcutsRuntime]);

    useEffect(() => {
        const handleVoiceActionStatus = (_event: any, payload: VoiceActionStatus = {}) => {
            setVoiceStatus(payload || {});
        };
        ipcRenderer.on('voice-action:status', handleVoiceActionStatus);
        return () => {
            ipcRenderer.removeListener('voice-action:status', handleVoiceActionStatus);
        };
    }, []);

    useEffect(() => {
        if (activeStep !== 'dictation') return;
        window.setTimeout(() => dictationInputRef.current?.focus(), 120);
    }, [activeStep]);

    useEffect(() => {
        if (activeStep === 'dictation' && dictationText.trim().length >= 8) {
            markComplete('dictation');
        }
    }, [activeStep, dictationText, markComplete]);

    useEffect(() => {
        if (activeStep !== 'mic') return () => undefined;

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
                } catch (_error) {}
                sourceNode = null;
            }
            if (analyser) {
                try {
                    analyser.disconnect();
                } catch (_error) {}
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
                setMicMeterActive(false);
                setMicBars(IDLE_METER_BARS);
            }
        };

        const startMeter = async () => {
            try {
                if (!navigator.mediaDevices?.getUserMedia) {
                    throw new Error('Microphone capture is not available in this runtime.');
                }

                const audio: MediaTrackConstraints = {
                    echoCancellation: false,
                    noiseSuppression: false,
                    autoGainControl: false,
                };
                if (selectedMicDeviceId) {
                    audio.deviceId = { exact: selectedMicDeviceId };
                }

                stream = await navigator.mediaDevices.getUserMedia({ audio, video: false });
                if (!mounted) {
                    cleanup();
                    return;
                }

                const devices = await navigator.mediaDevices.enumerateDevices();
                if (mounted) {
                    setMicDevices(devices.filter((device) => device.kind === 'audioinput'));
                }

                const AudioContextCtor = (window as any).AudioContext || (window as any).webkitAudioContext;
                if (!AudioContextCtor) {
                    throw new Error('Audio analysis is not available in this runtime.');
                }

                const ctx: AudioContext = new AudioContextCtor();
                audioContext = ctx;
                sourceNode = ctx.createMediaStreamSource(stream);
                analyser = ctx.createAnalyser();
                analyser.fftSize = 1024;
                analyser.smoothingTimeConstant = 0.58;
                sourceNode.connect(analyser);

                const timeData = new Uint8Array(analyser.fftSize);
                const previous = IDLE_METER_BARS.slice();
                let noiseFloor = 0.01;

                const update = () => {
                    if (!mounted || !analyser) return;
                    analyser.getByteTimeDomainData(timeData);
                    let rmsSum = 0;
                    for (let i = 0; i < timeData.length; i += 1) {
                        const centered = (timeData[i] - 128) / 128;
                        rmsSum += centered * centered;
                    }
                    const rms = Math.sqrt(rmsSum / timeData.length);
                    if (rms < noiseFloor + 0.025) {
                        noiseFloor = (noiseFloor * 0.992) + (rms * 0.008);
                    }
                    noiseFloor = Math.max(0.004, Math.min(0.05, noiseFloor));
                    const level = clamp01((rms - noiseFloor - 0.0015) * 20);
                    const boostedLevel = clamp01(level * 1.45);
                    const next = previous.map((current, index) => {
                        const threshold = (index + 0.55) / METER_BAR_COUNT;
                        const target = boostedLevel >= threshold ? 1 : 0;
                        const smoothing = target > current ? 0.42 : 0.18;
                        const value = current + ((target - current) * smoothing);
                        previous[index] = value;
                        return value;
                    });
                    setMicMeterActive(true);
                    setMicMeterError('');
                    setMicBars(next);
                    rafId = requestAnimationFrame(update);
                };

                update();
            } catch (error: any) {
                if (!mounted) return;
                cleanup();
                setMicMeterError(error?.message || 'Could not start microphone test.');
            }
        };

        void startMeter();
        return () => {
            mounted = false;
            cleanup();
        };
    }, [activeStep, micRetryKey, selectedMicDeviceId]);

    useEffect(() => {
        if (activeStep !== 'recording' && activeStep !== 'summary') return;
        if (tutorialRecordingId) return;
        const baseline = recordingBaselineIdsRef.current;
        const newest = recordings
            .filter((recording) => !baseline.has(recording.id))
            .sort((a, b) => Number(b.createdAt || 0) - Number(a.createdAt || 0))[0];
        if (!newest) return;

        setTutorialRecordingId(newest.id);
        markComplete('recording');
        if (!renamedRecordingIdsRef.current.has(newest.id)) {
            renamedRecordingIdsRef.current.add(newest.id);
            void ipcRenderer.invoke('recordings:update-metadata', {
                id: newest.id,
                title: 'Tutorial Recording Sample',
            });
        }
    }, [activeStep, markComplete, recordings, tutorialRecordingId]);

    useEffect(() => {
        if (!tutorialRecording?.summary) return;
        setSummaryText(tutorialRecording.summary);
        markComplete('summary');
    }, [markComplete, tutorialRecording?.summary]);

    useEffect(() => {
        const handleSummaryChunk = (_event: any, payload: { recordingId?: string; chunk?: string } = {}) => {
            if (!tutorialRecordingId || payload.recordingId !== tutorialRecordingId) return;
            const chunk = String(payload.chunk || '');
            if (!chunk) return;
            setSummaryText((previous) => previous + chunk);
        };
        ipcRenderer.on('recordings:summary-chunk', handleSummaryChunk);
        return () => {
            ipcRenderer.removeListener('recordings:summary-chunk', handleSummaryChunk);
        };
    }, [tutorialRecordingId]);

    useEffect(() => {
        if (activeStep !== 'quick-note') return;
        if (tutorialQuickNoteId) return;
        const baseline = noteBaselineIdsRef.current;
        const newest = notes
            .filter((note) => !baseline.has(note.id))
            .sort((a, b) => Number(b.lastModified || b.createdAt || 0) - Number(a.lastModified || a.createdAt || 0))[0];
        if (!newest) return;

        setTutorialQuickNoteId(newest.id);
        markComplete('quick-note');
        if (!renamedNoteIdsRef.current.has(newest.id)) {
            renamedNoteIdsRef.current.add(newest.id);
            ipcRenderer.send('save-note', {
                ...newest,
                title: 'Tutorial Quick Note',
                lastModified: Date.now(),
            });
        }
    }, [activeStep, markComplete, notes, tutorialQuickNoteId]);

    useEffect(() => {
        if (activeStep === 'recording') return;
        const audio = sampleAudioRef.current;
        if (audio) {
            audio.pause();
            audio.currentTime = 0;
        }
        setSamplePlaybackState((previous) => previous === 'playing' ? 'played' : previous);
    }, [activeStep]);

    useEffect(() => () => {
        const audio = sampleAudioRef.current;
        if (audio) {
            audio.pause();
            audio.currentTime = 0;
        }
    }, []);

    const playSampleConversation = () => {
        setSamplePlaybackError('');
        const audio = sampleAudioRef.current;
        if (!audio) {
            setSamplePlaybackError('Sample audio is unavailable. Read a short conversation aloud while recording is active.');
            setSamplePlaybackState('played');
            return;
        }
        audio.pause();
        audio.currentTime = 0;
        setSamplePlaybackState('playing');
        audio.play().catch((error: any) => {
            setSamplePlaybackError(error?.message || 'Sample audio could not be played. Read a short conversation aloud instead.');
            setSamplePlaybackState('played');
        });
    };

    const stopSampleConversation = () => {
        const audio = sampleAudioRef.current;
        if (audio) {
            audio.pause();
            audio.currentTime = 0;
        }
        setSamplePlaybackState('played');
    };

    const generateSummary = async () => {
        if (!tutorialRecordingId || isGeneratingSummary) return;
        setSummaryText('');
        setSummaryError('');
        setIsGeneratingSummary(true);
        try {
            const result = await ipcRenderer.invoke('recordings:generate-summary', {
                id: tutorialRecordingId,
                stream: true,
            });
            if (result?.status !== 'success') {
                setSummaryError(result?.message || 'Failed to generate summary.');
                return;
            }
            setSummaryText(String(result.summary || '').trim());
            markComplete('summary');
        } catch (error: any) {
            setSummaryError(error?.message || 'Failed to generate summary.');
        } finally {
            setIsGeneratingSummary(false);
        }
    };

    const finishTutorial = () => {
        void onComplete();
    };

    const renderStepContent = () => {
        if (activeStep === 'mic') {
            return (
                <div className="space-y-5">
                    <div className="space-y-2 text-center">
                        <h2 className="text-2xl md:text-3xl font-extrabold es-general-text tracking-tight">Test your microphone</h2>
                        <p className="text-xs md:text-sm es-general-secondary-text leading-relaxed">
                            Speak normally and confirm when the bars respond.
                        </p>
                    </div>
                    <div className="rounded-xl border es-global-outline bg-white/70 dark:bg-white/[0.03] p-5 shadow-sm space-y-4">
                        <div className="text-sm font-extrabold es-general-text">Do you see green bars while you speak?</div>
                        <div className="h-28 rounded-xl bg-stone-500/5 flex items-center justify-center gap-3 px-6">
                            {micBars.map((level, index) => (
                                <div
                                    key={`meter-bar-${index}`}
                                    className="h-16 w-3 overflow-hidden rounded-full bg-emerald-500/10 transition-all duration-75"
                                    aria-hidden="true"
                                >
                                    <div
                                        className="h-full w-full rounded-full bg-emerald-500 transition-opacity duration-75"
                                        style={{ opacity: micMeterActive ? level : 0 }}
                                    />
                                </div>
                            ))}
                        </div>
                        {micMeterError ? (
                            <div className="rounded-lg border border-rose-500/20 bg-rose-500/5 p-3 text-[11px] text-rose-400">
                                {micMeterError}
                            </div>
                        ) : null}
                        <div className="flex flex-wrap items-center justify-between gap-3">
                            <select
                                value={selectedMicDeviceId}
                                onChange={(event) => setSelectedMicDeviceId(event.target.value)}
                                className="min-w-[220px] flex-1 rounded-lg border es-global-outline bg-transparent px-3 py-2 text-xs es-general-text"
                            >
                                <option value="">Default microphone</option>
                                {micDevices.map((device, index) => (
                                    <option key={device.deviceId || `mic-${index}`} value={device.deviceId}>
                                        {device.label || `Microphone ${index + 1}`}
                                    </option>
                                ))}
                            </select>
                            <div className="flex items-center gap-2">
                                <button
                                    type="button"
                                    onClick={() => setMicRetryKey((value) => value + 1)}
                                    className="inline-flex items-center gap-1.5 rounded-lg border es-global-outline px-3 py-2 text-xs font-bold es-general-text hover:bg-stone-500/5"
                                >
                                    <RefreshCw size={13} /> Retry
                                </button>
                                <button
                                    type="button"
                                    onClick={() => ipcRenderer.invoke('microphone:open-settings')}
                                    className="inline-flex items-center gap-1.5 rounded-lg border es-global-outline px-3 py-2 text-xs font-bold es-general-text hover:bg-stone-500/5"
                                >
                                    <Settings size={13} /> Settings
                                </button>
                            </div>
                        </div>
                    </div>
                </div>
            );
        }

        if (activeStep === 'dictation') {
            const isVoiceBusy = voiceStatus.mode === 'dictation' && voiceStatus.state && voiceStatus.state !== 'idle';
            return (
                <div className="space-y-5">
                    <TutorialHeader icon={Ear} title="Try dictation" body="Hold Fn or press Fn+Space while this field is focused." />
                    <ShortcutPrompt
                        label={shortcutLabels.dictation}
                        state={isVoiceBusy ? voiceStatus.state : undefined}
                        idleLabel={localSpeechPreparing ? 'Preparing model' : undefined}
                        idleTone={localSpeechPreparing ? 'warning' : undefined}
                    />
                    <textarea
                        ref={dictationInputRef}
                        value={dictationText}
                        onChange={(event) => setDictationText(event.target.value)}
                        placeholder="Dictate a sentence here..."
                        className="h-44 w-full resize-none rounded-xl border es-global-outline bg-white/70 dark:bg-white/[0.03] p-4 text-sm es-general-text outline-none focus:border-emerald-500 focus:ring-2 focus:ring-emerald-500/20"
                    />
                    {completion.dictation ? <SuccessBanner text="Dictation landed in the practice field." /> : null}
                </div>
            );
        }

        if (activeStep === 'recording') {
            const canPlaySample = recordModeStatus === 'capturing';
            return (
                <div className="space-y-5">
                    <TutorialHeader icon={Mic} title="Record a sample" body="Start recording with the shortcut, play the sample conversation, then stop recording with the same shortcut." />
                    <ShortcutPrompt label={shortcutLabels.record} state={recordModeStatus === 'capturing' ? 'listening' : recordModeStatus === 'processing' ? 'processing' : undefined} />
                    <audio
                        ref={sampleAudioRef}
                        src={SAMPLE_AUDIO_URL}
                        preload="auto"
                        onEnded={() => setSamplePlaybackState('played')}
                        onError={() => {
                            setSamplePlaybackError('Sample audio could not be loaded. Read a short conversation aloud instead.');
                            setSamplePlaybackState('played');
                        }}
                    />
                    <div className="grid gap-3 md:grid-cols-[1fr_auto]">
                        <div className="rounded-xl border es-global-outline bg-white/70 dark:bg-white/[0.03] p-4">
                            <div className="text-[10px] font-bold uppercase tracking-[0.16em] es-general-secondary-text">Sample audio</div>
                            <p className="mt-2 text-sm leading-relaxed es-general-text">
                                Play the built-in audio sample while recording is active.
                            </p>
                        </div>
                        <div className="flex md:flex-col gap-2">
                            <button
                                type="button"
                                disabled={!canPlaySample || samplePlaybackState === 'playing'}
                                onClick={playSampleConversation}
                                className="inline-flex items-center justify-center gap-1.5 rounded-lg bg-emerald-500 px-4 py-2 text-xs font-bold text-white shadow hover:bg-emerald-600 disabled:opacity-45"
                            >
                                <Play size={14} /> Play
                            </button>
                            <button
                                type="button"
                                disabled={samplePlaybackState !== 'playing'}
                                onClick={stopSampleConversation}
                                className="inline-flex items-center justify-center gap-1.5 rounded-lg border es-global-outline px-4 py-2 text-xs font-bold es-general-text hover:bg-stone-500/5 disabled:opacity-45"
                            >
                                <Square size={13} /> Stop
                            </button>
                        </div>
                    </div>
                    <div className="rounded-xl border es-global-outline p-4">
                        <div className="flex items-center justify-between gap-3">
                            <div>
                                <div className="text-xs font-bold es-general-text">{formatRecordingStatus(recordModeStatus)}</div>
                                <div className="mt-1 text-[11px] es-general-secondary-text">
                                    {tutorialRecording ? 'Transcript saved as Tutorial Recording Sample.' : 'The wizard will show the transcript as soon as recording processing finishes.'}
                                </div>
                            </div>
                            <span className={`rounded-full px-2.5 py-1 text-[10px] font-bold uppercase ${
                                recordModeStatus === 'capturing'
                                    ? 'bg-rose-500/10 text-rose-400'
                                    : recordModeStatus === 'processing'
                                        ? 'bg-emerald-500/10 text-emerald-500'
                                        : 'bg-stone-500/10 es-general-secondary-text'
                            }`}>
                                {recordModeStatus}
                            </span>
                        </div>
                    </div>
                    {samplePlaybackError ? (
                        <div className="rounded-lg border border-amber-500/20 bg-amber-500/5 p-3 text-[11px] text-amber-500">
                            {samplePlaybackError}
                        </div>
                    ) : null}
                    {tutorialRecording ? (
                        <ResultPreview
                            title={tutorialRecording.title || 'Tutorial Recording Sample'}
                            body={tutorialRecording.transcript || 'Transcript is still being prepared.'}
                        />
                    ) : null}
                </div>
            );
        }

        if (activeStep === 'summary') {
            return (
                <div className="space-y-5">
                    <TutorialHeader icon={Sparkles} title="Generate a summary" body="Turn the saved sample transcript into a concise meeting summary." />
                    {!tutorialRecording ? (
                        <div className="rounded-xl border es-global-outline bg-stone-500/5 p-4 text-sm es-general-secondary-text">
                            Record a sample first, or skip this step.
                        </div>
                    ) : (
                        <>
                            <ResultPreview
                                title="Transcript"
                                body={tutorialRecording.transcript || 'Transcript is still being prepared.'}
                            />
                            <button
                                type="button"
                                disabled={isGeneratingSummary || !tutorialRecording.transcript}
                                onClick={generateSummary}
                                className="inline-flex items-center gap-1.5 rounded-lg bg-emerald-500 px-4 py-2 text-xs font-bold text-white shadow hover:bg-emerald-600 disabled:opacity-45"
                            >
                                <Sparkles size={14} /> {isGeneratingSummary ? 'Generating...' : 'Generate summary'}
                            </button>
                            {summaryError ? (
                                <div className="rounded-lg border border-rose-500/20 bg-rose-500/5 p-3 text-[11px] text-rose-400">
                                    {summaryError}
                                </div>
                            ) : null}
                            {summaryText ? <ResultPreview title="Summary" body={summaryText} /> : null}
                        </>
                    )}
                </div>
            );
        }

        const isQuickNoteBusy = voiceStatus.mode === 'quick-note' && voiceStatus.state && voiceStatus.state !== 'idle';
        return (
            <div className="space-y-5">
                <TutorialHeader icon={FileText} title="Try quick notes" body="Use the quick-note shortcut to capture one fleeting thought." />
                <ShortcutPrompt
                    label={shortcutLabels.quickNote}
                    state={isQuickNoteBusy ? voiceStatus.state : undefined}
                />
                <div className="rounded-xl border es-global-outline bg-white/70 dark:bg-white/[0.03] p-4">
                    <div className="text-[10px] font-bold uppercase tracking-[0.16em] es-general-secondary-text">Prompt</div>
                    <p className="mt-2 text-sm es-general-text">
                        Say one short note, then press the shortcut again to finish.
                    </p>
                </div>
                {tutorialQuickNote ? (
                    <ResultPreview
                        title={tutorialQuickNote.title || 'Tutorial Quick Note'}
                        body={tutorialQuickNote.text || 'Quick note saved.'}
                    />
                ) : null}
            </div>
        );
    };

    const isFinalStep = activeStep === 'quick-note';
    const canContinue = activeStep === 'mic' || completion[activeStep];
    const primaryButtonLabel = activeStep === 'mic'
        ? 'Yes'
        : isFinalStep
            ? 'Finish setup'
            : 'Continue';
    const handlePrimaryAction = () => {
        if (activeStep === 'mic') {
            markComplete('mic');
            goNext();
            return;
        }
        if (isFinalStep) {
            finishTutorial();
            return;
        }
        goNext();
    };

    return (
        <div className="flex-1 flex overflow-hidden">
            <aside className="w-[270px] shrink-0 border-r es-global-separator p-6 bg-stone-500/[0.03]">
                <div className="mb-6">
                    <div className="text-[10px] font-black uppercase tracking-[0.2em] es-general-secondary-text">Tutorial</div>
                    <div className="mt-1 text-lg font-extrabold es-general-text">Practice the commands</div>
                </div>
                <div className="space-y-2">
                    {TUTORIAL_STEPS.map((step, index) => {
                        const active = step.id === activeStep;
                        const done = completion[step.id];
                        return (
                            <button
                                key={step.id}
                                type="button"
                                onClick={() => selectStep(step.id)}
                                className={`w-full rounded-xl border p-3 text-left transition-all ${
                                    active
                                        ? 'border-emerald-500 bg-emerald-500/5 shadow-sm'
                                        : 'es-global-outline hover:bg-stone-500/5'
                                }`}
                            >
                                <div className="flex items-center justify-between gap-2">
                                    <span className="text-[10px] font-black uppercase tracking-[0.16em] es-general-secondary-text">
                                        {index + 1}. {step.kicker}
                                    </span>
                                    {done ? <Check size={14} className="text-emerald-500" strokeWidth={3} /> : null}
                                </div>
                                <div className="mt-1 text-xs font-bold es-general-text">{step.label}</div>
                            </button>
                        );
                    })}
                </div>
            </aside>

            <main className="flex-1 overflow-y-auto p-8 md:p-12">
                <div className="mx-auto flex min-h-full max-w-3xl flex-col">
                    <div className="flex-1">
                        <div className="mb-8 flex items-center justify-between gap-4">
                            <div>
                                <div className="text-[10px] font-black uppercase tracking-[0.2em] text-emerald-500">
                                    Step {activeIndex + 1} of {TUTORIAL_STEPS.length}
                                </div>
                                <div className="mt-1 text-sm es-general-secondary-text">{activeStepMeta.label}</div>
                            </div>
                            <div className="h-2 w-36 overflow-hidden rounded-full bg-stone-500/10">
                                <div
                                    className="h-full rounded-full bg-emerald-500 transition-all"
                                    style={{ width: `${((activeIndex + 1) / TUTORIAL_STEPS.length) * 100}%` }}
                                />
                            </div>
                        </div>
                        {renderStepContent()}
                    </div>

                    <div className="mt-8 flex items-center justify-between border-t es-global-separator pt-5">
                        <button
                            type="button"
                            onClick={goBack}
                            className="inline-flex items-center gap-1.5 rounded-lg border es-global-outline px-4 py-2 text-xs font-bold es-general-text hover:bg-stone-500/5"
                        >
                            <ChevronLeft size={14} /> Back
                        </button>
                        <div className="flex items-center gap-2">
                            <button
                                type="button"
                                onClick={isFinalStep ? finishTutorial : goNext}
                                className="rounded-lg border es-global-outline px-4 py-2 text-xs font-bold es-general-text hover:bg-stone-500/5"
                            >
                                Skip
                            </button>
                            <button
                                type="button"
                                disabled={!canContinue}
                                onClick={handlePrimaryAction}
                                className="inline-flex items-center gap-1.5 rounded-lg bg-emerald-500 px-5 py-2 text-xs font-bold text-white shadow hover:bg-emerald-600 disabled:opacity-45"
                            >
                                {primaryButtonLabel} <ChevronRight size={14} />
                            </button>
                        </div>
                    </div>
                </div>
            </main>
        </div>
    );
}

function TutorialHeader({ icon: Icon, title, body }: { icon: React.ComponentType<{ size?: number; className?: string }>; title: string; body: string }) {
    return (
        <div className="space-y-2 text-center">
            <div className="mx-auto flex h-11 w-11 items-center justify-center rounded-full bg-emerald-500/10 text-emerald-500">
                <Icon size={20} />
            </div>
            <h2 className="text-2xl md:text-3xl font-extrabold es-general-text tracking-tight">{title}</h2>
            <p className="text-xs md:text-sm es-general-secondary-text leading-relaxed">{body}</p>
        </div>
    );
}

function ShortcutPrompt({
    label,
    state,
    idleLabel,
    idleTone = 'ready',
}: {
    label: string;
    state?: string;
    idleLabel?: string;
    idleTone?: 'ready' | 'warning';
}) {
    const statusLabel = state === 'listening'
        ? 'Listening'
        : state === 'processing'
            ? 'Processing'
            : state === 'error'
                ? 'Needs retry'
                : (idleLabel || 'Ready');
    const idleClass = idleTone === 'warning'
        ? 'bg-amber-500/10 text-amber-500'
        : 'bg-emerald-500/10 text-emerald-500';
    return (
        <div className="rounded-xl border es-global-outline bg-white/70 dark:bg-white/[0.03] p-4">
            <div className="flex flex-wrap items-center justify-between gap-3">
                <div>
                    <div className="text-[10px] font-black uppercase tracking-[0.18em] es-general-secondary-text">Shortcut</div>
                    <div className="mt-1 text-lg font-extrabold es-general-text">{label}</div>
                </div>
                <div className={`rounded-full px-3 py-1 text-[10px] font-black uppercase tracking-[0.12em] ${
                    state === 'listening'
                        ? 'bg-rose-500/10 text-rose-400'
            : state === 'processing'
                            ? 'bg-emerald-500/10 text-emerald-500'
                            : state === 'error'
                                ? 'bg-rose-500/10 text-rose-400'
                                : idleClass
                }`}>
                    {statusLabel}
                </div>
            </div>
        </div>
    );
}

function ResultPreview({ title, body }: { title: string; body: string }) {
    return (
        <div className="rounded-xl border es-global-outline bg-white/70 dark:bg-white/[0.03] p-4">
            <div className="text-[10px] font-black uppercase tracking-[0.18em] es-general-secondary-text">{title}</div>
            <div className="mt-2 max-h-44 overflow-y-auto whitespace-pre-wrap text-sm leading-relaxed es-general-text">
                {body || 'Waiting for content...'}
            </div>
        </div>
    );
}

function SuccessBanner({ text }: { text: string }) {
    return (
        <div className="flex items-center gap-2 rounded-xl border border-emerald-500/20 bg-emerald-500/5 p-3 text-xs font-bold text-emerald-500">
            <Check size={14} strokeWidth={3} />
            {text}
        </div>
    );
}
