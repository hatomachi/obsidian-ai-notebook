import { App, TFile, TFolder, parseYaml, stringifyYaml, normalizePath } from 'obsidian';
import { NotebookMetadata, NotebookSource, NotebookArtifact, ChatMessage, AINotebookSettings, SystemKnowledge, DocumentTemplate } from '../types';

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
        const systemsDir = normalizePath(`${root}/systems`);
        const templatesDir = normalizePath(`${root}/templates`);

        await this.ensureFolder(root);
        await this.ensureFolder(indexDir);
        await this.ensureFolder(notebooksDir);
        await this.ensureFolder(systemsDir);
        await this.ensureFolder(templatesDir);

        // 初期サンプルデータの自動生成
        await this.ensureSampleData();
    }

    private async ensureFolder(path: string): Promise<void> {
        const folder = this.app.vault.getAbstractFileByPath(path);
        if (!folder) {
            await this.app.vault.createFolder(path);
        }
    }

    /**
     * 初回用のサンプルシステム知識とドキュメントテンプレートを生成
     */
    private async ensureSampleData(): Promise<void> {
        const sampleSystemPath = normalizePath(`${this.settings.rootDir}/systems/apigw.md`);
        if (!this.app.vault.getAbstractFileByPath(sampleSystemPath)) {
            const apigwContent = `---
system_id: "apigw"
name: "API Gateway (APIGW)"
tags: [core, api, routing, auth]
description: "KongベースのAPI Gateway。マイクロサービスへのルーティング、認証トークン検証、レートリミットを担当。"
---
# システム概要
本システムはKong Gatewayおよび自社カスタムプラグインで構成されるAPI Gatewayです。
外部クライアントからのリクエストを受け付け、認証基盤（Auth Service）との連携によるトークン検証、ルーティング、レートリミット制御を行います。

## アーキテクチャ & 依存関係
- **インフラ**: AWS ECS (Fargate), ALB
- **データストア**: Redis Cluster (レートリミット・トークンキャッシュ用), PostgreSQL (Kong設定DB)
- **依存サービス**: Auth Service (認証トークン検証), 各バックエンドマイクロサービス

## リリース・運用上のクセと重要注意事項
1. **Blue-Green デプロイとコネクションドレイン**:
   - ALB配下のBlue-Green切り替え時、コネクションドレイン待ち時間として最低60秒を確保すること。
   - 急激なターゲット切り替えを行うと、Keep-Alive中のロングポーリング/ストリーミング通信が502 Bad Gatewayとなる恐れがある。
2. **Redis キャッシュのウォームアップ & 疎通確認**:
   - リリース直後はRedisキャッシュがクリアされている場合があり、バックエンド認証サービスへのスパイクアクセスが発生しやすい。
   - 事前にヘルスチェックエンドポイント \`/healthz\` 経由でRedis疎通が正常であることを確認する。
3. **過去のトラブル・インシデント事例**:
   - 過去事例(2026-03): ルーティング設定の正規表現（URI Prefix）の記述ミスにより、一部の \`/api/v2/*\` リクエストが404となった。リリース後は必ず重要エンドポイントのスモークテストを実施すること。

## ロールバック基準
- リリース後10分間の 5xx エラー率が 0.5% を超えた場合。
- 認証APIのレイテンシ (p99) が 300ms を超過した場合。
`;
            await this.app.vault.create(sampleSystemPath, apigwContent);
        }

        const sampleTemplatePath = normalizePath(`${this.settings.rootDir}/templates/release-plan.md`);
        if (!this.app.vault.getAbstractFileByPath(sampleTemplatePath)) {
            const releasePlanContent = `---
template_id: "release-plan"
title: "リリース計画書"
tags: [release, deployment, standard]
description: "本番リリースに伴う変更内容、手順、品質評価、ロールバック基準をまとめる標準計画書"
---
# リリース計画書 作成ガイドライン & フォーマット

以下の章立てに厳格に準拠してドキュメントを作成してください。ドメイン知識（システムナレッジ）にある注意事項やロールバック基準、過去トラブルの教訓を必ず各セクションに反映すること。

---

# リリース計画書: [リリース対象システム名 / バージョンまたは年月]

## 1. リリース概要・背景
- **リリース日時（予定）**: 
- **リリース対象システム**: 
- **リリース目的・背景**: 今回のリリースを行う理由、解決する課題や追加機能の要約。
- **関連チケット/PR**: 

## 2. リリース内容・変更点詳細
- **主な機能追加・改修内容**:
- **API・インターフェースの変更点**:
- **DBマイグレーション / 設定変更の有無**:
- **非推奨化・影響範囲**:

## 3. 品質評価・テスト結果サマリー
- **テスト実施状況**: 単体テスト、結合テスト、E2Eテストの合格状況。
- **パフォーマンステスト・負荷検証**:
- **未解決の既知の不具合 / リスク評価**:

## 4. リリース方針 & デプロイ作業手順
- **デプロイ方式**: (例: Blue-Green デプロイ、カナリアリリース、メンテナンス停止 など)
- **事前準備作業**:
- **本番デプロイタイムライン・作業手順**:
  1. [事前確認] 設定値・DBマイグレーションの確認
  2. [デプロイ実行] サービス起動・切り替え
  3. [スモークテスト] 重要導線の疎通確認
- **作業担当者 & レビュアー**:

## 5. リリース後確認ポイント & 切り戻し（ロールバック）方針
- **リリース直後の監視・ヘルスチェック項目**:
  - 監視メトリクス (エラーレート、レイテンシ、CPU/メモリ使用率)
- **ロールバック判断基準**: (明確な数値基準を記載)
- **ロールバック手順**: 障害発生時の具体的な切り戻し手順と所要想定時間。
`;
            await this.app.vault.create(sampleTemplatePath, releasePlanContent);
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
    async createNotebook(title: string, description: string = '', systemId?: string, templateId?: string): Promise<NotebookMetadata> {
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
            description: description.trim(),
            systemId: systemId || undefined,
            templateId: templateId || undefined
        };

        // 1. Index Markdown の作成
        const indexPath = normalizePath(`${this.settings.rootDir}/index/${id}.md`);
        const frontmatterObj: Record<string, any> = {
            notebook_id: metadata.id,
            title: metadata.title,
            created_at: metadata.createdAt,
            updated_at: metadata.updatedAt,
            tags: metadata.tags,
            icon: metadata.icon,
            description: metadata.description
        };
        if (metadata.systemId) frontmatterObj.system_id = metadata.systemId;
        if (metadata.templateId) frontmatterObj.template_id = metadata.templateId;

        const frontmatter = stringifyYaml(frontmatterObj);
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
            description: yaml.description || '',
            systemId: yaml.system_id || undefined,
            templateId: yaml.template_id || undefined
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

        const frontmatterObj: Record<string, any> = {
            notebook_id: updated.id,
            title: updated.title,
            created_at: updated.createdAt,
            updated_at: updated.updatedAt,
            tags: updated.tags,
            icon: updated.icon,
            description: updated.description
        };
        if (updated.systemId) frontmatterObj.system_id = updated.systemId;
        if (updated.templateId) frontmatterObj.template_id = updated.templateId;

        const frontmatter = stringifyYaml(frontmatterObj);

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

    // ==========================================
    // システム・ドメイン知識 (Systems)
    // ==========================================

    /**
     * 全システムナレッジ一覧の取得
     */
    async getAllSystems(): Promise<SystemKnowledge[]> {
        await this.ensureBaseDirectories();
        const systemsDir = normalizePath(`${this.settings.rootDir}/systems`);
        const folder = this.app.vault.getAbstractFileByPath(systemsDir);
        if (!(folder instanceof TFolder)) return [];

        const systems: SystemKnowledge[] = [];
        for (const file of folder.children) {
            if (file instanceof TFile && file.extension === 'md') {
                try {
                    const content = await this.app.vault.read(file);
                    const match = content.match(/^---\n([\s\S]*?)\n---/);
                    const yaml = match ? parseYaml(match[1]) : {};
                    const body = content.replace(/^---\n[\s\S]*?\n---\n?/, '');

                    systems.push({
                        id: yaml.system_id || file.basename,
                        name: yaml.name || file.basename,
                        path: file.path,
                        description: yaml.description || '',
                        tags: yaml.tags || [],
                        content: body.trim()
                    });
                } catch (e) {
                    console.error(`Failed to read system file ${file.path}:`, e);
                }
            }
        }
        return systems.sort((a, b) => a.name.localeCompare(b.name));
    }

    /**
     * システムナレッジの取得
     */
    async getSystem(id: string): Promise<SystemKnowledge | null> {
        const systems = await this.getAllSystems();
        return systems.find(s => s.id === id) || null;
    }

    /**
     * システムナレッジの保存・更新
     */
    async saveSystem(id: string, name: string, description: string, content: string, tags: string[] = []): Promise<void> {
        await this.ensureBaseDirectories();
        const filePath = normalizePath(`${this.settings.rootDir}/systems/${id}.md`);
        const frontmatter = stringifyYaml({
            system_id: id,
            name: name,
            tags: tags,
            description: description
        });
        const fullContent = `---\n${frontmatter}---\n${content}`;

        const existing = this.app.vault.getAbstractFileByPath(filePath);
        if (existing instanceof TFile) {
            await this.app.vault.modify(existing, fullContent);
        } else {
            await this.app.vault.create(filePath, fullContent);
        }
    }

    // ==========================================
    // ドキュメントテンプレート (Templates)
    // ==========================================

    /**
     * 全テンプレート一覧の取得
     */
    async getAllTemplates(): Promise<DocumentTemplate[]> {
        await this.ensureBaseDirectories();
        const templatesDir = normalizePath(`${this.settings.rootDir}/templates`);
        const folder = this.app.vault.getAbstractFileByPath(templatesDir);
        if (!(folder instanceof TFolder)) return [];

        const templates: DocumentTemplate[] = [];
        for (const file of folder.children) {
            if (file instanceof TFile && file.extension === 'md') {
                try {
                    const content = await this.app.vault.read(file);
                    const match = content.match(/^---\n([\s\S]*?)\n---/);
                    const yaml = match ? parseYaml(match[1]) : {};
                    const body = content.replace(/^---\n[\s\S]*?\n---\n?/, '');

                    templates.push({
                        id: yaml.template_id || file.basename,
                        title: yaml.title || file.basename,
                        path: file.path,
                        description: yaml.description || '',
                        tags: yaml.tags || [],
                        content: body.trim()
                    });
                } catch (e) {
                    console.error(`Failed to read template file ${file.path}:`, e);
                }
            }
        }
        return templates.sort((a, b) => a.title.localeCompare(b.title));
    }

    /**
     * テンプレートの取得
     */
    async getTemplate(id: string): Promise<DocumentTemplate | null> {
        const templates = await this.getAllTemplates();
        return templates.find(t => t.id === id) || null;
    }

    /**
     * テンプレートの保存・更新
     */
    async saveTemplate(id: string, title: string, description: string, content: string, tags: string[] = []): Promise<void> {
        await this.ensureBaseDirectories();
        const filePath = normalizePath(`${this.settings.rootDir}/templates/${id}.md`);
        const frontmatter = stringifyYaml({
            template_id: id,
            title: title,
            tags: tags,
            description: description
        });
        const fullContent = `---\n${frontmatter}---\n${content}`;

        const existing = this.app.vault.getAbstractFileByPath(filePath);
        if (existing instanceof TFile) {
            await this.app.vault.modify(existing, fullContent);
        } else {
            await this.app.vault.create(filePath, fullContent);
        }
    }
}
