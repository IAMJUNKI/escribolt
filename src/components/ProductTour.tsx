import React, { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { Check, ChevronLeft, ChevronRight, X } from 'lucide-react';

export type ProductTourPopoverPlacement = 'auto' | 'top-right';

export interface ProductTourStep {
    id: string;
    targetId: string;
    popoverTargetId?: string;
    popoverPlacement?: ProductTourPopoverPlacement;
    title: string;
    body: string;
    spotlight?: ProductTourSpotlight;
}

export interface ProductTourSpotlight {
    padding?: number;
    offsetX?: number;
    offsetY?: number;
    extendTop?: number;
    extendRight?: number;
    extendBottom?: number;
    extendLeft?: number;
}

interface ProductTourProps {
    isOpen: boolean;
    steps: ProductTourStep[];
    theme: 'black' | 'white';
    onClose: () => void;
    onStepEnter?: (step: ProductTourStep, index: number) => void;
}

type SpotlightRect = {
    top: number;
    left: number;
    width: number;
    height: number;
};

type PopoverSide = 'top' | 'right' | 'bottom' | 'left' | 'center';

type PopoverLayout = {
    side: PopoverSide;
    style: React.CSSProperties;
    tailStyle: React.CSSProperties;
};

const SPOTLIGHT_PADDING = 8;
const POPOVER_WIDTH = 360;
const POPOVER_FALLBACK_HEIGHT = 238;
const POPOVER_GAP = 18;
const VIEWPORT_MARGIN = 18;
const TAIL_SIZE = 14;

function clamp(value: number, min: number, max: number): number {
    return Math.max(min, Math.min(max, value));
}

function findTourTarget(targetId: string): HTMLElement | null {
    if (typeof document === 'undefined') return null;
    return document.querySelector(`[data-tour-id="${targetId}"]`) as HTMLElement | null;
}

function getVisibleClipRect(target: HTMLElement): SpotlightRect {
    let clip = {
        top: 0,
        left: 0,
        right: window.innerWidth,
        bottom: window.innerHeight,
    };
    let element = target.parentElement;

    while (element && element !== document.body && element !== document.documentElement) {
        const style = window.getComputedStyle(element);
        const overflow = `${style.overflow} ${style.overflowX} ${style.overflowY}`;
        if (/(auto|scroll|hidden|clip)/.test(overflow)) {
            const rect = element.getBoundingClientRect();
            if (rect.width > 0 && rect.height > 0) {
                clip = {
                    top: Math.max(clip.top, rect.top),
                    left: Math.max(clip.left, rect.left),
                    right: Math.min(clip.right, rect.right),
                    bottom: Math.min(clip.bottom, rect.bottom),
                };
            }
        }
        if (style.position === 'fixed') {
            break;
        }
        element = element.parentElement;
    }

    return {
        top: clip.top,
        left: clip.left,
        width: Math.max(0, clip.right - clip.left),
        height: Math.max(0, clip.bottom - clip.top),
    };
}

function measureTarget(targetId: string, spotlight: ProductTourSpotlight = {}): SpotlightRect | null {
    const target = findTourTarget(targetId);
    if (!target) return null;

    const rect = target.getBoundingClientRect();
    if (rect.width <= 0 || rect.height <= 0) return null;

    const padding = spotlight.padding ?? SPOTLIGHT_PADDING;
    const offsetX = spotlight.offsetX || 0;
    const offsetY = spotlight.offsetY || 0;
    const left = clamp(rect.left - padding - (spotlight.extendLeft || 0) + offsetX, 0, window.innerWidth);
    const top = clamp(rect.top - padding - (spotlight.extendTop || 0) + offsetY, 0, window.innerHeight);
    const right = clamp(rect.right + padding + (spotlight.extendRight || 0) + offsetX, 0, window.innerWidth);
    const bottom = clamp(rect.bottom + padding + (spotlight.extendBottom || 0) + offsetY, 0, window.innerHeight);
    const clipRect = getVisibleClipRect(target);
    const clippedLeft = Math.max(left, clipRect.left);
    const clippedTop = Math.max(top, clipRect.top);
    const clippedRight = Math.min(right, clipRect.left + clipRect.width);
    const clippedBottom = Math.min(bottom, clipRect.top + clipRect.height);

    if (clippedRight <= clippedLeft || clippedBottom <= clippedTop) return null;

    return {
        top: clippedTop,
        left: clippedLeft,
        width: clippedRight - clippedLeft,
        height: clippedBottom - clippedTop,
    };
}

function getPopoverLayout(
    rect: SpotlightRect | null,
    size: { width: number; height: number },
    placement: ProductTourPopoverPlacement = 'auto',
): PopoverLayout {
    const width = Math.min(POPOVER_WIDTH, Math.max(260, window.innerWidth - VIEWPORT_MARGIN * 2));
    const height = Math.max(POPOVER_FALLBACK_HEIGHT, size.height || POPOVER_FALLBACK_HEIGHT);
    const tailBase: React.CSSProperties = {
        width: `${TAIL_SIZE}px`,
        height: `${TAIL_SIZE}px`,
        transform: 'rotate(45deg)',
        backgroundColor: 'var(--general-background)',
        borderColor: 'var(--global-outlines)',
    };

    if (placement === 'top-right') {
        const top = VIEWPORT_MARGIN;
        return {
            side: 'right',
            style: {
                right: `${VIEWPORT_MARGIN}px`,
                top: `${top}px`,
                width: `${width}px`,
                maxWidth: 'calc(100vw - 32px)',
            },
            tailStyle: {
                ...tailBase,
                left: `${-(TAIL_SIZE / 2 + 1)}px`,
                top: `${rect
                    ? clamp(rect.top + rect.height / 2 - top - TAIL_SIZE / 2 - 24, 22, height - 52)
                    : 28}px`,
                borderLeftWidth: '1px',
                borderBottomWidth: '1px',
            },
        };
    }

    if (!rect) {
        return {
            side: 'center',
            style: {
                left: '50%',
                top: '50%',
                transform: 'translate(-50%, -50%)',
                width: `${width}px`,
                maxWidth: 'calc(100vw - 32px)',
            },
            tailStyle: { display: 'none' },
        };
    }

    const viewportWidth = window.innerWidth;
    const viewportHeight = window.innerHeight;
    const focusCenterX = rect.left + rect.width / 2;
    const focusCenterY = rect.top + rect.height / 2;
    const space = {
        right: viewportWidth - (rect.left + rect.width),
        left: rect.left,
        bottom: viewportHeight - (rect.top + rect.height),
        top: rect.top,
    };

    let side: PopoverSide = 'right';
    if (space.right >= width + POPOVER_GAP + VIEWPORT_MARGIN) {
        side = 'right';
    } else if (space.left >= width + POPOVER_GAP + VIEWPORT_MARGIN) {
        side = 'left';
    } else if (space.bottom >= height + POPOVER_GAP + VIEWPORT_MARGIN) {
        side = 'bottom';
    } else if (space.top >= height + POPOVER_GAP + VIEWPORT_MARGIN) {
        side = 'top';
    } else {
        const ranked = [
            { side: 'right' as PopoverSide, value: space.right - width },
            { side: 'left' as PopoverSide, value: space.left - width },
            { side: 'bottom' as PopoverSide, value: space.bottom - height },
            { side: 'top' as PopoverSide, value: space.top - height },
        ].sort((a, b) => b.value - a.value);
        side = ranked[0].side;
    }

    let left = VIEWPORT_MARGIN;
    let top = VIEWPORT_MARGIN;
    if (side === 'right') {
        left = rect.left + rect.width + POPOVER_GAP;
        top = focusCenterY - height / 2;
    } else if (side === 'left') {
        left = rect.left - width - POPOVER_GAP;
        top = focusCenterY - height / 2;
    } else if (side === 'bottom') {
        left = focusCenterX - width / 2;
        top = rect.top + rect.height + POPOVER_GAP;
    } else {
        left = focusCenterX - width / 2;
        top = rect.top - height - POPOVER_GAP;
    }

    left = clamp(left, VIEWPORT_MARGIN, Math.max(VIEWPORT_MARGIN, viewportWidth - width - VIEWPORT_MARGIN));
    top = clamp(top, VIEWPORT_MARGIN, Math.max(VIEWPORT_MARGIN, viewportHeight - height - VIEWPORT_MARGIN));

    if (side === 'right') {
        return {
            side,
            style: { left: `${left}px`, top: `${top}px`, width: `${width}px`, maxWidth: 'calc(100vw - 32px)' },
            tailStyle: {
                ...tailBase,
                left: `${-(TAIL_SIZE / 2 + 1)}px`,
                top: `${clamp(focusCenterY - top - TAIL_SIZE / 2, 18, height - 28)}px`,
                borderLeftWidth: '1px',
                borderBottomWidth: '1px',
            },
        };
    }
    if (side === 'left') {
        return {
            side,
            style: { left: `${left}px`, top: `${top}px`, width: `${width}px`, maxWidth: 'calc(100vw - 32px)' },
            tailStyle: {
                ...tailBase,
                right: `${-(TAIL_SIZE / 2 + 1)}px`,
                top: `${clamp(focusCenterY - top - TAIL_SIZE / 2, 18, height - 28)}px`,
                borderRightWidth: '1px',
                borderTopWidth: '1px',
            },
        };
    }
    if (side === 'bottom') {
        return {
            side,
            style: { left: `${left}px`, top: `${top}px`, width: `${width}px`, maxWidth: 'calc(100vw - 32px)' },
            tailStyle: {
                ...tailBase,
                top: `${-(TAIL_SIZE / 2 + 1)}px`,
                left: `${clamp(focusCenterX - left - TAIL_SIZE / 2, 18, width - 28)}px`,
                borderLeftWidth: '1px',
                borderTopWidth: '1px',
            },
        };
    }

    return {
        side,
        style: { left: `${left}px`, top: `${top}px`, width: `${width}px`, maxWidth: 'calc(100vw - 32px)' },
        tailStyle: {
            ...tailBase,
            bottom: `${-(TAIL_SIZE / 2 + 1)}px`,
            left: `${clamp(focusCenterX - left - TAIL_SIZE / 2, 18, width - 28)}px`,
            borderRightWidth: '1px',
            borderBottomWidth: '1px',
        },
    };
}

export default function ProductTour({ isOpen, steps, theme, onClose, onStepEnter }: ProductTourProps) {
    const [activeIndex, setActiveIndex] = useState(0);
    const [spotlightRect, setSpotlightRect] = useState<SpotlightRect | null>(null);
    const [popoverAnchorRect, setPopoverAnchorRect] = useState<SpotlightRect | null>(null);
    const [popoverSize, setPopoverSize] = useState({ width: POPOVER_WIDTH, height: POPOVER_FALLBACK_HEIGHT });
    const popoverRef = useRef<HTMLDivElement | null>(null);
    const activeStep = steps[activeIndex] || null;
    const isLastStep = activeIndex >= steps.length - 1;

    const advanceStep = useCallback(() => {
        if (isLastStep) {
            onClose();
            return;
        }
        setActiveIndex((index) => Math.min(steps.length - 1, index + 1));
    }, [isLastStep, onClose, steps.length]);

    const refreshTarget = useCallback(() => {
        if (!activeStep) {
            setSpotlightRect(null);
            setPopoverAnchorRect(null);
            return;
        }
        const nextSpotlightRect = measureTarget(activeStep.targetId, activeStep.spotlight);
        const nextPopoverAnchorRect = activeStep.popoverTargetId
            ? measureTarget(activeStep.popoverTargetId, { padding: 0 }) || nextSpotlightRect
            : nextSpotlightRect;
        setSpotlightRect(nextSpotlightRect);
        setPopoverAnchorRect(nextPopoverAnchorRect);
    }, [activeStep]);

    useEffect(() => {
        if (!isOpen) return;
        setActiveIndex(0);
    }, [isOpen]);

    useLayoutEffect(() => {
        if (!isOpen || !popoverRef.current) return;
        const rect = popoverRef.current.getBoundingClientRect();
        setPopoverSize((previous) => {
            const next = {
                width: Math.ceil(rect.width || POPOVER_WIDTH),
                height: Math.ceil(rect.height || POPOVER_FALLBACK_HEIGHT),
            };
            if (previous.width === next.width && previous.height === next.height) return previous;
            return next;
        });
    }, [activeIndex, isOpen, popoverAnchorRect, spotlightRect]);

    useEffect(() => {
        if (!isOpen || !activeStep) return;

        onStepEnter?.(activeStep, activeIndex);

        const timers = [0, 120, 320, 700, 1200].map((delay) => window.setTimeout(refreshTarget, delay));
        return () => timers.forEach((timer) => window.clearTimeout(timer));
    }, [activeIndex, activeStep, isOpen, onStepEnter, refreshTarget]);

    useEffect(() => {
        if (!isOpen || !activeStep) return;

        const target = findTourTarget(activeStep.targetId);
        const popoverTarget = activeStep.popoverTargetId && activeStep.popoverTargetId !== activeStep.targetId
            ? findTourTarget(activeStep.popoverTargetId)
            : null;
        target?.scrollIntoView({ block: 'center', inline: 'nearest', behavior: 'smooth' });
        target?.setAttribute('data-tour-active', 'true');
        popoverTarget?.setAttribute('data-tour-active', 'true');

        return () => {
            target?.removeAttribute('data-tour-active');
            popoverTarget?.removeAttribute('data-tour-active');
        };
    }, [activeIndex, activeStep, isOpen]);

    useEffect(() => {
        if (!isOpen) return;

        const handleKeyDown = (event: KeyboardEvent) => {
            if (event.key === 'Escape') {
                event.preventDefault();
                onClose();
            }
        };

        window.addEventListener('keydown', handleKeyDown);
        window.addEventListener('resize', refreshTarget);
        window.addEventListener('scroll', refreshTarget, true);
        return () => {
            window.removeEventListener('keydown', handleKeyDown);
            window.removeEventListener('resize', refreshTarget);
            window.removeEventListener('scroll', refreshTarget, true);
        };
    }, [isOpen, onClose, refreshTarget]);

    if (!isOpen || !activeStep || typeof document === 'undefined') return null;

    const popoverLayout = getPopoverLayout(popoverAnchorRect || spotlightRect, popoverSize, activeStep.popoverPlacement);

    return createPortal(
        <div className={`fixed inset-0 z-[160] product-tour-root es-theme-${theme} es-general-text pointer-events-none`}>
            <style>{`
                [data-tour-active="true"] {
                    opacity: 1 !important;
                    visibility: visible !important;
                }
            `}</style>

            {spotlightRect ? (
                <>
                    <div className="fixed left-0 right-0 top-0 bg-black/60 pointer-events-auto" style={{ height: spotlightRect.top }} aria-hidden="true" />
                    <div className="fixed left-0 bg-black/60 pointer-events-auto" style={{ top: spotlightRect.top, width: spotlightRect.left, height: spotlightRect.height }} aria-hidden="true" />
                    <div className="fixed right-0 bg-black/60 pointer-events-auto" style={{ top: spotlightRect.top, left: spotlightRect.left + spotlightRect.width, height: spotlightRect.height }} aria-hidden="true" />
                    <div className="fixed left-0 right-0 bottom-0 bg-black/60 pointer-events-auto" style={{ top: spotlightRect.top + spotlightRect.height }} aria-hidden="true" />
                </>
            ) : (
                <div className="fixed inset-0 bg-black/60 pointer-events-auto" aria-hidden="true" />
            )}

            {spotlightRect ? (
                <>
                    <button
                        type="button"
                        tabIndex={-1}
                        className="fixed rounded-xl appearance-none border-0 bg-transparent p-0 pointer-events-auto cursor-pointer focus:outline-none"
                        style={{
                            left: spotlightRect.left,
                            top: spotlightRect.top,
                            width: spotlightRect.width,
                            height: spotlightRect.height,
                        }}
                        onClick={(event) => {
                            event.preventDefault();
                            event.stopPropagation();
                            advanceStep();
                        }}
                        aria-hidden="true"
                    />
                    <div
                        className="fixed rounded-xl border-2 border-[#4CAE6B] shadow-[0_0_0_1px_rgba(255,255,255,0.18),0_0_32px_rgba(76,174,107,0.38)] pointer-events-none"
                        style={{
                            left: spotlightRect.left,
                            top: spotlightRect.top,
                            width: spotlightRect.width,
                            height: spotlightRect.height,
                        }}
                    />
                </>
            ) : null}

            <div
                ref={popoverRef}
                className="fixed rounded-2xl border es-global-outline es-general-background shadow-2xl p-4 pointer-events-auto"
                style={popoverLayout.style}
                role="dialog"
                aria-modal="true"
                aria-labelledby="product-tour-title"
            >
                {popoverLayout.side !== 'center' ? (
                    <span
                        className="absolute border-solid"
                        style={popoverLayout.tailStyle}
                        aria-hidden="true"
                    />
                ) : null}
                <div className="flex items-start justify-between gap-3">
                    <div className="text-[10px] font-bold uppercase tracking-[0.18em] text-[#4CAE6B]">
                        Step {activeIndex + 1} of {steps.length}
                    </div>
                    <button
                        type="button"
                        className="h-7 w-7 -mr-1 -mt-1 rounded-md inline-flex items-center justify-center es-general-item-hover es-general-text"
                        onClick={onClose}
                        aria-label="Skip product tour"
                    >
                        <X size={14} />
                    </button>
                </div>

                <h2 id="product-tour-title" className="mt-2 text-base font-semibold es-general-text">
                    {activeStep.title}
                </h2>
                <p className="mt-2 text-sm leading-relaxed es-general-secondary-text">
                    {activeStep.body}
                </p>

                {!spotlightRect ? (
                    <p className="mt-3 rounded-lg border border-[#4CAE6B]/20 bg-[#4CAE6B]/10 px-3 py-2 text-xs es-general-text">
                        This area is not visible right now, but the tour will continue normally.
                    </p>
                ) : null}

                <div className="mt-4 flex items-center gap-1.5">
                    {steps.map((step, index) => (
                        <span
                            key={`product-tour-dot-${step.id}`}
                            className={`h-1.5 rounded-full transition-all ${index === activeIndex ? 'w-5 bg-[#4CAE6B]' : 'w-1.5 bg-stone-400/40'}`}
                        />
                    ))}
                </div>

                <div className="mt-5 flex items-center justify-between gap-2">
                    <button
                        type="button"
                        className="h-9 px-3 rounded-lg border es-global-outline es-general-text es-general-item-hover text-xs font-semibold inline-flex items-center gap-1.5 disabled:opacity-40"
                        disabled={activeIndex === 0}
                        onClick={() => setActiveIndex((index) => Math.max(0, index - 1))}
                    >
                        <ChevronLeft size={14} />
                        Back
                    </button>

                    <div className="inline-flex items-center gap-2">
                        <button
                            type="button"
                            className="h-9 px-3 rounded-lg border es-global-outline es-general-text es-general-item-hover text-xs font-semibold"
                            onClick={onClose}
                        >
                            Skip Tour
                        </button>
                        <button
                            type="button"
                            className="h-9 px-3 rounded-lg bg-[#4CAE6B] text-white text-xs font-semibold inline-flex items-center gap-1.5 shadow-md shadow-[#4CAE6B]/20 hover:opacity-95"
                            onClick={advanceStep}
                        >
                            {isLastStep ? (
                                <>
                                    Finish
                                    <Check size={14} />
                                </>
                            ) : (
                                <>
                                    Next
                                    <ChevronRight size={14} />
                                </>
                            )}
                        </button>
                    </div>
                </div>
            </div>
        </div>,
        document.body,
    );
}
