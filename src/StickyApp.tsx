import React, { useEffect, useState, useRef } from 'react';
import { X, Copy, Check } from 'lucide-react';
import HoverTooltip from './components/HoverTooltip';
import MarkdownEditor from './components/MarkdownEditor';

// Use window.require for Electron IPC
const { ipcRenderer } = window.require('electron');

const COLORS = [
    { id: 'yellow', bg: '#fef08a', header: '#fde047', border: '#eab308' },
    { id: 'blue', bg: '#bfdbfe', header: '#93c5fd', border: '#3b82f6' },
    { id: 'green', bg: '#bbf7d0', header: '#86efac', border: '#22c55e' },
    { id: 'pink', bg: '#fbcfe8', header: '#f9a8d4', border: '#ec4899' },
];

type StickyNoteSnapshot = {
    noteId: string | null;
    title: string;
    text: string;
    colorIdx: number;
};

type StickyNoteSavePayload = {
    id: string;
    title: string;
    text: string;
    colorId: string;
};

const StickyApp: React.FC = () => {
    const [noteId, setNoteId] = useState<string | null>(null);
    const [text, setText] = useState<string>('');
    const [title, setTitle] = useState<string>('NOTE');
    const [colorIdx, setColorIdx] = useState(0);
    const [copied, setCopied] = useState(false);
    const dragOffset = useRef({ x: 0, y: 0 });
    const isDragging = useRef(false);
    const latestNoteRef = useRef<StickyNoteSnapshot>({
        noteId: null,
        title: 'NOTE',
        text: '',
        colorIdx: 0,
    });

    const buildCurrentNotePayload = (): StickyNoteSavePayload | null => {
        const snapshot = latestNoteRef.current;
        if (!snapshot.noteId) return null;
        return {
            id: snapshot.noteId,
            title: snapshot.title,
            text: snapshot.text,
            colorId: COLORS[snapshot.colorIdx]?.id || COLORS[0].id,
        };
    };

    const saveCurrentNote = (): StickyNoteSavePayload | null => {
        const payload = buildCurrentNotePayload();
        if (payload) {
            ipcRenderer.send('save-note', payload);
        }
        return payload;
    };

    useEffect(() => {
        latestNoteRef.current = { noteId, title, text, colorIdx };
    }, [noteId, title, text, colorIdx]);

    // Initial load & listeners
    useEffect(() => {
        const handleLoadNote = (_e: any, note: { id: string, text: string, title?: string, colorId?: string }) => {
            let nextColorIdx = latestNoteRef.current.colorIdx;
            if (note.colorId) {
                const idx = COLORS.findIndex(c => c.id === note.colorId);
                if (idx !== -1) nextColorIdx = idx;
            }
            setNoteId(note.id);
            setText(note.text || '');
            setTitle(note.title || 'NOTE');
            setColorIdx(nextColorIdx);
            latestNoteRef.current = {
                noteId: note.id,
                text: note.text || '',
                title: note.title || 'NOTE',
                colorIdx: nextColorIdx,
            };
        };

        const handleAppendText = (_e: any, newText: string) => {
            setText(prev => {
                const separator = prev && !prev.endsWith('\n') ? ' ' : '';
                const nextText = prev + separator + newText;
                latestNoteRef.current = {
                    ...latestNoteRef.current,
                    text: nextText,
                };
                return nextText;
            });
        };

        const handleSaveNow = (_e: any, payload?: { requestId?: string }) => {
            const snapshot = latestNoteRef.current;
            const notePayload = snapshot.noteId
                ? {
                    id: snapshot.noteId,
                    title: snapshot.title,
                    text: snapshot.text,
                    colorId: COLORS[snapshot.colorIdx]?.id || COLORS[0].id,
                }
                : null;
            if (notePayload) {
                ipcRenderer.send('save-note', notePayload);
            }
            ipcRenderer.send('sticky:save-now-complete', {
                requestId: payload?.requestId || '',
                note: notePayload,
            });
        };

        ipcRenderer.on('load-note', handleLoadNote);
        ipcRenderer.on('append-text', handleAppendText);
        ipcRenderer.on('sticky:save-now', handleSaveNow);

        // Notify backend we are ready to receive data
        ipcRenderer.send('sticky-ready');

        return () => {
            ipcRenderer.removeListener('load-note', handleLoadNote);
            ipcRenderer.removeListener('append-text', handleAppendText);
            ipcRenderer.removeListener('sticky:save-now', handleSaveNow);
        };
    }, []);

    // Auto-save effect (debounced)
    useEffect(() => {
        if (!noteId) return;
        const timer = setTimeout(() => {
            ipcRenderer.send('save-note', {
                id: noteId,
                title,
                text,
                colorId: COLORS[colorIdx].id
            });
        }, 500); // Debounce 500ms
        return () => clearTimeout(timer);
    }, [title, text, colorIdx, noteId]);

    const handleCopy = () => {
        navigator.clipboard.writeText(text);
        setCopied(true);
        setTimeout(() => setCopied(false), 2000);
    };

    const handleClose = () => {
        saveCurrentNote();
        ipcRenderer.send('close-note', noteId);
    };

    const handleTextChange = (nextText: string) => {
        latestNoteRef.current = {
            ...latestNoteRef.current,
            text: nextText,
        };
        setText(nextText);
    };

    const handleTextareaFocus = () => {
        if (noteId) ipcRenderer.send('focus-note', noteId);
    };

    const handleTextareaBlur = () => {
        if (noteId) ipcRenderer.send('blur-note', noteId);
    };

    const handlePointerDown = (e: React.PointerEvent) => {
        e.preventDefault();

        // Prevent drag start on inputs
        if ((e.target as HTMLElement).tagName === 'INPUT' || (e.target as HTMLElement).tagName === 'BUTTON') {
            return;
        }

        // Start dragging logic immediately
        const startWindowX = window.screenX;
        const startWindowY = window.screenY;
        const offsetX = e.screenX - startWindowX;
        const offsetY = e.screenY - startWindowY;

        isDragging.current = true;
        dragOffset.current = { x: offsetX, y: offsetY };
        (e.currentTarget as Element).setPointerCapture(e.pointerId);

        // Defer blur to allow capture to lock in without interruption
        // Blur whatever is focused (Textarea OR Title Input)
        const activeElement = document.activeElement as HTMLElement;
        if (activeElement && (activeElement.tagName === 'TEXTAREA' || activeElement.tagName === 'INPUT')) {
            requestAnimationFrame(() => {
                activeElement.blur();
            });
        }
    };

    const handlePointerMove = (e: React.PointerEvent) => {
        if (isDragging.current) {
            const newX = e.screenX - dragOffset.current.x;
            const newY = e.screenY - dragOffset.current.y;
            ipcRenderer.send('window-move', { x: newX, y: newY });
        }
    };

    const handlePointerUp = (e: React.PointerEvent) => {
        isDragging.current = false;
        if ((e.currentTarget as Element).hasPointerCapture(e.pointerId)) {
            (e.currentTarget as Element).releasePointerCapture(e.pointerId);
        }
    };


    const theme = COLORS[colorIdx];

    return (
        <div
            className="flex flex-col h-screen w-full font-sans shadow-xl overflow-hidden border transition-colors duration-300"
            style={{ backgroundColor: theme.bg, borderColor: theme.border }}
        >
            {/* Header / Drag Handle */}
            <div
                className="flex items-center justify-between px-3 py-2 cursor-default select-none border-b transition-colors duration-300 touch-none"
                style={{ backgroundColor: theme.header, borderColor: theme.border }}
                onPointerDown={handlePointerDown}
                onPointerMove={handlePointerMove}
                onPointerUp={handlePointerUp}
                onPointerCancel={handlePointerUp} // Use same handler to reset
            >
                <div
                    className="flex items-center gap-2 opacity-70 hover:opacity-100 transition-opacity flex-1 min-w-0 mr-2"
                >
                    <input
                        onPointerDown={(e) => e.stopPropagation()}
                        value={title}
                        onChange={(e) => {
                            const nextTitle = e.target.value;
                            latestNoteRef.current = {
                                ...latestNoteRef.current,
                                title: nextTitle,
                            };
                            setTitle(nextTitle);
                        }}
                        className="bg-transparent font-bold uppercase tracking-wider text-xs focus:outline-none cursor-text placeholder-gray-600 min-w-[50px] w-auto max-w-full"
                        style={{ color: 'inherit', width: `${Math.max(4, title.length + 1)}ch` }}
                        placeholder="TITLE"
                    />
                </div>
                <div className="flex items-center gap-1 h-full pl-2 cursor-pointer" onPointerDown={(e) => e.stopPropagation()}>
                    <HoverTooltip label="Copy">
                        <button onClick={(e) => { e.stopPropagation(); handleCopy(); }} className="p-1.5 hover:bg-black/10 rounded-md transition-colors text-gray-700">
                            {copied ? <Check size={14} className="stroke-green-600" /> : <Copy size={14} />}
                        </button>
                    </HoverTooltip>
                    <HoverTooltip label="Close">
                        <button onClick={(e) => { e.stopPropagation(); handleClose(); }} className="p-1.5 hover:bg-red-500/20 hover:text-red-600 rounded-md transition-colors text-gray-700">
                            <X size={14} />
                        </button>
                    </HoverTooltip>
                </div>
            </div>

            {/* Content — Tiptap WYSIWYG editor */}
            <MarkdownEditor
                key={noteId || 'empty'}
                value={text}
                onChange={handleTextChange}
                onFocus={handleTextareaFocus}
                onBlur={handleTextareaBlur}
                placeholder="Type or dictate here..."
                className="flex-1 p-4 text-sm text-gray-900"
                proseClassName="sticky-md-prose"
                showToolbar={false}
                enableSlashCommands={false}
                selectionToolbarStyle={{
                    backgroundColor: theme.bg,
                    borderColor: theme.border,
                }}
            />
        </div>
    );
};

export default StickyApp;
