import { App, TFile, TFolder, parseYaml, stringifyYaml, normalizePath } from 'obsidian';
import { NotebookMetadata, NotebookSource, NotebookArtifact, ChatMessage, AINotebookSettings } from '../types';

export class NotebookManager {
    app: App;
    settings: AINotebookSettings;

    constructor(app: App, settings: AINotebookSettings) {
        this.app = app;
        this.settings = settings;
    }

    /**
     * ルート保存フォルダおよびサブフォルダが存在することを確認・作成
     */
    async ensureBaseDirectories(): Promise<void> {
        const root = normalizePath(this.settings.rootDir);
        const indexDir = normalizePath(`${root}/index`);
        const notebooksDir = normalizePath(`${root}/notebooks`);

        await this.ensureFolder(root);
        await this.ensureFolder(indexDir);
        await this.ensureFolder(notebooksDir);
    }

    private async ensureFolder(path: string): Promise<void> {
        const folder = this.app.vault.getAbstractFileByPath(path);
        if (!folder) {
            await this.app.vault.createFolder(path);
        }
    }

    /**
     * 一意なノートブックID（タイムスタンプ＋ランダム文字列）を生成
     */
    generateNotebookId(): string {
        const now = new Date();
        const timestamp = now.toISOString().replace(/[-:T.]/g, '').slice(0, 14); // YYYYMMDDHHMMSS
        const randomStr = Math.random().toString(36).substring(2, 7);
        return `${timestamp}_${randomStr}`;
    }

    /**
     * 新規ノートブックを作成
     */
    async createNotebook(title: string, description: string = ''): Promise<NotebookMetadata> {
        await this.ensureBaseDirectories();
        const id = this.generateNotebookId();
        const now = new Date().toISOString();

        const metadata: NotebookMetadata = {
            id,
            title: title.trim() || '無題のノートブック',
            createdAt: now,
            updatedAt: now,
            tags: [],
            icon: 'book-open',
            description: description.trim()
        };

        // 1. Index Markdown の作成
        const indexPath = normalizePath(`${this.settings.rootDir}/index/${id}.md`);
        const frontmatter = stringifyYaml({
            notebook_id: metadata.id,
            title: metadata.title,
            created_at: metadata.createdAt,
            updated_at: metadata.updatedAt,
            tags: metadata.tags,
            icon: metadata.icon,
            description: metadata.description
        });
        const indexContent = `---\n${frontmatter}---\n# ${metadata.title}\n\n${metadata.description}\n`;
        await this.app.vault.create(indexPath, indexContent);

        // 2. 実体フォルダ構造の作成
        const notebookDir = normalizePath(`${this.settings.rootDir}/notebooks/${id}`);
        await this.ensureFolder(notebookDir);
        await this.ensureFolder(normalizePath(`${notebookDir}/sources`));
        await this.ensureFolder(normalizePath(`${notebookDir}/artifacts`));

        // 3. chat.json の初期化
        const chatPath = normalizePath(`${notebookDir}/chat.json`);
        await this.app.vault.create(chatPath, JSON.stringify([], null, 2));

        return metadata;
    }

    /**
     * 全ノートブックのメタデータ一覧を取得
     */
    async getAllNotebooks(): Promise<NotebookMetadata[]> {
        await this.ensureBaseDirectories();
        const indexDir = normalizePath(`${this.settings.rootDir}/index`);
        const folder = this.app.vault.getAbstractFileByPath(indexDir);
        if (!(folder instanceof TFolder)) {
            return [];
        }

        const notebooks: NotebookMetadata[] = [];
        for (const file of folder.children) {
            if (file instanceof TFile && file.extension === 'md') {
                try {
                    const metadata = await this.readNotebookMetadata(file);
                    if (metadata) {
                        notebooks.push(metadata);
                    }
                } catch (e) {
                    console.error(`Failed to parse notebook index file: ${file.path}`, e);
                }
            }
        }

        // 更新日時の降順でソート
        return notebooks.sort((a, b) => new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime());
    }

