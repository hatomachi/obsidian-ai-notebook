export class App {}
export class TFile {
    path: string = '';
    name: string = '';
    basename: string = '';
    extension: string = '';
    stat: any = { size: 0, mtime: 0, ctime: 0 };
}
export class TFolder {
    path: string = '';
    name: string = '';
    children: any[] = [];
}
export class FileSystemAdapter {
    getBasePath(): string { return process.cwd(); }
}
export class Notice {
    constructor(public message: string, public duration?: number) {}
}
export function setIcon(el: HTMLElement, iconName: string): void {}
export class Modal {
    contentEl: any = { empty: () => {}, createEl: () => ({ createEl: () => ({}) }), createDiv: () => ({ createEl: () => ({}) }) };
    constructor(public app: any) {}
    open(): void {}
    close(): void {}
}
export class ItemView {}
export class WorkspaceLeaf {}
export function parseYaml(s: string): any { return {}; }
export function stringifyYaml(o: any): string { return ''; }
export function normalizePath(p: string): string { return p.replace(/\\/g, '/'); }

let customPdfJsMock: any = null;
export function __setMockPdfJs(mock: any) {
    customPdfJsMock = mock;
}

export async function loadPdfJs(): Promise<any> {
    if (customPdfJsMock) {
        return customPdfJsMock;
    }
    return {
        getDocument: (params: { data: Uint8Array }) => {
            return {
                promise: Promise.resolve({
                    numPages: 2,
                    getPage: async (pageNum: number) => {
                        return {
                            getTextContent: async () => {
                                return {
                                    items: [
                                        { str: `Page ${pageNum} Title`, transform: [1, 0, 0, 1, 0, 100] },
                                        { str: `Body text on page ${pageNum}`, transform: [1, 0, 0, 1, 0, 80] }
                                    ]
                                };
                            }
                        };
                    }
                })
            };
        }
    };
}
