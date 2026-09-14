/**
 * クリップボードからのファイル・テキスト投入に関するユーティリティ
 */

/**
 * ファイル名用のタイムスタンプ文字列を生成 (例: "20260915-123045")
 */
export function formatDateForFileName(date: Date = new Date()): string {
    const pad = (n: number) => n.toString().padStart(2, '0');
    const y = date.getFullYear();
    const m = pad(date.getMonth() + 1);
    const d = pad(date.getDate());
    const h = pad(date.getHours());
    const min = pad(date.getMinutes());
    const s = pad(date.getSeconds());
    return `${y}${m}${d}-${h}${min}${s}`;
}

/**
 * ファイル名として使えない文字をサニタイズ（安全な文字列に置換）
 * Windows禁止文字: \ / : * ? " < > |
 * Obsidian禁止文字: ^ [ ] #
 */
export function sanitizeFileName(name: string): string {
    return name
        // 制御文字・改行を除去
        .replace(/[\r\n\t\x00-\x1f\x7f]/g, ' ')
        // Windows & Obsidian 禁止文字を除去
        .replace(/[\\/:*?"<>|^#[\]]/g, '')
        // 連続空白を1つに統合してトリム
        .replace(/\s+/g, ' ')
        .trim();
}

/**
 * 重複しないファイル名を生成（同名があれば "_1", "_2" を付与）
 */
export function getUniqueFileName(baseNameWithoutExt: string, ext: string, existingNames: string[]): string {
    const cleanExt = ext.startsWith('.') ? ext.substring(1) : ext;
    const existingSet = new Set(existingNames.map(n => n.toLowerCase()));

    const candidate = `${baseNameWithoutExt}.${cleanExt}`;
    if (!existingSet.has(candidate.toLowerCase())) {
        return candidate;
    }

    let counter = 1;
    while (true) {
        const nextCandidate = `${baseNameWithoutExt}_${counter}.${cleanExt}`;
        if (!existingSet.has(nextCandidate.toLowerCase())) {
            return nextCandidate;
        }
        counter++;
    }
}

/**
 * クリップボード画像（スクリーンショット）用のファイル名を生成
 * 例: "Pasted image 20260915-123045.png"
 */
export function generatePastedImageName(existingFileNames: string[], date: Date = new Date(), ext: string = 'png'): string {
    const timeStr = formatDateForFileName(date);
    const base = `Pasted image ${timeStr}`;
    return getUniqueFileName(base, ext, existingFileNames);
}

/**
 * クリップボードテキストからスマートにファイル名を生成
 * 1行目からタイトルを抽出し、無効な場合はタイムスタンプ名にフォールバック
 */
export function generatePastedTextName(content: string, existingFileNames: string[], date: Date = new Date()): string {
    const lines = content.split(/\r?\n/);
    let titleCandidate = '';

    for (const line of lines) {
        const trimmed = line.trim();
        if (!trimmed) continue;

        // Markdownの見出し記号 (# ), 箇条書き記号 (- , * , 1. ), 引用符 (> ) を除去
        let cleaned = trimmed
            .replace(/^#{1,6}\s+/, '')
            .replace(/^[-*+]\s+/, '')
            .replace(/^\d+\.\s+/, '')
            .replace(/^>\s+/, '')
            .trim();

        cleaned = sanitizeFileName(cleaned);
        if (cleaned.length >= 2) {
            // 最大40文字に制限
            titleCandidate = cleaned.substring(0, 40).trim();
            break;
        }
    }

    if (!titleCandidate) {
        const timeStr = formatDateForFileName(date);
        titleCandidate = `Pasted note ${timeStr}`;
    }

    return getUniqueFileName(titleCandidate, 'md', existingFileNames);
}

/**
 * 指定された要素がテキスト入力中（input, textarea, contenteditable）かを判定
 */
export function isInputElement(el: Element | null): boolean {
    if (!el) return false;
    const tagName = el.tagName.toUpperCase();
    if (tagName === 'INPUT' || tagName === 'TEXTAREA') return true;
    if ((el as HTMLElement).isContentEditable) return true;
    return false;
}

/**
 * 実行環境が macOS かどうかを判定
 */
export function isMac(): boolean {
    if (typeof navigator === 'undefined') return false;
    const platform = (navigator as any).userAgentData?.platform || navigator.platform || '';
    return /mac/i.test(platform);
}

/**
 * プラットフォームに応じたペーストショートカットの案内表記 ("Ctrl+V" or "⌘V")
 */
export function getPasteShortcutLabel(): string {
    return isMac() ? '⌘V' : 'Ctrl+V';
}