    /**
     * Index Markdown ファイルからメタデータを読み込み
     */
    private async readNotebookMetadata(file: TFile): Promise<NotebookMetadata | null> {
        const content = await this.app.vault.read(file);
        const match = content.match(/^---\n([\s\S]*?)\n---/);
        if (!match) return null;

        const yaml = parseYaml(match[1]);
        if (!yaml || !yaml.notebook_id) return null;

        return {
            id: yaml.notebook_id,
            title: yaml.title || file.basename,
            createdAt: yaml.created_at || new Date(file.stat.ctime).toISOString(),
            updatedAt: yaml.updated_at || new Date(file.stat.mtime).toISOString(),
            tags: yaml.tags || [],
            icon: yaml.icon || 'book-open',
            description: yaml.description || ''
        };
    }

    /**
     * ID からノートブックメタデータを取得
     */
    async getNotebookMetadata(id: string): Promise<NotebookMetadata | null> {
        const indexPath = normalizePath(`${this.settings.rootDir}/index/${id}.md`);
        const file = this.app.vault.getAbstractFileByPath(indexPath);
        if (file instanceof TFile) {
            return await this.readNotebookMetadata(file);
        }
        return null;
    }

    /**
     * ノートブックメタデータの更新
     */
    async updateNotebookMetadata(id: string, updates: Partial<NotebookMetadata>): Promise<void> {
        const indexPath = normalizePath(`${this.settings.rootDir}/index/${id}.md`);
        const file = this.app.vault.getAbstractFileByPath(indexPath);
        if (!(file instanceof TFile)) return;

        const current = await this.readNotebookMetadata(file);
        if (!current) return;

        const updated: NotebookMetadata = {
            ...current,
            ...updates,
            updatedAt: new Date().toISOString()
        };

        const frontmatter = stringifyYaml({
            notebook_id: updated.id,
            title: updated.title,
            created_at: updated.createdAt,
            updated_at: updated.updatedAt,
            tags: updated.tags,
            icon: updated.icon,
            description: updated.description
        });

        // 本文（Frontmatter以降）を維持しつつフロントマターのみ置換
        const content = await this.app.vault.read(file);
        const body = content.replace(/^---\n[\s\S]*?\n---\n?/, '');
        const newContent = `---\n${frontmatter}---\n${body}`;

        await this.app.vault.modify(file, newContent);
    }

    /**
     * ノートブックの削除
     */
    async deleteNotebook(id: string): Promise<void> {
        // 1. Index Markdown 削除
        const indexPath = normalizePath(`${this.settings.rootDir}/index/${id}.md`);
        const indexFile = this.app.vault.getAbstractFileByPath(indexPath);
        if (indexFile) {
            await this.app.vault.delete(indexFile, true);
        }

        // 2. 実体フォルダの削除
        const notebookDir = normalizePath(`${this.settings.rootDir}/notebooks/${id}`);
        const folder = this.app.vault.getAbstractFileByPath(notebookDir);
        if (folder) {
            await this.app.vault.delete(folder, true);
        }
    }

    /**
     * ソースファイル一覧の取得
     */
    async getSources(id: string): Promise<NotebookSource[]> {
        const sourcesDir = normalizePath(`${this.settings.rootDir}/notebooks/${id}/sources`);
        const folder = this.app.vault.getAbstractFileByPath(sourcesDir);
        if (!(folder instanceof TFolder)) return [];

        const sources: NotebookSource[] = [];
        for (const file of folder.children) {
            if (file instanceof TFile) {
                sources.push({
                    name: file.name,
                    path: file.path,
                    extension: file.extension,
                    size: file.stat.size,
                    addedAt: new Date(file.stat.ctime).toISOString()
                });
            }
        }
        return sources;
    }

