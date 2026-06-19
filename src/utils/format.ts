/**
 * Shared formatting utilities used across multiple views.
 */

/** Format a millisecond duration as a compact human-readable label. */
export function formatDurationMs(durationMs: number | undefined): string {
    const safe = Number(durationMs || 0);
    if (!Number.isFinite(safe) || safe <= 0) return '0 sec';

    const totalSeconds = Math.floor(safe / 1000);
    const minutes = Math.floor(totalSeconds / 60);
    const hours = Math.floor(minutes / 60);
    const remainingMinutes = minutes % 60;

    if (hours > 0) {
        return remainingMinutes > 0
            ? `${hours} hr ${remainingMinutes} mins`
            : `${hours} hr`;
    }

    if (minutes > 0) {
        return `${minutes} ${minutes === 1 ? 'min' : 'mins'}`;
    }

    return `${Math.max(1, totalSeconds)} sec`;
}

/** Format duration for tight sidebar surfaces (for example `2m`, `48s`, `1h 5m`). */
export function formatDurationCompactMs(durationMs: number | undefined): string {
    const safe = Number(durationMs || 0);
    if (!Number.isFinite(safe) || safe <= 0) return '0s';

    const totalSeconds = Math.floor(safe / 1000);
    const minutes = Math.floor(totalSeconds / 60);
    const hours = Math.floor(minutes / 60);
    const remainingMinutes = minutes % 60;
    const remainingSeconds = totalSeconds % 60;

    if (hours > 0) {
        return remainingMinutes > 0 ? `${hours}h ${remainingMinutes}m` : `${hours}h`;
    }

    if (minutes > 0) {
        return `${minutes}m`;
    }

    return `${Math.max(1, remainingSeconds)}s`;
}

/** Format a unix-ms timestamp as a locale string, or `'Unknown time'`. */
export function formatTimestampLabel(value: number | undefined): string {
    const safe = Number(value || 0);
    if (!Number.isFinite(safe) || safe <= 0) {
        return 'Unknown time';
    }
    return new Date(safe).toLocaleString();
}

/** Format a unix-ms timestamp as compact date + 24h time, e.g. "May 20 · 18:30". */
export function formatTimeCompact(ts: number): string {
    if (!ts) return '';
    const d = new Date(ts);
    const months = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
    const month = months[d.getMonth()];
    const day = d.getDate();
    const hh = String(d.getHours()).padStart(2, '0');
    const mm = String(d.getMinutes()).padStart(2, '0');
    return `${month} ${day} · ${hh}:${mm}`;
}

/** Format a unix-ms timestamp as a short date like `Mar 12, 2026`. */
export function formatDateShort(ts: number): string {
    if (!ts) return 'Unknown Date';
    return new Date(ts).toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' });
}
