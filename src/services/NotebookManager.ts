import { App, TFile, TFolder, parseYaml, stringifyYaml, normalizePath, FileSystemAdapter } from 'obsidian';
import { NotebookMetadata, NotebookSource, NotebookArtifact, ChatMessage, ChatSessionMetadata, ChatSession, AINotebookSettings, SystemKnowledge, DocumentTemplate, SourceOrigin, TranscriptionErrorEntry, MattermostChannelRef, AddSourceResult } from '../types';
import { TranscriptionService } from './transcription/TranscriptionService';
import { BoundFolderReader } from './BoundFolderReader';
import { DebugFolderHelper } from '../utils/debugFolderHelper';
import * as path from 'path';

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

    private async ensureFolder(folderPath: string): Promise<void> {
        const normalized = normalizePath(folderPath);
        if (!normalized || normalized === '/' || normalized === '.') return;

        const parts = normalized.split('/');
        let current = '';
        for (const part of parts) {
            current = current ? `${current}/${part}` : part;
            const existing = this.app.vault.getAbstractFileByPath(current);
            if (!existing) {
                try {
                    await this.app.vault.createFolder(current);
                } catch (e: any) {
                    // 並行実行や Obsidian の同期遅延で既に作成済みの場合は安全に無視
                    const errMsg = (e?.message || String(e)).toLowerCase();
                    if (!errMsg.includes('already exists')) {
                        throw e;
                    }
                }
            }
        }
    }

    /**
     * テキストファイルを安全に作成または上書き（並行競合時の File already exists を吸収）
     */
    private async safeCreateOrModify(filePath: string, content: string): Promise<TFile> {
        const normalized = normalizePath(filePath);
        const existing = this.app.vault.getAbstractFileByPath(normalized);
        if (existing instanceof TFile) {
            await this.app.vault.modify(existing, content);
            return existing;
        }

        try {
            return await this.app.vault.create(normalized, content);
        } catch (e: any) {
            const errMsg = (e?.message || String(e)).toLowerCase();
            if (errMsg.includes('already exists')) {
                const refreshed = this.app.vault.getAbstractFileByPath(normalized);
                if (refreshed instanceof TFile) {
                    await this.app.vault.modify(refreshed, content);
                    return refreshed;
                }
            }
            throw e;
        }
    }

    /**
     * バイナリファイルを安全に作成または上書き（並行競合時の File already exists を吸収）
     */
    private async safeCreateOrModifyBinary(filePath: string, buffer: ArrayBuffer): Promise<TFile> {
        const normalized = normalizePath(filePath);
        const existing = this.app.vault.getAbstractFileByPath(normalized);
        if (existing instanceof TFile) {
            await this.app.vault.modifyBinary(existing, buffer);
            return existing;
        }

        try {
            return await this.app.vault.createBinary(normalized, buffer);
        } catch (e: any) {
            const errMsg = (e?.message || String(e)).toLowerCase();
            if (errMsg.includes('already exists')) {
                const refreshed = this.app.vault.getAbstractFileByPath(normalized);
                if (refreshed instanceof TFile) {
                    await this.app.vault.modifyBinary(refreshed, buffer);
                    return refreshed;
                }
            }
            throw e;
        }
    }

    /**
     * 初回用の標準ナレッジ育成ノートブック（APIGW仕様・リリース計画書デザイン仕様）を生成
     */
    private async ensureSampleData(): Promise<void> {
        // 1. 📘 APIGW システム仕様・クセ ノートブック
        const apigwId = 'sample_sys_apigw';
        const apigwIndexPath = normalizePath(`${this.settings.rootDir}/index/${apigwId}.md`);
        if (!this.app.vault.getAbstractFileByPath(apigwIndexPath)) {
            const now = new Date().toISOString();
            const apigwFrontmatter = stringifyYaml({
                notebook_id: apigwId,
                title: '📘 APIGW システム仕様・クセ',
                created_at: now,
                updated_at: now,
                tags: ['system', 'apigw', 'architecture', 'knowledge'],
                icon: 'cpu',
                description: 'KongベースのAPI Gateway仕様、トラブル教訓、運用上の注意点まとめ',
                linked_notebook_ids: []
            });
            await this.app.vault.create(apigwIndexPath, `---\n${apigwFrontmatter}---\n# 📘 APIGW システム仕様・クセ\n\nKong Gatewayおよび自社カスタムプラグインの仕様と運用上の知見。\n`);

            const apigwDir = normalizePath(`${this.settings.rootDir}/notebooks/${apigwId}`);
            await this.ensureFolder(apigwDir);
            await this.ensureFolder(normalizePath(`${apigwDir}/sources`));
            await this.ensureFolder(normalizePath(`${apigwDir}/artifacts`));
            await this.app.vault.create(normalizePath(`${apigwDir}/chat.json`), JSON.stringify([], null, 2));

            // 成果物1: アーキテクチャ概要
            const archDoc = `# APIGW システムアーキテクチャ概要

## 概要
本システムはKong Gatewayおよび自社カスタムプラグインで構成されるAPI Gatewayです。
外部クライアントからのリクエストを受け付け、認証基盤（Auth Service）との連携によるトークン検証、ルーティング、レートリミット制御を行います。

## インフラ構成 & 依存関係
- **インフラ**: AWS ECS (Fargate), ALB
- **データストア**: Redis Cluster (レートリミット・トークンキャッシュ用), PostgreSQL (Kong設定DB)
- **依存サービス**: Auth Service (認証トークン検証), 各バックエンドマイクロサービス
`;
            await this.addArtifactFile(apigwId, '01_システムアーキテクチャ概要', archDoc);

            // 成果物2: 運用上のクセと注意事項
            const quirksDoc = `# APIGW 運用上のクセ・重要注意事項 & ロールバック基準

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
            await this.addArtifactFile(apigwId, '02_運用上のクセと注意事項', quirksDoc);
        }

        // 2. 📋 リリース計画書 デザイン仕様 ノートブック
        const releaseTplId = 'sample_tpl_release';
        const releaseTplIndexPath = normalizePath(`${this.settings.rootDir}/index/${releaseTplId}.md`);
        if (!this.app.vault.getAbstractFileByPath(releaseTplIndexPath)) {
            const now = new Date().toISOString();
            const tplFrontmatter = stringifyYaml({
                notebook_id: releaseTplId,
                title: '📋 リリース計画書 デザイン仕様',
                created_at: now,
                updated_at: now,
                tags: ['template', 'release', 'standard', 'rules'],
                icon: 'file-text',
                description: '本番リリース計画書の標準章立てルールおよび高品質な記述サンプル (few-shot)',
                linked_notebook_ids: []
            });
            await this.app.vault.create(releaseTplIndexPath, `---\n${tplFrontmatter}---\n# 📋 リリース計画書 デザイン仕様\n\n標準リリース計画書のフォーマット定義と、AIに模倣させるための高品質サンプル。\n`);

            const tplDir = normalizePath(`${this.settings.rootDir}/notebooks/${releaseTplId}`);
            await this.ensureFolder(tplDir);
            await this.ensureFolder(normalizePath(`${tplDir}/sources`));
            await this.ensureFolder(normalizePath(`${tplDir}/artifacts`));
            await this.app.vault.create(normalizePath(`${tplDir}/chat.json`), JSON.stringify([], null, 2));

            // 成果物1: 作成ルール
            const rulesDoc = `# リリース計画書 標準作成ガイドライン & 章立てルール

以下の章立てに厳格に準拠してドキュメントを作成してください。参照元のシステム知識にある注意事項やロールバック基準、過去トラブルの教訓を必ず各セクションに反映すること。

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
            await this.addArtifactFile(releaseTplId, '01_リリース計画書_標準作成ルール', rulesDoc);

            // 成果物2: few-shot サンプル
            const fewShotDoc = `# 【高品質サンプル】2026-08 APIGW v2.4 リリース計画書 (few-shot)

## 1. リリース概要・背景
- **リリース日時（予定）**: 2026-08-15 22:00〜23:00 JST
- **リリース対象システム**: API Gateway (APIGW)
- **リリース目的・背景**: OAuth 2.1 トークン検証プラグインのメモリリーク解消およびレートリミットRedis接続プールの最適化。
- **関連チケット/PR**: PR #452, TICKET-8821

## 2. リリース内容・変更点詳細
- **主な機能追加・改修内容**: トークン検証キャッシュのTTL制御修正、Redis Cluster再接続リトライのバックオフ制御導入。
- **API・インターフェースの変更点**: 変更なし（内部ロジック最適化のみ）。
- **DBマイグレーション / 設定変更の有無**: 環境変数 \`REDIS_POOL_MAX_IDLE=50\` の追加。
- **影響範囲**: 全外部APIリクエスト。

## 3. 品質評価・テスト結果サマリー
- **テスト実施状況**: 単体テスト100%パス、ステージング環境での48時間ソークテスト完了（メモリ増加なし確認済み）。
- **パフォーマンステスト**: 5,000 req/sec の高負荷時でもレイテンシp99が25ms以内を維持。

## 4. リリース方針 & デプロイ作業手順
- **デプロイ方式**: Blue-Green デプロイ（ALB コネクションドレイン待機時間: 90秒）
- **本番デプロイ手順**:
  1. [22:00] グリーン環境へ新バージョンコンテナデプロイ & \`/healthz\` 疎通確認
  2. [22:15] ALBのトラフィックをグリーン環境へ50%シフト、エラーレート監視 (5分間)
  3. [22:20] 100%切り替え実行、ALBコネクションドレイン完了待機 (90秒)
  4. [22:25] 重要エンドポイント (\`/api/v2/auth\`, \`/api/v2/users\`) のスモークテスト実施

## 5. リリース後確認ポイント & 切り戻し方針
- **監視項目**: Datadog APM にて 5xx エラー率、Redisコネクション数、p99レイテンシを常時監視。
- **ロールバック判断基準**:
  - 切り替え後10分間に 5xx エラー率が 0.5% を超過した場合
  - 認証レイテンシ p99 が 300ms を超過した場合
- **ロールバック手順**: ALB ターゲットグループを即座に旧ブルー環境へ100%戻す（所要想定時間: 約30秒）。
`;
            await this.addArtifactFile(releaseTplId, '02_fewshot_良質サンプル', fewShotDoc);
        }

        // 3. 📘 案件見積基準・過去実績ナレッジ ノートブック (Phase 4 外部ソース・ナレッジ育成サンプル)
        const estimatesKbId = 'sample_kb_estimates';
        const estimatesIndexPath = normalizePath(`${this.settings.rootDir}/index/${estimatesKbId}.md`);
        if (!this.app.vault.getAbstractFileByPath(estimatesIndexPath)) {
            const now = new Date().toISOString();
            const estimatesFrontmatter = stringifyYaml({
                notebook_id: estimatesKbId,
                title: '📘 案件見積基準・過去実績ナレッジ',
                created_at: now,
                updated_at: now,
                tags: ['estimate', 'pricing', 'knowledge', 'sample'],
                icon: 'calculator',
                description: '過去の案件見積書・提案書（Excel/PPTX）から抽出・構造化した工数基準・単価マスター・リスク係数ナレッジ',
                linked_notebook_ids: []
            });
            await this.app.vault.create(estimatesIndexPath, `---\n${estimatesFrontmatter}---\n# 📘 案件見積基準・過去実績ナレッジ\n\n過去案件のExcel見積書および方式設計PPTXから抽出・洗練されたドメインナレッジ。\n`);

            const estimatesDir = normalizePath(`${this.settings.rootDir}/notebooks/${estimatesKbId}`);
            await this.ensureFolder(estimatesDir);
            await this.ensureFolder(normalizePath(`${estimatesDir}/sources`));
            await this.ensureFolder(normalizePath(`${estimatesDir}/artifacts`));
            await this.ensureFolder(normalizePath(`${estimatesDir}/sessions`));

            // 成果物1: 工数算出テーブル & 標準単価マスター
            const pricingDoc = `# 工数算出テーブル & 標準単価マスター

## 1. ロール別 標準単価表
| ロール名 | 標準単価(万円/人月) | 役割定義・適用基準 |
| :--- | :--- | :--- |
| **PM (Project Manager)** | 180 | 全体統括、ステコミ報告、クリティカルリスクマネジメント |
| **PL / Lead Architect** | 150 | 基本設計リード、技術意思決定、チームリード |
| **Senior SE** | 120 | コアAPI実装、インフラ構築 (AWS/EKS)、性能チューニング |
| **SE** | 90 | 機能実装、単体/結合テスト作成、仕様調査 |
| **PG / Tester** | 70 | 定型実装、テスト実行、テストデータ作成 |

## 2. アーキテクチャ要素別 標準工数レンジ (人月)
| 要素・タスク名 | 標準工数目安 | 留意点・前提 |
| :--- | :--- | :--- |
| **バックエンド REST API 開発** | 0.5〜0.8 人月 / 1エンドポイント | Go / Clean Architecture 設計前提 |
| **フロントエンド画面開発 (React)** | 0.4〜0.6 人月 / 1画面 | 共通UIコンポーネントがある場合 |
| **AWS / EKS インフラ構築 (IaC)** | 3.0〜4.5 人月 | Terraform による自動化、CI/CD含む |
| **DB マイグレーション (異種DB間)** | 3.0〜5.0 人月 | データ量・スキーマ変換難易度による |
| **総合テスト & 負荷試験 (5k rps)** | 4.0〜5.0 人月 | シナリオ作成・Locust負荷試験実施 |
| **夜間切替 & 移行リハーサル** | 2.0 人月 | リハーサル最低2回実施 |
`;
            await this.addArtifactFile(estimatesKbId, '01_工数算出テーブル_標準単価マスター', pricingDoc);

            // 成果物2: 見積作成ガイドライン & リスク管理
            const guidelineDoc = `# 見積作成ガイドライン & リスクバッファ方針

## 1. 見積作成時の必須確認事項
1. **夜間・休日作業割増**:
   - 本番デプロイや切り替えリハーサルが夜間（22:00〜05:00）または休日の場合、**深夜割増（25%）**を工数または費用に加算すること。
2. **外部SaaS / API 連携の前提**:
   - 外部連携先APIの利用料や契約費用は顧客直接契約前提とし、開発見積スコープ外であることを明記する。
3. **データ移行時のデュアルライト整合性**:
   - 現行DBと新DB間のレプリケーション遅延が発生する懸念がある場合、整合性リトライ・補正バッチの工数（最低1.5人月）を見積もりに計上すること。

## 2. リスクバッファ (予備費) 算定基準
- **小規模・既存改善案件**: 全体工数の **5%**
- **新規システム構築・DB移行案件**: 全体工数の **10%〜15%**
- **外部依存・未検証PoC案件**: 全体工数の **15%〜20%**
`;
            await this.addArtifactFile(estimatesKbId, '02_見積作成ガイドライン_リスク管理', guidelineDoc);

            // 初期セッション
            await this.createChatSession(estimatesKbId, '見積Excelからの知識抽出セッション', [
                {
                    id: 'msg_sample_1',
                    sender: 'user',
                    text: '投入した過去3件の見積Excelと提案書PPTXから、工数算定基準と単価マスター、リスク管理ルールを抽出して artifacts にまとめて。',
                    timestamp: now
                },
                {
                    id: 'msg_sample_2',
                    sender: 'agent',
                    text: '投入された過去見積書（A社基幹刷新、B社APIGW移行、C社クラウド移行）および提案書PPTXを横断分析し、以下のドメインナレッジ成果物を artifacts に直接生成しました：\n\n- `01_工数算出テーブル_標準単価マスター.md`: ロール別標準単価および機能要素別工数レンジ\n- `02_見積作成ガイドライン_リスク管理.md`: 夜間割増・DB移行時の注意点・リスクバッファ算定基準\n\n今後新規の見積作成タスクを行う際は、本ノートブックを参照リンクとして追加することで、これらの基準に基づいた高精度な見積ドラフトを自律作成できます。',
                    timestamp: now,
                    artifactsGenerated: ['01_工数算出テーブル_標準単価マスター.md', '02_見積作成ガイドライン_リスク管理.md']
                }
            ]);
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
    async createNotebook(
        title: string,
        description: string = '',
        linkedNotebookIds: string[] = [],
        boundFolderPath?: string,
        systemId?: string,
        templateId?: string
    ): Promise<NotebookMetadata> {
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
            linkedNotebookIds: linkedNotebookIds || [],
            boundFolderPath: boundFolderPath?.trim() || undefined,
            systemId: systemId || undefined,
            templateId: templateId || undefined
        };

        // 2. 実体フォルダ構造の作成
        const notebookDir = normalizePath(`${this.settings.rootDir}/notebooks/${id}`);
        await this.ensureFolder(notebookDir);
        await this.ensureFolder(normalizePath(`${notebookDir}/sources`));
        await this.ensureFolder(normalizePath(`${notebookDir}/artifacts`));
        await this.ensureFolder(normalizePath(`${notebookDir}/sessions`));

        // 3. 初期チャットセッションの作成
        const initialSession = await this.createChatSession(id, '新規セッション 1');
        metadata.activeSessionId = initialSession.id;

        // 1. Index Markdown の作成 (activeSessionId を含める)
        const indexPath = normalizePath(`${this.settings.rootDir}/index/${id}.md`);
        const frontmatterObj: Record<string, any> = {
            notebook_id: metadata.id,
            title: metadata.title,
            created_at: metadata.createdAt,
            updated_at: metadata.updatedAt,
            tags: metadata.tags,
            icon: metadata.icon,
            description: metadata.description,
            linked_notebook_ids: metadata.linkedNotebookIds || [],
            active_session_id: metadata.activeSessionId
        };
        if (metadata.boundFolderPath) frontmatterObj.bound_folder_path = metadata.boundFolderPath;
        if (metadata.systemId) frontmatterObj.system_id = metadata.systemId;
        if (metadata.templateId) frontmatterObj.template_id = metadata.templateId;

        const frontmatter = stringifyYaml(frontmatterObj);
        const indexContent = `---\n${frontmatter}---\n# ${metadata.title}\n\n${metadata.description}\n`;
        await this.app.vault.create(indexPath, indexContent);

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
            linkedNotebookIds: yaml.linked_notebook_ids || yaml.linkedNotebookIds || [],
            activeSessionId: yaml.active_session_id || yaml.activeSessionId || undefined,
            boundFolderPath: yaml.bound_folder_path || yaml.boundFolderPath || undefined,
            boundMmChannels: yaml.bound_mm_channels || yaml.boundMmChannels || [],
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
            description: updated.description,
            linked_notebook_ids: updated.linkedNotebookIds || []
        };
        if (updated.activeSessionId) frontmatterObj.active_session_id = updated.activeSessionId;
        if (updated.boundFolderPath !== undefined) frontmatterObj.bound_folder_path = updated.boundFolderPath;
        if (updated.boundMmChannels !== undefined) frontmatterObj.bound_mm_channels = updated.boundMmChannels;
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
     * リンクされたノートブック群の成果物（ナレッジ・ルール・サンプル）を走査・集約して取得
     */
    async getLinkedContexts(notebookId: string): Promise<import('../types').LinkedContext[]> {
        const metadata = await this.getNotebookMetadata(notebookId);
        if (!metadata || !metadata.linkedNotebookIds || metadata.linkedNotebookIds.length === 0) {
            return [];
        }

        let vaultBasePath = '';
        const adapter = this.app.vault.adapter;
        if (adapter instanceof FileSystemAdapter) {
            vaultBasePath = adapter.getBasePath();
        }

        const contexts: import('../types').LinkedContext[] = [];

        for (const linkedId of metadata.linkedNotebookIds) {
            const targetMeta = await this.getNotebookMetadata(linkedId);
            if (!targetMeta) continue;

            const artifacts = await this.getArtifacts(linkedId);
            const loadedArtifacts: import('../types').LinkedArtifact[] = [];

            for (const art of artifacts) {
                const artFile = this.app.vault.getAbstractFileByPath(art.path);
                const absPath = vaultBasePath ? path.join(vaultBasePath, art.path) : art.path;
                if (artFile instanceof TFile) {
                    loadedArtifacts.push({
                        name: art.id,
                        title: art.title,
                        path: art.path,
                        absolutePath: absPath,
                        size: artFile.stat.size
                    });
                }
            }

            contexts.push({
                notebookId: targetMeta.id,
                notebookTitle: targetMeta.title,
                description: targetMeta.description,
                artifacts: loadedArtifacts
            });
        }

        return contexts;
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
     * ソースメタデータ（origins.json）の読み込み
     */
    private async readSourcesOrigins(id: string): Promise<Record<string, SourceOrigin>> {
        const originsPath = normalizePath(`${this.settings.rootDir}/notebooks/${id}/sources/.origins.json`);
        const file = this.app.vault.getAbstractFileByPath(originsPath);
        if (file instanceof TFile) {
            try {
                const content = await this.app.vault.read(file);
                return JSON.parse(content);
            } catch (e) {
                console.warn(`Failed to read .origins.json for notebook ${id}:`, e);
            }
        }
        return {};
    }

    /**
     * ソースメタデータ（origins.json）の保存
     */
    private async saveSourcesOrigins(id: string, origins: Record<string, SourceOrigin>): Promise<void> {
        const sourcesDir = normalizePath(`${this.settings.rootDir}/notebooks/${id}/sources`);
        await this.ensureFolder(sourcesDir);
        const originsPath = normalizePath(`${sourcesDir}/.origins.json`);
        const content = JSON.stringify(origins, null, 2);

        const existing = this.app.vault.getAbstractFileByPath(originsPath);
        if (existing instanceof TFile) {
            await this.app.vault.modify(existing, content);
        } else {
            await this.app.vault.create(originsPath, content);
        }
    }

    /**
     * 変換エラー情報（.transcription-errors.json）の取得
     */
    async readTranscriptionErrors(id: string): Promise<Record<string, TranscriptionErrorEntry>> {
        const errorsPath = normalizePath(`${this.settings.rootDir}/notebooks/${id}/sources/.transcription-errors.json`);
        const file = this.app.vault.getAbstractFileByPath(errorsPath);
        if (file instanceof TFile) {
            try {
                const content = await this.app.vault.read(file);
                return JSON.parse(content);
            } catch (e) {
                console.warn(`Failed to read .transcription-errors.json for notebook ${id}:`, e);
            }
        }
        return {};
    }

    /**
     * 変換エラー情報の保存
     */
    private async saveTranscriptionErrors(id: string, errors: Record<string, TranscriptionErrorEntry>): Promise<void> {
        const sourcesDir = normalizePath(`${this.settings.rootDir}/notebooks/${id}/sources`);
        await this.ensureFolder(sourcesDir);
        const errorsPath = normalizePath(`${sourcesDir}/.transcription-errors.json`);
        const content = JSON.stringify(errors, null, 2);

        const existing = this.app.vault.getAbstractFileByPath(errorsPath);
        if (existing instanceof TFile) {
            await this.app.vault.modify(existing, content);
        } else {
            await this.app.vault.create(errorsPath, content);
        }
    }

    /**
     * 変換エラー情報の記録
     */
    async recordTranscriptionError(id: string, fileName: string, error: any, actualBytesRead: number): Promise<void> {
        const errorsMap = await this.readTranscriptionErrors(id);
        errorsMap[fileName] = {
            fileName,
            fileSize: actualBytesRead,
            actualBytesRead,
            errorMessage: error?.message || String(error),
            stackTrace: error?.stack || undefined,
            timestamp: new Date().toISOString()
        };
        await this.saveTranscriptionErrors(id, errorsMap);
    }

    /**
     * 変換エラー情報の消去
     */
    async clearTranscriptionError(id: string, fileName: string): Promise<void> {
        const errorsMap = await this.readTranscriptionErrors(id);
        let modified = false;
        if (errorsMap[fileName]) {
            delete errorsMap[fileName];
            modified = true;
        }
        // *.md 形式で登録されている可能性もあるため両方クリア
        const mdName = `${fileName}.md`;
        if (errorsMap[mdName]) {
            delete errorsMap[mdName];
            modified = true;
        }
        if (modified) {
            await this.saveTranscriptionErrors(id, errorsMap);
        }
    }

    /**
     * ソースファイル一覧の取得
     */
    async getSources(id: string): Promise<NotebookSource[]> {
        const sourcesDir = normalizePath(`${this.settings.rootDir}/notebooks/${id}/sources`);
        const folder = this.app.vault.getAbstractFileByPath(sourcesDir);
        if (!(folder instanceof TFolder)) return [];

        const originsMap = await this.readSourcesOrigins(id);
        const errorsMap = await this.readTranscriptionErrors(id);
        const sources: NotebookSource[] = [];

        for (const file of folder.children) {
            if (file instanceof TFile && !file.name.startsWith('.')) {
                let convertedFrom: string | undefined = undefined;
                // *.xlsx.md, *.pptx.md, *.docx.md の検出
                const match = file.name.match(/^(.+\.(xlsx|xls|pptx|docx))\.md$/i);
                if (match) {
                    convertedFrom = match[1];
                }

                // 変換前ファイル名または現在のファイル名から origin を検索
                const origin = (convertedFrom && originsMap[convertedFrom]) || originsMap[file.name] || undefined;
                const transcriptionError = errorsMap[file.name] || (convertedFrom ? errorsMap[convertedFrom] : undefined);

                sources.push({
                    name: file.name,
                    path: file.path,
                    extension: file.extension,
                    size: file.stat.size,
                    addedAt: new Date(file.stat.ctime).toISOString(),
                    origin,
                    convertedFrom,
                    transcriptionError
                });
            }
        }
        return sources;
    }

    /**
     * ソースファイルの追加 (Binary / ArrayBuffer / Buffer 対応 & 自動決定的変換)
     */
    async addSourceFile(
        id: string,
        fileName: string,
        data: ArrayBuffer | Buffer | string,
        origin?: SourceOrigin
    ): Promise<AddSourceResult> {
        const sourcesDir = normalizePath(`${this.settings.rootDir}/notebooks/${id}/sources`);
        await this.ensureFolder(sourcesDir);

        // origin が渡された場合、.origins.json を更新
        if (origin) {
            const originsMap = await this.readSourcesOrigins(id);
            originsMap[fileName] = origin;
            await this.saveSourcesOrigins(id, originsMap);
        }

        // ArrayBuffer への安全な変換ヘルパー
        const toArrayBuffer = (d: ArrayBuffer | Buffer): ArrayBuffer => {
            if (Buffer.isBuffer(d)) {
                const ab = new ArrayBuffer(d.byteLength);
                const view = new Uint8Array(ab);
                view.set(d);
                return ab;
            }
            return d;
        };

        // Node.js Buffer への変換ヘルパー
        const toBuffer = (d: ArrayBuffer | Buffer | string): Buffer => {
            if (typeof d === 'string') return Buffer.from(d, 'utf-8');
            if (Buffer.isBuffer(d)) return d;
            return Buffer.from(d);
        };

        const buffer = toBuffer(data);
        if (buffer.length === 0) {
            DebugFolderHelper.logPipelineError(fileName, 2, 'Read', new Error('データが空（0バイト）です'));
            throw new Error(`ファイル "${fileName}" のデータが空（0バイト）です。ファイルが正しく保存・同期されているか確認してください。`);
        }

        DebugFolderHelper.logPipelineStep(fileName, 2, 'Read', `バッファ取得完了 (${buffer.length.toLocaleString()} bytes)`);

        // バイナリドキュメント（Excel/PPTX/Word）の場合は自動で Markdown に決定的変換
        if (TranscriptionService.isTranscribable(fileName)) {
            DebugFolderHelper.logPipelineStep(fileName, 3, 'Route', `Officeドキュメントと判定 -> 自動パースを実行します`);
            try {
                const { markdown, convertedFilename, metrics } = await TranscriptionService.transcribe(
                    buffer,
                    fileName
                );

                DebugFolderHelper.logPipelineStep(
                    fileName, 
                    4, 
                    'Parse', 
                    `パース完了 (所要時間: ${metrics?.durationMs}ms, ${metrics?.lineCount}行, ${metrics?.charCount}文字)`,
                    metrics
                );

                await this.clearTranscriptionError(id, fileName);

                // 変換後 Markdown を sources 直下に作成
                const mdPath = normalizePath(`${sourcesDir}/${convertedFilename}`);
                const resultFile = await this.safeCreateOrModify(mdPath, markdown);

                // 原本バイナリを sources/.cache/ 配下に保存（差分検知や再同期用）
                const cacheDir = normalizePath(`${sourcesDir}/.cache`);
                await this.ensureFolder(cacheDir);
                const rawPath = normalizePath(`${cacheDir}/${fileName}`);

                if (typeof data === 'string') {
                    await this.safeCreateOrModify(rawPath, data);
                } else {
                    await this.safeCreateOrModifyBinary(rawPath, toArrayBuffer(data));
                }

                DebugFolderHelper.logPipelineStep(
                    fileName, 
                    5, 
                    'Save', 
                    `Markdown保存完了: ${convertedFilename} (原本は .cache/${fileName} にバックアップ)`
                );

                return {
                    file: resultFile,
                    isConverted: true,
                    convertedFilename,
                    metrics
                };
            } catch (transcribeError: any) {
                DebugFolderHelper.logPipelineError(fileName, 4, 'Parse', transcribeError, { bufferLength: buffer.length });
                console.error(`[AI Notebook] ❌ 自動パース失敗: ${fileName} - 原本バイナリを通常保存へフォールバックします:`, transcribeError);
                await this.recordTranscriptionError(id, fileName, transcribeError, buffer.length);

                // フォールバック: 原本を sources 直下に直接保存
                const fallbackPath = normalizePath(`${sourcesDir}/${fileName}`);
                let fallbackFile: TFile;
                if (typeof data === 'string') {
                    fallbackFile = await this.safeCreateOrModify(fallbackPath, data);
                } else {
                    fallbackFile = await this.safeCreateOrModifyBinary(fallbackPath, toArrayBuffer(data));
                }

                DebugFolderHelper.logPipelineStep(fileName, 5, 'Save (Fallback)', `原本バイナリを直接保存しました: ${fileName}`);

                return {
                    file: fallbackFile,
                    isConverted: false,
                    transcriptionFailed: true,
                    error: transcribeError?.message || String(transcribeError)
                };
            }
        }

        // 非Office文書（通常テキスト・PDF・画像など）
        DebugFolderHelper.logPipelineStep(fileName, 3, 'Route', `非Office文書のため直接保存します`);
        const filePath = normalizePath(`${sourcesDir}/${fileName}`);
        let directFile: TFile;

        if (typeof data === 'string') {
            directFile = await this.safeCreateOrModify(filePath, data);
        } else {
            directFile = await this.safeCreateOrModifyBinary(filePath, toArrayBuffer(data));
        }

        DebugFolderHelper.logPipelineStep(fileName, 5, 'Save', `直接保存完了: ${fileName}`);

        return {
            file: directFile,
            isConverted: false,
            transcriptionFailed: false
        };
    }

    /**
     * 未変換バイナリまたは変換失敗ファイルの再変換を実行
     */
    async retranscribeSource(id: string, fileName: string): Promise<{ success: boolean; error?: string }> {
        DebugFolderHelper.logPipelineStep(fileName, 1, 'Retry', `再変換を開始します`);
        const sourcesDir = normalizePath(`${this.settings.rootDir}/notebooks/${id}/sources`);
        const rawInSources = normalizePath(`${sourcesDir}/${fileName}`);
        const rawInCache = normalizePath(`${sourcesDir}/.cache/${fileName}`);

        let rawFile = this.app.vault.getAbstractFileByPath(rawInSources);
        if (!(rawFile instanceof TFile)) {
            rawFile = this.app.vault.getAbstractFileByPath(rawInCache);
        }

        if (!(rawFile instanceof TFile)) {
            const msg = `原本ファイルが見つかりません: ${fileName}`;
            DebugFolderHelper.logPipelineError(fileName, 1, 'Retry', new Error(msg));
            return { success: false, error: msg };
        }

        try {
            const arrayBuf = await this.app.vault.readBinary(rawFile);
            const buffer = Buffer.from(arrayBuf);
            if (buffer.length === 0) {
                throw new Error(`ファイルデータが空（0バイト）です。`);
            }

            const { markdown, convertedFilename, metrics } = await TranscriptionService.transcribe(buffer, fileName);
            DebugFolderHelper.logPipelineStep(fileName, 2, 'Retry-Parse', `再パース成功 (${metrics?.durationMs}ms, ${metrics?.lineCount}行)`, metrics);

            // 変換後 Markdown を sources 直下に作成
            const mdPath = normalizePath(`${sourcesDir}/${convertedFilename}`);
            await this.safeCreateOrModify(mdPath, markdown);

            // 原本を .cache/ に移動（sources/ 直下にある場合は .cache へ移管して sources/ 直下の原本を削除）
            const cacheDir = normalizePath(`${sourcesDir}/.cache`);
            await this.ensureFolder(cacheDir);
            const cachePath = normalizePath(`${cacheDir}/${fileName}`);

            if (rawFile.path === rawInSources) {
                await this.safeCreateOrModifyBinary(cachePath, arrayBuf);
                await this.app.vault.delete(rawFile);
            }

            await this.clearTranscriptionError(id, fileName);
            DebugFolderHelper.logPipelineStep(fileName, 3, 'Retry-Save', `再変換後Markdownの保存完了: ${convertedFilename}`);
            return { success: true };
        } catch (err: any) {
            DebugFolderHelper.logPipelineError(fileName, 2, 'Retry-Parse', err);
            console.error(`Retranscription failed for ${fileName}:`, err);
            const fileSize = (rawFile instanceof TFile) ? rawFile.stat.size : 0;
            await this.recordTranscriptionError(id, fileName, err, fileSize);
            return { success: false, error: err?.message || String(err) };
        }
    }

    /**
     * ソースファイルの削除
     */
    async deleteSourceFile(id: string, fileName: string): Promise<void> {
        const sourcesDir = normalizePath(`${this.settings.rootDir}/notebooks/${id}/sources`);
        const filePath = normalizePath(`${sourcesDir}/${fileName}`);
        const file = this.app.vault.getAbstractFileByPath(filePath);
        if (file instanceof TFile) {
            await this.app.vault.delete(file);
        }

        // キャッシュ（.cache/）内の原本も削除
        const cachePath = normalizePath(`${sourcesDir}/.cache/${fileName}`);
        const cacheFile = this.app.vault.getAbstractFileByPath(cachePath);
        if (cacheFile instanceof TFile) {
            await this.app.vault.delete(cacheFile);
        }

        // *.md が削除された場合、元のバイナリキャッシュも探索して削除
        const match = fileName.match(/^(.+\.(xlsx|xls|pptx|docx))\.md$/i);
        if (match) {
            const origCachePath = normalizePath(`${sourcesDir}/.cache/${match[1]}`);
            const origCacheFile = this.app.vault.getAbstractFileByPath(origCachePath);
            if (origCacheFile instanceof TFile) {
                await this.app.vault.delete(origCacheFile);
            }
        }

        // origins からも削除
        const originsMap = await this.readSourcesOrigins(id);
        if (originsMap[fileName]) {
            delete originsMap[fileName];
            await this.saveSourcesOrigins(id, originsMap);
        }

        // エラーログからも削除
        await this.clearTranscriptionError(id, fileName);
    }

    /**
     * バインドされた外部フォルダから指定されたファイルを一括読み込み・変換格納 (Extract)
     */
    async extractFromBoundFolder(
        notebookId: string,
        relativeFilePaths: string[]
    ): Promise<{ importedCount: number; errors: string[] }> {
        const metadata = await this.getNotebookMetadata(notebookId);
        const basePath = metadata?.boundFolderPath || this.settings.sharedFolderBasePath;
        if (!basePath) {
            throw new Error('バインド外部フォルダまたは共有フォルダ起点パスが設定されていません');
        }

        let importedCount = 0;
        const errors: string[] = [];

        for (const relPath of relativeFilePaths) {
            try {
                const { buffer, fileName, mtime } = await BoundFolderReader.readFile(basePath, relPath);
                const relDir = path.dirname(relPath);
                const relativeFolder = (relDir && relDir !== '.') ? relDir : undefined;

                const origin: SourceOrigin = {
                    connectorId: 'cifs',
                    remoteUrl: `file://${path.resolve(basePath, relPath)}`,
                    remoteId: path.resolve(basePath, relPath),
                    relativeFolder,
                    remoteVersion: mtime,
                    lastSyncedAt: new Date().toISOString()
                };

                await this.addSourceFile(notebookId, fileName, buffer, origin);
                importedCount++;
            } catch (e: any) {
                console.error(`Failed to extract ${relPath}:`, e);
                errors.push(`${relPath}: ${e.message}`);
            }
        }

        return { importedCount, errors };
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

    // ==========================================
    // チャットセッション管理 (Multi-Chat Sessions)
    // ==========================================

    /**
     * チャットセッション一覧の取得（旧chat.jsonからの自動移行含む）
     */
    async getChatSessions(notebookId: string): Promise<ChatSessionMetadata[]> {
        const notebookDir = normalizePath(`${this.settings.rootDir}/notebooks/${notebookId}`);
        const sessionsDir = normalizePath(`${notebookDir}/sessions`);
        await this.ensureFolder(sessionsDir);

        const folder = this.app.vault.getAbstractFileByPath(sessionsDir);
        const sessions: ChatSessionMetadata[] = [];

        if (folder instanceof TFolder) {
            for (const file of folder.children) {
                if (file instanceof TFile && file.extension === 'json') {
                    try {
                        const content = await this.app.vault.read(file);
                        const sessionData = JSON.parse(content);
                        if (sessionData && sessionData.id) {
                            sessions.push({
                                id: sessionData.id,
                                title: sessionData.title || 'チャットセッション',
                                createdAt: sessionData.createdAt || new Date(file.stat.ctime).toISOString(),
                                updatedAt: sessionData.updatedAt || new Date(file.stat.mtime).toISOString(),
                                messageCount: Array.isArray(sessionData.messages) ? sessionData.messages.length : 0
                            });
                        }
                    } catch (e) {
                        console.error(`Failed to parse session file: ${file.path}`, e);
                    }
                }
            }
        }

        // セッションが0件の場合：旧 chat.json の自動マイグレーションまたは新規セッション作成
        if (sessions.length === 0) {
            const oldChatPath = normalizePath(`${notebookDir}/chat.json`);
            const oldChatFile = this.app.vault.getAbstractFileByPath(oldChatPath);
            let initialMessages: ChatMessage[] = [];
            if (oldChatFile instanceof TFile) {
                try {
                    const oldContent = await this.app.vault.read(oldChatFile);
                    const parsed = JSON.parse(oldContent);
                    if (Array.isArray(parsed) && parsed.length > 0) {
                        initialMessages = parsed;
                    }
                } catch (e) {
                    console.warn(`Failed to read old chat.json for notebook ${notebookId}:`, e);
                }
            }

            const initialTitle = initialMessages.length > 0
                ? (initialMessages[0].text.slice(0, 25).trim() || 'メインセッション')
                : '新規セッション 1';
            
            const newSession = await this.createChatSession(notebookId, initialTitle, initialMessages);
            sessions.push({
                id: newSession.id,
                title: newSession.title,
                createdAt: newSession.createdAt,
                updatedAt: newSession.updatedAt,
                messageCount: newSession.messages.length
            });
        }

        return sessions.sort((a, b) => new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime());
    }

    /**
     * 特定セッションの会話データを取得
     */
    async getChatSession(notebookId: string, sessionId: string): Promise<ChatSession | null> {
        const filePath = normalizePath(`${this.settings.rootDir}/notebooks/${notebookId}/sessions/${sessionId}.json`);
        const file = this.app.vault.getAbstractFileByPath(filePath);
        if (file instanceof TFile) {
            try {
                const content = await this.app.vault.read(file);
                return JSON.parse(content);
            } catch (e) {
                console.error(`Failed to read chat session ${sessionId} for notebook ${notebookId}:`, e);
            }
        }
        return null;
    }

    /**
     * チャットセッションの保存
     */
    async saveChatSession(notebookId: string, session: ChatSession): Promise<void> {
        const sessionsDir = normalizePath(`${this.settings.rootDir}/notebooks/${notebookId}/sessions`);
        await this.ensureFolder(sessionsDir);

        session.updatedAt = new Date().toISOString();
        const filePath = normalizePath(`${sessionsDir}/${session.id}.json`);
        const content = JSON.stringify(session, null, 2);

        const existing = this.app.vault.getAbstractFileByPath(filePath);
        if (existing instanceof TFile) {
            await this.app.vault.modify(existing, content);
        } else {
            await this.app.vault.create(filePath, content);
        }
    }

    /**
     * 新規チャットセッションの作成
     */
    async createChatSession(notebookId: string, title?: string, initialMessages: ChatMessage[] = []): Promise<ChatSession> {
        const sessionsDir = normalizePath(`${this.settings.rootDir}/notebooks/${notebookId}/sessions`);
        await this.ensureFolder(sessionsDir);

        const id = `session_${this.generateNotebookId()}`;
        const now = new Date().toISOString();
        const session: ChatSession = {
            id,
            title: title?.trim() || '新規チャット',
            createdAt: now,
            updatedAt: now,
            messages: initialMessages
        };

        const filePath = normalizePath(`${sessionsDir}/${id}.json`);
        await this.app.vault.create(filePath, JSON.stringify(session, null, 2));

        return session;
    }

    /**
     * チャットセッションの削除
     */
    async deleteChatSession(notebookId: string, sessionId: string): Promise<void> {
        const filePath = normalizePath(`${this.settings.rootDir}/notebooks/${notebookId}/sessions/${sessionId}.json`);
        const file = this.app.vault.getAbstractFileByPath(filePath);
        if (file instanceof TFile) {
            await this.app.vault.delete(file);
        }
    }

    /**
     * チャットセッションタイトルの更新
     */
    async updateChatSessionTitle(notebookId: string, sessionId: string, newTitle: string): Promise<void> {
        const session = await this.getChatSession(notebookId, sessionId);
        if (session) {
            session.title = newTitle.trim() || '無題のセッション';
            await this.saveChatSession(notebookId, session);
        }
    }

    /**
     * チャット履歴の取得（後方互換用）
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
     * チャット履歴の保存（後方互換用）
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

    /**
     * ノートブックに Mattermost チャンネルをバインドし、初回ログ Markdown を sources/ に保存
     */
    async bindMattermostChannel(
        notebookId: string,
        channel: MattermostChannelRef,
        initialMarkdown: string
    ): Promise<TFile> {
        const metadata = await this.getNotebookMetadata(notebookId);
        if (!metadata) {
            throw new Error(`ノートブックが見つかりません: ${notebookId}`);
        }

        const safeChannelName = (channel.channelName || 'channel').replace(/[^a-zA-Z0-9_\-]/g, '_');
        const fileName = channel.sourceFileName || `mattermost_${safeChannelName}.md`;
        const sourcesDir = normalizePath(`${this.settings.rootDir}/notebooks/${notebookId}/sources`);
        await this.ensureFolder(sourcesDir);

        const filePath = normalizePath(`${sourcesDir}/${fileName}`);
        const existing = this.app.vault.getAbstractFileByPath(filePath);
        let resultFile: TFile;
        if (existing instanceof TFile) {
            await this.app.vault.modify(existing, initialMarkdown);
            resultFile = existing;
        } else {
            resultFile = await this.app.vault.create(filePath, initialMarkdown);
        }

        // メタデータのバインドリストを更新
        const currentChannels = metadata.boundMmChannels || [];
        const updatedRef: MattermostChannelRef = {
            ...channel,
            sourceFileName: fileName,
            lastSyncedAt: channel.lastSyncedAt || new Date().toISOString()
        };

        const nextChannels = currentChannels.filter(c => c.channelId !== channel.channelId);
        nextChannels.push(updatedRef);

        await this.updateNotebookMetadata(notebookId, {
            boundMmChannels: nextChannels
        });

        return resultFile;
    }

    /**
     * ノートブックから Mattermost チャンネルのバインドを解除
     */
    async unbindMattermostChannel(notebookId: string, channelId: string): Promise<void> {
        const metadata = await this.getNotebookMetadata(notebookId);
        if (!metadata) return;

        const currentChannels = metadata.boundMmChannels || [];
        const nextChannels = currentChannels.filter(c => c.channelId !== channelId);

        await this.updateNotebookMetadata(notebookId, {
            boundMmChannels: nextChannels
        });
    }

    /**
     * Mattermost 差分ログを sources/<file> に追記し、メタデータの同期時刻を更新（追いつき同期）
     */
    async appendMattermostDiff(
        notebookId: string,
        channelId: string,
        diffMarkdown: string,
        latestPostId?: string,
        latestCreateAt?: number
    ): Promise<void> {
        const metadata = await this.getNotebookMetadata(notebookId);
        if (!metadata) throw new Error(`ノートブックが見つかりません: ${notebookId}`);

        const currentChannels = metadata.boundMmChannels || [];
        const ch = currentChannels.find(c => c.channelId === channelId);
        if (!ch) throw new Error(`対象チャンネルがバインドされていません: ${channelId}`);

        const fileName = ch.sourceFileName || `mattermost_${ch.channelName}.md`;
        const sourcesDir = normalizePath(`${this.settings.rootDir}/notebooks/${notebookId}/sources`);
        const filePath = normalizePath(`${sourcesDir}/${fileName}`);
        const file = this.app.vault.getAbstractFileByPath(filePath);

        if (file instanceof TFile) {
            const currentContent = await this.app.vault.read(file);
            const newContent = currentContent + diffMarkdown;
            await this.app.vault.modify(file, newContent);
        } else {
            await this.app.vault.create(filePath, diffMarkdown);
        }

        // メタデータ更新
        const updatedChannels = currentChannels.map(c => {
            if (c.channelId === channelId) {
                return {
                    ...c,
                    lastSyncedPostId: latestPostId || c.lastSyncedPostId,
                    lastSyncedAt: latestCreateAt ? new Date(latestCreateAt).toISOString() : new Date().toISOString()
                };
            }
            return c;
        });

        await this.updateNotebookMetadata(notebookId, {
            boundMmChannels: updatedChannels
        });
    }

    /**
     * Mattermost 検索結果ログを sources/ に独立保存
     */
    async addMattermostSearchSource(notebookId: string, query: string, markdown: string): Promise<TFile> {
        const safeQuery = query.replace(/[^a-zA-Z0-9_\-\u3040-\u30ff\u3400-\u4dbf\u4e00-\u9fff]/g, '_').slice(0, 30);
        const fileName = `mattermost_search_${safeQuery}_${Date.now()}.md`;
        const sourcesDir = normalizePath(`${this.settings.rootDir}/notebooks/${notebookId}/sources`);
        await this.ensureFolder(sourcesDir);

        const filePath = normalizePath(`${sourcesDir}/${fileName}`);
        return await this.app.vault.create(filePath, markdown);
    }

    /**
     * 全ノートブックで過去にバインドされたチャンネル一覧を収集（再利用用）
     */
    async getAllBoundMattermostChannels(): Promise<{ channel: MattermostChannelRef; notebookTitle: string; notebookId: string }[]> {
        const allNotebooks = await this.getAllNotebooks();
        const results: { channel: MattermostChannelRef; notebookTitle: string; notebookId: string }[] = [];
        const seen = new Set<string>();

        for (const nb of allNotebooks) {
            if (nb.boundMmChannels && nb.boundMmChannels.length > 0) {
                for (const ch of nb.boundMmChannels) {
                    const key = `${nb.id}:${ch.channelId}`;
                    if (!seen.has(key)) {
                        seen.add(key);
                        results.push({
                            channel: ch,
                            notebookTitle: nb.title,
                            notebookId: nb.id
                        });
                    }
                }
            }
        }
        return results;
    }
}

