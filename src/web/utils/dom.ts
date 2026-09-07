/**
 * Lightweight DOM utility functions compatible with Obsidian-like syntax
 */

export interface CreateElOptions {
    cls?: string | string[];
    text?: string;
    attr?: Record<string, string | number | boolean>;
    title?: string;
    value?: string;
    placeholder?: string;
    type?: string;
    href?: string;
    target?: string;
}

export function el<K extends keyof HTMLElementTagNameMap>(
    tag: K,
    options?: CreateElOptions,
    parent?: HTMLElement
): HTMLElementTagNameMap[K] {
    const element = document.createElement(tag);

    if (options) {
        if (options.cls) {
            if (Array.isArray(options.cls)) {
                element.classList.add(...options.cls.filter(Boolean));
            } else {
                element.className = options.cls;
            }
        }
        if (options.text !== undefined) {
            element.textContent = options.text;
        }
        if (options.title) {
            element.title = options.title;
        }
        if (options.attr) {
            for (const [key, val] of Object.entries(options.attr)) {
                element.setAttribute(key, String(val));
            }
        }
        if (options.value !== undefined && 'value' in element) {
            (element as any).value = options.value;
        }
        if (options.placeholder && 'placeholder' in element) {
            (element as any).placeholder = options.placeholder;
        }
        if (options.type && 'type' in element) {
            (element as any).type = options.type;
        }
        if (options.href && 'href' in element) {
            (element as any).href = options.href;
        }
        if (options.target && 'target' in element) {
            (element as any).target = options.target;
        }
    }

    if (parent) {
        parent.appendChild(element);
    }

    return element;
}

export function div(options?: CreateElOptions, parent?: HTMLElement): HTMLDivElement {
    return el('div', options, parent);
}

export function span(options?: CreateElOptions, parent?: HTMLElement): HTMLSpanElement {
    return el('span', options, parent);
}

export function button(options?: CreateElOptions, parent?: HTMLElement): HTMLButtonElement {
    return el('button', options, parent);
}

export function empty(element: HTMLElement): void {
    while (element.firstChild) {
        element.removeChild(element.firstChild);
    }
}
