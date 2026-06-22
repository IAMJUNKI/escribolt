import { Extension } from '@tiptap/core';
import { Plugin, PluginKey } from '@tiptap/pm/state';
import { Decoration, DecorationSet } from '@tiptap/pm/view';

export const collapsedHeadingSectionsPluginKey = new PluginKey('collapsedHeadingSections');

type CollapsedHeadingSectionsMeta = {
    positions?: number[];
    enabled?: boolean;
};

function buildCollapsedHeadingDecorations(doc: any, positions: number[] = [], enabled = true): DecorationSet {
    if (!enabled || positions.length === 0) return DecorationSet.empty;

    const collapsedPositions = new Set(positions);
    const decorations: Decoration[] = [];
    const collapsedHeadingLevels: number[] = [];

    doc.forEach((node: any, offset: number) => {
        if (node.type.name === 'heading') {
            const level = typeof node.attrs?.level === 'number' ? node.attrs.level : 0;

            while (
                collapsedHeadingLevels.length > 0
                && level <= collapsedHeadingLevels[collapsedHeadingLevels.length - 1]
            ) {
                collapsedHeadingLevels.pop();
            }

            if (collapsedHeadingLevels.length > 0) {
                decorations.push(Decoration.node(offset, offset + node.nodeSize, {
                    class: 'es-collapsed-heading-section-hidden',
                    'data-es-collapsed-content': 'true',
                }));
            }

            if (collapsedPositions.has(offset)) {
                collapsedHeadingLevels.push(level);
            }

            return;
        }

        if (collapsedHeadingLevels.length > 0) {
            decorations.push(Decoration.node(offset, offset + node.nodeSize, {
                class: 'es-collapsed-heading-section-hidden',
                'data-es-collapsed-content': 'true',
            }));
        }
    });

    return DecorationSet.create(doc, decorations);
}

export const CollapsedHeadingSectionsExtension = Extension.create({
    name: 'collapsedHeadingSections',

    addProseMirrorPlugins() {
        return [
            new Plugin({
                key: collapsedHeadingSectionsPluginKey,
                state: {
                    init() {
                        return DecorationSet.empty;
                    },
                    apply(tr, set) {
                        const meta = tr.getMeta(collapsedHeadingSectionsPluginKey) as CollapsedHeadingSectionsMeta | undefined;

                        if (meta) {
                            return buildCollapsedHeadingDecorations(tr.doc, meta.positions || [], meta.enabled !== false);
                        }

                        return set.map(tr.mapping, tr.doc);
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
