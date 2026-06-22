import React, { useRef, useState, useEffect, useCallback } from 'react';
import { useEditor, EditorContent } from '@tiptap/react';
import { BubbleMenu } from '@tiptap/react/menus';
import StarterKit from '@tiptap/starter-kit';
import Link from '@tiptap/extension-link';
import TaskList from '@tiptap/extension-task-list';
import TaskItem from '@tiptap/extension-task-item';
import Placeholder from '@tiptap/extension-placeholder';
import Underline from '@tiptap/extension-underline';

import { Markdown } from 'tiptap-markdown';
import {
    Bold, Italic, Strikethrough, Heading1, Heading2, Heading3,
    Code, FileCode2, List, ListOrdered, ListChecks,
    Link as LinkIcon, Quote, Minus, Wrench,
    Underline as UnderlineIcon, ChevronDown, GripVertical,
} from 'lucide-react';
import HoverTooltip from './HoverTooltip';
import SlashCommandMenu, { SLASH_COMMANDS, SlashCommandItem } from './SlashCommandMenu';
import { SlashHighlightExtension, slashHighlightPluginKey } from '../extensions/SlashHighlightExtension';
import { CollapsedHeadingSectionsExtension, collapsedHeadingSectionsPluginKey } from '../extensions/CollapsedHeadingSectionsExtension';
import { MathInline, MathBlock } from '../extensions/MathExtensions';
import 'katex/dist/katex.min.css';

/* ────────────────────────────────────────────────
 *  Types
 * ──────────────────────────────────────────────── */

interface MarkdownEditorProps {
    value: string;
    onChange: (value: string) => void;
    onFocus?: () => void;
    onBlur?: () => void;
    placeholder?: string;
    className?: string;
    /** If true, editor is not editable */
    readOnly?: boolean;
    /** Extra class applied to the editor prose container */
    proseClassName?: string;
    /** Show the formatting toolbar (default true) */
    showToolbar?: boolean;
    /** Render toolbar as a small floating overlay (ideal for compact widgets) */
    compactToolbar?: boolean;
    /** Enable slash-command formatting menu (default true) */
    enableSlashCommands?: boolean;
    /** Optional key used to persist collapsed heading sections */
    collapseStateKey?: string;
    /** Optional custom class for text-selection formatting menu */
    selectionToolbarClassName?: string;
    /** Optional custom inline style for text-selection formatting menu */
    selectionToolbarStyle?: React.CSSProperties;
}

type LinkRange = { from: number; to: number };
type EditorRange = { from: number; to: number };
type TextBlockRange = EditorRange & { start: number; end: number };
type BlockNodeRange = EditorRange;
type HeadingCollapseControl = {
    top: number;
    left: number;
    height: number;
    range: BlockNodeRange;
    collapsed: boolean;
};
type HeadingCollapseIdentity = {
    level: number;
    text: string;
    occurrence: number;
};
type SlashCommandTarget = {
    source: 'typed' | 'selection';
    deleteRange?: EditorRange;
    inlineRange?: EditorRange;
    textBlockRange?: TextBlockRange;
    blockNodeRange?: BlockNodeRange;
};

const BLOCK_DRAG_MIME = 'application/x-escribolt-block';
const COLLAPSED_HEADING_STORAGE_PREFIX = 'escribolt:collapsed-headings:';
const BLOCK_HANDLE_LEFT_OFFSET = 58;
const HEADING_COLLAPSE_LEFT_OFFSET = 34;

function hasBlockDragPayload(dataTransfer?: DataTransfer | null): boolean {
    return Boolean(dataTransfer && Array.from(dataTransfer.types).includes(BLOCK_DRAG_MIME));
}

function clampDocPos(editor: NonNullable<ReturnType<typeof useEditor>>, pos: number): number {
    return Math.max(0, Math.min(pos, editor.state.doc.content.size));
}

function getTextBlockRangeAtSelection(editor: NonNullable<ReturnType<typeof useEditor>>): TextBlockRange | null {
    const { doc, selection } = editor.state;
    const candidatePositions = [
        selection.from,
        selection.from < doc.content.size ? selection.from + 1 : selection.from,
        selection.head,
    ];

    for (const candidatePos of candidatePositions) {
        const $pos = doc.resolve(clampDocPos(editor, candidatePos));
        for (let depth = $pos.depth; depth > 0; depth -= 1) {
            const node = $pos.node(depth);
            if (node.isTextblock) {
                return {
                    from: $pos.before(depth),
                    to: $pos.after(depth),
                    start: $pos.start(depth),
                    end: $pos.end(depth),
                };
            }
        }
    }

    return null;
}

function getTopLevelBlockRangeAtPos(editor: NonNullable<ReturnType<typeof useEditor>>, rawPos: number): BlockNodeRange | null {
    const { doc } = editor.state;
    const pos = clampDocPos(editor, rawPos);
    const $pos = doc.resolve(pos);

    for (let depth = $pos.depth; depth > 0; depth -= 1) {
        if (depth === 1 && $pos.node(depth).isBlock) {
            return { from: $pos.before(depth), to: $pos.after(depth) };
        }
    }

    const before = doc.childBefore(pos);
    if (before.node?.isBlock) {
        return { from: before.offset, to: before.offset + before.node.nodeSize };
    }

    const after = doc.childAfter(pos);
    if (after.node?.isBlock) {
        return { from: after.offset, to: after.offset + after.node.nodeSize };
    }

    return null;
}

function getTopLevelBlockRangeAtClientY(editor: NonNullable<ReturnType<typeof useEditor>>, clientY: number): BlockNodeRange | null {
    let offset = 0;
    let nearest: { range: BlockNodeRange; distance: number } | null = null;

    for (let index = 0; index < editor.state.doc.childCount; index += 1) {
        const child = editor.state.doc.child(index);
        const range = { from: offset, to: offset + child.nodeSize };
        const nodeDom = getTopLevelBlockDomAtPos(editor, range.from);
        offset = range.to;

        if (!(nodeDom instanceof HTMLElement)) continue;

        const rect = nodeDom.getBoundingClientRect();
        if (clientY >= rect.top - 8 && clientY <= rect.bottom + 8) {
            return range;
        }

        const distance = clientY < rect.top ? rect.top - clientY : clientY - rect.bottom;
        if (!nearest || distance < nearest.distance) {
            nearest = { range, distance };
        }
    }

    return nearest && nearest.distance <= 24 ? nearest.range : null;
}

function isHeadingRange(editor: NonNullable<ReturnType<typeof useEditor>>, range: BlockNodeRange): boolean {
    return editor.state.doc.nodeAt(range.from)?.type.name === 'heading';
}

function getTopLevelBlockDomAtPos(editor: NonNullable<ReturnType<typeof useEditor>>, pos: number): HTMLElement | null {
    const nodeDom = editor.view.nodeDOM(pos);
    if (nodeDom instanceof HTMLElement) return nodeDom;

    const domAtPos = editor.view.domAtPos(clampDocPos(editor, pos + 1)).node;
    let element = domAtPos instanceof HTMLElement ? domAtPos : domAtPos.parentElement;
    while (element && element.parentElement !== editor.view.dom) {
        element = element.parentElement;
    }
    return element;
}

function normalizeHeadingText(text: string): string {
    return String(text || '').trim().replace(/\s+/g, ' ');
}

function getHeadingCollapseStorageKey(collapseStateKey?: string): string | null {
    const trimmed = String(collapseStateKey || '').trim();
    return trimmed ? `${COLLAPSED_HEADING_STORAGE_PREFIX}${trimmed}` : null;
}

