import { Extension } from '@tiptap/core';
import { Plugin, PluginKey } from '@tiptap/pm/state';
import { Decoration, DecorationSet } from '@tiptap/pm/view';

export const slashHighlightPluginKey = new PluginKey('slashHighlight');

export const SlashHighlightExtension = Extension.create({
    name: 'slashHighlight',

    addProseMirrorPlugins() {
        return [
            new Plugin({
                key: slashHighlightPluginKey,
                state: {
                    init() {
                        return DecorationSet.empty;
                    },
                    apply(tr, set) {
                        set = set.map(tr.mapping, tr.doc);
                        const meta = tr.getMeta(slashHighlightPluginKey);
                        if (meta?.range) {
                            const deco = Decoration.inline(meta.range.from, meta.range.to, {
                                class: 'slash-command-code',
                            });
                            set = DecorationSet.create(tr.doc, [deco]);
                        } else if (meta?.clear) {
                            set = DecorationSet.empty;
                        }
                        return set;
                    },
                },
                props: {
                    decorations(state) {
                        return this.getState(state);
                    },
                },
            }),
        ];
    },
});
