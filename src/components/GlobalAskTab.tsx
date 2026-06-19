import React, { useEffect, useLayoutEffect, useMemo, useRef, useState, useCallback } from 'react';
import { ChevronDown, ChevronRight, Send, FileText, Volume2, Folder, Mic, Check, Search, X, Copy, Plus, MessageCircle, Lock, Sparkles } from 'lucide-react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import remarkMath from 'remark-math';
import rehypeKatex from 'rehype-katex';
import 'katex/dist/katex.min.css';
import HoverTooltip from './HoverTooltip';

export interface AskMessage {
    id: string;
    role: 'user' | 'assistant';
    content: string;
    createdAt: number;
}

export type GlobalAskContextKind = 'recording' | 'note' | 'folder' | 'chat';

export interface GlobalAskContextOption {
    id: string;
    kind: GlobalAskContextKind;
    label: string;
    helperText?: string;
    timestamp?: number;
    iconId?: string;
    colorId?: string;
    spaceIcon?: React.ComponentType<any>;
    spaceIconStyle?: React.CSSProperties;
    hierarchyDepth?: number;
}

export type GlobalAskModelSelection =
    | { mode: 'auto' }
    | { mode: 'local' }
    | { mode: 'byok'; provider: 'openai' | 'groq' | 'anthropic' | 'gemini'; model: string }
    | { mode: 'pro'; modelAlias: string };

export interface GlobalAskModelOption {
    id: string;
    label: string;
    helperText?: string;
    selection: GlobalAskModelSelection;
}

export interface GlobalAskContextItem {
    kind: GlobalAskContextKind;
    id?: string;
}

export interface GlobalAskSendPayload {
    prompt: string;
    source: 'input';
    modelSelection: GlobalAskModelSelection;
    contextSelection: GlobalAskContextItem | GlobalAskContextItem[];
}

export interface ProgressStep {
    step: string;
    message: string;
}

export interface GlobalAskTabProps {
    messages: AskMessage[];
    draft: string;
    isLoading: boolean;
    progressSteps: ProgressStep[];
    modelOptions: GlobalAskModelOption[];
    selectedModelOptionId: string;
    onModelOptionChange: (optionId: string) => void;
    contextOptions: GlobalAskContextOption[];
    selectedContextOptionIds: string[];
    onContextOptionChange: (optionIds: string[]) => void;
    onDraftChange: (value: string) => void;
    onSend: (payload?: GlobalAskSendPayload) => void;
    onSelectLibraryItem?: (kind: 'note' | 'recording', id: string) => void;
    resolveCitationTitle?: (kind: 'note' | 'recording', uuid: string) => string | null;
    onCreateNote?: (text: string) => void;
    conversationKey?: string;
    authState?: any;
}

const DEFAULT_MODEL_OPTION: GlobalAskModelOption = {
    id: 'global-default-model',
    label: 'Auto',
    selection: { mode: 'auto' },
};

const COMPOSER_BASE_HEIGHT = 108;
const COMPOSER_MAX_HEIGHT = 227; // Limited growth by 30% (from 324 to 227)
const COMPOSER_MIN_TEXTAREA_HEIGHT = 44;
const COMPOSER_CHROME_HEIGHT = 64;

// Source-level citations (canonical + tolerant input):
// 1) [citation:note:<uuid>] or [citation:recording:<uuid>]
// 2) [<label>](citation://note/<uuid>) or [<label>](citation://recording/<uuid>)
const CITATION_TOKEN_REGEX = /\[citation:(note|recording):([a-zA-Z0-9-]+)\]/gi;
const CITATION_LINK_REGEX = /\[[^\]\n]*\]\(\s*citation:\/\/(note|recording)\/([a-zA-Z0-9-]+)\s*\)/gi;
const CITATION_TOKEN_PATTERN = String.raw`\[citation:(?:note|recording):[a-zA-Z0-9-]+\]`;
const CITATION_LINK_PATTERN = String.raw`\[[^\]\n]*\]\(\s*citation:\/\/(?:note|recording)\/[a-zA-Z0-9-]+\s*\)`;
const CITATION_ANY_PATTERN = String.raw`(?:${CITATION_TOKEN_PATTERN}|${CITATION_LINK_PATTERN})`;
const INLINE_MENTION_REGEX = /@(note|recording|chat|folder):(?:"([^"]+)"|'([^']+)'|([a-zA-Z0-9_-]+))|@(?:"([^"]+)"|'([^']+)')/gi;

function collectCitationRefs(text: string): Array<{ kind: 'note' | 'recording'; uuid: string; index: number }> {
    const refs: Array<{ kind: 'note' | 'recording'; uuid: string; index: number }> = [];

    const tokenRegex = new RegExp(CITATION_TOKEN_REGEX.source, 'gi');
    let tokenMatch;
    while ((tokenMatch = tokenRegex.exec(text)) !== null) {
        const kind = String(tokenMatch[1] || '').toLowerCase();
        const uuid = String(tokenMatch[2] || '');
        if ((kind === 'note' || kind === 'recording') && uuid) {
            refs.push({ kind, uuid, index: tokenMatch.index });
        }
    }

    const linkRegex = new RegExp(CITATION_LINK_REGEX.source, 'gi');
    let linkMatch;
    while ((linkMatch = linkRegex.exec(text)) !== null) {
        const kind = String(linkMatch[1] || '').toLowerCase();
        const uuid = String(linkMatch[2] || '');
        if ((kind === 'note' || kind === 'recording') && uuid) {
            refs.push({ kind, uuid, index: linkMatch.index });
        }
    }

    refs.sort((a, b) => a.index - b.index);
    return refs;
}

function resolveContextSelection(option: GlobalAskContextOption): { kind: GlobalAskContextKind; id?: string } {
    const text = String(option.id || '').trim();
    const parts = text.split(':');
    if (parts.length === 3 && parts[0] === 'ctx' && parts[2]) {
        if (parts[1] === 'recording') return { kind: 'recording', id: parts[2] };
        if (parts[1] === 'note') return { kind: 'note', id: parts[2] };
        if (parts[1] === 'folder') return { kind: 'folder', id: parts[2] };
        if (parts[1] === 'chat') return { kind: 'chat', id: parts[2] };
    }
    return { kind: option.kind };
}

function parseInlineMentions(text: string, options: GlobalAskContextOption[]): GlobalAskContextOption[] {
    const matchedOptions: GlobalAskContextOption[] = [];
    
    // Pattern 1: typed mentions with quotes, e.g., @note:"Some Title"
    const typedQuotedRegex = /@(note|recording|chat|folder):(?:"([^"]+)"|'([^']+)')/gi;
    let match;
    while ((match = typedQuotedRegex.exec(text)) !== null) {
        const kind = match[1].toLowerCase();
        const title = (match[2] || match[3] || '').trim();
        if (title) {
            const found = options.find(opt => 
                opt.kind === (kind === 'folder' ? 'folder' : kind) && 
                opt.label.toLowerCase() === title.toLowerCase()
            );
            if (found && !matchedOptions.some(m => m.id === found.id)) {
                matchedOptions.push(found);
            }
        }
    }
    
    // Pattern 2: typed mentions without quotes, e.g., @note:SomeTitle
    const typedUnquotedRegex = /@(note|recording|chat|folder):([a-zA-Z0-9_-]+)/gi;
    typedUnquotedRegex.lastIndex = 0; // Reset
    while ((match = typedUnquotedRegex.exec(text)) !== null) {
        const kind = match[1].toLowerCase();
        const title = (match[2] || '').trim();
        if (title) {
            const found = options.find(opt => 
                opt.kind === (kind === 'folder' ? 'folder' : kind) && 
                opt.label.toLowerCase() === title.toLowerCase()
            );
            if (found && !matchedOptions.some(m => m.id === found.id)) {
                matchedOptions.push(found);
            }
        }
    }
    
    // Pattern 3: generic quoted mentions, e.g., @"Some Title"
    const genericQuotedRegex = /@(?:"([^"]+)"|'([^']+)')/gi;
    genericQuotedRegex.lastIndex = 0; // Reset
    while ((match = genericQuotedRegex.exec(text)) !== null) {
        const title = (match[1] || match[2] || '').trim();
        if (title) {
            const found = options.find(opt => opt.label.toLowerCase() === title.toLowerCase());
            if (found && !matchedOptions.some(m => m.id === found.id)) {
                matchedOptions.push(found);
            }
        }
    }
    
    return matchedOptions;
}

function renderUserMessageContent(text: string, options: GlobalAskContextOption[]): React.ReactNode {
    const combinedRegex = new RegExp(INLINE_MENTION_REGEX.source, 'gi');
    
    const elements: React.ReactNode[] = [];
    let lastIndex = 0;
    let match;
    
    combinedRegex.lastIndex = 0;
    while ((match = combinedRegex.exec(text)) !== null) {
        const matchIndex = match.index;
        
        // Add preceding text
        if (matchIndex > lastIndex) {
            elements.push(text.slice(lastIndex, matchIndex));
        }
        
        // Extract values
        const kind = match[1] ? match[1].toLowerCase() : null;
        const quotedTitle = match[2] || match[3];
        const unquotedTitle = match[4];
        const genericQuotedTitle = match[5] || match[6];
        
        const titleToFind = (quotedTitle || unquotedTitle || genericQuotedTitle || '').trim().toLowerCase();
        const optionKind = kind === 'folder' ? 'folder' : kind;
        
        // Find matching option
        const foundOpt = options.find(opt => {
            const matchesKind = !optionKind || opt.kind === optionKind;
            return matchesKind && opt.label.toLowerCase() === titleToFind;
        });
        
        if (foundOpt) {
            const item = foundOpt;
            elements.push(
                <span 
                    key={`inline-${item.id}-${matchIndex}`} 
                    className="inline-flex items-center gap-1.5 px-1.5 py-0.5 rounded-lg bg-[#4CAE6B]/10 text-[#4CAE6B] font-semibold border border-[#4CAE6B]/20 align-baseline select-none"
                    style={{ whiteSpace: 'nowrap' }}
                >
                    {renderContextOptionIcon(item, 12)}
                    {item.label}
                </span>
            );
        } else {
            // Keep the raw text if option wasn't found
            elements.push(match[0]);
        }
        
        lastIndex = combinedRegex.lastIndex;
    }
    
    if (lastIndex < text.length) {
        elements.push(text.slice(lastIndex));
    }
    
    return elements.length > 0 ? elements : text;
}

