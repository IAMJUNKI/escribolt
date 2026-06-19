import React, { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import {
    Type, Heading1, Heading2, Heading3, Heading4,
    List, ListOrdered, ListChecks, Quote, Minus,
    Code, Code2, Sigma, Variable,
} from 'lucide-react';

export interface SlashCommandItem {
    id: string;
    label: string;
    icon: React.FC<{ size?: number; strokeWidth?: number }>;
    shortcut?: string;
    section: 'basics' | 'advanced';
    action: (editor: any) => void;
}

interface SlashCommandMenuProps {
    editor: any;
    range: { from: number; to: number };
    command: (item: SlashCommandItem) => void;
    query: string;
    position: { top: number; bottom: number; left: number } | null;
}

export const SLASH_COMMANDS: SlashCommandItem[] = [
    { id: 'text', label: 'Text', icon: Type, section: 'basics', action: (editor) => editor.chain().focus().setParagraph().run() },
    { id: 'h1', label: 'Heading 1', icon: Heading1, shortcut: '#', section: 'basics', action: (editor) => editor.chain().focus().toggleHeading({ level: 1 }).run() },
    { id: 'h2', label: 'Heading 2', icon: Heading2, shortcut: '##', section: 'basics', action: (editor) => editor.chain().focus().toggleHeading({ level: 2 }).run() },
    { id: 'h3', label: 'Heading 3', icon: Heading3, shortcut: '###', section: 'basics', action: (editor) => editor.chain().focus().toggleHeading({ level: 3 }).run() },
    { id: 'h4', label: 'Heading 4', icon: Heading4, shortcut: '####', section: 'basics', action: (editor) => editor.chain().focus().toggleHeading({ level: 4 }).run() },
    { id: 'bullet', label: 'Bullet list', icon: List, shortcut: '-', section: 'basics', action: (editor) => editor.chain().focus().toggleBulletList().run() },
    { id: 'numbered', label: 'Numbered list', icon: ListOrdered, shortcut: '1.', section: 'basics', action: (editor) => editor.chain().focus().toggleOrderedList().run() },
    { id: 'task', label: 'Task list', icon: ListChecks, shortcut: '[]', section: 'basics', action: (editor) => editor.chain().focus().toggleTaskList().run() },
    { id: 'quote', label: 'Quote', icon: Quote, shortcut: '>', section: 'basics', action: (editor) => editor.chain().focus().toggleBlockquote().run() },
    { id: 'divider', label: 'Divider', icon: Minus, shortcut: '---', section: 'basics', action: (editor) => editor.chain().focus().setHorizontalRule().run() },
    { id: 'codeblock', label: 'Code block', icon: Code, shortcut: '```', section: 'advanced', action: (editor) => editor.chain().focus().toggleCodeBlock().run() },
    { id: 'inlinecode', label: 'Inline code', icon: Code2, shortcut: '`', section: 'advanced', action: (editor) => editor.chain().focus().toggleCode().run() },
    { id: 'mathinline', label: 'Inline math', icon: Variable, shortcut: '$', section: 'advanced', action: (editor) => editor.chain().focus().insertContent({ type: 'mathInline', attrs: { latex: 'x^2' } }).run() },
    { id: 'mathblock', label: 'Math block', icon: Sigma, shortcut: '$$', section: 'advanced', action: (editor) => editor.chain().focus().insertContent({ type: 'mathBlock', attrs: { latex: '\\theta = 90^\\circ' } }).run() },
];

export default function SlashCommandMenu({ editor, range, command, query, position }: SlashCommandMenuProps) {
    const [selectedIndex, setSelectedIndex] = useState(0);
    const menuRef = useRef<HTMLDivElement>(null);
    const selectedRef = useRef<HTMLButtonElement>(null);
    const [themeClass, setThemeClass] = useState('');

    useEffect(() => {
        const el = document.querySelector('[class*="es-theme-"]');
        if (el) {
            const cls = Array.from(el.classList).find((c) => c.startsWith('es-theme-'));
            if (cls) setThemeClass(cls);
        }
    }, []);

    useEffect(() => {
        selectedRef.current?.scrollIntoView({ block: 'nearest' });
    }, [selectedIndex]);

    const filteredCommands = SLASH_COMMANDS.filter((item) =>
        item.label.toLowerCase().includes(query.toLowerCase())
    );

    const basics = filteredCommands.filter((c) => c.section === 'basics');
    const advanced = filteredCommands.filter((c) => c.section === 'advanced');

    useEffect(() => {
        const handleKeyDown = (e: KeyboardEvent) => {
            if (e.key === 'ArrowUp') {
                e.preventDefault();
                e.stopPropagation();
                setSelectedIndex((prev) => (prev - 1 + filteredCommands.length) % filteredCommands.length);
            } else if (e.key === 'ArrowDown') {
                e.preventDefault();
                e.stopPropagation();
                setSelectedIndex((prev) => (prev + 1) % filteredCommands.length);
            } else if (e.key === 'Enter') {
                e.preventDefault();
                e.stopPropagation();
                if (filteredCommands[selectedIndex]) {
                    command(filteredCommands[selectedIndex]);
                }
            } else if (e.key === 'Escape') {
                e.preventDefault();
                e.stopPropagation();
            }
        };
        window.addEventListener('keydown', handleKeyDown, true);
        return () => window.removeEventListener('keydown', handleKeyDown, true);
    }, [selectedIndex, filteredCommands, command]);

    useEffect(() => {
        setSelectedIndex(0);
    }, [query]);

    if (!position || filteredCommands.length === 0) return null;

    const renderItem = (item: SlashCommandItem, index: number, globalIndex: number) => {
        const IconComp = item.icon;
        const isSelected = globalIndex === selectedIndex;
        return (
            <button
                key={item.id}
                ref={isSelected ? selectedRef : undefined}
                className={`w-full flex items-center gap-3 px-3 py-2 text-left rounded-lg transition-colors ${
                    isSelected
                        ? 'es-general-selected-item'
                        : 'es-general-item-hover es-general-text opacity-80 hover:opacity-100'
                }`}
                onClick={() => command(item)}
                onMouseEnter={() => setSelectedIndex(globalIndex)}
                type="button"
            >
                <span className="shrink-0 opacity-70 inline-flex">
                    <IconComp size={16} strokeWidth={1.5} />
                </span>
                <span className="flex-1 text-sm">{item.label}</span>
                {item.shortcut && (
                    <span className="text-xs text-stone-400 font-mono">{item.shortcut}</span>
                )}
            </button>
        );
    };

    const menuHeightEstimate = 280;
    const showAbove = position.bottom + menuHeightEstimate + 4 > window.innerHeight;
    const top = showAbove ? position.top - menuHeightEstimate - 4 : position.bottom + 4;

    return createPortal(
        <div
            ref={menuRef}
            data-slash-command-menu="true"
            className={`fixed z-[100] w-72 rounded-xl border es-global-outline shadow-2xl overflow-hidden es-general-background ${themeClass}`}
            style={{
                top: Math.max(8, top),
                left: Math.min(position.left, window.innerWidth - 320),
            }}
        >
            <div className="max-h-80 overflow-y-auto p-2">
                {basics.length > 0 && (
                    <>
                        <div className="px-3 py-1.5 text-[10px] font-semibold uppercase tracking-wider text-stone-400">
                            Basics
                        </div>
                        {basics.map((item, i) => renderItem(item, i, i))}
                    </>
                )}
                {advanced.length > 0 && (
                    <>
                        <div className="px-3 py-1.5 text-[10px] font-semibold uppercase tracking-wider text-stone-400 mt-2 pt-2 border-t es-global-separator">
                            Advanced
                        </div>
                        {advanced.map((item, i) => renderItem(item, i, basics.length + i))}
                    </>
                )}
            </div>
        </div>,
        document.body
    );
}
