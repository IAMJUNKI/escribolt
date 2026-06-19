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
    Underline as UnderlineIcon,
} from 'lucide-react';
import HoverTooltip from './HoverTooltip';
import SlashCommandMenu, { SlashCommandItem } from './SlashCommandMenu';
import { SlashHighlightExtension, slashHighlightPluginKey } from '../extensions/SlashHighlightExtension';
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
    /** Optional custom class for text-selection formatting menu */
    selectionToolbarClassName?: string;
    /** Optional custom inline style for text-selection formatting menu */
    selectionToolbarStyle?: React.CSSProperties;
}

type LinkRange = { from: number; to: number };

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
    selectionToolbarClassName = '',
    selectionToolbarStyle,
}: MarkdownEditorProps) {
    const [toolbarOpen, setToolbarOpen] = useState(false);
    const [linkHint, setLinkHint] = useState<string | null>(null);
    const [linkPopoverOpen, setLinkPopoverOpen] = useState(false);
    const [linkDraft, setLinkDraft] = useState('');
    const [linkRange, setLinkRange] = useState<LinkRange | null>(null);
    const linkInputRef = useRef<HTMLInputElement>(null);
    const [, setTick] = useState(0);

    const [slashCommandOpen, setSlashCommandOpen] = useState(false);
    const [slashCommandQuery, setSlashCommandQuery] = useState('');
    const [slashCommandRange, setSlashCommandRange] = useState<{ from: number; to: number } | null>(null);
    const [slashCommandPosition, setSlashCommandPosition] = useState<{ top: number; bottom: number; left: number } | null>(null);
    // Track whether the last change came from the editor itself
    const skipNextSync = useRef(false);
    // Sync external value changes (e.g. loading a different note, AI output, IPC data)
    const lastSyncedValue = useRef(value);
    const [mathDraft, setMathDraft] = useState('');
    const mathInputRef = useRef<HTMLInputElement>(null);

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
            setTick((t) => t + 1);

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

    const openLinkPopover = () => {
        if (!editor) return;
        const { from, to } = editor.state.selection;
        if (from === to) {
            setLinkHint('Highlight text to turn into a link');
            setTimeout(() => setLinkHint(null), 2500);
            return;
        }
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

    const handleSlashCommand = useCallback((item: SlashCommandItem) => {
        if (!editor || !slashCommandRange) return;
        setSlashCommandOpen(false);

        const { from, to } = slashCommandRange;
        const chain = editor.chain().focus().deleteRange({ from, to });

        if (item.id !== 'inlinecode' && item.id !== 'mathinline') {
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
                chain.insertContent({ type: 'mathInline', attrs: { latex: 'x^2' } });
                break;
            case 'mathblock':
                chain.insertContent({ type: 'mathBlock', attrs: { latex: '\\theta = 90^\\circ' } });
                break;
            default:
                break;
        }

        chain.run();
    }, [editor, slashCommandRange]);

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
        if (!editor || !slashCommandOpen) return;
        const handlePointerDown = (event: PointerEvent) => {
            const target = event.target as Node | null;
            if (!target) return;
            const clickedEditor = editor.view.dom.contains(target);
            const clickedMenu = target instanceof Element && !!target.closest('[data-slash-command-menu="true"]');
            if (!clickedEditor && !clickedMenu) {
                setSlashCommandOpen(false);
            }
        };
        document.addEventListener('pointerdown', handlePointerDown, true);
        return () => document.removeEventListener('pointerdown', handlePointerDown, true);
    }, [editor, slashCommandOpen]);

    // Close toolbar with Escape
    useEffect(() => {
        const handleEsc = (e: KeyboardEvent) => {
            if (e.key === 'Escape' && slashCommandOpen) {
                setSlashCommandOpen(false);
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
    }, [toolbarOpen, linkPopoverOpen, slashCommandOpen]);

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

    return (
        <div className={`flex flex-col h-full relative ${className}`}>
            {/* Tiptap WYSIWYG editor */}
            <EditorContent
                editor={editor}
                onClickCapture={handleEditorClick}
                className={`flex-1 overflow-y-auto es-writing-text leading-relaxed font-sans text-base es-md-prose pb-14 pr-1 ${proseClassName}`}
            />

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
                        return linkPopoverOpen || editor.state.selection.content().size > 0;
                    }}
                    className={
                        hasCustomSelectionToolbarStyling
                            ? `rounded-xl border shadow-2xl ${selectionToolbarClassName}`.trim()
                            : 'rounded-xl border es-global-outline shadow-2xl es-general-background'
                    }
                    style={selectionToolbarStyle}
                >
                    <div className="flex items-center gap-0.5 p-1.5">
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
