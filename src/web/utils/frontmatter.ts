/**
 * YAML Frontmatter parser for browser / web environment
 */

export interface ParsedFrontmatter<T = Record<string, any>> {
    data: T;
    content: string;
}

export function parseFrontmatter<T = Record<string, any>>(rawMarkdown: string): ParsedFrontmatter<T> {
    if (!rawMarkdown || !rawMarkdown.startsWith('---')) {
        return { data: {} as T, content: rawMarkdown || '' };
    }

    const match = rawMarkdown.match(/^---\r?\n([\s\S]*?)\r?\n---(?:\r?\n([\s\S]*))?$/);
    if (!match) {
        return { data: {} as T, content: rawMarkdown };
    }

    const yamlBlock = match[1];
    const content = match[2] ? match[2].trim() : '';

    const data: Record<string, any> = {};
    const lines = yamlBlock.split(/\r?\n/);
    let currentKey: string | null = null;
    let currentArray: string[] = [];

    for (const line of lines) {
        const trimmed = line.trim();
        if (!trimmed || trimmed.startsWith('#')) continue;

        // Array items: - "val"
        if (trimmed.startsWith('- ') && currentKey) {
            const val = trimmed.slice(2).trim().replace(/^["']|["']$/g, '');
            currentArray.push(val);
            continue;
        }

        if (currentKey && currentArray.length > 0) {
            data[currentKey] = currentArray;
            currentKey = null;
            currentArray = [];
        }

        const colonIdx = line.indexOf(':');
        if (colonIdx !== -1) {
            const key = line.slice(0, colonIdx).trim();
            const rawVal = line.slice(colonIdx + 1).trim();

            if (!rawVal) {
                currentKey = key;
                currentArray = [];
            } else if (rawVal.startsWith('[') && rawVal.endsWith(']')) {
                data[key] = rawVal
                    .slice(1, -1)
                    .split(',')
                    .map((s) => s.trim().replace(/^["']|["']$/g, ''))
                    .filter(Boolean);
            } else {
                let val: any = rawVal.replace(/^["']|["']$/g, '');
                if (val === 'true') val = true;
                else if (val === 'false') val = false;
                else if (!isNaN(Number(val)) && val !== '') val = Number(val);
                data[key] = val;
            }
        }
    }

    if (currentKey && currentArray.length > 0) {
        data[currentKey] = currentArray;
    }

    return {
        data: data as T,
        content,
    };
}