function getHeadingIdentityKey(identity: HeadingCollapseIdentity): string {
    return `${identity.level}:${identity.occurrence}:${identity.text}`;
}

function getHeadingCollapseIdentity(node: any, counts: Map<string, number>): HeadingCollapseIdentity {
    const level = typeof node.attrs?.level === 'number' ? node.attrs.level : 0;
    const text = normalizeHeadingText(node.textContent || '');
    const signature = `${level}:${text}`;
    const occurrence = counts.get(signature) || 0;
    counts.set(signature, occurrence + 1);
    return { level, text, occurrence };
}

function getCollapsedHeadingSnapshot(
    editor: NonNullable<ReturnType<typeof useEditor>>,
    positions: Set<number>,
): HeadingCollapseIdentity[] {
    if (positions.size === 0) return [];

    const counts = new Map<string, number>();
    const snapshot: HeadingCollapseIdentity[] = [];

    editor.state.doc.forEach((node, offset) => {
        if (node.type.name !== 'heading') return;
        const identity = getHeadingCollapseIdentity(node, counts);
        if (positions.has(offset)) {
            snapshot.push(identity);
        }
    });

    return snapshot;
}

function getCollapsedHeadingPositionsFromSnapshot(
    editor: NonNullable<ReturnType<typeof useEditor>>,
    snapshot: HeadingCollapseIdentity[],
): Set<number> {
    if (snapshot.length === 0) return new Set<number>();

    const targetKeys = new Set(snapshot.map(getHeadingIdentityKey));
    const counts = new Map<string, number>();
    const positions = new Set<number>();

    editor.state.doc.forEach((node, offset) => {
        if (node.type.name !== 'heading') return;
        const identity = getHeadingCollapseIdentity(node, counts);
        if (targetKeys.has(getHeadingIdentityKey(identity))) {
            positions.add(offset);
        }
    });

    return positions;
}

function loadCollapsedHeadingSnapshot(storageKey: string): HeadingCollapseIdentity[] {
    if (typeof window === 'undefined') return [];

    try {
        const raw = window.localStorage.getItem(storageKey);
        if (!raw) return [];
        const parsed = JSON.parse(raw);
        if (!Array.isArray(parsed)) return [];
        return parsed
            .filter((item) => (
                item
                && typeof item.level === 'number'
                && typeof item.text === 'string'
                && typeof item.occurrence === 'number'
            ))
            .map((item) => ({
                level: item.level,
                text: normalizeHeadingText(item.text),
                occurrence: item.occurrence,
            }));
    } catch {
        return [];
    }
}

function saveCollapsedHeadingSnapshot(storageKey: string, snapshot: HeadingCollapseIdentity[]): void {
    if (typeof window === 'undefined') return;

    try {
        if (snapshot.length === 0) {
            window.localStorage.removeItem(storageKey);
            return;
        }
        window.localStorage.setItem(storageKey, JSON.stringify(snapshot));
    } catch {
        // Collapsing is a UI preference, so storage failures should not affect editing.
    }
}

function areHeadingControlsEqual(a: HeadingCollapseControl[], b: HeadingCollapseControl[]): boolean {
    if (a.length !== b.length) return false;
    return a.every((control, index) => {
        const next = b[index];
        return Boolean(next)
            && control.top === next.top
            && control.left === next.left
            && control.height === next.height
            && control.collapsed === next.collapsed
            && control.range.from === next.range.from
            && control.range.to === next.range.to;
    });
}

function getHeadingCollapseControl(
    editor: NonNullable<ReturnType<typeof useEditor>>,
    shell: HTMLElement,
    range: BlockNodeRange,
    collapsed: boolean,
): HeadingCollapseControl | null {
    const blockDom = getTopLevelBlockDomAtPos(editor, range.from);
    if (!blockDom) return null;

    const shellRect = shell.getBoundingClientRect();
    const editorRect = editor.view.dom.getBoundingClientRect();
    const blockRect = blockDom.getBoundingClientRect();

    if (blockRect.width === 0 && blockRect.height === 0) {
        return null;
    }

    if (blockRect.bottom < shellRect.top || blockRect.top > shellRect.bottom) {
        return null;
    }

    const editorOffsetLeft = editorRect.left - shellRect.left;
    return {
        top: blockRect.top - shellRect.top,
        left: editorOffsetLeft - HEADING_COLLAPSE_LEFT_OFFSET,
        height: blockRect.height,
        range,
        collapsed,
    };
}

function getSlashCommandById(id: string): SlashCommandItem {
    return SLASH_COMMANDS.find((item) => item.id === id) || SLASH_COMMANDS[0];
}

function getActiveBlockSlashCommand(editor: NonNullable<ReturnType<typeof useEditor>>): SlashCommandItem {
    if (editor.isActive('taskList')) return getSlashCommandById('task');
    if (editor.isActive('orderedList')) return getSlashCommandById('numbered');
    if (editor.isActive('bulletList')) return getSlashCommandById('bullet');
    if (editor.isActive('blockquote')) return getSlashCommandById('quote');
    if (editor.isActive('codeBlock')) return getSlashCommandById('codeblock');
    if (editor.isActive('heading', { level: 1 })) return getSlashCommandById('h1');
    if (editor.isActive('heading', { level: 2 })) return getSlashCommandById('h2');
    if (editor.isActive('heading', { level: 3 })) return getSlashCommandById('h3');
    if (editor.isActive('heading', { level: 4 })) return getSlashCommandById('h4');
    if (editor.isActive('mathBlock')) return getSlashCommandById('mathblock');
    return getSlashCommandById('text');
}

/* ────────────────────────────────────────────────
 *  Toolbar definition
 * ──────────────────────────────────────────────── */

interface ToolDef {
    id: string;
    label: string;
    shortcut: string;
    icon: React.FC<{ size?: number; strokeWidth?: number }>;
    action: (editor: NonNullable<ReturnType<typeof useEditor>>) => void;
    isActive?: (editor: NonNullable<ReturnType<typeof useEditor>>) => boolean;
}

