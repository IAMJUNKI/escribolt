import React from 'react';

export interface ModalProps {
    open: boolean;
    onClose: () => void;
    title?: string;
    children: React.ReactNode;
    /** Extra class names for the modal panel */
    className?: string;
}

/**
 * A centered modal overlay with a semi-transparent backdrop.
 *
 * Clicking the backdrop triggers `onClose`. The panel is
 * theme-aware via CSS variables.
 */
export default function Modal({ open, onClose, title, children, className }: ModalProps) {
    if (!open) return null;

    return (
        <div
            className="fixed inset-0 z-[9999] flex items-center justify-center"
            onClick={onClose}
        >
            {/* Backdrop */}
            <div className="absolute inset-0 bg-black/50 backdrop-blur-sm" />

            {/* Panel */}
            <div
                className={`relative rounded-xl border shadow-xl p-5 max-w-lg w-full mx-4 ${className || ''}`}
                style={{
                    backgroundColor: 'var(--es-surface, #1b2230)',
                    borderColor: 'var(--es-border, #313d52)',
                    color: 'var(--es-text, #e7ecf5)',
                }}
                onClick={(e) => e.stopPropagation()}
            >
                {title ? (
                    <h3 className="text-sm font-semibold mb-3" style={{ color: 'var(--es-text, #e7ecf5)' }}>
                        {title}
                    </h3>
                ) : null}
                {children}
            </div>
        </div>
    );
}
