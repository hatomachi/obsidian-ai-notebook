/**
 * Obsidian API Shim for Web / Browser environments
 */

export class App {
    vault: any = {
        adapter: {
            getBasePath: () => '',
        },
        getAbstractFileByPath: () => null,
        read: async () => '',
        readBinary: async () => new ArrayBuffer(0),
        modify: async () => {},
        create: async () => null,
        createFolder: async () => {},
        delete: async () => {},
    };
    workspace: any = {
        getActiveFile: () => null,
        openLinkText: async () => {},
    };
}

export class TFile {
    path: string = '';
    basename: string = '';
    extension: string = '';
    stat: { ctime: number; mtime: number; size: number } = { ctime: 0, mtime: 0, size: 0 };
}

export class TFolder {
    path: string = '';
    children: any[] = [];
}

export class Plugin {}
export class PluginSettingTab {}
export class Setting {}

export class Notice {
    constructor(public message: string, public duration?: number) {
        console.log('[Obsidian Notice]', message);
    }
}

export class ItemView {}
export class WorkspaceLeaf {}
export class Modal {}

export function setIcon(element: HTMLElement, iconId: string): void {
    element.setAttribute('data-icon', iconId);
}

export function normalizePath(path: string): string {
    return path.replace(/\\/g, '/').replace(/\/+/g, '/').replace(/^\/|\/$/g, '');
}

export function parseYaml(yamlStr: string): any {
    // 簡易パースまたは fallback
    try {
        const lines = yamlStr.split('\n');
        const result: Record<string, any> = {};
        let currentArrayKey: string | null = null;
        let currentArray: string[] = [];

        for (const line of lines) {
            const trimmed = line.trim();
            if (!trimmed || trimmed.startsWith('#')) continue;

            if (trimmed.startsWith('- ') && currentArrayKey) {
                const val = trimmed.slice(2).trim().replace(/^["']|["']$/g, '');
                currentArray.push(val);
                continue;
            }

            if (currentArrayKey) {
                result[currentArrayKey] = currentArray;
                currentArrayKey = null;
                currentArray = [];
            }

            const colonIdx = trimmed.indexOf(':');
            if (colonIdx !== -1) {
                const key = trimmed.slice(0, colonIdx).trim();
                const rawVal = trimmed.slice(colonIdx + 1).trim();

                if (!rawVal) {
                    currentArrayKey = key;
                    currentArray = [];
                } else if (rawVal.startsWith('[') && rawVal.endsWith(']')) {
                    result[key] = rawVal
                        .slice(1, -1)
                        .split(',')
                        .map((s) => s.trim().replace(/^["']|["']$/g, ''))
                        .filter(Boolean);
                } else {
                    const cleaned = rawVal.replace(/^["']|["']$/g, '');
                    result[key] = cleaned;
                }
            }
        }
        if (currentArrayKey) {
            result[currentArrayKey] = currentArray;
        }
        return result;
    } catch {
        return {};
    }
}

export function stringifyYaml(obj: any): string {
    return JSON.stringify(obj, null, 2);
}

export class FileSystemAdapter {
    getBasePath(): string {
        return '';
    }
}

export async function loadPdfJs(): Promise<any> {
    if (typeof window !== 'undefined' && (window as any).pdfjsLib) {
        return (window as any).pdfjsLib;
    }
    throw new Error('PDF.js は Web 版環境では現在サポートされていません');
}