const TOOLS: ToolDef[] = [
    {
        id: 'bold', label: 'Bold', shortcut: '⌘B', icon: Bold,
        action: (e) => { e.chain().focus().toggleBold().run(); },
        isActive: (e) => e.isActive('bold'),
    },
    {
        id: 'italic', label: 'Italic', shortcut: '⌘I', icon: Italic,
        action: (e) => { e.chain().focus().toggleItalic().run(); },
        isActive: (e) => e.isActive('italic'),
    },
    {
        id: 'strikethrough', label: 'Strikethrough', shortcut: '⌘⇧X', icon: Strikethrough,
        action: (e) => { e.chain().focus().toggleStrike().run(); },
        isActive: (e) => e.isActive('strike'),
    },
    {
        id: 'h1', label: 'Heading 1', shortcut: '⌘⌥1', icon: Heading1,
        action: (e) => { e.chain().focus().toggleHeading({ level: 1 }).run(); },
        isActive: (e) => e.isActive('heading', { level: 1 }),
    },
    {
        id: 'h2', label: 'Heading 2', shortcut: '⌘⌥2', icon: Heading2,
        action: (e) => { e.chain().focus().toggleHeading({ level: 2 }).run(); },
        isActive: (e) => e.isActive('heading', { level: 2 }),
    },
    {
        id: 'h3', label: 'Heading 3', shortcut: '⌘⌥3', icon: Heading3,
        action: (e) => { e.chain().focus().toggleHeading({ level: 3 }).run(); },
        isActive: (e) => e.isActive('heading', { level: 3 }),
    },
    {
        id: 'code', label: 'Inline code', shortcut: '⌘E', icon: Code,
        action: (e) => { e.chain().focus().toggleCode().run(); },
        isActive: (e) => e.isActive('code'),
    },
    {
        id: 'codeblock', label: 'Code block', shortcut: '⌘⇧E', icon: FileCode2,
        action: (e) => { e.chain().focus().toggleCodeBlock().run(); },
        isActive: (e) => e.isActive('codeBlock'),
    },
    {
        id: 'ul', label: 'Bullet list', shortcut: '⌘⇧8', icon: List,
        action: (e) => { e.chain().focus().toggleBulletList().run(); },
        isActive: (e) => e.isActive('bulletList'),
    },
    {
        id: 'ol', label: 'Numbered list', shortcut: '⌘⇧7', icon: ListOrdered,
        action: (e) => { e.chain().focus().toggleOrderedList().run(); },
        isActive: (e) => e.isActive('orderedList'),
    },
    {
        id: 'task', label: 'Task list', shortcut: '⌘⇧9', icon: ListChecks,
        action: (e) => { e.chain().focus().toggleTaskList().run(); },
        isActive: (e) => e.isActive('taskList'),
    },
    {
        id: 'link', label: 'Link', shortcut: '⌘K', icon: LinkIcon,
        action: () => { /* handled separately in component */ },
        isActive: (e) => e.isActive('link'),
    },
    {
        id: 'quote', label: 'Blockquote', shortcut: '⌘⇧B', icon: Quote,
        action: (e) => { e.chain().focus().toggleBlockquote().run(); },
        isActive: (e) => e.isActive('blockquote'),
    },
    {
        id: 'hr', label: 'Horizontal rule', shortcut: '', icon: Minus,
        action: (e) => { e.chain().focus().setHorizontalRule().run(); },
    },
];

function isSafeLinkHref(href: string): boolean {
    const trimmed = String(href || '').trim();
    return Boolean(trimmed) && !/^(javascript|data|vbscript):/i.test(trimmed);
}

function normalizeLinkHrefForOpen(href: string): string {
    const trimmed = String(href || '').trim();
    if (!trimmed || /^(javascript|data|vbscript):/i.test(trimmed)) return '';
    if (/^[a-z][a-z0-9+.-]*:/i.test(trimmed)) return trimmed;
    return `https://${trimmed.replace(/\s+/g, '')}`;
}

/* ────────────────────────────────────────────────
 *  Component
 * ──────────────────────────────────────────────── */

