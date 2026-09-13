import { NotebookMetadata, GalleryGroupingMode, TagInfo } from '../types';

export const TAG_PREFIX_SYSTEM = 'system/';
export const TAG_PREFIX_TYPE = 'type/';
export const TAG_PREFIX_DOC = 'doc/';

/**
 * タグ文字列を解析し、プレフィックスと値を構造化
 */
export function parseTag(rawTag: string): TagInfo {
    if (!rawTag) {
        return { raw: '', value: '', isSystem: false, isType: false };
    }

    // 先頭の # を除去しトリム
    const cleaned = rawTag.trim().replace(/^#+/, '');
    const lower = cleaned.toLowerCase();

    if (lower.startsWith(TAG_PREFIX_SYSTEM)) {
        const value = cleaned.slice(TAG_PREFIX_SYSTEM.length).trim();
        return {
            raw: cleaned,
            prefix: 'system',
            value,
            isSystem: true,
            isType: false
        };
    }

    if (lower.startsWith(TAG_PREFIX_TYPE)) {
        const value = cleaned.slice(TAG_PREFIX_TYPE.length).trim();
        return {
            raw: cleaned,
            prefix: 'type',
            value,
            isSystem: false,
            isType: true
        };
    }

    if (lower.startsWith(TAG_PREFIX_DOC)) {
        const value = cleaned.slice(TAG_PREFIX_DOC.length).trim();
        return {
            raw: cleaned,
            prefix: 'type', // doc/* も type として扱う
            value,
            isSystem: false,
            isType: true
        };
    }

    // スラッシュが含まれるその他のプレフィックス
    const slashIdx = cleaned.indexOf('/');
    if (slashIdx > 0) {
        const prefix = cleaned.slice(0, slashIdx);
        const value = cleaned.slice(slashIdx + 1).trim();
        return {
            raw: cleaned,
            prefix,
            value,
            isSystem: false,
            isType: false
        };
    }

    // プレフィックスなしの一般タグ
    return {
        raw: cleaned,
        value: cleaned,
        isSystem: false,
        isType: false
    };
}

/**
 * ノートブックのタグ一覧からシステムタグ値（system/xxx の xxx）を取得
 */
export function getSystemTag(tags?: string[]): string | undefined {
    if (!tags || tags.length === 0) return undefined;
    for (const t of tags) {
        const parsed = parseTag(t);
        if (parsed.isSystem && parsed.value) {
            return parsed.value;
        }
    }
    return undefined;
}

/**
 * ノートブックのタグ一覧から種別タグ値（type/xxx の xxx）を取得
 */
export function getTypeTag(tags?: string[]): string | undefined {
    if (!tags || tags.length === 0) return undefined;
    for (const t of tags) {
        const parsed = parseTag(t);
        if (parsed.isType && parsed.value) {
            return parsed.value;
        }
    }
    return undefined;
}

/**
 * 全ノートブックから重複のないシステム名一覧を取得（小文字昇順）
 */
export function extractUniqueSystems(notebooks: NotebookMetadata[]): string[] {
    const set = new Set<string>();
    for (const nb of notebooks) {
        if (!nb.tags) continue;
        for (const t of nb.tags) {
            const parsed = parseTag(t);
            if (parsed.isSystem && parsed.value) {
                set.add(parsed.value);
            }
        }
    }
    return Array.from(set).sort((a, b) => a.localeCompare(b));
}

/**
 * 全ノートブックから重複のない種別名一覧を取得（小文字昇順）
 */
export function extractUniqueTypes(notebooks: NotebookMetadata[]): string[] {
    const set = new Set<string>();
    for (const nb of notebooks) {
        if (!nb.tags) continue;
        for (const t of nb.tags) {
            const parsed = parseTag(t);
            if (parsed.isType && parsed.value) {
                set.add(parsed.value);
            }
        }
    }
    return Array.from(set).sort((a, b) => a.localeCompare(b));
}

/**
 * 全ノートブックからプレフィックスなしの一般タグ一覧を取得
 */
export function extractUniqueGeneralTags(notebooks: NotebookMetadata[]): string[] {
    const set = new Set<string>();
    for (const nb of notebooks) {
        if (!nb.tags) continue;
        for (const t of nb.tags) {
            const parsed = parseTag(t);
            if (!parsed.isSystem && !parsed.isType && parsed.value) {
                set.add(parsed.value);
            }
        }
    }
    return Array.from(set).sort((a, b) => a.localeCompare(b));
}

export const UNCLASSIFIED_GROUP_NAME = '未分類';

/**
 * グルーピングモードに従ってノートブックをグループ化
 */
export function groupNotebooks(
    notebooks: NotebookMetadata[],
    mode: GalleryGroupingMode
): Map<string, NotebookMetadata[]> {
    const result = new Map<string, NotebookMetadata[]>();

    if (mode === 'none') {
        result.set('all', notebooks);
        return result;
    }

    const unclassified: NotebookMetadata[] = [];

    for (const nb of notebooks) {
        let groupKey: string | undefined = undefined;

        if (mode === 'system') {
            groupKey = getSystemTag(nb.tags);
        } else if (mode === 'type') {
            groupKey = getTypeTag(nb.tags);
        }

        if (groupKey) {
            const list = result.get(groupKey) || [];
            list.push(nb);
            result.set(groupKey, list);
        } else {
            unclassified.push(nb);
        }
    }

    // 昇順にソートした新しいMapを生成
    const sortedResult = new Map<string, NotebookMetadata[]>();
    const sortedKeys = Array.from(result.keys()).sort((a, b) => a.localeCompare(b));
    for (const k of sortedKeys) {
        sortedResult.set(k, result.get(k)!);
    }

    // 未分類があれば最後に追加
    if (unclassified.length > 0) {
        sortedResult.set(UNCLASSIFIED_GROUP_NAME, unclassified);
    }

    return sortedResult;
}

export interface NotebookFilterCriteria {
    searchQuery?: string;
    territory?: 'all' | 'mine' | 'others';
    currentUser?: string;
    system?: string; // 'all' または 特定システム名
    type?: string;   // 'all' または 特定種別名
    tags?: string[]; // 選択された特定タグ一覧
}

/**
 * 複合条件によるノートブックの絞り込み
 */
export function filterNotebooks(
    notebooks: NotebookMetadata[],
    criteria: NotebookFilterCriteria
): NotebookMetadata[] {
    const { searchQuery, territory = 'all', currentUser, system = 'all', type = 'all', tags = [] } = criteria;
    const q = searchQuery?.toLowerCase().trim();

    return notebooks.filter(nb => {
        // 1. 縄張りフィルター
        if (territory === 'mine' && currentUser && nb.userName !== currentUser) {
            return false;
        }
        if (territory === 'others' && currentUser && nb.userName === currentUser) {
            return false;
        }

        // 2. システムフィルター
        if (system && system !== 'all') {
            const sys = getSystemTag(nb.tags);
            if (!sys || sys.toLowerCase() !== system.toLowerCase()) {
                return false;
            }
        }

        // 3. 種別フィルター
        if (type && type !== 'all') {
            const docType = getTypeTag(nb.tags);
            if (!docType || docType.toLowerCase() !== type.toLowerCase()) {
                return false;
            }
        }

        // 4. 特定タグ（AND一致）
        if (tags && tags.length > 0) {
            const nbTagsLower = (nb.tags || []).map(t => t.toLowerCase());
            for (const requiredTag of tags) {
                const reqLower = requiredTag.toLowerCase();
                if (!nbTagsLower.includes(reqLower)) {
                    return false;
                }
            }
        }

        // 5. 自由検索クエリ（タイトル、説明、ユーザー名、タグ）
        if (q) {
            const inTitle = nb.title.toLowerCase().includes(q);
            const inDesc = (nb.description || '').toLowerCase().includes(q);
            const inUser = (nb.userName || '').toLowerCase().includes(q);
            const inTags = (nb.tags || []).some(t => t.toLowerCase().includes(q));
            if (!inTitle && !inDesc && !inUser && !inTags) {
                return false;
            }
        }

        return true;
    });
}