function contextMentionToken(option: GlobalAskContextOption): string {
    const kind = option.kind === 'folder' ? 'folder' : option.kind;
    return `@${kind}:"${option.label}"`;
}

function renderContextMentionIcon(kind: GlobalAskContextKind, size: number, className = 'shrink-0'): React.ReactNode {
    if (kind === 'recording') return <Mic size={size} className={className} />;
    if (kind === 'note') return <FileText size={size} className={className} />;
    if (kind === 'folder') return <Folder size={size} className={className} />;
    if (kind === 'chat') return <MessageCircle size={size} className={className} />;
    return <Volume2 size={size} className={className} />;
}

function renderContextOptionIcon(option: GlobalAskContextOption, size: number, className = 'shrink-0'): React.ReactNode {
    if (option.kind === 'folder' && option.spaceIcon) {
        const SpaceIcon = option.spaceIcon;
        return <SpaceIcon size={size} className={className} style={option.spaceIconStyle} />;
    }
    return renderContextMentionIcon(option.kind, size, className);
}

function appendComposerMentionIcon(parent: HTMLElement, kind: GlobalAskContextKind): void {
    const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
    svg.setAttribute('viewBox', '0 0 24 24');
    svg.setAttribute('width', '12');
    svg.setAttribute('height', '12');
    svg.setAttribute('fill', 'none');
    svg.setAttribute('stroke', 'currentColor');
    svg.setAttribute('stroke-width', '2');
    svg.setAttribute('stroke-linecap', 'round');
    svg.setAttribute('stroke-linejoin', 'round');
    svg.setAttribute('class', 'ask-composer-mention-icon');

    const path = (d: string) => {
        const node = document.createElementNS('http://www.w3.org/2000/svg', 'path');
        node.setAttribute('d', d);
        svg.appendChild(node);
    };

    const line = (x1: number, y1: number, x2: number, y2: number) => {
        const node = document.createElementNS('http://www.w3.org/2000/svg', 'line');
        node.setAttribute('x1', String(x1));
        node.setAttribute('y1', String(y1));
        node.setAttribute('x2', String(x2));
        node.setAttribute('y2', String(y2));
        svg.appendChild(node);
    };

    if (kind === 'recording') {
        path('M12 2a3 3 0 0 0-3 3v7a3 3 0 0 0 6 0V5a3 3 0 0 0-3-3Z');
        path('M19 10v2a7 7 0 0 1-14 0v-2');
        line(12, 19, 12, 22);
    } else if (kind === 'note') {
        path('M15 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V7Z');
        path('M14 2v4a2 2 0 0 0 2 2h4');
        line(8, 13, 16, 13);
        line(8, 17, 16, 17);
    } else if (kind === 'folder') {
        path('M20 20a2 2 0 0 0 2-2V8a2 2 0 0 0-2-2h-7.9a2 2 0 0 1-1.69-.9L9.6 3.9A2 2 0 0 0 7.93 3H4a2 2 0 0 0-2 2v13a2 2 0 0 0 2 2Z');
    } else {
        path('M7.9 20A9 9 0 1 0 4 16.1L2 22Z');
    }

    parent.appendChild(svg);
}

function renderComposerInputContent(root: HTMLElement, text: string, options: GlobalAskContextOption[]): void {
    const combinedRegex = new RegExp(INLINE_MENTION_REGEX.source, 'gi');
    const fragment = document.createDocumentFragment();
    let lastIndex = 0;
    let match;

    combinedRegex.lastIndex = 0;
    while ((match = combinedRegex.exec(text)) !== null) {
        const matchIndex = match.index;

        if (matchIndex > lastIndex) {
            fragment.appendChild(document.createTextNode(text.slice(lastIndex, matchIndex)));
        }

        const kind = match[1] ? match[1].toLowerCase() : null;
        const quotedTitle = match[2] || match[3];
        const unquotedTitle = match[4];
        const genericQuotedTitle = match[5] || match[6];
        const titleToFind = (quotedTitle || unquotedTitle || genericQuotedTitle || '').trim().toLowerCase();
        const optionKind = kind === 'folder' ? 'folder' : kind;

        const foundOpt = options.find(opt => {
            const matchesKind = !optionKind || opt.kind === optionKind;
            return matchesKind && opt.label.toLowerCase() === titleToFind;
        });

        if (foundOpt) {
            const mention = document.createElement('span');
            mention.contentEditable = 'false';
            mention.dataset.mentionToken = match[0];
            mention.className = 'ask-composer-mention';

            appendComposerMentionIcon(mention, foundOpt.kind);

            const label = document.createElement('span');
            label.className = 'ask-composer-mention-label';
            label.textContent = foundOpt.label;
            mention.appendChild(label);

            fragment.appendChild(mention);
        } else {
            fragment.appendChild(document.createTextNode(match[0]));
        }

        lastIndex = combinedRegex.lastIndex;
    }

    if (lastIndex < text.length) {
        fragment.appendChild(document.createTextNode(text.slice(lastIndex)));
    }

    root.replaceChildren(fragment);
}

function composerNodeDraftLength(node: Node): number {
    if (node.nodeType === Node.TEXT_NODE) return (node.textContent || '').replace(/\u00a0/g, ' ').length;
    if (!(node instanceof HTMLElement)) return 0;
    if (node.dataset.mentionToken) return node.dataset.mentionToken.length;
    if (node.tagName === 'BR') return 1;
    return Array.from(node.childNodes).reduce((total, child) => total + composerNodeDraftLength(child), 0);
}

function serializeComposerContent(root: HTMLElement): string {
    const serializeNode = (node: Node): string => {
        if (node.nodeType === Node.TEXT_NODE) return (node.textContent || '').replace(/\u00a0/g, ' ');
        if (!(node instanceof HTMLElement)) return '';
        if (node.dataset.mentionToken) return node.dataset.mentionToken;
        if (node.tagName === 'BR') return '\n';
        return Array.from(node.childNodes).map(serializeNode).join('');
    };

    return Array.from(root.childNodes).map(serializeNode).join('');
}

function getComposerSelectionOffset(root: HTMLElement): number {
    const selection = window.getSelection();
    if (!selection || selection.rangeCount === 0) return serializeComposerContent(root).length;

    const range = selection.getRangeAt(0);
    if (!root.contains(range.startContainer)) return serializeComposerContent(root).length;

    let offset = 0;
    let found = false;

    const walk = (node: Node) => {
        if (found) return;

        if (node === range.startContainer) {
            if (node.nodeType === Node.TEXT_NODE) {
                offset += range.startOffset;
            } else {
                const children = Array.from(node.childNodes).slice(0, range.startOffset);
                children.forEach((child) => {
                    offset += composerNodeDraftLength(child);
                });
            }
            found = true;
            return;
        }

        if (node.nodeType === Node.TEXT_NODE) {
            offset += node.textContent?.length || 0;
            return;
        }

        if (!(node instanceof HTMLElement)) return;

        if (node.dataset.mentionToken) {
            if (node.contains(range.startContainer)) {
                offset += node.dataset.mentionToken.length;
                found = true;
                return;
            }
            offset += node.dataset.mentionToken.length;
            return;
        }

        if (node.tagName === 'BR') {
            offset += 1;
            return;
        }

        Array.from(node.childNodes).forEach(walk);
    };

    walk(root);
    return offset;
}

function setComposerSelectionFromOffset(root: HTMLElement, targetOffset: number): void {
    root.focus();

    const range = document.createRange();
    const selection = window.getSelection();
    let remaining = Math.max(0, targetOffset);
    let placed = false;

    const placeAroundNode = (node: Node, after = false) => {
        const parent = node.parentNode || root;
        const index = Array.prototype.indexOf.call(parent.childNodes, node);
        range.setStart(parent, index + (after ? 1 : 0));
        placed = true;
    };

    const walk = (node: Node) => {
        if (placed) return;

        if (node.nodeType === Node.TEXT_NODE) {
            const length = node.textContent?.length || 0;
            if (remaining <= length) {
                range.setStart(node, remaining);
                placed = true;
                return;
            }
            remaining -= length;
            return;
        }

        if (!(node instanceof HTMLElement)) return;

        if (node.dataset.mentionToken) {
            const length = node.dataset.mentionToken.length;
            if (remaining === 0) {
                placeAroundNode(node, false);
                return;
            }
            if (remaining <= length) {
                placeAroundNode(node, true);
                return;
            }
            remaining -= length;
            return;
        }

        if (node.tagName === 'BR') {
            if (remaining === 0) {
                placeAroundNode(node, false);
                return;
            }
            if (remaining <= 1) {
                placeAroundNode(node, true);
                return;
            }
            remaining -= 1;
            return;
        }

        Array.from(node.childNodes).forEach(walk);
    };

    Array.from(root.childNodes).forEach(walk);

    if (!placed) {
        range.selectNodeContents(root);
        range.collapse(false);
    }

    selection?.removeAllRanges();
    selection?.addRange(range);
}

function resolvePlaceholder(contextOption: GlobalAskContextOption | null): string {
    if (!contextOption) return 'Ask anything about your notes and recordings...';
    if (contextOption.kind === 'recording') return `Ask about "${contextOption.label}"...`;
    if (contextOption.kind === 'note') return `Ask about note "${contextOption.label}"...`;
    if (contextOption.kind === 'chat') return `Ask about chat "${contextOption.label}"...`;
    return `Ask about folder "${contextOption.label}"...`;
}

