import React, { useState, useEffect, useCallback } from 'react';
import type { UiSettings, AuthState, UsageSummary } from '../types';
import { SettingsPage, SettingsSection, SettingsRow } from '../components/SettingsLayout';

const { ipcRenderer } = window.require('electron');

export interface SettingsAccountPageProps {
    settings: UiSettings;
    authState: AuthState;
    modeLabel: string;
    proKeyStatus: string;
    updateSettings: (patch: Record<string, any>) => Promise<void>;
    fetchTempProKey: () => void;
    logout: () => void;
}

export default function SettingsAccountPage({
    settings,
    authState,
    modeLabel,
    proKeyStatus,
    updateSettings,
    fetchTempProKey,
    logout,
}: SettingsAccountPageProps) {
    const [browserAuthMessage, setBrowserAuthMessage] = useState('');
    const [isModeInfoOpen, setIsModeInfoOpen] = useState(false);
    const [showByokPermissionModal, setShowByokPermissionModal] = useState(false);
    const [isByokPermissionRequestInFlight, setIsByokPermissionRequestInFlight] = useState(false);
    const [byokPermissionError, setByokPermissionError] = useState('');

    // Usage stats
    const [usage, setUsage] = useState<UsageSummary | null>(null);
    const [usageLoading, setUsageLoading] = useState(false);
    const [upgradeStatusMessage, setUpgradeStatusMessage] = useState('');
    const [isOpeningUpgradeCheckout, setIsOpeningUpgradeCheckout] = useState(false);

    const fetchUsage = useCallback(async () => {
        if (!authState.isLoggedIn || !authState.accessToken) return;
        setUsageLoading(true);
        try {
            const result = await ipcRenderer.invoke('fetch-usage-summary');
            if (result && !result.error) {
                setUsage(result);
            }
        } catch (err) {
            console.error('Failed to fetch usage:', err);
        } finally {
            setUsageLoading(false);
        }
    }, [authState.isLoggedIn, authState.accessToken]);

    useEffect(() => {
        if (authState.isLoggedIn) {
            fetchUsage();
        }
    }, [authState.isLoggedIn, fetchUsage]);

    const openBrowserAuth = () => {
        try {
            ipcRenderer.send('open-login-flow');
            setBrowserAuthMessage('Browser opened. Complete sign up/login there, then return to Escribolt.');
        } catch (err: any) {
            setBrowserAuthMessage(err?.message || 'Unable to open browser sign up.');
        }
    };

    const handleOperationalModeChange = async (nextMode: string) => {
        if (nextMode === settings.mode) return;
        if (nextMode === 'byok' && settings.mode !== 'byok') {
            try {
                const secureStorageStatus = await ipcRenderer.invoke('byok:get-secure-storage-status');
                if (secureStorageStatus && secureStorageStatus.status === 'success' && secureStorageStatus.secureStoragePrimed) {
                    await updateSettings({ mode: 'byok' });
                    return;
                }
            } catch (_error) {
                // Fall through to confirmation modal.
            }
            setByokPermissionError('');
            setShowByokPermissionModal(true);
            return;
        }
        await updateSettings({ mode: nextMode });
    };

    const confirmByokModeSwitch = async () => {
        if (isByokPermissionRequestInFlight) return;
        setIsByokPermissionRequestInFlight(true);
        setByokPermissionError('');
        try {
            const probeResult = await ipcRenderer.invoke('byok:prime-secure-storage');
            if (!probeResult || probeResult.status !== 'success') {
                setByokPermissionError(probeResult?.message || 'Secure storage permission was not granted.');
                return;
            }
            await updateSettings({ mode: 'byok' });
            setShowByokPermissionModal(false);
        } catch (error: any) {
            setByokPermissionError(error?.message || 'Unable to enable BYOK mode.');
        } finally {
            setIsByokPermissionRequestInFlight(false);
        }
    };

    const renderUsageBar = (label: string, used: number, limit: number, unit: string) => {
        const safeLimit = Math.max(0, Number(limit) || 0);
        const safeUsed = Math.max(0, Number(used) || 0);
        const percent = safeLimit > 0 ? Math.min(100, Math.round((safeUsed / safeLimit) * 100)) : 0;
        const isHigh = percent > 80;
        const isCritical = percent > 95;
        return (
            <div className="mb-3">
                <div className="flex justify-between text-xs es-general-secondary-text mb-1">
                    <span>{label}</span>
                    <span>
                        {safeUsed.toLocaleString()} / {safeLimit.toLocaleString()} {unit}
                    </span>
                </div>
                <div className="h-2 rounded-full overflow-hidden" style={{ backgroundColor: 'var(--es-bg-tertiary, rgba(255,255,255,0.08))' }}>
                    <div
                        className="h-full rounded-full transition-all duration-300"
                        style={{
                            width: `${percent}%`,
                            backgroundColor: isCritical ? '#ef4444' : isHigh ? '#f59e0b' : '#22c55e',
                        }}
                    />
                </div>
            </div>
        );
    };

    const formatSecondsAsHoursMinutes = (seconds: number) => {
        const safeSeconds = Math.max(0, Math.round(Number(seconds) || 0));
        const totalMinutes = Math.floor(safeSeconds / 60);
        const hours = Math.floor(totalMinutes / 60);
        const minutes = totalMinutes % 60;
        return `${hours}h ${String(minutes).padStart(2, '0')}m`;
    };

    const openUpgradeCheckout = async (tier: 'standard' | 'pro' = 'pro') => {
        if (isOpeningUpgradeCheckout) return;
        setIsOpeningUpgradeCheckout(true);
        setUpgradeStatusMessage('');
        try {
            const result = await ipcRenderer.invoke('billing:open-checkout', {
                tier,
                plan: 'annual',
                currency: 'eur',
            });
            if (!result || result.status !== 'success') {
                setUpgradeStatusMessage(result?.message || 'Unable to open checkout.');
                return;
            }
            setUpgradeStatusMessage('Checkout opened in your browser.');
        } catch (error: any) {
            setUpgradeStatusMessage(error?.message || 'Unable to open checkout.');
        } finally {
            setIsOpeningUpgradeCheckout(false);
        }
    };

    const isStandardEntitlement = authState.plan === 'standard' || usage?.plan === 'standard';
    const isProEntitlement = authState.plan === 'pro' || usage?.plan === 'pro';
    const isSubscribed = isStandardEntitlement || isProEntitlement;
    const showTrialMeters = authState.isLoggedIn && !isSubscribed;
    const selectClass = 'h-9 min-w-[280px] rounded-md border es-global-outline bg-transparent px-3 text-sm es-general-text';
    const buttonClass = 'h-9 rounded-md border es-global-outline px-3 text-sm font-medium es-general-item-hover es-general-text disabled:opacity-60';
    const accountDescription = authState.isLoggedIn
        ? 'Manage your plan, session, and billing usage.'
        : 'Choose how Escribolt runs on this device or connect a PRO account.';
    return (
        <SettingsPage title="Account & Plan" description={accountDescription}>
            <SettingsSection title="Plan">
                <SettingsRow
                    title="Current plan"
                    description={authState.email ? authState.email : 'This device is using the current local account mode.'}
                >
                    <div className="text-right">
                        <div className="text-base font-semibold es-general-text">
                            {isProEntitlement ? 'Founder Plan' : isStandardEntitlement ? 'Pioneer Plan' : modeLabel}
                        </div>
                        <div className="mt-1 text-xs es-general-secondary-text">
                            {authState.isLoggedIn ? (isProEntitlement ? 'Founder (Pro) active' : isStandardEntitlement ? 'Pioneer (Standard) active' : 'Free trial') : 'Not signed in'}
                        </div>
                    </div>
                </SettingsRow>

                <SettingsRow title="Processing details" description="See how Local, BYOK, and PRO processing routes work.">
                    <button
                        type="button"
                        className={buttonClass}
                        onClick={() => setIsModeInfoOpen((previous) => !previous)}
                    >
                        {isModeInfoOpen ? 'Hide details' : 'Show details'}
                    </button>
                </SettingsRow>

                {isModeInfoOpen ? (
                    <div className="py-5 grid gap-3 md:grid-cols-3">
                        {[
                            ['Local Mode', 'Processing runs on your device. Audio and text do not leave your computer.'],
                            ['BYOK Mode', 'Processing uses your provider keys for speech, language, and voice features.'],
                            ['PRO Mode', 'Cloud processing through managed routing and account usage limits.'],
                        ].map(([title, description]) => (
                            <div key={title} className="rounded-md border es-global-outline p-3">
                                <div className="text-sm font-semibold es-general-text">{title}</div>
                                <p className="mt-1 text-xs leading-relaxed es-general-secondary-text">{description}</p>
                            </div>
                        ))}
                    </div>
                ) : null}
            </SettingsSection>

            {authState.isLoggedIn && usage ? (
                <SettingsSection title={usage.meterMode === 'trial' ? 'Cloud starter trial usage' : `Usage for ${usage.billingMonth}`}>
                    <SettingsRow title="Cloud dictation & transcripts" description="Time used for cloud transcription this billing period." align="start">
                        <div className="w-[360px] max-w-full">
                            <div className="mb-1 flex justify-between text-xs es-general-secondary-text">
                                <span>{formatSecondsAsHoursMinutes(usage.stt.used)}</span>
                                <span>{formatSecondsAsHoursMinutes(usage.stt.limit)}</span>
                            </div>
                            <div className="h-2 rounded-full overflow-hidden bg-stone-500/20">
                                <div
                                    className="h-full rounded-full bg-emerald-500 transition-all duration-300"
                                    style={{ width: `${usage.stt.limit > 0 ? Math.min(100, Math.round((usage.stt.used / usage.stt.limit) * 100)) : 0}%` }}
                                />
                            </div>
                        </div>
                    </SettingsRow>
                    <SettingsRow title="AI intelligence" description="Action usage for generated answers and summaries." align="start">
                        <div className="w-[360px] max-w-full">{renderUsageBar('Actions', usage.aiActions.used, usage.aiActions.limit, usage.aiActions.unit)}</div>
                    </SettingsRow>
                    <SettingsRow
                        title="Usage data"
                        description={showTrialMeters ? `Trial remaining: ${usage.trialRemaining?.aiActions ?? 0} AI actions, ${usage.trialRemaining?.sttSeconds ?? 0}s STT.` : 'Refresh the current usage numbers.'}
                    >
                        <button className={buttonClass} onClick={fetchUsage} disabled={usageLoading}>
                            {usageLoading ? 'Refreshing...' : 'Refresh usage'}
                        </button>
                    </SettingsRow>
                </SettingsSection>
            ) : null}

            {authState.isLoggedIn ? (
                <SettingsSection title="Session">
                    <SettingsRow
                        title="Secure storage"
                        description={authState.usingFallbackStorage ? 'Fallback storage is currently in use.' : 'Encrypted storage is available for account secrets.'}
                    >
                        <span className="text-sm font-medium es-general-text">
                            {authState.secureStorageAvailable ? 'Available' : 'Unavailable'}
                        </span>
                    </SettingsRow>
                    <SettingsRow title="Account actions" description="Manage the current authenticated session.">
                        <div className="flex flex-wrap justify-end gap-2 text-right">
                            {isSubscribed ? (
                                <button className={buttonClass} onClick={fetchTempProKey}>
                                    Fetch temp Deepgram key
                                </button>
                            ) : null}
                            {!isSubscribed ? (
                                <>
                                    <button
                                        className="h-9 rounded-md bg-[#3b82f6] px-3 text-sm font-medium text-white hover:opacity-90 active:scale-98 transition-all disabled:opacity-60 shadow-sm"
                                        onClick={() => { void openUpgradeCheckout('standard'); }}
                                        disabled={isOpeningUpgradeCheckout}
                                    >
                                        {isOpeningUpgradeCheckout ? 'Opening...' : 'Upgrade to Pioneer'}
                                    </button>
                                    <button
                                        className="h-9 rounded-md bg-[#4CAE6B] px-3 text-sm font-medium text-white hover:opacity-90 active:scale-98 transition-all disabled:opacity-60 shadow-sm"
                                        onClick={() => { void openUpgradeCheckout('pro'); }}
                                        disabled={isOpeningUpgradeCheckout}
                                    >
                                        {isOpeningUpgradeCheckout ? 'Opening...' : 'Upgrade to Founder'}
                                    </button>
                                </>
                            ) : null}
                            {isStandardEntitlement ? (
                                <button
                                    className="h-9 rounded-md bg-[#4CAE6B] px-3 text-sm font-medium text-white hover:opacity-90 active:scale-98 transition-all disabled:opacity-60 shadow-sm"
                                    onClick={() => { void openUpgradeCheckout('pro'); }}
                                    disabled={isOpeningUpgradeCheckout}
                                >
                                    {isOpeningUpgradeCheckout ? 'Opening...' : 'Upgrade to Founder'}
                                </button>
                            ) : null}
                            <button className={buttonClass} onClick={logout}>
                                Log out
                            </button>
                        </div>
                        {proKeyStatus ? <div className="mt-2 text-right text-xs es-general-secondary-text">{proKeyStatus}</div> : null}
                        {upgradeStatusMessage ? <div className="mt-2 text-right text-xs es-general-secondary-text">{upgradeStatusMessage}</div> : null}
                    </SettingsRow>
                </SettingsSection>
            ) : (
                <SettingsSection title="Sign in">
                    <SettingsRow title="Operational mode" description="Choose whether processing stays local or uses your own provider keys.">
                        <select
                            className={selectClass}
                            value={settings.mode}
                            onChange={(event) => { void handleOperationalModeChange(event.target.value); }}
                        >
                            <option value="local">Local Mode</option>
                            <option value="byok">BYOK Mode</option>
                        </select>
                    </SettingsRow>
                    <SettingsRow title="PRO account" description="Authentication opens in your browser. No credentials are entered inside the app.">
                        <button type="button" className={buttonClass} onClick={openBrowserAuth}>
                            Open sign up / login
                        </button>
                        {browserAuthMessage ? <div className="mt-2 text-right text-xs es-general-secondary-text">{browserAuthMessage}</div> : null}
                    </SettingsRow>
                </SettingsSection>
            )}

            {showByokPermissionModal ? (
                <div
                    className="fixed inset-0 z-50 flex items-center justify-center bg-stone-900/45 backdrop-blur-sm p-6"
                    onClick={() => {
                        if (isByokPermissionRequestInFlight) return;
                        setShowByokPermissionModal(false);
                        setByokPermissionError('');
                    }}
                >
                    <div
                        className="w-full max-w-lg rounded-xl border es-global-outline es-general-background shadow-xl p-5"
                        onClick={(event) => event.stopPropagation()}
                    >
                        <div className="text-sm font-semibold es-general-text mb-2">Enable BYOK Secure Storage</div>
                        <div className="text-sm es-general-secondary-text leading-relaxed space-y-2">
                            <p>
                                BYOK keys are encrypted at rest using macOS Keychain (`Chromium Safe Storage`).
                            </p>
                            <p>
                                To enable BYOK mode, the app will request permission to access secure key storage now.
                            </p>
                            <p>
                                Recommendation: click <strong>Always Allow</strong> in the system prompt so you do not have to approve Keychain access repeatedly.
                            </p>
                        </div>
                        {byokPermissionError ? (
                            <div className="mt-3 rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-xs text-red-700">
                                {byokPermissionError}
                            </div>
                        ) : null}
                        <div className="mt-4 flex justify-end gap-2">
                            <button
                                type="button"
                                className="px-3 py-1.5 text-xs font-semibold rounded-md border es-global-outline bg-transparent es-general-item-hover transition-colors shadow-sm disabled:opacity-60"
                                onClick={() => {
                                    setShowByokPermissionModal(false);
                                    setByokPermissionError('');
                                }}
                                disabled={isByokPermissionRequestInFlight}
                            >
                                Cancel
                            </button>
                            <button
                                type="button"
                                className="px-3 py-1.5 text-xs font-semibold rounded-md bg-stone-900 text-white hover:bg-stone-800 transition-colors shadow-sm disabled:opacity-60"
                                onClick={() => { void confirmByokModeSwitch(); }}
                                disabled={isByokPermissionRequestInFlight}
                            >
                                {isByokPermissionRequestInFlight ? 'Requesting permission...' : 'I Understand, Continue'}
                            </button>
                        </div>
                    </div>
                </div>
            ) : null}
        </SettingsPage>
    );
}
