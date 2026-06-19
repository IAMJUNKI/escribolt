import React from 'react';

type SettingsPageProps = {
    title: string;
    description?: string;
    children: React.ReactNode;
};

type SettingsSectionProps = {
    title: string;
    children: React.ReactNode;
};

type SettingsRowProps = {
    title: string;
    description?: React.ReactNode;
    children?: React.ReactNode;
    align?: 'center' | 'start';
};

type SettingsSwitchProps = {
    checked: boolean;
    onChange: (checked: boolean) => void;
    disabled?: boolean;
    ariaLabel: string;
};

export function SettingsPage({ title, description, children }: SettingsPageProps) {
    return (
        <div className="min-h-full es-general-background">
            <div className="mx-auto w-full max-w-5xl px-10 py-8">
                <h1 className="text-3xl font-semibold tracking-tight es-general-text">{title}</h1>
                {description ? (
                    <p className="mt-3 max-w-3xl text-base leading-relaxed es-general-secondary-text">{description}</p>
                ) : null}
                <div className="mt-10 space-y-10">
                    {children}
                </div>
            </div>
        </div>
    );
}

export function SettingsSection({ title, children }: SettingsSectionProps) {
    return (
        <section>
            <h2 className="text-lg font-semibold tracking-tight es-general-text">{title}</h2>
            <div className="mt-3 border-t es-global-separator" />
            <div className="mt-3 space-y-1">
                {children}
            </div>
        </section>
    );
}

export function SettingsRow({ title, description, children, align = 'center' }: SettingsRowProps) {
    const alignmentClass = align === 'start' ? 'lg:items-start' : 'lg:items-center';

    return (
        <div className={`py-5 flex flex-col gap-3 lg:flex-row lg:justify-between ${alignmentClass}`}>
            <div className="min-w-0 max-w-2xl">
                <div className="text-sm font-semibold es-general-text">{title}</div>
                {description ? (
                    <p className="mt-1 text-xs leading-relaxed es-general-secondary-text">{description}</p>
                ) : null}
            </div>
            {children ? (
                <div className="shrink-0 lg:max-w-[420px]">
                    {children}
                </div>
            ) : null}
        </div>
    );
}

export function SettingsSwitch({ checked, onChange, disabled = false, ariaLabel }: SettingsSwitchProps) {
    return (
        <button
            type="button"
            role="switch"
            aria-checked={checked}
            aria-label={ariaLabel}
            disabled={disabled}
            className="relative h-7 w-12 rounded-full transition-all duration-200 disabled:opacity-50"
            style={{
                backgroundColor: checked ? '#4CAE6B' : 'color-mix(in srgb, var(--global-outlines) 68%, transparent)',
                boxShadow: checked
                    ? 'inset 0 0 0 1px rgba(0,0,0,0.12)'
                    : 'inset 0 0 0 1px color-mix(in srgb, var(--global-outlines) 90%, transparent)',
            }}
            onClick={() => onChange(!checked)}
        >
            <span
                className={`absolute left-1 top-1 h-5 w-5 rounded-full bg-white transition-transform shadow-sm ${checked ? 'translate-x-5' : 'translate-x-0'}`}
            />
        </button>
    );
}