    /**
     * ソースファイルの追加 (Binary / ArrayBuffer 対応)
     */
    async addSourceFile(id: string, fileName: string, data: ArrayBuffer | string): Promise<TFile> {
        const sourcesDir = normalizePath(`${this.settings.rootDir}/notebooks/${id}/sources`);
        await this.ensureFolder(sourcesDir);

        const filePath = normalizePath(`${sourcesDir}/${fileName}`);
        const existing = this.app.vault.getAbstractFileByPath(filePath);

        if (existing instanceof TFile) {
            if (typeof data === 'string') {
                await this.app.vault.modify(existing, data);
            } else {
                await this.app.vault.modifyBinary(existing, data);
            }
            return existing;
        } else {
            if (typeof data === 'string') {
                return await this.app.vault.create(filePath, data);
            } else {
                return await this.app.vault.createBinary(filePath, data);
            }
        }
    }

    /**
     * ソースファイルの削除
     */
    async deleteSourceFile(id: string, fileName: string): Promise<void> {
        const filePath = normalizePath(`${this.settings.rootDir}/notebooks/${id}/sources/${fileName}`);
        const file = this.app.vault.getAbstractFileByPath(filePath);
        if (file instanceof TFile) {
            await this.app.vault.delete(file);
        }
    }

    /**
     * 成果物一覧の取得
     */
    async getArtifacts(id: string): Promise<NotebookArtifact[]> {
        const artifactsDir = normalizePath(`${this.settings.rootDir}/notebooks/${id}/artifacts`);
        const folder = this.app.vault.getAbstractFileByPath(artifactsDir);
        if (!(folder instanceof TFolder)) return [];

        const artifacts: NotebookArtifact[] = [];
        for (const file of folder.children) {
            if (file instanceof TFile) {
                artifacts.push({
                    id: file.name,
                    title: file.basename,
                    path: file.path,
                    type: 'note',
                    createdAt: new Date(file.stat.ctime).toISOString(),
                    updatedAt: new Date(file.stat.mtime).toISOString()
                });
            }
        }
        return artifacts.sort((a, b) => new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime());
    }

    /**
     * 成果物ファイルの作成/保存
     */
    async addArtifactFile(id: string, title: string, content: string): Promise<TFile> {
        const artifactsDir = normalizePath(`${this.settings.rootDir}/notebooks/${id}/artifacts`);
        await this.ensureFolder(artifactsDir);

        // 安全なファイル名にクレンジング
        const safeTitle = title.replace(/[\/\\?%*:|"<>]/g, '_').trim() || '成果物ノート';
        const fileName = `${safeTitle}.md`;
        const filePath = normalizePath(`${artifactsDir}/${fileName}`);

        const existing = this.app.vault.getAbstractFileByPath(filePath);
        if (existing instanceof TFile) {
            await this.app.vault.modify(existing, content);
            return existing;
        } else {
            return await this.app.vault.create(filePath, content);
        }
    }

    /**
     * 成果物ファイルの削除
     */
    async deleteArtifactFile(id: string, fileName: string): Promise<void> {
        const filePath = normalizePath(`${this.settings.rootDir}/notebooks/${id}/artifacts/${fileName}`);
        const file = this.app.vault.getAbstractFileByPath(filePath);
        if (file instanceof TFile) {
            await this.app.vault.delete(file);
        }
    }

    /**
     * チャット履歴の取得
     */
    async getChatHistory(id: string): Promise<ChatMessage[]> {
        const chatPath = normalizePath(`${this.settings.rootDir}/notebooks/${id}/chat.json`);
        const file = this.app.vault.getAbstractFileByPath(chatPath);
        if (file instanceof TFile) {
            try {
                const content = await this.app.vault.read(file);
                return JSON.parse(content);
            } catch (e) {
                console.error(`Failed to read chat history for notebook ${id}`, e);
            }
        }
        return [];
    }

    /**
     * チャット履歴の保存
     */
    async saveChatHistory(id: string, history: ChatMessage[]): Promise<void> {
        const notebookDir = normalizePath(`${this.settings.rootDir}/notebooks/${id}`);
        await this.ensureFolder(notebookDir);

        const chatPath = normalizePath(`${notebookDir}/chat.json`);
        const content = JSON.stringify(history, null, 2);

        const file = this.app.vault.getAbstractFileByPath(chatPath);
        if (file instanceof TFile) {
            await this.app.vault.modify(file, content);
        } else {
            await this.app.vault.create(chatPath, content);
        }
    }
}
