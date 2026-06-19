import { Node } from '@tiptap/core';
import katex from 'katex';

// Custom markdown-it inline math parser rule
const inlineMathRule = (state: any, silent: boolean) => {
    const start = state.pos;
    if (state.src.charCodeAt(start) !== 0x24 /* $ */) {
        return false;
    }
    
    let end = -1;
    for (let i = start + 1; i < state.src.length; i++) {
        if (state.src.charCodeAt(i) === 0x24 /* $ */) {
            // Check if it's escaped
            if (state.src.charCodeAt(i - 1) !== 0x5c /* \ */) {
                // If it's double dollar at start, block rule handles it
                if (i === start + 1) {
                    continue;
                }
                end = i;
                break;
            }
        }
    }
    
    if (end === -1) {
        return false;
    }
    
    if (!silent) {
        const latex = state.src.slice(start + 1, end);
        const token = state.push('math_inline', 'math', 0);
        token.content = latex.trim();
    }
    
    state.pos = end + 1;
    return true;
};

// Custom markdown-it block math parser rule
const blockMathRule = (state: any, silent: boolean) => {
    const start = state.pos;
    if (state.src.charCodeAt(start) !== 0x24 /* $ */ || state.src.charCodeAt(start + 1) !== 0x24 /* $ */) {
        return false;
    }
    
    let end = -1;
    for (let i = start + 2; i < state.src.length - 1; i++) {
        if (state.src.charCodeAt(i) === 0x24 /* $ */ && state.src.charCodeAt(i + 1) === 0x24 /* $ */) {
            if (state.src.charCodeAt(i - 1) !== 0x5c /* \ */) {
                end = i;
                break;
            }
        }
    }
    
    if (end === -1) {
        return false;
    }
    
    if (!silent) {
        const latex = state.src.slice(start + 2, end);
        const token = state.push('math_block', 'math', 0);
        token.content = latex.trim();
    }
    
    state.pos = end + 2;
    return true;
};

export const MathInline = Node.create({
    name: 'mathInline',
    group: 'inline',
    inline: true,
    selectable: true,
    atom: true,

    addAttributes() {
        return {
            latex: {
                default: '',
            },
        };
    },

    parseHTML() {
        return [
            {
                tag: 'span[data-latex]',
                getAttrs: (element) => {
                    if (typeof element === 'string') return {};
                    return {
                        latex: (element as HTMLElement).getAttribute('data-latex') || '',
                    };
                },
            },
        ];
    },

    renderHTML({ node }) {
        return [
            'span',
            {
                'data-latex': node.attrs.latex,
                class: 'math-inline',
            },
            `$${node.attrs.latex}$`,
        ];
    },

    addNodeView() {
        return ({ node }) => {
            const dom = document.createElement('span');
            dom.className = 'math-inline inline-block mx-0.5 align-middle';
            dom.setAttribute('data-latex', node.attrs.latex);

            const renderEl = document.createElement('span');
            renderEl.className = 'math-render';
            renderEl.contentEditable = 'false';
            try {
                renderEl.innerHTML = katex.renderToString(node.attrs.latex, {
                    throwOnError: false,
                    displayMode: false,
                });
            } catch (e) {
                renderEl.textContent = node.attrs.latex;
            }

            dom.appendChild(renderEl);
            return {
                dom,
            };
        };
    },

    addStorage() {
        return {
            markdown: {
                serialize(state: any, node: any) {
                    state.write(`$${node.attrs.latex}$`);
                },
                parse: {
                    setup(markdownit: any) {
                        markdownit.inline.ruler.after('escape', 'math_inline', inlineMathRule);
                        markdownit.renderer.rules.math_inline = (tokens: any, idx: number) => {
                            return `<span data-latex="${markdownit.utils.escapeHtml(tokens[idx].content)}"></span>`;
                        };
                    },
                },
            },
        };
    },
});

export const MathBlock = Node.create({
    name: 'mathBlock',
    group: 'block',
    defining: true,
    selectable: true,
    atom: true,

    addAttributes() {
        return {
            latex: {
                default: '',
            },
        };
    },

    parseHTML() {
        return [
            {
                tag: 'div[data-latex]',
                getAttrs: (element) => {
                    if (typeof element === 'string') return {};
                    return {
                        latex: (element as HTMLElement).getAttribute('data-latex') || '',
                    };
                },
            },
        ];
    },

    renderHTML({ node }) {
        return [
            'div',
            {
                'data-latex': node.attrs.latex,
                class: 'math-block',
            },
            `$$${node.attrs.latex}$$`,
        ];
    },

    addNodeView() {
        return ({ node }) => {
            const dom = document.createElement('div');
            dom.className = 'math-block my-4 text-center w-full block';
            dom.setAttribute('data-latex', node.attrs.latex);

            const renderEl = document.createElement('div');
            renderEl.className = 'math-render w-full';
            renderEl.contentEditable = 'false';
            try {
                renderEl.innerHTML = katex.renderToString(node.attrs.latex, {
                    throwOnError: false,
                    displayMode: true,
                });
            } catch (e) {
                renderEl.textContent = node.attrs.latex;
            }

            dom.appendChild(renderEl);
            return {
                dom,
            };
        };
    },

    addStorage() {
        return {
            markdown: {
                serialize(state: any, node: any) {
                    state.write(`$$${node.attrs.latex}$$`);
                    state.closeBlock(node);
                },
                parse: {
                    setup(markdownit: any) {
                        markdownit.inline.ruler.after('escape', 'math_block', blockMathRule);
                        markdownit.renderer.rules.math_block = (tokens: any, idx: number) => {
                            return `<div data-latex="${markdownit.utils.escapeHtml(tokens[idx].content)}"></div>`;
                        };
                    },
                },
            },
        };
    },
});
