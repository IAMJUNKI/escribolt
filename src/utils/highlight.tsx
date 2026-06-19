import React from 'react';

/**
 * Escapes special regex characters in a string so it can be used
 * safely inside a `new RegExp(...)` call.
 */
export function escapeRegExp(value: string): string {
    return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/**
 * Wraps every occurrence of `query` inside `text` with a `<mark>` tag
 * that uses the `.es-search-match` CSS class.
 *
 * Returns a plain string when there is nothing to highlight, or a
 * `React.ReactNode[]` when matches exist.
 */
export function renderHighlightedContent(text: string, query: string): React.ReactNode {
    const sourceText = String(text || '');
    const trimmedQuery = query.trim();
    if (!trimmedQuery) return sourceText;

    const matcher = new RegExp(escapeRegExp(trimmedQuery), 'ig');
    const segments: React.ReactNode[] = [];
    let cursor = 0;
    let match = matcher.exec(sourceText);

    while (match) {
        const start = match.index;
        const end = start + match[0].length;
        if (start > cursor) {
            segments.push(sourceText.slice(cursor, start));
        }
        segments.push(
            <mark key={`match-${start}-${end}`} className="es-search-match">
                {sourceText.slice(start, end)}
            </mark>,
        );
        cursor = end;
        match = matcher.exec(sourceText);
    }

    if (cursor === 0) return sourceText;
    if (cursor < sourceText.length) {
        segments.push(sourceText.slice(cursor));
    }
    return segments;
}

/**
 * Extracts a short snippet of `text` centered around the first occurrence
 * of `query`, trimmed to approximately `maxLength` characters.
 *
 * Prepends/appends "..." when the snippet doesn't start/end at the
 * boundary of `text`.
 */
export function getHighlightedSnippet(text: string, query: string, maxLength: number): string {
    const sourceText = String(text || '').replace(/\s+/g, ' ').trim();
    if (!sourceText) return '';

    const trimmedQuery = query.trim();
    if (!trimmedQuery) return sourceText;

    const match = new RegExp(escapeRegExp(trimmedQuery), 'i').exec(sourceText);
    if (!match) return sourceText;

    const safeMaxLength = Math.max(maxLength, match[0].length + 10);
    const context = Math.max(6, Math.floor((safeMaxLength - match[0].length) / 2));
    const matchStart = match.index;
    const matchEnd = matchStart + match[0].length;

    let start = Math.max(0, matchStart - context);
    let end = Math.min(sourceText.length, matchEnd + context);

    if (end - start < safeMaxLength) {
        if (start === 0) {
            end = Math.min(sourceText.length, safeMaxLength);
        } else if (end === sourceText.length) {
            start = Math.max(0, sourceText.length - safeMaxLength);
        }
    }

    let snippet = sourceText.slice(start, end).trim();
    if (start > 0) {
        snippet = `... ${snippet}`;
    }
    if (end < sourceText.length) {
        snippet = `${snippet} ...`;
    }

    return snippet;
}
