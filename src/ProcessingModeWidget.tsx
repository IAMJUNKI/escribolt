import React, { useEffect, useState } from 'react';
import { Cloud, Lock } from 'lucide-react';

type ProcessingLocation = 'local' | 'cloud';

type WidgetState = {
    location?: ProcessingLocation;
    effectiveMode?: string;
    cloudAvailable?: boolean;
};

const { ipcRenderer } = window.require('electron');

type ProcessingModeWidgetProps = {
    theme?: 'black' | 'white';
};

export default function ProcessingModeWidget({ theme = 'black' }: ProcessingModeWidgetProps) {
    const [location, setLocation] = useState<ProcessingLocation>('local');
    const [isHovering, setIsHovering] = useState(false);
    const [message, setMessage] = useState('');

    const applyState = (state: WidgetState = {}) => {
        setLocation(state.location === 'cloud' ? 'cloud' : 'local');
    };

    useEffect(() => {
        const handleState = (_event: any, state: WidgetState = {}) => {
            applyState(state);
        };

        ipcRenderer.on('record-processing-widget:state', handleState);
        ipcRenderer.send('record-processing-widget:ready');
        return () => {
            ipcRenderer.removeListener('record-processing-widget:state', handleState);
        };
    }, []);

    const selectLocation = async (nextLocation: ProcessingLocation) => {
        setLocation(nextLocation);
        setMessage('');

        try {
            const result = await ipcRenderer.invoke('processing-mode:set-feature', {
                feature: 'meetingTranscription',
                location: nextLocation,
            });
            if (result?.processingMode) {
                applyState(result.processingMode);
            }
            if (result?.status === 'requires-auth') {
                setMessage('Sign in');
            }
        } catch (_error) {
            setMessage('Try again');
        }
    };

    const widgetBackground = theme === 'black' ? '#0a0a0a' : '#ffffff';

    return (
        <div
            className="relative flex items-center pt-[9px] pb-[9px] px-1 overflow-visible select-none pointer-events-auto no-drag w-max h-max"
            onMouseEnter={() => {
                setIsHovering(true);
            }}
            onMouseLeave={() => {
                setIsHovering(false);
            }}
        >
            <div
                className="pointer-events-none absolute left-1/2 top-[-12px] -translate-x-1/2 -translate-y-full whitespace-nowrap rounded-md px-1.5 py-[2px] text-[10px] font-medium leading-none transition-all duration-300 ease-in-out shrink-0"
                style={{
                    backgroundColor: widgetBackground,
                    border: theme === 'black' ? '1px solid rgba(255, 255, 255, 0.18)' : '1px solid rgba(0, 0, 0, 0.12)',
                    color: theme === 'black' ? '#ffffff' : '#000000',
                    opacity: isHovering ? 1 : 0,
                    transform: isHovering ? 'translate(-50%, 0)' : 'translate(-50%, 4px)',
                }}
            >
                Processing mode
            </div>

            {/* Capsule container: smoothly morphs from circle (32px) to pill (114px) */}
            <div
                className="flex h-8 items-center rounded-full border transition-all duration-300 cubic-bezier(0.4, 0, 0.2, 1) overflow-hidden"
                style={{
                    backgroundColor: widgetBackground,
                    borderColor: theme === 'black' ? 'rgba(255, 255, 255, 0.18)' : 'rgba(0, 0, 0, 0.12)',
                    width: isHovering ? (message ? '172px' : '114px') : '32px',
                    gap: isHovering ? '4px' : '0px',
                    padding: isHovering ? '0px 4px' : '0px',
                }}
            >
                {([
                    { key: 'local', label: 'local', Icon: Lock },
                    { key: 'cloud', label: 'cloud', Icon: Cloud },
                ] as const).map((option) => {
                    const selected = location === option.key;
                    const OptionIcon = option.Icon;
                    const isVisible = isHovering || selected;
                    const showLabel = isHovering && selected;

                    return (
                        <button
                            key={`processing-location-${option.key}`}
                            type="button"
                            className="flex h-6 items-center justify-center rounded-full text-[10px] font-semibold transition-all duration-300 cubic-bezier(0.4, 0, 0.2, 1) overflow-hidden shrink-0"
                            aria-label={`Use ${option.label.toLowerCase()} processing for meeting transcription`}
                            onClick={(event) => {
                                event.stopPropagation();
                                void selectLocation(option.key);
                            }}
                            style={{
                                color: (selected && isHovering) ? '#ffffff' : (selected ? (theme === 'black' ? '#ffffff' : '#000000') : (theme === 'black' ? 'rgba(255, 255, 255, 0.52)' : 'rgba(0, 0, 0, 0.46)')),
                                backgroundColor: (selected && isHovering) ? '#4CAE6B' : 'transparent',
                                width: isVisible ? (isHovering ? (selected ? '76px' : '24px') : '30px') : '0px',
                                opacity: isVisible ? 1 : 0,
                                paddingLeft: showLabel ? '8px' : '0px',
                                paddingRight: showLabel ? '8px' : '0px',
                                pointerEvents: isVisible ? 'auto' : 'none',
                                gap: showLabel ? '4px' : '0px',
                            }}
                        >
                            <OptionIcon className="h-3 w-3 shrink-0" strokeWidth={2.5} />
                            
                            {/* Text label: slides out smoothly inside the button */}
                            <span 
                                className="transition-all duration-300 cubic-bezier(0.4, 0, 0.2, 1) overflow-hidden shrink-0"
                                style={{
                                    width: showLabel ? 'auto' : '0px',
                                    opacity: showLabel ? 1 : 0,
                                }}
                            >
                                {option.label}
                            </span>
                        </button>
                    );
                })}
                {message && isHovering && (
                    <span className="px-1 text-[10px] font-semibold text-amber-200 animate-pulse shrink-0 transition-opacity duration-300">
                        {message}
                    </span>
                )}
            </div>
        </div>
    );
}
