import React from 'react';
import { X } from 'lucide-react';

export type ErrorBannerLevel = 'error' | 'warning';

export interface ErrorBannerProps {
    level?: ErrorBannerLevel;
    message: string;
    onDismiss?: () => void;
    className?: string;
}

const LEVEL_STYLES: Record<ErrorBannerLevel, string> = {
    error: 'border-[var(--es-danger-border)] bg-[var(--es-danger-bg)] text-[var(--es-danger-text)]',
    warning: 'border-amber-200 bg-amber-50 text-amber-700',
};

/**
 * Dismissable banner for surfacing errors and warnings.
 *
 * Uses the app's semantic CSS variables so it adapts to all themes.
 */
export default function ErrorBanner({ level = 'error', message, onDismiss, className }: ErrorBannerProps) {
    return (
        <div
            className={`w-full rounded-xl border p-2.5 text-xs flex items-start justify-between gap-2 ${LEVEL_STYLES[level]} ${className || ''}`}
        >
            <span className="leading-relaxed flex-1 min-w-0 break-words">{message}</span>
            {onDismiss ? (
                <button
                    className="shrink-0 transition-colors hover:opacity-80"
                    onClick={onDismiss}
                    aria-label="Dismiss message"
                >
                    <X size={12} strokeWidth={3} />
                </button>
            ) : null}
        </div>
    );
}