export default function MarkdownEditor({
    value,
    onChange,
    onFocus,
    onBlur,
    placeholder = "Start writting or press '/' for commands.",
    className = '',
    readOnly = false,
    proseClassName = '',
    showToolbar = false,
    compactToolbar = false,
    enableSlashCommands = true,
    collapseStateKey,
    selectionToolbarClassName = '',
    selectionToolbarStyle,
}: MarkdownEditorProps) {
    const [toolbarOpen, setToolbarOpen] = useState(false);
    const [linkHint, setLinkHint] = useState<string | null>(null);
    const [linkPopoverOpen, setLinkPopoverOpen] = useState(false);
    const [linkDraft, setLinkDraft] = useState('');
    const [linkRange, setLinkRange] = useState<LinkRange | null>(null);
    const linkInputRef = useRef<HTMLInputElement>(null);
    const [editorVersion, setEditorVersion] = useState(0);

    const [slashCommandOpen, setSlashCommandOpen] = useState(false);
    const [slashCommandQuery, setSlashCommandQuery] = useState('');
    const [slashCommandRange, setSlashCommandRange] = useState<{ from: number; to: number } | null>(null);
    const [slashCommandPosition, setSlashCommandPosition] = useState<{ top: number; bottom: number; left: number } | null>(null);
    const [selectionCommandOpen, setSelectionCommandOpen] = useState(false);
    const [selectionCommandPosition, setSelectionCommandPosition] = useState<{ top: number; bottom: number; left: number } | null>(null);
    const [selectionCommandTarget, setSelectionCommandTarget] = useState<SlashCommandTarget | null>(null);
    const editorShellRef = useRef<HTMLDivElement>(null);
    const draggedBlockRef = useRef<BlockNodeRange | null>(null);
    const [blockHandle, setBlockHandle] = useState<{ top: number; left: number; height: number; range: BlockNodeRange } | null>(null);
    const [headingCollapseControl, setHeadingCollapseControl] = useState<HeadingCollapseControl | null>(null);
    const [collapsedHeadingControls, setCollapsedHeadingControls] = useState<HeadingCollapseControl[]>([]);
    const [collapsedHeadingPositions, setCollapsedHeadingPositions] = useState<Set<number>>(() => new Set());
    const [collapseStateHydrated, setCollapseStateHydrated] = useState(false);
    const [dropIndicatorTop, setDropIndicatorTop] = useState<number | null>(null);
    // Track whether the last change came from the editor itself
    const skipNextSync = useRef(false);
    // Sync external value changes (e.g. loading a different note, AI output, IPC data)
    const lastSyncedValue = useRef(value);
    const [mathDraft, setMathDraft] = useState('');
    const mathInputRef = useRef<HTMLInputElement>(null);
    const collapseStorageKey = getHeadingCollapseStorageKey(collapseStateKey);

    const editor = useEditor({
        extensions: [
            StarterKit.configure({
                heading: { levels: [1, 2, 3, 4] },
            }),
            Link.configure({
                openOnClick: false,
                autolink: true,
                defaultProtocol: 'https',
                HTMLAttributes: {
                    target: '_blank',
                    rel: 'noopener noreferrer nofollow',
                    class: null,
                },
                isAllowedUri: (url) => isSafeLinkHref(url),
            }),
            TaskList,
            TaskItem.configure({ nested: true }),
            Placeholder.configure({ placeholder }),
            Underline,
            SlashHighlightExtension,
            CollapsedHeadingSectionsExtension,
            MathInline,
            MathBlock,
            Markdown.configure({
                html: false,
                transformCopiedText: true,
                transformPastedText: true,
            }),
        ],
        content: value,
        editable: !readOnly,
        editorProps: {
            handleDOMEvents: {
                dragover: (_view, event) => {
                    const dragEvent = event as DragEvent;
                    if (draggedBlockRef.current || hasBlockDragPayload(dragEvent.dataTransfer)) {
                        dragEvent.preventDefault();
                        return true;
                    }
                    return false;
                },
                drop: (_view, event) => {
                    const dragEvent = event as DragEvent;
                    if (draggedBlockRef.current || hasBlockDragPayload(dragEvent.dataTransfer)) {
                        dragEvent.preventDefault();
                        return true;
                    }
                    return false;
                },
            },
        },
        onUpdate: ({ editor: ed }) => {
            const md = (ed.storage as any).markdown.getMarkdown();
            if (md === lastSyncedValue.current) {
                return;
            }
            skipNextSync.current = true;
            lastSyncedValue.current = md;
            onChange(md);
        },
        onFocus: () => onFocus?.(),
        onBlur: () => onBlur?.(),
        onTransaction: ({ transaction }) => {
            setEditorVersion((version) => version + 1);

            if (transaction.docChanged) {
                setCollapsedHeadingPositions((current) => {
                    if (current.size === 0) return current;
                    const next = new Set<number>();
                    current.forEach((pos) => {
                        const mappedPos = transaction.mapping.map(pos, 1);
                        if (transaction.doc.nodeAt(mappedPos)?.type.name === 'heading') {
                            next.add(mappedPos);
                        }
                    });
                    if (next.size === current.size && Array.from(next).every((pos) => current.has(pos))) {
                        return current;
                    }
                    return next;
                });
            }

            if (!enableSlashCommands) {
                setSlashCommandOpen(false);
                return;
            }

            if (!transaction.docChanged && !transaction.selectionSet) return;
            const { state } = editor;
            const { selection } = state;
            const { $head } = selection;

            if ($head.parent.isTextblock && $head.parent.type.name !== 'codeBlock') {
                const textBeforeCursor = $head.parent.textContent.slice(0, $head.parentOffset);
                const slashIndex = textBeforeCursor.lastIndexOf('/');
                if (slashIndex !== -1) {
                    const isStartOrPrecededBySpace = slashIndex === 0 || textBeforeCursor[slashIndex - 1] === ' ';
                    if (isStartOrPrecededBySpace) {
                        const query = textBeforeCursor.slice(slashIndex + 1);
                        if (!query.includes(' ')) {
                            const startOfSlash = $head.start() + slashIndex;
                            setSlashCommandOpen(true);
                            setSelectionCommandOpen(false);
                            setSlashCommandQuery(query);
                            setSlashCommandRange({ from: startOfSlash, to: $head.pos });
                            const coords = editor.view.coordsAtPos(startOfSlash);
                            setSlashCommandPosition({
                                top: coords.top,
                                bottom: coords.bottom,
                                left: coords.left,
                            });
                            return;
                        }
                    }
                }
            }
            setSlashCommandOpen(false);
        },
    });

    useEffect(() => {
        if (!editor) return;
        if (skipNextSync.current) {
            skipNextSync.current = false;
            lastSyncedValue.current = value;
            return;
        }
        if (value === lastSyncedValue.current) return;
        lastSyncedValue.current = value;
        editor.commands.setContent(value);
    }, [value, editor]);

    // Sync readOnly prop
    useEffect(() => {
        if (!editor) return;
        editor.setEditable(!readOnly);
    }, [readOnly, editor]);

    useEffect(() => {
        if (!editor) return;

        setCollapseStateHydrated(false);

        if (!collapseStorageKey) {
            setCollapsedHeadingPositions(new Set<number>());
            setCollapseStateHydrated(true);
            return;
        }

        const snapshot = loadCollapsedHeadingSnapshot(collapseStorageKey);
        setCollapsedHeadingPositions(getCollapsedHeadingPositionsFromSnapshot(editor, snapshot));
        setCollapseStateHydrated(true);
    }, [editor, collapseStorageKey]);

    useEffect(() => {
        if (!editor) return;

        const validHeadingPositions = new Set<number>();
        editor.state.doc.forEach((node, offset) => {
            if (node.type.name === 'heading') {
                validHeadingPositions.add(offset);
            }
        });

        const tr = editor.state.tr.setMeta(collapsedHeadingSectionsPluginKey, {
            positions: Array.from(collapsedHeadingPositions),
            enabled: enableSlashCommands,
        });
        editor.view.dispatch(tr);

        setCollapsedHeadingPositions((current) => {
            if (current.size === 0) return current;
            const next = new Set<number>();
            current.forEach((pos) => {
                if (validHeadingPositions.has(pos)) {
                    next.add(pos);
                }
            });
            if (next.size === current.size) return current;
            return next;
        });
    }, [editor, enableSlashCommands, collapsedHeadingPositions]);

    useEffect(() => {
        if (!editor || !collapseStorageKey || !collapseStateHydrated) return;
        saveCollapsedHeadingSnapshot(
            collapseStorageKey,
            getCollapsedHeadingSnapshot(editor, collapsedHeadingPositions),
        );
    }, [editor, collapseStorageKey, collapseStateHydrated, collapsedHeadingPositions, editorVersion]);

    const openLinkPopover = () => {
        if (!editor) return;
        const { from, to } = editor.state.selection;
        if (from === to) {
            setLinkHint('Highlight text to turn into a link');
            setTimeout(() => setLinkHint(null), 2500);
            return;
        }
        setSelectionCommandOpen(false);
        const attrs = editor.getAttributes('link') as { href?: string };
        setLinkRange({ from, to });
        setLinkDraft(typeof attrs.href === 'string' ? attrs.href : '');
        setLinkPopoverOpen(true);
        setLinkHint(null);
    };

    const closeLinkPopover = () => {
        setLinkPopoverOpen(false);
        setLinkDraft('');
        setLinkRange(null);
    };

    const applyLinkDraft = (nextHref?: string) => {
        if (!editor || !linkRange) return;
        const href = typeof nextHref === 'string' ? nextHref.trim() : linkDraft.trim();
        let chain = editor.chain().focus().setTextSelection(linkRange);
        if (href) {
            chain.setLink({
                href,
                target: '_blank',
                rel: 'noopener noreferrer nofollow',
            }).run();
        } else {
            chain.unsetLink().run();
        }
        closeLinkPopover();
    };

    const handleEditorClick = (event: React.MouseEvent<HTMLDivElement>) => {
        const target = event.target as HTMLElement | null;
        const anchor = target?.closest('a[href]') as HTMLAnchorElement | null;
        if (!anchor) return;
        const href = anchor.getAttribute('href') || '';
        const destination = normalizeLinkHrefForOpen(href);
        if (!destination) return;
        event.preventDefault();
        event.stopPropagation();
        try {
            const { shell } = window.require('electron');
            shell.openExternal(destination);
        } catch (error) {
            window.open(destination, '_blank', 'noopener,noreferrer');
        }
    };

    const runSlashCommand = useCallback((item: SlashCommandItem, target: SlashCommandTarget) => {
        if (!editor) return;

        const inlineRange = target.inlineRange;
        const textBlockRange = target.textBlockRange;
        const inlineText = inlineRange ? editor.state.doc.textBetween(inlineRange.from, inlineRange.to).trim() : '';
        const blockText = textBlockRange ? editor.state.doc.textBetween(textBlockRange.start, textBlockRange.end).trim() : '';

        if (target.source === 'selection' && target.blockNodeRange && item.id === 'divider') {
            editor.chain().focus().deleteRange(target.blockNodeRange).setHorizontalRule().run();
            return;
        }

        if (target.source === 'selection' && target.blockNodeRange && item.id === 'mathblock') {
            editor.chain().focus().deleteRange(target.blockNodeRange).insertContent({
                type: 'mathBlock',
                attrs: { latex: blockText || '\\theta = 90^\\circ' },
            }).run();
            return;
        }

        const isInlineCommand = item.id === 'inlinecode' || item.id === 'mathinline';
        const commandRange = isInlineCommand && inlineRange
            ? inlineRange
            : textBlockRange
                ? { from: textBlockRange.start, to: textBlockRange.end }
                : null;

        const chain = editor.chain().focus();

        if (target.deleteRange) {
            chain.deleteRange(target.deleteRange);
        }

        if (commandRange) {
            chain.setTextSelection(commandRange);
        }

        if (!isInlineCommand) {
            chain.clearNodes();
        }

        switch (item.id) {
            case 'text':
                chain.setParagraph();
                break;
            case 'h1':
                chain.toggleHeading({ level: 1 });
                break;
            case 'h2':
                chain.toggleHeading({ level: 2 });
                break;
            case 'h3':
                chain.toggleHeading({ level: 3 });
                break;
            case 'h4':
                chain.toggleHeading({ level: 4 });
                break;
            case 'bullet':
                chain.toggleBulletList();
                break;
            case 'numbered':
                chain.toggleOrderedList();
                break;
            case 'task':
                chain.toggleTaskList();
                break;
            case 'quote':
                chain.toggleBlockquote();
                break;
            case 'divider':
                chain.setHorizontalRule();
                break;
            case 'codeblock':
                chain.toggleCodeBlock();
                break;
            case 'inlinecode':
                chain.toggleCode();
                break;
            case 'mathinline':
                chain.insertContent({ type: 'mathInline', attrs: { latex: inlineText || 'x^2' } });
                break;
            case 'mathblock':
                chain.insertContent({ type: 'mathBlock', attrs: { latex: '\\theta = 90^\\circ' } });
                break;
            default:
                break;
        }

        chain.run();
    }, [editor]);

    const handleSlashCommand = useCallback((item: SlashCommandItem) => {
        if (!editor || !slashCommandRange) return;
        setSlashCommandOpen(false);
        runSlashCommand(item, { source: 'typed', deleteRange: slashCommandRange });
    }, [editor, runSlashCommand, slashCommandRange]);

    const openSelectionCommandMenu = useCallback((event: React.MouseEvent<HTMLButtonElement>) => {
        event.preventDefault();
        event.stopPropagation();
        if (!editor) return;

        const { from, to } = editor.state.selection;
        if (from === to) return;

        const textBlockRange = getTextBlockRangeAtSelection(editor);
        if (!textBlockRange) return;

        const blockNodeRange = getTopLevelBlockRangeAtPos(editor, textBlockRange.from) || {
            from: textBlockRange.from,
            to: textBlockRange.to,
        };
        const rect = event.currentTarget.getBoundingClientRect();

        setSlashCommandOpen(false);
        setLinkPopoverOpen(false);
        setSelectionCommandTarget({
            source: 'selection',
            inlineRange: { from, to },
            textBlockRange,
            blockNodeRange,
        });
        setSelectionCommandPosition({
            top: rect.top,
            bottom: rect.bottom,
            left: rect.left,
        });
        setSelectionCommandOpen((open) => !open);
    }, [editor]);

    const handleSelectionSlashCommand = useCallback((item: SlashCommandItem) => {
        if (!editor || !selectionCommandTarget) return;
        setSelectionCommandOpen(false);
        runSlashCommand(item, selectionCommandTarget);
    }, [editor, runSlashCommand, selectionCommandTarget]);

    const getBlockDom = useCallback((range: BlockNodeRange): HTMLElement | null => {
        if (!editor) return null;
        return getTopLevelBlockDomAtPos(editor, range.from);
    }, [editor]);

    const refreshCollapsedHeadingControls = useCallback(() => {
        if (!editor || readOnly || !enableSlashCommands || collapsedHeadingPositions.size === 0) {
            setCollapsedHeadingControls((current) => (current.length ? [] : current));
            return;
        }

        const shell = editorShellRef.current;
        if (!shell) {
            setCollapsedHeadingControls((current) => (current.length ? [] : current));
            return;
        }

        const nextControls: HeadingCollapseControl[] = [];
        collapsedHeadingPositions.forEach((pos) => {
            const node = editor.state.doc.nodeAt(pos);
            if (node?.type.name !== 'heading') return;
            const control = getHeadingCollapseControl(
                editor,
                shell,
                { from: pos, to: pos + node.nodeSize },
                true,
            );
            if (control) {
                nextControls.push(control);
            }
        });

        setCollapsedHeadingControls((current) => (
            areHeadingControlsEqual(current, nextControls) ? current : nextControls
        ));
    }, [collapsedHeadingPositions, editor, enableSlashCommands, readOnly]);

    const updateBlockHandleFromEvent = useCallback((event: React.MouseEvent<HTMLDivElement>) => {
        if (!editor || readOnly || !enableSlashCommands || draggedBlockRef.current) return;

        const shell = editorShellRef.current;
        if (!shell) {
            setBlockHandle(null);
            setHeadingCollapseControl(null);
            return;
        }

        const shellRect = shell.getBoundingClientRect();
        const editorRect = editor.view.dom.getBoundingClientRect();
        const coords = editor.view.posAtCoords({ left: event.clientX, top: event.clientY });
        const range = event.clientX < editorRect.left
            ? getTopLevelBlockRangeAtClientY(editor, event.clientY)
            : coords
                ? getTopLevelBlockRangeAtPos(editor, coords.pos)
                : getTopLevelBlockRangeAtClientY(editor, event.clientY);

        if (!range) {
            setBlockHandle(null);
            setHeadingCollapseControl(null);
            return;
        }

        const blockDom = getBlockDom(range);
        if (!blockDom) {
            setBlockHandle(null);
            setHeadingCollapseControl(null);
            return;
        }

        const blockRect = blockDom.getBoundingClientRect();

        if (blockRect.bottom < shellRect.top || blockRect.top > shellRect.bottom) {
            setBlockHandle(null);
            setHeadingCollapseControl(null);
            return;
        }

        const editorOffsetLeft = editorRect.left - shellRect.left;
        const top = blockRect.top - shellRect.top;
        const isHeading = isHeadingRange(editor, range);
        const collapseControl = isHeading
            ? getHeadingCollapseControl(editor, shell, range, collapsedHeadingPositions.has(range.from))
            : null;

        setBlockHandle({
            top,
            left: editorOffsetLeft - BLOCK_HANDLE_LEFT_OFFSET,
            height: blockRect.height,
            range,
        });
        setHeadingCollapseControl(collapseControl);
    }, [collapsedHeadingPositions, editor, enableSlashCommands, getBlockDom, readOnly]);

    const resolveDropTargetFromEvent = useCallback((event: React.DragEvent<HTMLDivElement>) => {
        if (!editor || !editorShellRef.current) return null;

        const shellRect = editorShellRef.current.getBoundingClientRect();
        const editorRect = editor.view.dom.getBoundingClientRect();
        const coords = editor.view.posAtCoords({ left: event.clientX, top: event.clientY });
        const range = event.clientX < editorRect.left
            ? getTopLevelBlockRangeAtClientY(editor, event.clientY)
            : coords
                ? getTopLevelBlockRangeAtPos(editor, coords.pos)
                : getTopLevelBlockRangeAtClientY(editor, event.clientY);

        if (!range) {
            const atTop = event.clientY < editorRect.top + editorRect.height / 2;
            return {
                pos: atTop ? 0 : editor.state.doc.content.size,
                top: (atTop ? editorRect.top : editorRect.bottom) - shellRect.top,
            };
        }

        const blockDom = getBlockDom(range);
        if (!blockDom) {
            return {
                pos: range.to,
                top: editorRect.bottom - shellRect.top,
            };
        }

        const blockRect = blockDom.getBoundingClientRect();
        const placeAfter = event.clientY > blockRect.top + blockRect.height / 2;

        return {
            pos: placeAfter ? range.to : range.from,
            top: (placeAfter ? blockRect.bottom : blockRect.top) - shellRect.top,
        };
    }, [editor, getBlockDom]);

    const moveBlockToPos = useCallback((source: BlockNodeRange, dropPos: number) => {
        if (!editor) return;

        if (dropPos === source.from || dropPos === source.to || (dropPos > source.from && dropPos < source.to)) {
            return;
        }

        const { state, view } = editor;
        const slice = state.doc.slice(source.from, source.to);
        const mappedDropPos = dropPos > source.to ? dropPos - (source.to - source.from) : dropPos;

        try {
            const tr = state.tr
                .delete(source.from, source.to)
                .insert(mappedDropPos, slice.content)
                .scrollIntoView();
            view.dispatch(tr);
            window.requestAnimationFrame(() => editor.commands.focus());
        } catch (error) {
            console.warn('Unable to move editor block', error);
        }
    }, [editor]);

    const handleBlockDragStart = useCallback((event: React.DragEvent<HTMLDivElement>) => {
        if (!editor || !blockHandle) return;
        draggedBlockRef.current = blockHandle.range;
        setDropIndicatorTop(null);
        event.dataTransfer.effectAllowed = 'move';
        event.dataTransfer.setData(BLOCK_DRAG_MIME, `${blockHandle.range.from}:${blockHandle.range.to}`);
    }, [blockHandle, editor]);

    const handleBlockDragEnd = useCallback(() => {
        draggedBlockRef.current = null;
        setDropIndicatorTop(null);
        setBlockHandle(null);
    }, []);

    const handleEditorDragOver = useCallback((event: React.DragEvent<HTMLDivElement>) => {
        if (!draggedBlockRef.current) return;
        event.preventDefault();
        event.stopPropagation();
        event.dataTransfer.dropEffect = 'move';
        const target = resolveDropTargetFromEvent(event);
        setDropIndicatorTop(target?.top ?? null);
    }, [resolveDropTargetFromEvent]);

    const handleEditorDrop = useCallback((event: React.DragEvent<HTMLDivElement>) => {
        const draggedRange = draggedBlockRef.current;
        if (!draggedRange) return;

        event.preventDefault();
        event.stopPropagation();
        const target = resolveDropTargetFromEvent(event);
        if (target) {
            moveBlockToPos(draggedRange, target.pos);
        }
        handleBlockDragEnd();
    }, [handleBlockDragEnd, moveBlockToPos, resolveDropTargetFromEvent]);

    const toggleHeadingCollapse = useCallback((range: BlockNodeRange) => {
        setCollapsedHeadingPositions((current) => {
            const next = new Set(current);
            if (next.has(range.from)) {
                next.delete(range.from);
            } else {
                next.add(range.from);
            }
            if (editor) {
                const tr = editor.state.tr.setMeta(collapsedHeadingSectionsPluginKey, {
                    positions: Array.from(next),
                    enabled: enableSlashCommands,
                });
                editor.view.dispatch(tr);
            }
            return next;
        });
        setHeadingCollapseControl((current) => current && current.range.from === range.from
            ? { ...current, collapsed: !current.collapsed }
            : current);
    }, [editor, enableSlashCommands]);

    const hideBlockHandle = useCallback(() => {
        if (!draggedBlockRef.current) {
            setBlockHandle(null);
            setHeadingCollapseControl(null);
        }
    }, []);

    useEffect(() => {
        refreshCollapsedHeadingControls();
    }, [refreshCollapsedHeadingControls, editorVersion]);

    useEffect(() => {
        if (!enableSlashCommands || readOnly) return;
        const handleResize = () => refreshCollapsedHeadingControls();
        window.addEventListener('resize', handleResize);
        return () => window.removeEventListener('resize', handleResize);
    }, [enableSlashCommands, readOnly, refreshCollapsedHeadingControls]);

    // Apply inline-code-like decoration to the slash text while menu is open
    useEffect(() => {
        if (!editor) return;
        const tr = editor.state.tr;
        if (slashCommandOpen && slashCommandRange) {
            tr.setMeta(slashHighlightPluginKey, { range: slashCommandRange });
        } else {
            tr.setMeta(slashHighlightPluginKey, { clear: true });
        }
        editor.view.dispatch(tr);
    }, [editor, slashCommandOpen, slashCommandRange, enableSlashCommands]);

    useEffect(() => {
        if (!editor || (!slashCommandOpen && !selectionCommandOpen)) return;
        const handlePointerDown = (event: PointerEvent) => {
            const target = event.target as Node | null;
            if (!target) return;
            const clickedEditor = editor.view.dom.contains(target);
            const targetElement = target instanceof Element ? target : target.parentElement;
            const clickedMenu = targetElement instanceof Element && !!targetElement.closest('[data-slash-command-menu="true"]');
            const clickedSelectionToolbar = targetElement instanceof Element && !!targetElement.closest('[data-selection-toolbar="true"]');
            if (slashCommandOpen && !clickedEditor && !clickedMenu) {
                setSlashCommandOpen(false);
            }
            if (selectionCommandOpen && !clickedMenu && !clickedSelectionToolbar) {
                setSelectionCommandOpen(false);
            }
        };
        document.addEventListener('pointerdown', handlePointerDown, true);
        return () => document.removeEventListener('pointerdown', handlePointerDown, true);
    }, [editor, slashCommandOpen, selectionCommandOpen]);

    // Close toolbar with Escape
    useEffect(() => {
        const handleEsc = (e: KeyboardEvent) => {
            if (e.key === 'Escape' && slashCommandOpen) {
                setSlashCommandOpen(false);
                return;
            }
            if (e.key === 'Escape' && selectionCommandOpen) {
                setSelectionCommandOpen(false);
                return;
            }
            if (e.key === 'Escape' && linkPopoverOpen) {
                setLinkPopoverOpen(false);
                return;
            }
            if (e.key === 'Escape' && toolbarOpen) setToolbarOpen(false);
        };
        window.addEventListener('keydown', handleEsc);
        return () => window.removeEventListener('keydown', handleEsc);
    }, [toolbarOpen, linkPopoverOpen, slashCommandOpen, selectionCommandOpen]);

    useEffect(() => {
        if (!linkPopoverOpen) return;
        const timer = window.setTimeout(() => {
            linkInputRef.current?.focus();
            linkInputRef.current?.select();
        }, 0);
        return () => window.clearTimeout(timer);
    }, [linkPopoverOpen]);

    const isMathSelected = editor ? (editor.isActive('mathInline') || editor.isActive('mathBlock')) : false;

    useEffect(() => {
        if (!editor) return;
        const isMath = editor.isActive('mathInline') || editor.isActive('mathBlock');
        if (isMath) {
            const attrs = editor.getAttributes(editor.isActive('mathInline') ? 'mathInline' : 'mathBlock');
            setMathDraft(attrs.latex || '');
        }
    }, [editor, editor?.state.selection]);

    useEffect(() => {
        if (isMathSelected) {
            const timer = window.setTimeout(() => {
                mathInputRef.current?.focus();
                mathInputRef.current?.select();
            }, 50);
            return () => window.clearTimeout(timer);
        }
    }, [isMathSelected]);

    if (!editor) return null;

    const hasCustomSelectionToolbarStyling = Boolean(selectionToolbarClassName || selectionToolbarStyle);
    const activeBlockCommand = getActiveBlockSlashCommand(editor);
    const ActiveBlockIcon = activeBlockCommand.icon;
    const persistentCollapsedHeadingControls = collapsedHeadingControls.filter((control) => (
        !headingCollapseControl || control.range.from !== headingCollapseControl.range.from
    ));
    const renderHeadingCollapseButton = (control: HeadingCollapseControl) => (
        <button
            key={`heading-collapse-${control.range.from}`}
            className={`no-drag absolute z-30 flex h-8 w-8 items-center justify-center border-0 bg-transparent p-0 es-general-text transition-opacity hover:opacity-90 cursor-pointer ${
                control.collapsed ? 'opacity-70' : 'opacity-35'
            }`}
            style={{
                top: control.top + Math.max(0, Math.min(8, (control.height - 32) / 2)),
                left: control.left,
            }}
            type="button"
            aria-label={control.collapsed ? 'Expand heading section' : 'Collapse heading section'}
            title={control.collapsed ? 'Expand section' : 'Collapse section'}
            onMouseDown={(event) => {
                event.preventDefault();
                event.stopPropagation();
            }}
            onClick={(event) => {
                event.preventDefault();
                event.stopPropagation();
                toggleHeadingCollapse(control.range);
            }}
        >
            <ChevronDown
                size={16}
                strokeWidth={2}
                className={`transition-transform ${control.collapsed ? '-rotate-90' : ''}`}
            />
        </button>
    );

    return (
        <div className={`flex flex-col h-full relative ${className}`}>
            {/* Tiptap WYSIWYG editor */}
            <div
                ref={editorShellRef}
                className={`relative flex-1 min-h-0 ${enableSlashCommands && !readOnly ? '-ml-16 pl-16' : ''}`.trim()}
                onMouseMove={updateBlockHandleFromEvent}
                onMouseLeave={hideBlockHandle}
                onDragOverCapture={handleEditorDragOver}
                onDropCapture={handleEditorDrop}
                onDragOver={handleEditorDragOver}
                onDrop={handleEditorDrop}
            >
                <EditorContent
                    editor={editor}
                    onClickCapture={handleEditorClick}
                    onScroll={() => {
                        hideBlockHandle();
                        window.requestAnimationFrame(() => refreshCollapsedHeadingControls());
                    }}
                    className={`h-full overflow-y-auto es-writing-text leading-relaxed font-sans text-base es-md-prose pb-14 pr-1 ${proseClassName}`}
                />

                {enableSlashCommands && !readOnly && persistentCollapsedHeadingControls.map(renderHeadingCollapseButton)}
                {enableSlashCommands && !readOnly && headingCollapseControl && renderHeadingCollapseButton(headingCollapseControl)}

                {enableSlashCommands && !readOnly && blockHandle && (
                    <div
                        data-block-drag-handle="true"
                        className="no-drag absolute z-30 flex h-8 w-8 items-center justify-center es-general-text opacity-35 transition-opacity hover:opacity-80 cursor-grab active:cursor-grabbing"
                        style={{
                            top: blockHandle.top + Math.max(0, Math.min(8, (blockHandle.height - 32) / 2)),
                            left: blockHandle.left,
                        }}
                        draggable
                        role="button"
                        aria-label="Drag block"
                        title="Drag block"
                        onMouseDown={(event) => event.stopPropagation()}
                        onDragStart={handleBlockDragStart}
                        onDragEnd={handleBlockDragEnd}
                    >
                        <GripVertical size={16} strokeWidth={1.75} />
                    </div>
                )}

                {enableSlashCommands && dropIndicatorTop !== null && (
                    <div
                        className="pointer-events-none absolute left-0 right-0 z-20 h-0.5 rounded-full bg-[#4CAE6B] shadow-[0_0_0_1px_rgba(76,174,107,0.18),0_6px_16px_rgba(76,174,107,0.22)]"
                        style={{ top: dropIndicatorTop }}
                    />
                )}
            </div>

            {/* Bubble menu for math live editing */}
            {editor && !readOnly && (
                <BubbleMenu
                    editor={editor}
                    options={{ placement: 'top' as any }}
                    shouldShow={({ editor }: { editor: any }) => editor.isActive('mathInline') || editor.isActive('mathBlock')}
                    className="rounded-xl border es-global-outline shadow-2xl es-general-background p-2"
                >
                    <div className="flex items-center gap-2 px-1 py-0.5">
                        <span className="text-xs font-semibold uppercase tracking-wider opacity-60">LaTeX:</span>
                        <input
                            ref={mathInputRef}
                            type="text"
                            value={mathDraft}
                            onChange={(e) => {
                                setMathDraft(e.target.value);
                                const isBlock = editor.isActive('mathBlock');
                                editor.commands.updateAttributes(isBlock ? 'mathBlock' : 'mathInline', {
                                    latex: e.target.value,
                                });
                            }}
                            className="px-2 py-1 text-sm rounded bg-stone-100 dark:bg-stone-800 border-none outline-none es-general-text min-w-[240px]"
                            placeholder="Type LaTeX equation..."
                            onKeyDown={(e) => {
                                if (e.key === 'Enter' || e.key === 'Escape') {
                                    editor.commands.focus();
                                }
                            }}
                        />
                    </div>
                </BubbleMenu>
            )}

            {/* Bubble menu for text selection */}
            {editor && !readOnly && (
                <BubbleMenu
                    editor={editor}
                    options={{ placement: 'top' as any }}
                    shouldShow={({ editor }: { editor: any }) => {
                        if (editor.isActive('mathInline') || editor.isActive('mathBlock')) {
                            return false;
                        }
                        return linkPopoverOpen || selectionCommandOpen || editor.state.selection.content().size > 0;
                    }}
                    className={
                        hasCustomSelectionToolbarStyling
                            ? `rounded-xl border shadow-2xl ${selectionToolbarClassName}`.trim()
                            : 'rounded-xl border es-global-outline shadow-2xl es-general-background'
                    }
                    style={selectionToolbarStyle}
                >
                    <div className="flex items-center gap-0.5 p-1.5" data-selection-toolbar="true">
                        {enableSlashCommands && (
                            <>
                                <HoverTooltip label="Block commands">
                                    <button
                                        className={`h-7 px-2.5 rounded-md es-general-item-hover transition-colors inline-flex items-center justify-center gap-1.5 text-xs font-semibold ${
                                            selectionCommandOpen ? 'es-general-selected-item' : 'es-general-text opacity-80 hover:opacity-100'
                                        }`}
                                        onMouseDown={(event) => event.preventDefault()}
                                        onClick={openSelectionCommandMenu}
                                        type="button"
                                    >
                                        <ActiveBlockIcon size={14} strokeWidth={1.75} />
                                        <span>{activeBlockCommand.label}</span>
                                        <ChevronDown size={12} strokeWidth={2} className="opacity-70" />
                                    </button>
                                </HoverTooltip>
                                <div className="w-px h-5 bg-stone-300 opacity-30 mx-1" />
                            </>
                        )}

                        <HoverTooltip label="Bold" shortcut="⌘B">
                            <button
                                className={`p-1.5 rounded-md es-general-item-hover transition-colors ${
                                    editor.isActive('bold') ? 'es-general-selected-item' : 'es-general-text opacity-60 hover:opacity-100'
                                }`}
                                onClick={() => editor.chain().focus().toggleBold().run()}
                                type="button"
                            >
                                <Bold size={15} />
                            </button>
                        </HoverTooltip>

                        <HoverTooltip label="Italic" shortcut="⌘I">
                            <button
                                className={`p-1.5 rounded-md es-general-item-hover transition-colors ${
                                    editor.isActive('italic') ? 'es-general-selected-item' : 'es-general-text opacity-60 hover:opacity-100'
                                }`}
                                onClick={() => editor.chain().focus().toggleItalic().run()}
                                type="button"
                            >
                                <Italic size={15} />
                            </button>
                        </HoverTooltip>

                        <HoverTooltip label="Underline" shortcut="⌘U">
                            <button
                                className={`p-1.5 rounded-md es-general-item-hover transition-colors ${
                                    editor.isActive('underline') ? 'es-general-selected-item' : 'es-general-text opacity-60 hover:opacity-100'
                                }`}
                                onClick={() => editor.chain().focus().toggleUnderline().run()}
                                type="button"
                            >
                                <UnderlineIcon size={15} />
                            </button>
                        </HoverTooltip>

                        <div className="w-px h-5 bg-stone-300 opacity-30 mx-1" />

                        <HoverTooltip label="Link" shortcut="⌘K">
                            <button
                                className={`p-1.5 rounded-md es-general-item-hover transition-colors ${
                                    editor.isActive('link') ? 'es-general-selected-item' : 'es-general-text opacity-60 hover:opacity-100'
                                }`}
                                onMouseDown={(event) => event.preventDefault()}
                                onClick={openLinkPopover}
                                type="button"
                            >
                                <LinkIcon size={15} />
                            </button>
                        </HoverTooltip>

                        <HoverTooltip label="Strikethrough" shortcut="⇧X">
                            <button
                                className={`p-1.5 rounded-md es-general-item-hover transition-colors ${
                                    editor.isActive('strike') ? 'es-general-selected-item' : 'es-general-text opacity-60 hover:opacity-100'
                                }`}
                                onClick={() => editor.chain().focus().toggleStrike().run()}
                                type="button"
                            >
                                <Strikethrough size={15} />
                            </button>
                        </HoverTooltip>

                        <HoverTooltip label="Inline code" shortcut="E">
                            <button
                                className={`p-1.5 rounded-md es-general-item-hover transition-colors ${
                                    editor.isActive('code') ? 'es-general-selected-item' : 'es-general-text opacity-60 hover:opacity-100'
                                }`}
                                onClick={() => editor.chain().focus().toggleCode().run()}
                                type="button"
                            >
                                <Code size={15} />
                            </button>
                        </HoverTooltip>

                        <HoverTooltip label="Math Equation">
                            <button
                                className="p-1.5 rounded-md es-general-item-hover transition-colors es-general-text opacity-60 hover:opacity-100"
                                onClick={() => {
                                    const { from, to } = editor.state.selection;
                                    const text = editor.state.doc.textBetween(from, to);
                                    editor.chain().focus().insertContent({
                                        type: 'mathInline',
                                        attrs: { latex: text || 'x^2' }
                                    }).run();
                                }}
                                type="button"
                            >
                                <span className="text-xs font-bold font-mono px-0.5">fx</span>
                            </button>
                        </HoverTooltip>
                    </div>
                    {linkPopoverOpen && (
                        <form
                            className="flex items-center gap-1.5 border-t es-global-separator p-2"
                            onSubmit={(event) => {
                                event.preventDefault();
                                applyLinkDraft();
                            }}
                            onMouseDown={(event) => event.stopPropagation()}
                        >
                            <input
                                ref={linkInputRef}
                                value={linkDraft}
                                onChange={(event) => setLinkDraft(event.target.value)}
                                className="h-8 w-56 min-w-0 rounded-md border es-global-outline bg-transparent px-2 text-xs es-general-text outline-none focus:border-[var(--global-selected-outlines)]"
                                placeholder="Type link"
                            />
                            <button
                                type="submit"
                                className="h-8 rounded-md bg-[#4CAE6B] px-2.5 text-xs font-semibold text-white transition-colors hover:opacity-90"
                            >
                                Apply
                            </button>
                            <button
                                type="button"
                                className="h-8 rounded-md px-2.5 text-xs font-semibold es-general-item-hover es-general-text transition-colors"
                                onMouseDown={(event) => event.preventDefault()}
                                onClick={() => applyLinkDraft('')}
                            >
                                Remove
                            </button>
                        </form>
                    )}
                </BubbleMenu>
            )}

            {/* Slash command menu */}
            {enableSlashCommands && slashCommandOpen && editor && (
                <SlashCommandMenu
                    editor={editor}
                    range={slashCommandRange!}
                    command={handleSlashCommand}
                    query={slashCommandQuery}
                    position={slashCommandPosition}
                />
            )}

            {enableSlashCommands && selectionCommandOpen && editor && selectionCommandTarget && (
                <SlashCommandMenu
                    editor={editor}
                    range={selectionCommandTarget.textBlockRange
                        ? { from: selectionCommandTarget.textBlockRange.start, to: selectionCommandTarget.textBlockRange.end }
                        : selectionCommandTarget.inlineRange!}
                    command={handleSelectionSlashCommand}
                    query=""
                    position={selectionCommandPosition}
                />
            )}

            {/* Formatting toolbar — fixed bottom-left */}
            {showToolbar && !readOnly && (
                <div className="fixed bottom-4 left-4 z-[70] pointer-events-none">
                    <div className={`pointer-events-auto inline-flex items-center rounded-xl border shadow-lg p-1.5 gap-0.5 ${
                        compactToolbar
                            ? 'bg-white/95 backdrop-blur-sm'
                            : 'es-general-background es-global-outline'
                    } ${toolbarOpen ? 'flex-wrap' : ''}`} style={compactToolbar ? { borderColor: '#e5e5e5' } : undefined}>
                        {toolbarOpen && TOOLS.map((tool) => {
                            const IconComp = tool.icon;
                            const active = tool.isActive?.(editor);
                            const isLinkTool = tool.id === 'link';
                            return (
                                <HoverTooltip key={tool.id} label={tool.label} shortcut={tool.shortcut || undefined}>
                                    <button
                                        className={compactToolbar
                                            ? `p-1 rounded transition-colors ${
                                                active
                                                    ? 'text-gray-800 bg-gray-200/60'
                                                    : 'text-gray-500 hover:text-gray-800 hover:bg-gray-100'
                                            }`
                                            : `p-1.5 rounded-md es-general-item-hover transition-colors ${
                                                active
                                                    ? 'es-general-text bg-stone-200/50'
                                                    : 'es-general-text opacity-60 hover:opacity-100'
                                            }`
                                        }
                                        onClick={() => isLinkTool ? openLinkPopover() : tool.action(editor)}
                                        type="button"
                                        tabIndex={-1}
                                    >
                                        <IconComp size={compactToolbar ? 13 : 15} strokeWidth={2} />
                                    </button>
                                </HoverTooltip>
                            );
                        })}
                        {toolbarOpen && (
                            <div className={`w-px bg-stone-300 opacity-30 ${compactToolbar ? 'h-4 mx-0.5' : 'h-5 mx-1'}`} />
                        )}
                        <HoverTooltip label={toolbarOpen ? 'Close toolbar' : 'Formatting tools'} shortcut={toolbarOpen ? 'Esc' : undefined}>
                            <button
                                className={compactToolbar
                                    ? 'p-1.5 rounded transition-colors text-gray-500 hover:text-gray-700 hover:bg-gray-100'
                                    : 'p-1.5 rounded-md es-general-item-hover transition-colors text-stone-400 hover:text-stone-600'
                                }
                                onClick={() => setToolbarOpen((o) => !o)}
                                type="button"
                                tabIndex={-1}
                            >
                                <Wrench size={compactToolbar ? 13 : 16} strokeWidth={2} />
                            </button>
                        </HoverTooltip>
                    </div>
                    {linkHint && (
                        <div className="absolute bottom-full mb-1.5 left-0 px-2.5 py-1.5 rounded-md text-xs font-medium bg-red-50 border border-red-200 shadow-lg text-red-600 whitespace-nowrap animate-fade-in">
                            {linkHint}
                        </div>
                    )}
                </div>
            )}
        </div>
    );
}
