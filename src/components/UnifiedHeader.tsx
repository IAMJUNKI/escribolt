import React from 'react';
import { Cloud, Lock, MoreHorizontal } from 'lucide-react';
import HoverTooltip from './HoverTooltip';

export interface UnifiedHeaderProps {
    title: string | React.ReactNode;
    onRenameClick?: () => void;
    renameTooltip?: string;

    // Cloud Sync
    isAuthenticated: boolean;
    isCloudSynced: boolean;
    onCloudSyncToggle: () => void;
    cloudSyncTooltip: string;

    // Optional right-side content (external link for notes, tab switcher for recordings, etc.)
    rightActions?: React.ReactNode;

    // Optional actions menu
    menuRef?: React.RefObject<HTMLDivElement | null>;
    isMenuOpen?: boolean;
    onMenuToggle?: () => void;
    menuTooltip?: string;
    menuContent?: React.ReactNode;
}

export default function UnifiedHeader({
    title,
    onRenameClick,
    renameTooltip,
    isAuthenticated,
    isCloudSynced,
    onCloudSyncToggle,
    cloudSyncTooltip,
    rightActions,
    menuRef,
    isMenuOpen,
    onMenuToggle,
    menuTooltip = 'Actions',
    menuContent,
}: UnifiedHeaderProps) {
    return (
        <div className="pt-2 px-8 pb-4 es-general-background">
            <div className="flex items-center justify-between gap-4 min-h-[32px]">
                <div className="min-w-0 flex-1">
                    <div className="flex min-w-0 flex-wrap items-center gap-2">
                        {typeof title === 'string' ? (
                            <button
                                type="button"
                                className="min-w-0 max-w-full shrink text-left text-sm font-medium text-stone-900 transition-opacity hover:opacity-75 h-8 inline-flex items-center"
                                onClick={onRenameClick}
                                title={renameTooltip}
                            >
                                <span className="block truncate">{title}</span>
                            </button>
                        ) : (
                            title
                        )}

                        <HoverTooltip label={cloudSyncTooltip}>
                            <button
                                type="button"
                                className={`inline-flex items-center gap-1.5 rounded-md px-2.5 h-6 text-[11px] font-medium transition-opacity ${
                                    isAuthenticated ? 'hover:opacity-85' : 'cursor-not-allowed opacity-65'
                                }`}
                                onClick={onCloudSyncToggle}
                                disabled={!isAuthenticated}
                                style={{
                                    backgroundColor: 'color-mix(in srgb, var(--general-text) 10%, transparent)',
                                    color: 'color-mix(in srgb, var(--general-text) 68%, transparent)',
                                }}
                            >
                                {isCloudSynced ? <Cloud size={11} /> : <Lock size={11} />}
                                <span>{isCloudSynced ? 'Cloud' : 'Private'}</span>
                            </button>
                        </HoverTooltip>
                    </div>
                </div>

                <div className="flex items-center gap-2 shrink-0">
                    {rightActions}

                    {menuContent && onMenuToggle && (
                        <div ref={menuRef} className="relative flex">
                            <HoverTooltip label={menuTooltip}>
                                <button
                                    className="inline-flex h-8 w-8 items-center justify-center rounded-lg bg-transparent es-general-item-hover es-general-text transition-colors"
                                    onClick={onMenuToggle}
                                    aria-label={menuTooltip}
                                >
                                    <MoreHorizontal size={16} className="opacity-90" />
                                </button>
                            </HoverTooltip>
                            {isMenuOpen && menuContent}
                        </div>
                    )}
                </div>
            </div>
        </div>
    );
}