function markdownToHtml(markdown: string): string {
    return markdown
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/^### (.*$)/gim, '<h3>$1</h3>')
        .replace(/^## (.*$)/gim, '<h2>$1</h2>')
        .replace(/^# (.*$)/gim, '<h1>$1</h1>')
        .replace(/\*\*(.*?)\*\*/g, '<strong>$1</strong>')
        .replace(/\*(.*?)\*/g, '<em>$1</em>')
        .replace(/`([^`]+)`/g, '<code>$1</code>')
        .replace(/^\s*[-*+]\s+(.*)$/gim, '<li>$1</li>')
        .replace(/\n/g, '<br />');
}

function parseThinkBlock(content: string): { thinkContent: string | null; mainContent: string } {
    const thinkStartIdx = content.indexOf('<think>');
    if (thinkStartIdx === -1) {
        return { thinkContent: null, mainContent: content };
    }
    
    const thinkEndIdx = content.indexOf('</think>', thinkStartIdx + 7);
    const beforeThink = content.slice(0, thinkStartIdx);
    
    if (thinkEndIdx !== -1) {
        const thinkContent = content.slice(thinkStartIdx + 7, thinkEndIdx).trim();
        const afterThink = content.slice(thinkEndIdx + 8);
        return {
            thinkContent: thinkContent || null,
            mainContent: (beforeThink + afterThink).trim()
        };
    } else {
        const thinkContent = content.slice(thinkStartIdx + 7).trim();
        return {
            thinkContent: thinkContent || null,
            mainContent: beforeThink.trim()
        };
    }
}

function normalizeInlineListMarkdownForRender(text: string): string {
    let normalized = text.replace(/\r\n/g, '\n');

    // Some models emit bullet markers inline in a single paragraph:
    // "... **Section:** * Item A * Item B". Convert that into real list lines.
    const inlineStarCount = (normalized.match(/\s\*\s+/g) || []).length;
    if (inlineStarCount >= 2) {
        normalized = normalized.replace(/\s\*\s+/g, '\n- ');
    }

    return normalized.trim();
}

function removeCitationOnlyReferenceLines(text: string): string {
    const citationOnlyReferenceLine = new RegExp(
        String.raw`^\s*(?:#{1,6}\s*)?(?:reference|references|source|sources|fuente|fuentes)\s*:?\s*(?:${CITATION_ANY_PATTERN}\s*)+\s*$`,
        'gim',
    );
    return text.replace(citationOnlyReferenceLine, '').replace(/\n{3,}/g, '\n\n').trim();
}

function resolveThoughtTitle(question: string): string {
    return 'Thinking';
}

export default function GlobalAskTab({
    messages,
    draft,
    isLoading,
    progressSteps,
    modelOptions,
    selectedModelOptionId,
    onModelOptionChange,
    contextOptions,
    selectedContextOptionIds,
    onContextOptionChange,
    onDraftChange,
    onSend,
    onSelectLibraryItem,
    resolveCitationTitle,
    onCreateNote,
    conversationKey,
    authState,
}: GlobalAskTabProps) {
    const scrollRef = useRef<HTMLDivElement>(null);
    const composerEditorRef = useRef<HTMLDivElement>(null);
    const [isBannerDismissed, setIsBannerDismissed] = useState(() => {
        try {
            return sessionStorage.getItem('escribolt:pro-banner-dismissed') === 'true';
        } catch {
            return false;
        }
    });
    const pendingComposerSelectionOffsetRef = useRef<number | null>(null);
    const shouldStickToBottomRef = useRef(true);
    const [textareaHeight, setTextareaHeight] = useState(COMPOSER_MIN_TEXTAREA_HEIGHT);
    const hasConversation = messages.length > 0;

    const composerHeight = useMemo(() => {
        return Math.min(
            COMPOSER_MAX_HEIGHT,
            Math.max(COMPOSER_BASE_HEIGHT, textareaHeight + COMPOSER_CHROME_HEIGHT),
        );
    }, [textareaHeight]);

    // Citation hover tooltip state
    const [hoveredCitation, setHoveredCitation] = useState<{
        kind: 'note' | 'recording';
        uuid: string;
        rect: DOMRect;
    } | null>(null);
    const hoverTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
    const isOverTooltipRef = useRef(false);

    // Reasoning trace collapse state
    const [activeTraceCollapsed, setActiveTraceCollapsed] = useState(true);
    const [copiedMessageId, setCopiedMessageId] = useState<string | null>(null);

    const handleCopy = useCallback(async (msgId: string, content: string) => {
        const { mainContent } = parseThinkBlock(content);
        try {
            const htmlText = markdownToHtml(mainContent);
            const data = [
                new ClipboardItem({
                    'text/plain': new Blob([mainContent], { type: 'text/plain' }),
                    'text/html': new Blob([htmlText], { type: 'text/html' }),
                })
            ];
            await navigator.clipboard.write(data);
        } catch (err) {
            console.error('Failed to copy formatted text: ', err);
            await navigator.clipboard.writeText(mainContent);
        }
        setCopiedMessageId(msgId);
        setTimeout(() => setCopiedMessageId(null), 2000);
    }, []);

    const handleSaveAsNote = useCallback((content: string) => {
        const { mainContent } = parseThinkBlock(content);
        if (onCreateNote) {
            onCreateNote(mainContent);
        }
    }, [onCreateNote]);

    const handleOpenLoginFlow = useCallback(() => {
        try {
            const { ipcRenderer } = (window as any).require('electron');
            ipcRenderer.send('open-login-flow');
        } catch (err) {
            console.error('Failed to open login flow:', err);
        }
    }, []);

    const selectedModelOption = useMemo(
        () => modelOptions.find((entry) => entry.id === selectedModelOptionId) || modelOptions[0] || DEFAULT_MODEL_OPTION,
        [modelOptions, selectedModelOptionId],
    );
    const primaryContextOption = useMemo(
        () => (selectedContextOptionIds.length > 0
            ? contextOptions.find((entry) => entry.id === selectedContextOptionIds[0]) || null
            : null),
        [contextOptions, selectedContextOptionIds],
    );

    const dynamicPlaceholder = useMemo(
        () => resolvePlaceholder(primaryContextOption),
        [primaryContextOption],
    );

    // Determine streaming phases
    const isStreaming = useMemo(() => {
        if (!isLoading) return false;
        const lastMsg = messages[messages.length - 1];
        return lastMsg?.id === 'a-streaming' && !!lastMsg.content;
    }, [isLoading, messages]);

    useEffect(() => {
        const el = scrollRef.current;
        if (!el || !hasConversation) return;
        if (!shouldStickToBottomRef.current) return;
        el.scrollTop = el.scrollHeight;
    }, [hasConversation, messages, isLoading, progressSteps]);

    useEffect(() => {
        const el = scrollRef.current;
        shouldStickToBottomRef.current = true;
        if (!el) return;
        el.scrollTop = el.scrollHeight;
    }, [conversationKey]);

    const handleMessagesScroll = useCallback(() => {
        const el = scrollRef.current;
        if (!el) return;
        const distanceFromBottom = el.scrollHeight - el.scrollTop - el.clientHeight;
        shouldStickToBottomRef.current = distanceFromBottom < 48;
    }, []);

    useEffect(() => {
        const el = composerEditorRef.current;
        if (!el) return;
        
        // Temporarily disable flex stretching to measure natural height
        const originalFlex = el.style.flex;
        el.style.flex = 'none';
        el.style.height = 'auto';
        
        const maxTextareaHeight = COMPOSER_MAX_HEIGHT - COMPOSER_CHROME_HEIGHT;
        const nextHeight = el.scrollHeight;
        
        // Restore flex styling
        el.style.flex = originalFlex;
        
        const clampedHeight = Math.max(
            COMPOSER_MIN_TEXTAREA_HEIGHT,
            Math.min(nextHeight, maxTextareaHeight),
        );
        el.style.height = `${clampedHeight}px`;
        setTextareaHeight(clampedHeight);
    }, [draft]);

    useLayoutEffect(() => {
        const editor = composerEditorRef.current;
        if (!editor) return;

        const pendingOffset = pendingComposerSelectionOffsetRef.current;
        const activeOffset = document.activeElement === editor
            ? getComposerSelectionOffset(editor)
            : null;
        const offset = pendingOffset ?? activeOffset;

        renderComposerInputContent(editor, draft, contextOptions);
        if (offset !== null) {
            setComposerSelectionFromOffset(editor, offset);
        }
        pendingComposerSelectionOffsetRef.current = null;
    }, [contextOptions, draft]);

    // Reset trace collapse when loading starts
    useEffect(() => {
        if (isLoading) {
            setActiveTraceCollapsed(true);
        }
    }, [isLoading]);

    // Auto-collapse trace when response content starts streaming
    useEffect(() => {
        if (isStreaming) {
            setActiveTraceCollapsed(true);
        }
    }, [isStreaming]);

    // Dropdown & search state
    const [contextDropdownOpen, setContextDropdownOpen] = useState(false);
    const [contextDropdownRect, setContextDropdownRect] = useState<DOMRect | null>(null);
    const [modelDropdownOpen, setModelDropdownOpen] = useState(false);
    const [modelDropdownRect, setModelDropdownRect] = useState<DOMRect | null>(null);
    const [contextSearch, setContextSearch] = useState('');
    const [contextActiveTab, setContextActiveTab] = useState<'all' | 'note' | 'recording' | 'folder' | 'chat'>('all');

    // Mention popover states
    const [mentionPopoverOpen, setMentionPopoverOpen] = useState(false);
    const [mentionFilter, setMentionFilter] = useState('');
    const [mentionStartIndex, setMentionStartIndex] = useState(-1);
    const [mentionSelectedIndex, setMentionSelectedIndex] = useState(0);

    // Active context calculation (including dynamic inline @ mentions)
    const activeContextItems = useMemo(() => {
        // 1. Start with initial context items from selectedContextOptionIds
        const initial = selectedContextOptionIds
            .map(id => contextOptions.find(o => o.id === id))
            .filter(Boolean) as GlobalAskContextOption[];
            
        // 2. Accumulate all @ mentions from all user messages in the conversation
        const parsedMentions: GlobalAskContextOption[] = [];
        messages.forEach(msg => {
            if (msg.role === 'user') {
                const mentions = parseInlineMentions(msg.content, contextOptions);
                mentions.forEach(opt => {
                    if (!parsedMentions.some(p => p.id === opt.id)) {
                        parsedMentions.push(opt);
                    }
                });
            }
        });
        
        // 3. Union them
        const union = [...initial];
        parsedMentions.forEach(opt => {
            if (!union.some(u => u.id === opt.id)) {
                union.push(opt);
            }
        });
        
        return union;
    }, [messages, selectedContextOptionIds, contextOptions]);
    const initialContextItems = useMemo(() => {
        const seen = new Set<string>();
        return selectedContextOptionIds
            .map((id) => contextOptions.find((entry) => entry.id === id))
            .filter((entry): entry is GlobalAskContextOption => !!entry)
            .filter((entry) => {
                if (seen.has(entry.id)) return false;
                seen.add(entry.id);
                return true;
            });
    }, [contextOptions, selectedContextOptionIds]);

    const resolveContextNavigationTarget = useCallback((item: GlobalAskContextOption) => {
        const selection = resolveContextSelection(item);
        if ((selection.kind === 'note' || selection.kind === 'recording') && selection.id) {
            return { kind: selection.kind, id: selection.id };
        }
        return null;
    }, []);

    const openContextPill = useCallback((item: GlobalAskContextOption) => {
        const target = resolveContextNavigationTarget(item);
        if (!target) return;
        onSelectLibraryItem?.(target.kind, target.id);
    }, [onSelectLibraryItem, resolveContextNavigationTarget]);

    const mentionRecommendations = useMemo(() => {
        if (!mentionPopoverOpen) return [];
        const filter = mentionFilter.toLowerCase();
        
        return contextOptions
            .filter(opt => {
                const isMatch = opt.label.toLowerCase().includes(filter) || opt.kind.toLowerCase().includes(filter);
                return isMatch;
            })
            .slice(0, 8);
    }, [contextOptions, mentionPopoverOpen, mentionFilter]);

    const updateMentionTrigger = useCallback((value: string, cursor: number) => {
        const textBeforeCursor = value.slice(0, cursor);
        const lastAtIndex = textBeforeCursor.lastIndexOf('@');
        if (lastAtIndex !== -1 && (lastAtIndex === 0 || /\s/.test(textBeforeCursor[lastAtIndex - 1]))) {
            const query = textBeforeCursor.slice(lastAtIndex + 1);
            if (!/\s/.test(query)) {
                setMentionPopoverOpen(true);
                setMentionFilter(query);
                setMentionStartIndex(lastAtIndex);
                setMentionSelectedIndex(0);
                return;
            }
        }

        setMentionPopoverOpen(false);
    }, []);

    const handleComposerInput = useCallback(() => {
        const editor = composerEditorRef.current;
        if (!editor) return;

        const nextDraft = serializeComposerContent(editor);
        const cursor = getComposerSelectionOffset(editor);
        pendingComposerSelectionOffsetRef.current = cursor;
        onDraftChange(nextDraft);
        updateMentionTrigger(nextDraft, cursor);
    }, [onDraftChange, updateMentionTrigger]);

    const insertTextAtComposerSelection = useCallback((text: string) => {
        const editor = composerEditorRef.current;
        const cursor = editor ? getComposerSelectionOffset(editor) : draft.length;
        const nextDraft = `${draft.slice(0, cursor)}${text}${draft.slice(cursor)}`;
        const nextCursor = cursor + text.length;

        pendingComposerSelectionOffsetRef.current = nextCursor;
        onDraftChange(nextDraft);
        updateMentionTrigger(nextDraft, nextCursor);
    }, [draft, onDraftChange, updateMentionTrigger]);

    const refreshMentionTriggerFromSelection = useCallback(() => {
        const editor = composerEditorRef.current;
        if (!editor) return;
        updateMentionTrigger(draft, getComposerSelectionOffset(editor));
    }, [draft, updateMentionTrigger]);

    const completeMention = (opt: GlobalAskContextOption) => {
        if (mentionStartIndex === -1) return;
        
        const editor = composerEditorRef.current;
        const cursor = editor ? getComposerSelectionOffset(editor) : draft.length;
        const textBeforeMention = draft.slice(0, mentionStartIndex);
        const textAfterCursor = draft.slice(cursor);
        const mentionText = `${contextMentionToken(opt)} `;
        
        const newText = textBeforeMention + mentionText + textAfterCursor;
        pendingComposerSelectionOffsetRef.current = mentionStartIndex + mentionText.length;
        onDraftChange(newText);
        
        setMentionPopoverOpen(false);
        setMentionStartIndex(-1);
    };

    const filteredContextOptions = useMemo(() => {
        let list = contextOptions;
        if (contextActiveTab !== 'all') {
            list = list.filter((o) => o.kind === contextActiveTab);
        }
        if (!contextSearch) return list;
        const q = contextSearch.toLowerCase();
        return list.filter((o) => {
            const label = `${o.kind === 'recording' ? 'Recording' : o.kind === 'note' ? 'Note' : o.kind === 'folder' ? 'Folder' : 'Chat'}: ${o.label}`;
            return label.toLowerCase().includes(q) || (o.helperText || '').toLowerCase().includes(q);
        });
    }, [contextOptions, contextSearch, contextActiveTab]);

    // Cleanup hover timer on unmount
    useEffect(() => {
        return () => {
            if (hoverTimerRef.current) clearTimeout(hoverTimerRef.current);
        };
    }, []);

    // Inject CSS keyframes for step animations
    useEffect(() => {
        if (document.getElementById('es-ask-animations')) return;
        const style = document.createElement('style');
        style.id = 'es-ask-animations';
        style.textContent = `
            @keyframes esFadeSlideIn {
                from { opacity: 0; transform: translateY(-6px); }
                to { opacity: 1; transform: translateY(0); }
            }
            .es-trace-step-enter {
                animation: esFadeSlideIn 0.35s ease-out both;
            }
            @keyframes esThoughtShimmer {
                0% { background-position: -200% 0; }
                100% { background-position: 200% 0; }
            }
            .es-thought-summary-active {
                background: linear-gradient(90deg, var(--general-text) 40%, var(--general-secondary-text) 50%, var(--general-text) 60%);
                background-size: 200% 100%;
                -webkit-background-clip: text;
                -webkit-text-fill-color: transparent;
                background-clip: text;
                animation: esThoughtShimmer 4.8s ease-in-out infinite;
            }
        `;
        document.head.appendChild(style);
    }, []);




    const submitDraft = (promptOverride?: string) => {
        if (isLoading) return;
        const prompt = String(promptOverride ?? draft ?? '').trim();
        if (!prompt) return;
        
        setMentionPopoverOpen(false);
        
        const uiSelections = selectedContextOptionIds.length > 0
            ? selectedContextOptionIds
                .map((id) => contextOptions.find((o) => o.id === id))
                .filter(Boolean) as GlobalAskContextOption[]
            : [];
            
        const mentionedOptions = parseInlineMentions(prompt, contextOptions);
        
        const combinedOptions = [...uiSelections];
        for (const opt of mentionedOptions) {
            if (!combinedOptions.some((o) => o.id === opt.id)) {
                combinedOptions.push(opt);
            }
        }

        onSend({
            prompt,
            source: 'input',
            modelSelection: selectedModelOption.selection,
            contextSelection: combinedOptions.length === 1
                ? resolveContextSelection(combinedOptions[0])
                : combinedOptions.map(resolveContextSelection),
        });
    };

    const handleKeyDown = (event: React.KeyboardEvent<HTMLDivElement>) => {
        if (mentionPopoverOpen && mentionRecommendations.length > 0) {
            if (event.key === 'ArrowDown') {
                event.preventDefault();
                setMentionSelectedIndex((prev) => (prev + 1) % mentionRecommendations.length);
                return;
            }
            if (event.key === 'ArrowUp') {
                event.preventDefault();
                setMentionSelectedIndex((prev) => (prev - 1 + mentionRecommendations.length) % mentionRecommendations.length);
                return;
            }
            if (event.key === 'Enter') {
                event.preventDefault();
                completeMention(mentionRecommendations[mentionSelectedIndex]);
                return;
            }
            if (event.key === 'Escape') {
                event.preventDefault();
                setMentionPopoverOpen(false);
                return;
            }
        }

        if (event.key === 'Enter' && !event.shiftKey) {
            event.preventDefault();
            submitDraft();
            return;
        }

        if (event.key === 'Enter' && event.shiftKey) {
            event.preventDefault();
            insertTextAtComposerSelection('\n');
        }
    };

    const handleComposerPaste = (event: React.ClipboardEvent<HTMLDivElement>) => {
        event.preventDefault();
        insertTextAtComposerSelection(event.clipboardData.getData('text/plain'));
    };

    // Build citation number index — one number per source document (not per line)
    const buildCitationIndex = useCallback((content: string) => {
        const { mainContent } = parseThinkBlock(content);
        const seen = new Map<string, number>();
        let counter = 1;

        const refs = collectCitationRefs(mainContent);
        refs.forEach((ref) => {
            const key = `${ref.kind}:${ref.uuid}`;
            if (!seen.has(key)) {
                seen.set(key, counter);
                counter++;
            }
        });

        return seen;
    }, []);

    const formattedContent = (msg: AskMessage) => {
        if (msg.role !== 'assistant') return msg.content;
        const { mainContent } = parseThinkBlock(msg.content);
        const normalizedMainContent = normalizeInlineListMarkdownForRender(
            removeCitationOnlyReferenceLines(mainContent),
        );
        const seen = buildCitationIndex(msg.content);
        const renderCitationLink = (kindRaw: string, uuidRaw: string): string => {
            const kind = String(kindRaw || '').toLowerCase();
            const uuid = String(uuidRaw || '');
            const key = `${kind}:${uuid}`;
            const num = seen.get(key) || 1;
            return `[${num}](citation://${kind}/${uuid})`;
        };

        const tokenRegex = new RegExp(CITATION_TOKEN_REGEX.source, 'gi');
        const linkRegex = new RegExp(CITATION_LINK_REGEX.source, 'gi');
        const withTokenLinks = normalizedMainContent.replace(tokenRegex, (_match, kind, uuid) => (
            renderCitationLink(kind, uuid)
        ));
        return withTokenLinks.replace(linkRegex, (_match, kind, uuid) => (
            renderCitationLink(kind, uuid)
        ));
    };

    const showTooltip = useCallback((kind: 'note' | 'recording', uuid: string, rect: DOMRect) => {
        if (hoverTimerRef.current) clearTimeout(hoverTimerRef.current);
        hoverTimerRef.current = setTimeout(() => {
            setHoveredCitation({ kind, uuid, rect });
        }, 200);
    }, []);

    const scheduleHideTooltip = useCallback(() => {
        if (hoverTimerRef.current) clearTimeout(hoverTimerRef.current);
        hoverTimerRef.current = setTimeout(() => {
            if (!isOverTooltipRef.current) {
                setHoveredCitation(null);
            }
        }, 120);
    }, []);

    const cancelHideTooltip = useCallback(() => {
        if (hoverTimerRef.current) clearTimeout(hoverTimerRef.current);
    }, []);

    const renderers = useMemo(() => ({
        a: ({ href, children, ...props }: any) => {
            if (href && href.startsWith('citation://')) {
                const parts = href.slice(11).split('/');
                const [kind, uuid] = parts;
                const num = typeof children === 'string' ? children :
                    Array.isArray(children) ? children[0] : '•';

                return (
                    <button
                        type="button"
                        onClick={(e) => {
                            e.preventDefault();
                            e.stopPropagation();
                            onSelectLibraryItem?.(kind as 'note' | 'recording', uuid);
                        }}
                        onMouseEnter={(e) => {
                            showTooltip(kind as 'note' | 'recording', uuid, e.currentTarget.getBoundingClientRect());
                        }}
                        onMouseLeave={scheduleHideTooltip}
                        className="inline-flex items-center justify-center min-w-[18px] h-[18px] -mt-1 mx-[1px] px-[4px] rounded-full text-[10px] font-bold leading-none cursor-pointer hover:scale-110 transition-all duration-150 align-super"
                        style={{
                            backgroundColor: 'var(--general-item-hover)',
                            color: 'var(--general-secondary-text)',
                            border: '1px solid var(--global-outlines)',
                        }}
                    >
                        {num}
                    </button>
                );
            }
            const handleClick = (e: React.MouseEvent<HTMLAnchorElement>) => {
                if (href && (href.startsWith('http://') || href.startsWith('https://'))) {
                    e.preventDefault();
                    try {
                        const { shell } = window.require('electron');
                        shell.openExternal(href);
                    } catch (err) {
                        console.error('Failed to open external URL:', err);
                    }
                }
            };
            return (
                <a
                    href={href}
                    onClick={handleClick}
                    className="text-[var(--general-eye-catch)] underline hover:opacity-80"
                    {...props}
                >
                    {children}
                </a>
            );
        }
    }), [onSelectLibraryItem, showTooltip, scheduleHideTooltip]);

    /* ─── Reasoning Trace (active, during loading) ─── */
    const renderReasoningTrace = () => {
        const lastUserMessage = [...messages].reverse().find((message) => message.role === 'user');
        const thoughtTitle = resolveThoughtTitle(lastUserMessage?.content || '');

        return (
            <div className="mb-3">
                <button
                    type="button"
                    onClick={() => setActiveTraceCollapsed(!activeTraceCollapsed)}
                    className="group flex items-center gap-2 text-xs font-medium text-[var(--general-secondary-text)] hover:text-[var(--general-text)] transition-colors cursor-pointer select-none"
                >
                    <span className="font-semibold text-[var(--general-text)]">Thought</span>
                    {activeTraceCollapsed && (
                        <span className="text-[var(--general-secondary-text)] opacity-60 truncate max-w-[280px]">
                            — {thoughtTitle}{isLoading && !isStreaming ? '...' : ''}
                        </span>
                    )}
                    {isLoading && !isStreaming && (
                        <span className="ml-auto mr-1 w-1.5 h-1.5 rounded-full animate-pulse shrink-0 bg-[#4CAE6B]" />
                    )}
                    <ChevronRight
                        size={14}
                        className={`shrink-0 transition-transform duration-200 opacity-40 group-hover:opacity-70 ${activeTraceCollapsed ? '' : 'rotate-90'}`}
                    />
                </button>

                {!activeTraceCollapsed && (
                    <div className="ml-[10px] mt-2.5 pl-4 pb-1" style={{ borderLeft: '2px solid color-mix(in srgb, var(--general-secondary-text) 22%, transparent)' }}>
                        <div className="es-trace-step-enter text-xs leading-relaxed">
                            <div className="es-thought-summary-active font-medium text-[var(--general-text)] mb-2">{thoughtTitle}</div>
                            <div className="flex flex-col gap-2 mt-1 text-[var(--general-secondary-text)] max-w-[520px]">
                                {progressSteps.length > 0 ? (
                                    progressSteps.map((stepEntry, index) => {
                                        const isLast = index === progressSteps.length - 1;
                                        return (
                                            <div key={index} className="flex items-center gap-2">
                                                {isLast && isLoading && !isStreaming ? (
                                                    <span className="w-1.5 h-1.5 rounded-full animate-pulse bg-[#4CAE6B] shrink-0" />
                                                ) : (
                                                    <span className="w-1 h-1 rounded-full bg-[#4CAE6B] shrink-0 opacity-60" />
                                                )}
                                                <span className={`text-xs ${isLast && isLoading && !isStreaming ? 'text-[var(--general-text)] font-medium' : 'opacity-70'}`}>
                                                    {stepEntry.message}
                                                </span>
                                            </div>
                                        );
                                    })
                                ) : (
                                    <div className="flex items-center gap-2">
                                        {isLoading && !isStreaming ? (
                                            <span className="w-1.5 h-1.5 rounded-full animate-pulse bg-[#4CAE6B] shrink-0" />
                                        ) : (
                                            <span className="w-1 h-1 rounded-full bg-[#4CAE6B] shrink-0 opacity-60" />
                                        )}
                                        <span className="text-xs opacity-70">Thinking...</span>
                                    </div>
                                )}
                                {isStreaming && (
                                    <div className="flex items-center gap-2">
                                        <span className="w-1.5 h-1.5 rounded-full bg-[#4CAE6B] shrink-0 opacity-80" />
                                        <span className="text-xs text-[var(--general-text)] font-medium">
                                            Writing the answer now...
                                        </span>
                                    </div>
                                )}
                            </div>
                        </div>
                    </div>
                )}
            </div>
        );
    };

    /* ─── Citation Hover Tooltip ─── */
    const renderCitationTooltip = () => {
        if (!hoveredCitation) return null;
        const { kind, uuid, rect } = hoveredCitation;
        const title = resolveCitationTitle?.(kind, uuid);

        const spaceBelow = window.innerHeight - rect.bottom;
        const renderAbove = spaceBelow < 50 && rect.top > 50;
        const estimatedWidth = 200;
        const idealLeft = rect.left + rect.width / 2 - estimatedWidth / 2;
        const tooltipLeft = Math.max(8, Math.min(idealLeft, window.innerWidth - estimatedWidth - 8));

        return (
            <div
                className="fixed z-50 flex items-center gap-2 px-3 py-1.5 rounded-lg shadow-lg cursor-pointer"
                style={
                    renderAbove ? {
                        bottom: window.innerHeight - rect.top + 6,
                        left: tooltipLeft,
                        backgroundColor: 'var(--sidebar-background)',
                        border: '1px solid var(--global-separator)',
                    } : {
                        top: rect.bottom + 6,
                        left: tooltipLeft,
                        backgroundColor: 'var(--sidebar-background)',
                        border: '1px solid var(--global-separator)',
                    }
                }
                onMouseEnter={() => { isOverTooltipRef.current = true; cancelHideTooltip(); }}
                onMouseLeave={() => { isOverTooltipRef.current = false; scheduleHideTooltip(); }}
                onClick={(e) => {
                    e.stopPropagation();
                    onSelectLibraryItem?.(kind, uuid);
                    isOverTooltipRef.current = false;
                    setHoveredCitation(null);
                }}
            >
                {kind === 'note'
                    ? <FileText size={12} className="text-[var(--general-secondary-text)] shrink-0" />
                    : <Volume2 size={12} className="text-[var(--general-secondary-text)] shrink-0" />
                }
                <span className="text-xs font-medium text-[var(--general-text)] whitespace-nowrap max-w-[200px] truncate">
                    {title || (kind === 'note' ? 'Note' : 'Recording')}
                </span>
                <span className="text-xs font-medium shrink-0 text-[var(--general-secondary-text)] opacity-80">
                    Open →
                </span>
            </div>
        );
    };

    /* ─── Composer ─── */
    const renderComposer = (compact = false) => (
        <div
            data-tour-id="ask-composer"
            className="relative w-full overflow-visible"
            style={{
                marginTop: compact ? `${Math.min(0, COMPOSER_BASE_HEIGHT - composerHeight)}px` : '0px',
            }}
        >
            {/* Mention popover */}
            {mentionPopoverOpen && mentionRecommendations.length > 0 && (
                <div className="absolute bottom-full left-0 mb-2 w-full max-w-[450px] z-50 rounded-xl border es-global-outline es-general-background shadow-2xl overflow-hidden flex flex-col max-h-[200px] overflow-y-auto py-1 animate-[esFadeSlideIn_0.2s_ease-out]">
                    <div className="px-3 py-1.5 text-[10px] font-bold text-stone-400 uppercase tracking-wider bg-stone-50/50 dark:bg-stone-900/50 border-b es-global-separator">
                        Reference Note, Recording, Space or Chat
                    </div>
                    {mentionRecommendations.map((opt, idx) => {
                        const isSelected = idx === mentionSelectedIndex;
                        return (
                            <button
                                key={opt.id}
                                type="button"
                                onClick={() => completeMention(opt)}
                                className={`w-full flex items-center gap-2 px-3 py-2 text-xs text-left transition-colors ${
                                    isSelected 
                                        ? 'bg-[#4CAE6B]/15 text-[var(--general-text)] font-semibold border-l-2 border-[#4CAE6B]' 
                                        : 'es-general-item-hover es-general-secondary-text border-l-2 border-transparent'
                                }`}
                            >
                                {opt.kind === 'recording' ? (
                                    <Mic size={12} className={isSelected ? "text-[#4CAE6B] shrink-0" : "text-stone-400 shrink-0"} />
                                ) : opt.kind === 'note' ? (
                                    <FileText size={12} className={isSelected ? "text-[#4CAE6B] shrink-0" : "text-stone-400 shrink-0"} />
                                ) : opt.kind === 'folder' ? (
                                    <Folder 
                                        size={12} 
                                        className={opt.colorId ? "shrink-0" : (isSelected ? "text-[#4CAE6B] shrink-0" : "text-stone-400 shrink-0")} 
                                        style={opt.colorId ? { color: opt.colorId === 'yellow' ? '#eab308' : opt.colorId === 'blue' ? '#3b82f6' : opt.colorId === 'green' ? '#22c55e' : opt.colorId === 'pink' ? '#ec4899' : undefined } : undefined} 
                                    />
                                ) : opt.kind === 'chat' ? (
                                    <MessageCircle size={12} className={isSelected ? "text-[#4CAE6B] shrink-0" : "text-stone-400 shrink-0"} />
                                ) : (
                                    <Volume2 size={12} className={isSelected ? "text-[#4CAE6B] shrink-0" : "text-stone-400 shrink-0"} />
                                )}
                                <span className="truncate flex-1">{opt.label}</span>
                                <span className="text-[9px] uppercase tracking-wider font-semibold opacity-60">
                                    {opt.kind}
                                </span>
                            </button>
                        );
                    })}
                </div>
            )}

            <div
                className="relative w-full flex flex-col overflow-hidden rounded-xl border border-[var(--global-outlines)] hover:border-[#4CAE6B] focus-within:border-[#4CAE6B] focus-within:ring-1 focus-within:ring-[#4CAE6B] transition shadow-sm"
                style={{
                    backgroundColor: 'var(--input-background)',
                    height: `${composerHeight}px`,
                }}
            >
                <div
                    ref={composerEditorRef}
                    role="textbox"
                    aria-multiline="true"
                    contentEditable={!isLoading}
                    suppressContentEditableWarning
                    data-placeholder={dynamicPlaceholder}
                    onInput={handleComposerInput}
                    onKeyDown={handleKeyDown}
                    onKeyUp={refreshMentionTriggerFromSelection}
                    onMouseUp={refreshMentionTriggerFromSelection}
                    onPaste={handleComposerPaste}
                    className="ask-composer-editor relative z-10 flex-1 min-h-0 w-full border-0 px-4 pt-3.5 pr-12 text-sm leading-relaxed focus:outline-none focus:ring-0 es-general-text"
                    style={{
                        height: `${textareaHeight}px`,
                    }}
                />

                <div className="h-10 px-3 flex items-center justify-between gap-2">
                    {/* ─── Custom Context Selector (multi-select) ─── */}
                    <div className="relative min-w-0">
                        <HoverTooltip label={hasConversation ? "Click to view active context" : "Select Context"}>
                            <button
                                type="button"
                                onClick={(e) => {
                                    setContextDropdownRect(e.currentTarget.getBoundingClientRect());
                                    setContextDropdownOpen(!contextDropdownOpen);
                                }}
                                className={`flex items-center gap-1.5 h-7 max-w-[220px] rounded-lg pl-2.5 pr-2.5 text-xs font-medium es-ask-selector es-general-item-hover transition-colors overflow-hidden cursor-pointer`}
                            >
                                <span className="truncate min-w-0">
                                    {hasConversation ? (
                                        activeContextItems.length === 0
                                            ? 'No context selected'
                                            : activeContextItems.length === 1
                                                ? activeContextItems[0].label
                                                : `${activeContextItems.length} active items`
                                    ) : (
                                        selectedContextOptionIds.length === 0
                                            ? 'No context selected'
                                            : selectedContextOptionIds.length === 1
                                                ? contextOptions.find((o) => o.id === selectedContextOptionIds[0])?.label || 'Context'
                                                : `${selectedContextOptionIds.length} selected`
                                    )}
                                </span>
                                <ChevronDown size={12} className={`shrink-0 transition-transform ${contextDropdownOpen ? 'rotate-180' : ''}`} />
                                {hasConversation && <Lock size={10} className="shrink-0 opacity-50" />}
                            </button>
                        </HoverTooltip>
                    </div>

                    <div className="flex items-center gap-2 shrink-0">
                        {/* ─── Custom Model Selector (single-select) ─── */}
                        <div className="relative">
                            <HoverTooltip label="Select model">
                                <button
                                    type="button"
                                    onClick={(e) => {
                                        setModelDropdownRect(e.currentTarget.getBoundingClientRect());
                                        setModelDropdownOpen(!modelDropdownOpen);
                                    }}
                                    className="flex items-center gap-1 h-7 rounded-lg pl-2.5 pr-2 text-xs font-medium es-ask-selector es-general-item-hover transition-colors cursor-pointer"
                                >
                                    <span>{selectedModelOption.label}</span>
                                    <ChevronDown size={12} className={`shrink-0 transition-transform ${modelDropdownOpen ? 'rotate-180' : ''}`} />
                                </button>
                            </HoverTooltip>
                        </div>

                        <button
                            type="button"
                            onClick={() => submitDraft()}
                            disabled={!draft.trim() || isLoading}
                            className="w-7 h-7 rounded-full inline-flex items-center justify-center bg-[#4CAE6B] text-white hover:opacity-90 disabled:opacity-40 transition-all shadow-sm cursor-pointer"
                            aria-label="Send message"
                            title="Send"
                        >
                            <Send size={12} />
                        </button>
                    </div>
                </div>
            </div>
        </div>
    );

    /* ─── Main Render ─── */
    return (
        <div className="flex-1 min-h-0 flex flex-col overflow-hidden es-general-background">
            {hasConversation ? (
                <div className="flex-1 min-h-0 h-full flex flex-col overflow-hidden">
                    <div ref={scrollRef} onScroll={handleMessagesScroll} className="flex-1 min-h-0 h-0 overflow-y-auto px-8 py-6">
                        <div className="mx-auto w-full max-w-[760px] space-y-4">
                            {/* Initial context pills shown above the first user bubble */}
                            {initialContextItems.length > 0 && (
                                <div className="flex justify-end">
                                    <div className="flex items-center justify-end gap-1.5 flex-wrap max-w-[82%]">
                                        {initialContextItems.map((item) => {
                                            const target = resolveContextNavigationTarget(item);
                                            const isClickable = !!target;
                                            const pillClassName = "inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-medium bg-[#4CAE6B]/10 text-[#4CAE6B] border border-[#4CAE6B]/20 transition-colors";
                                            if (!isClickable) {
                                                return (
                                                    <span key={item.id} className={pillClassName}>
                                                        {renderContextOptionIcon(item, 9)}
                                                        {item.label}
                                                    </span>
                                                );
                                            }
                                            return (
                                                <button
                                                    key={item.id}
                                                    type="button"
                                                    onClick={() => openContextPill(item)}
                                                    className={`${pillClassName} hover:bg-[#4CAE6B]/20 cursor-pointer`}
                                                    title={`Open ${item.label}`}
                                                >
                                                    {renderContextOptionIcon(item, 9)}
                                                    {item.label}
                                                </button>
                                            );
                                        })}
                                    </div>
                                </div>
                            )}

                            {messages.map((msg, msgIndex) => (
                                msg.role === 'user' ? (() => {
                                    const formattedTime = new Date(msg.createdAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
                                    const isCopied = copiedMessageId === msg.id;
                                    const msgMentions = parseInlineMentions(msg.content, contextOptions);
                                    const newMentions = msgMentions.filter(m => {
                                        // Check if this mention was NOT already in active context from prior messages
                                        const priorMentionIds = new Set<string>();
                                        selectedContextOptionIds.forEach(id => priorMentionIds.add(id));
                                        for (let i = 0; i < msgIndex; i++) {
                                            if (messages[i].role === 'user') {
                                                parseInlineMentions(messages[i].content, contextOptions).forEach(p => priorMentionIds.add(p.id));
                                            }
                                        }
                                        return !priorMentionIds.has(m.id);
                                    });

                                    return (
                                        <div key={msg.id} className="flex flex-col items-end my-2 w-full relative group pb-5">
                                            {/* Inline @ mention pills above the user message bubble */}
                                            {newMentions.length > 0 && (
                                                <div className="flex items-center gap-1.5 flex-wrap mb-1.5 max-w-[82%]">
                                                    <span className="text-[9px] font-semibold uppercase tracking-wider text-[#4CAE6B] opacity-80">+ context</span>
                                                    {newMentions.map((m) => {
                                                        const target = resolveContextNavigationTarget(m);
                                                        const isClickable = !!target;
                                                        const pillClassName = "inline-flex items-center gap-1 px-1.5 py-0.5 rounded-full text-[9px] font-medium bg-[#4CAE6B]/10 text-[#4CAE6B] border border-[#4CAE6B]/25 transition-colors";
                                                        if (!isClickable) {
                                                            return (
                                                                <span key={m.id} className={pillClassName}>
                                                                    {m.kind === 'recording' ? <Mic size={8} /> : m.kind === 'note' ? <FileText size={8} /> : m.kind === 'folder' ? <Folder size={8} /> : m.kind === 'chat' ? <MessageCircle size={8} /> : <Volume2 size={8} />}
                                                                    {m.label}
                                                                </span>
                                                            );
                                                        }
                                                        return (
                                                            <button
                                                                key={m.id}
                                                                type="button"
                                                                onClick={() => openContextPill(m)}
                                                                className={`${pillClassName} hover:bg-[#4CAE6B]/20 cursor-pointer`}
                                                                title={`Open ${m.label}`}
                                                            >
                                                                {m.kind === 'recording' ? <Mic size={8} /> : m.kind === 'note' ? <FileText size={8} /> : m.kind === 'folder' ? <Folder size={8} /> : m.kind === 'chat' ? <MessageCircle size={8} /> : <Volume2 size={8} />}
                                                                {m.label}
                                                            </button>
                                                        );
                                                    })}
                                                </div>
                                            )}
                                            <div className="max-w-[82%] px-4 py-3 rounded-2xl rounded-tr-none text-sm leading-relaxed shadow-sm border es-user-message-bubble whitespace-pre-wrap relative">
                                                {renderUserMessageContent(msg.content, contextOptions)}
                                            </div>
                                            <div className="absolute bottom-0 right-2 flex items-center gap-1.5 opacity-0 group-hover:opacity-100 transition-opacity duration-200 text-[10px] text-[var(--general-secondary-text)] select-none">
                                                <span className="opacity-70">{formattedTime}</span>
                                                <HoverTooltip label={isCopied ? "Copied" : "Copy"}>
                                                    <button
                                                        type="button"
                                                        onClick={() => handleCopy(msg.id, msg.content)}
                                                        className="p-1 rounded hover:bg-[var(--general-item-hover)] text-[var(--general-secondary-text)] hover:text-[var(--general-text)] transition-colors cursor-pointer"
                                                        aria-label="Copy message"
                                                    >
                                                        {isCopied ? <Check size={12} className="text-[#4CAE6B]" /> : <Copy size={12} />}
                                                    </button>
                                                </HoverTooltip>
                                            </div>
                                        </div>
                                    );
                                })() : (() => {
                                    const formattedTime = new Date(msg.createdAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
                                    const isCopied = copiedMessageId === msg.id;

                                    return (
                                        <div key={msg.id} className="flex justify-center my-4 w-full relative group">
                                            <div className="w-full max-w-[96%] text-sm leading-relaxed text-[var(--general-text)] relative pb-6">
                                                {/* Active reasoning trace for streaming message */}
                                                {msg.id === 'a-streaming' && isLoading && renderReasoningTrace()}

                                                {/* Main response content — no visual container */}
                                                <div className="es-md-prose es-general-text">
                                                    <ReactMarkdown
                                                        remarkPlugins={[remarkGfm, remarkMath]}
                                                        rehypePlugins={[rehypeKatex]}
                                                        components={renderers}
                                                        urlTransform={(url) => url}
                                                    >
                                                        {formattedContent(msg)}
                                                    </ReactMarkdown>
                                                </div>

                                                {/* Hover Toolbar (Time left bottom, Actions right bottom) */}
                                                {msg.id !== 'a-streaming' && (
                                                    <>
                                                        <div className="absolute bottom-0 left-0 opacity-0 group-hover:opacity-100 transition-opacity duration-200 text-[10px] text-[var(--general-secondary-text)] select-none">
                                                            {formattedTime}
                                                        </div>
                                                        <div className="absolute bottom-0 right-0 flex items-center gap-1.5 opacity-80 hover:opacity-100 transition-opacity duration-150">
                                                            <HoverTooltip label={isCopied ? "Copied" : "Copy"}>
                                                                <button
                                                                    type="button"
                                                                    onClick={() => handleCopy(msg.id, msg.content)}
                                                                    className="p-1 rounded hover:bg-[var(--general-item-hover)] text-[var(--general-secondary-text)] hover:text-[var(--general-text)] transition-colors cursor-pointer"
                                                                    aria-label="Copy response"
                                                                >
                                                                    {isCopied ? <Check size={12} className="text-[#4CAE6B]" /> : <Copy size={12} />}
                                                                </button>
                                                            </HoverTooltip>
                                                            <HoverTooltip label="Save as a note">
                                                                <button
                                                                    type="button"
                                                                    onClick={() => handleSaveAsNote(msg.content)}
                                                                    className="p-1 rounded hover:bg-[var(--general-item-hover)] text-[var(--general-secondary-text)] hover:text-[var(--general-text)] transition-colors cursor-pointer"
                                                                    aria-label="Save as a note"
                                                                >
                                                                    <Plus size={12} />
                                                                </button>
                                                            </HoverTooltip>
                                                        </div>
                                                    </>
                                                )}
                                            </div>
                                        </div>
                                    );
                                })()
                            ))}
                        </div>
                    </div>

                    <div className="shrink-0 px-8 pb-5 pt-3 es-general-background">
                        <div className="mx-auto w-full max-w-[760px]">
                            {renderComposer(true)}
                        </div>
                    </div>
                </div>
            ) : (
                <div className="flex-1 min-h-0 overflow-y-auto px-6 py-10 relative">
                    <div className="mx-auto w-full max-w-[960px] h-full min-h-[420px] flex flex-col items-center justify-center pb-24">
                        <h2 className="text-[24px] sm:text-[28px] md:text-[32px] leading-[1.08] tracking-[-0.03em] font-bold text-[var(--general-text)] text-center">
                            What are we working on?
                        </h2>
                        <p className="mt-3 text-sm text-[var(--general-secondary-text)] text-center max-w-xl">
                            Search your memory, summarize meetings, and turn raw notes into clear next steps.
                        </p>

                        <div className="mt-7 w-full max-w-[760px]">
                            {renderComposer(false)}
                        </div>

                        <p className="mt-5 text-[11px] text-[var(--general-secondary-text)] text-center opacity-70">
                            Press <span className="font-semibold">Enter</span> to send, <span className="font-semibold">Shift+Enter</span> for a new line.
                        </p>
                    </div>

                    {!authState?.isLoggedIn && !isBannerDismissed ? (
                        <div className="absolute bottom-6 left-1/2 -translate-x-1/2 w-[calc(100%-3rem)] max-w-[760px] p-4 rounded-2xl border border-[var(--global-outlines)] bg-[var(--input-background)] shadow-lg flex items-center justify-between gap-4 transition-all hover:border-[#4CAE6B]/40 hover:shadow-md duration-300 group/banner z-20">
                            <div className="flex items-center gap-3.5 min-w-0 pr-6">
                                <div className="h-10 w-10 shrink-0 flex items-center justify-center">
                                    <Sparkles className="text-[#4CAE6B] h-5 w-5" />
                                </div>
                                <div className="min-w-0">
                                    <h4 className="text-sm font-bold text-[var(--general-text)]">
                                        Try Pro
                                    </h4>
                                    <p className="mt-1 text-xs text-[var(--general-secondary-text)] leading-relaxed max-w-2xl">
                                        Unlock top-tier AI models and agentic RAG to analyze your entire library of notes and recordings, get highly accurate answers, and supercharge your development speed.
                                    </p>
                                </div>
                            </div>
                            <div className="flex items-center gap-2.5 shrink-0">
                                <button
                                    onClick={handleOpenLoginFlow}
                                    className="h-9 px-4 rounded-xl bg-gradient-to-r from-[#4CAE6B] to-emerald-500 text-white text-xs font-semibold hover:opacity-95 hover:scale-[1.02] active:scale-98 transition-all shadow-md shadow-[#4CAE6B]/15 flex items-center justify-center cursor-pointer"
                                >
                                    Get the free trial
                                </button>
                                <button
                                    onClick={() => {
                                        setIsBannerDismissed(true);
                                        try {
                                            sessionStorage.setItem('escribolt:pro-banner-dismissed', 'true');
                                        } catch (err) {
                                            console.error('Failed to save session state:', err);
                                        }
                                    }}
                                    className="h-7 w-7 rounded-full inline-flex items-center justify-center text-stone-400 hover:text-stone-600 hover:bg-stone-500/10 transition-colors cursor-pointer"
                                    aria-label="Dismiss banner"
                                >
                                    <X size={14} />
                                </button>
                            </div>
                        </div>
                    ) : null}
                </div>
            )}

            {renderCitationTooltip()}

            {/* Dropdown portals (rendered here to avoid backdrop-filter containing block) */}
            {contextDropdownOpen && contextDropdownRect && (
                <>
                    <div className="fixed inset-0 z-40" onClick={() => setContextDropdownOpen(false)} />
                    <div
                        className="fixed z-50 w-80 rounded-2xl border es-global-outline es-general-background shadow-2xl overflow-hidden flex flex-col"
                        style={
                            (window.innerHeight - contextDropdownRect.bottom) < 320 ? {
                                bottom: window.innerHeight - contextDropdownRect.top + 6,
                                left: contextDropdownRect.left,
                            } : {
                                top: contextDropdownRect.bottom + 6,
                                left: contextDropdownRect.left,
                            }
                        }
                    >
                        {hasConversation ? (
                            /* ─── Read-only active context view ─── */
                            <>
                                <div className="px-4 py-3 border-b es-global-separator">
                                    <div className="text-[11px] font-bold uppercase tracking-wider text-stone-400">Active Context</div>
                                    <div className="text-[10px] text-stone-400 mt-0.5">Use <span className="font-semibold text-[#4CAE6B]">@</span> in your message to add more</div>
                                </div>
                                <div className="max-h-64 overflow-y-auto py-1">
                                    {activeContextItems.length === 0 ? (
                                        <div className="px-4 py-6 text-sm text-stone-400 text-center">
                                            <div className="text-lg mb-1">🌐</div>
                                            Global Mode — AI has access to all your library items
                                        </div>
                                    ) : (
                                        activeContextItems.map((entry) => (
                                            <div
                                                key={entry.id}
                                                className="w-full flex items-center gap-2.5 px-4 py-2 text-sm es-general-text"
                                            >
                                                <span className="w-4 h-4 rounded border border-[#4CAE6B] bg-[#4CAE6B] flex items-center justify-center shrink-0">
                                                    <Check size={10} className="text-white" />
                                                </span>
                                                {renderContextOptionIcon(entry, 14, 'text-[#4CAE6B] shrink-0')}
                                                <span className="truncate font-medium">{entry.label}</span>
                                                <span className="text-[9px] uppercase tracking-wider font-semibold text-stone-400 ml-auto shrink-0">{entry.kind}</span>
                                            </div>
                                        ))
                                    )}
                                </div>
                            </>
                        ) : (
                            /* ─── Editable context selector ─── */
                            <>
                                {/* Search */}
                                <div className="p-3 border-b es-global-separator flex flex-col gap-2">
                                    <div className="relative">
                                        <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-stone-400" />
                                        <input
                                            value={contextSearch}
                                            onChange={(e) => setContextSearch(e.target.value)}
                                            placeholder="Filter context…"
                                            className="w-full search-input rounded-lg bg-transparent pl-8 pr-8 py-2 text-sm focus:outline-none ring-1 ring-inset border-transparent ring-[var(--global-outlines)] hover:ring-[#4CAE6B] focus:ring-[#4CAE6B] transition-all es-general-text placeholder:text-stone-500"
                                            autoFocus
                                        />
                                        {contextSearch && (
                                            <button
                                                type="button"
                                                onClick={() => setContextSearch('')}
                                                className="absolute right-2 top-1/2 -translate-y-1/2 h-5 w-5 rounded-md inline-flex items-center justify-center es-general-item-hover es-general-text transition-colors"
                                            >
                                                <X size={12} />
                                            </button>
                                        )}
                                    </div>

                                    {/* Tabs Bar */}
                                    <div className="flex items-center gap-1 overflow-x-auto pb-1 select-none border-t es-global-separator pt-2" style={{ scrollbarWidth: 'none' }}>
                                        {[
                                            { id: 'all', label: 'All' },
                                            { id: 'note', label: 'Notes' },
                                            { id: 'recording', label: 'Recs' },
                                            { id: 'folder', label: 'Spaces' },
                                            { id: 'chat', label: 'Chats' }
                                        ].map((tab) => {
                                            const active = contextActiveTab === tab.id;
                                            return (
                                                <button
                                                    key={tab.id}
                                                    type="button"
                                                    onClick={() => setContextActiveTab(tab.id as any)}
                                                    className={`px-2 py-0.5 rounded-full text-[10px] font-semibold shrink-0 transition-all border ${
                                                        active 
                                                            ? 'bg-[#4CAE6B] text-white border-[#4CAE6B]' 
                                                            : 'bg-transparent text-[var(--general-secondary-text)] border-[var(--global-outlines)] hover:bg-[var(--general-item-hover)]'
                                                    }`}
                                                >
                                                    {tab.label}
                                                </button>
                                            );
                                        })}
                                    </div>
                                </div>

                                {/* Options */}
                                <div className="max-h-64 overflow-y-auto py-1">
                                    {filteredContextOptions.length === 0 ? (
                                        <div className="px-4 py-6 text-sm text-stone-500 text-center">No matches</div>
                                    ) : (() => {
                                        const todayStr = new Date().toISOString().slice(0, 10);
                                        const dateStr = (ts: number) => new Date(ts).toISOString().slice(0, 10);
                                        const daysAgo = (ts: number) => {
                                            const diff = new Date(todayStr).getTime() - new Date(dateStr(ts)).getTime();
                                            return Math.round(diff / 86400000);
                                        };
                                        const getPeriod = (ts?: number): string => {
                                            if (!ts) return '';
                                            const d = daysAgo(ts);
                                            if (d === 0) return 'Today';
                                            if (d === 1) return 'Yesterday';
                                            if (d <= 7) return 'Last 7 days';
                                            if (d <= 28) return 'Last 4 weeks';
                                            return 'Older';
                                        };
                                        const groups: { label: string; items: typeof filteredContextOptions }[] = [];
                                        let currentLabel = '';
                                        let currentItems: typeof filteredContextOptions = [];
                                        for (const entry of filteredContextOptions) {
                                            if (entry.kind === 'folder') {
                                                if (currentItems.length) {
                                                    groups.push({ label: currentLabel, items: currentItems });
                                                    currentItems = [];
                                                }
                                                groups.push({ label: '', items: [entry] });
                                                continue;
                                            }
                                            const label = getPeriod(entry.timestamp);
                                            if (label !== currentLabel) {
                                                if (currentItems.length) {
                                                    groups.push({ label: currentLabel, items: currentItems });
                                                }
                                                currentLabel = label;
                                                currentItems = [entry];
                                            } else {
                                                currentItems.push(entry);
                                            }
                                        }
                                        if (currentItems.length) {
                                            groups.push({ label: currentLabel, items: currentItems });
                                        }

                                        return groups.map((group) => (
                                            <div key={group.label || group.items[0]?.id}>
                                                {group.label && (
                                                    <div className="px-4 py-1.5 text-[11px] font-semibold uppercase tracking-wider text-stone-500">
                                                        {group.label}
                                                    </div>
                                                )}
                                                {group.items.map((entry) => {
                                                    const isSelected = selectedContextOptionIds.includes(entry.id);
                                                    return (
                                                        <button
                                                            key={entry.id}
                                                            type="button"
                                                            onClick={() => {
                                                                const updated = isSelected
                                                                    ? selectedContextOptionIds.filter((id) => id !== entry.id)
                                                                    : [...selectedContextOptionIds, entry.id];
                                                                onContextOptionChange(updated);
                                                            }}
                                                            className="w-full flex items-center gap-2.5 px-4 py-2 text-sm text-left es-general-item-hover transition-colors"
                                                        >
                                                            <span
                                                                className={`w-4 h-4 rounded border flex items-center justify-center shrink-0 transition-colors ${
                                                                    isSelected
                                                                        ? 'border-[#4CAE6B] bg-[#4CAE6B]'
                                                                        : 'border-stone-400'
                                                                }`}
                                                            >
                                                                {isSelected && <Check size={10} className="text-white" />}
                                                            </span>
                                                            <span
                                                                className="flex min-w-0 flex-1 items-center gap-2"
                                                                style={entry.kind === 'folder' && entry.hierarchyDepth
                                                                    ? { paddingLeft: `${entry.hierarchyDepth * 14}px` }
                                                                    : undefined}
                                                            >
                                                                {entry.kind === 'folder' && entry.hierarchyDepth ? (
                                                                    <span className="h-3 w-2 shrink-0 border-b border-l border-stone-400/60" aria-hidden="true" />
                                                                ) : null}
                                                                {renderContextOptionIcon(entry, 14, 'text-stone-400 shrink-0')}
                                                                <span className={`truncate ${isSelected ? 'es-general-text font-medium' : 'es-general-secondary-text'}`}>
                                                                    {entry.label}
                                                                </span>
                                                            </span>
                                                            {entry.helperText && (
                                                                <span className="text-xs text-stone-400 shrink-0 ml-auto">{entry.helperText}</span>
                                                            )}
                                                        </button>
                                                    );
                                                })}
                                            </div>
                                        ));
                                    })()}
                                </div>
                            </>
                        )}
                    </div>
                </>
            )}

            {modelDropdownOpen && modelDropdownRect && (
                <>
                    <div className="fixed inset-0 z-40" onClick={() => setModelDropdownOpen(false)} />
                    <div
                        className="fixed z-50 w-52 rounded-2xl border es-global-outline es-general-background shadow-2xl overflow-hidden py-1"
                        style={
                            (window.innerHeight - modelDropdownRect.bottom) < 180 ? {
                                bottom: window.innerHeight - modelDropdownRect.top + 6,
                                right: window.innerWidth - modelDropdownRect.right,
                            } : {
                                top: modelDropdownRect.bottom + 6,
                                right: window.innerWidth - modelDropdownRect.right,
                            }
                        }
                    >
                        {modelOptions.map((entry) => (
                            <button
                                key={entry.id}
                                type="button"
                                onClick={() => {
                                    onModelOptionChange(entry.id);
                                    setModelDropdownOpen(false);
                                }}
                                className={`w-full flex items-center justify-between px-4 py-2 text-sm text-left es-general-item-hover transition-colors ${
                                    entry.id === selectedModelOptionId ? 'es-general-text font-medium' : 'es-general-secondary-text'
                                }`}
                            >
                                <span>{entry.label}</span>
                                {entry.id === selectedModelOptionId && (
                                    <Check size={13} style={{ color: '#4CAE6B' }} />
                                )}
                            </button>
                        ))}
                    </div>
                </>
            )}
        </div>
    );
}
