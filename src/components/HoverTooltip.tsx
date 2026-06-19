import React, { useCallback, useEffect, useLayoutEffect, useState, useRef } from 'react';
import { createPortal } from 'react-dom';

export type HoverTooltipProps = {
    label: string;
    shortcut?: string;
    disabled?: boolean;
    className?: string;
    children: React.ReactNode;
};

type TooltipPalette = {
    background: string;
    border: string;
    color: string;
    shadow: string;
    shortcutBackground: string;
    shortcutBorder: string;
    shortcutColor: string;
};

const DEFAULT_TOOLTIP_PALETTE: TooltipPalette = {
    background: '#282828',
    border: '#393939',
    color: '#FFFFFF',
    shadow: '0 10px 24px rgba(0, 0, 0, 0.36)',
    shortcutBackground: 'rgba(255, 255, 255, 0.08)',
    shortcutBorder: '#4a4a4a',
    shortcutColor: '#d1d5db',
};

function readCssVarValue(styles: CSSStyleDeclaration, name: string, fallback: string): string {
    const value = styles.getPropertyValue(name).trim();
    return value || fallback;
}

export default function HoverTooltip({ label, shortcut, disabled, className, children }: HoverTooltipProps) {
    const [isVisible, setIsVisible] = useState(false);
    const [isSuppressed, setIsSuppressed] = useState(false);
    const [renderBelow, setRenderBelow] = useState(false);
    const [tooltipAnchor, setTooltipAnchor] = useState<{ left: number; top: number; bottom: number } | null>(null);
    const [clampedCenterX, setClampedCenterX] = useState<number | null>(null);
    const [palette, setPalette] = useState<TooltipPalette>(DEFAULT_TOOLTIP_PALETTE);
    const wrapperRef = useRef<HTMLSpanElement | null>(null);
    const tooltipRef = useRef<HTMLSpanElement | null>(null);
    const centerXRef = useRef(0);
    const showTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);

    const MARGIN = 12;

    const clampCenterX = useCallback((centerX: number, tooltipWidth: number) => {
        return Math.max(
            MARGIN + tooltipWidth / 2,
            Math.min(centerX, window.innerWidth - MARGIN - tooltipWidth / 2),
        );
    }, []);

    const syncPalette = useCallback(() => {
        if (!wrapperRef.current) return;
        const styles = window.getComputedStyle(wrapperRef.current);
        setPalette({
            background: readCssVarValue(styles, '--tooltip-background', DEFAULT_TOOLTIP_PALETTE.background),
            border: readCssVarValue(styles, '--tooltip-border', DEFAULT_TOOLTIP_PALETTE.border),
            color: readCssVarValue(styles, '--tooltip-color', DEFAULT_TOOLTIP_PALETTE.color),
            shadow: readCssVarValue(styles, '--tooltip-shadow', DEFAULT_TOOLTIP_PALETTE.shadow),
            shortcutBackground: readCssVarValue(styles, '--tooltip-shortcut-background', DEFAULT_TOOLTIP_PALETTE.shortcutBackground),
            shortcutBorder: readCssVarValue(styles, '--tooltip-shortcut-border', DEFAULT_TOOLTIP_PALETTE.shortcutBorder),
            shortcutColor: readCssVarValue(styles, '--tooltip-shortcut-color', DEFAULT_TOOLTIP_PALETTE.shortcutColor),
        });
    }, []);

    const computePlacement = useCallback(() => {
        if (!wrapperRef.current) return;
        const rect = wrapperRef.current.getBoundingClientRect();
        const shouldRenderBelow = rect.top < 56;
        const centerX = rect.left + rect.width / 2;
        centerXRef.current = centerX;
        setRenderBelow(shouldRenderBelow);
        setTooltipAnchor({
            left: centerX,
            top: rect.top,
            bottom: rect.bottom,
        });
    }, []);

    useLayoutEffect(() => {
        if (!isVisible || !tooltipRef.current) return;
        const tooltipWidth = tooltipRef.current.offsetWidth;
        setClampedCenterX(clampCenterX(centerXRef.current, tooltipWidth));
    }, [isVisible, clampCenterX]);

    useEffect(() => {
        return () => {
            if (showTimeoutRef.current) clearTimeout(showTimeoutRef.current);
        };
    }, []);

    useEffect(() => {
        if (!isVisible) return;
        syncPalette();

        const updatePosition = () => {
            if (!wrapperRef.current || !tooltipRef.current) return;
            const rect = wrapperRef.current.getBoundingClientRect();
            const shouldRenderBelow = rect.top < 56;
            const centerX = rect.left + rect.width / 2;
            centerXRef.current = centerX;
            setRenderBelow(shouldRenderBelow);
            setTooltipAnchor({ left: centerX, top: rect.top, bottom: rect.bottom });
            setClampedCenterX(clampCenterX(centerX, tooltipRef.current.offsetWidth));
            syncPalette();
        };

        window.addEventListener('scroll', updatePosition, true);
        window.addEventListener('resize', updatePosition);
        return () => {
            window.removeEventListener('scroll', updatePosition, true);
            window.removeEventListener('resize', updatePosition);
        };
    }, [isVisible, clampCenterX, syncPalette]);

    return (
        <span
            ref={wrapperRef}
            className={`relative inline-flex no-drag ${className || ''}`.trim()}
            onMouseEnter={() => {
                if (!isSuppressed) {
                    if (showTimeoutRef.current) clearTimeout(showTimeoutRef.current);
                    showTimeoutRef.current = setTimeout(() => {
                        computePlacement();
                        syncPalette();
                        setIsVisible(true);
                    }, 400);
                }
            }}
            onMouseLeave={() => {
                if (showTimeoutRef.current) {
                    clearTimeout(showTimeoutRef.current);
                    showTimeoutRef.current = null;
                }
                setIsVisible(false);
                setIsSuppressed(false);
                setTooltipAnchor(null);
                setClampedCenterX(null);
            }}
            onMouseDown={() => {
                if (showTimeoutRef.current) {
                    clearTimeout(showTimeoutRef.current);
                    showTimeoutRef.current = null;
                }
                setIsVisible(false);
                setIsSuppressed(true);
                setTooltipAnchor(null);
                setClampedCenterX(null);
            }}
            onClick={() => {
                if (showTimeoutRef.current) {
                    clearTimeout(showTimeoutRef.current);
                    showTimeoutRef.current = null;
                }
                setIsVisible(false);
                setIsSuppressed(true);
                setTooltipAnchor(null);
                setClampedCenterX(null);
            }}
        >
            {children}
            {!disabled && isVisible && !isSuppressed && tooltipAnchor && typeof document !== 'undefined'
                ? createPortal(
                    <span
                        ref={tooltipRef}
                        className="pointer-events-none fixed"
                        style={{
                            left: clampedCenterX ?? tooltipAnchor.left,
                            top: renderBelow ? (tooltipAnchor.bottom + 8) : (tooltipAnchor.top - 8),
                            transform: renderBelow ? 'translateX(-50%)' : 'translate(-50%, -100%)',
                            zIndex: 2147483647,
                        }}
                    >
                        <span
                            className="flex items-center gap-2 px-2.5 py-1 rounded-md text-[11px] whitespace-nowrap"
                            style={{
                                backgroundColor: palette.background,
                                border: `1px solid ${palette.border}`,
                                color: palette.color,
                                boxShadow: palette.shadow,
                            }}
                        >
                            <span>{label}</span>
                            {shortcut ? (
                                <span
                                    className="text-[10px] rounded-md px-1.5 py-0.5"
                                    style={{
                                        backgroundColor: palette.shortcutBackground,
                                        border: `1px solid ${palette.shortcutBorder}`,
                                        color: palette.shortcutColor,
                                    }}
                                >
                                    {shortcut}
                                </span>
                            ) : null}
                        </span>
                    </span>,
                    document.body,
                )
                : null}
        </span>
    );
}
