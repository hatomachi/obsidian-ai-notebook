import { NotebookMetadata, ChatSession } from '../../types';
import { IViewerAdapter, NotebookDetailData, ViewerArtifact, ViewerSource } from './GitLabViewerAdapter';

export class MockViewerAdapter implements IViewerAdapter {
    private mockNotebooks: NotebookMetadata[] = [
        {
            id: '20260831_task_rel09',
            title: '2026-09 APIGW リリース計画書作成',
            createdAt: '2026-08-31T17:00:00+09:00',
            updatedAt: '2026-09-01T10:30:00+09:00',
            tags: ['release', 'apigw', 'task'],
            icon: 'rocket',
            description: '2026年9月度 APIGW 本番リリース計画書の作成タスク。APIGWのクセとリリース仕様を踏まえて成果物を生成。',
            linkedNotebookIds: ['20260831_sys_apigw', '20260831_tpl_release'],
            activeSessionId: 'session_draft',
        },
        {
            id: '20260831_sys_apigw',
            title: '📘 APIGW システム仕様・クセ',
            createdAt: '2026-08-31T10:00:00+09:00',
            updatedAt: '2026-08-31T15:00:00+09:00',
            tags: ['system', 'apigw', 'spec'],
            icon: 'server',
            description: '部内APIGW基盤のアーキテクチャ特性、認証フロー、およびデプロイ時の運用注意点。',
            linkedNotebookIds: [],
        },
        {
            id: '20260831_tpl_release',
            title: '📋 リリース計画書 デザイン仕様',
            createdAt: '2026-08-31T11:00:00+09:00',
            updatedAt: '2026-08-31T16:00:00+09:00',
            tags: ['template', 'release', 'rule'],
            icon: 'file-text',
            description: 'リリース計画書の必須記載項目、ロールバック基準、事前・事後チェックリストの標準フォーマット。',
            linkedNotebookIds: [],
        },
    ];

    private mockSessions: Record<string, ChatSession[]> = {
        '20260831_task_rel09': [
            {
                id: 'session_draft',
                title: 'ドラフト作成セッション',
                createdAt: '2026-08-31T17:05:00+09:00',
                updatedAt: '2026-08-31T17:15:00+09:00',
                messages: [
                    {
                        id: 'msg_1',
                        sender: 'user',
                        text: '投入したPR差分と、参照しているAPIGWシステム仕様・リリース計画書仕様を前提に、9月定期リリースの計画書ドラフトを作成してください。',
                        timestamp: '2026-08-31T17:05:12+09:00',
                    },
                    {
                        id: 'msg_2',
                        sender: 'agent',
                        text: '承知いたしました。参照ノート `📘 APIGW システム仕様・クセ` に記載されている「Blue/Green切り替え時のセッション維持要件」および `📋 リリース計画書 デザイン仕様` の章立てに従い、`2026-09_APIGW_リリース計画書.md` を作成しました。成果物タブからご確認ください。',
                        timestamp: '2026-08-31T17:06:05+09:00',
                        artifactsGenerated: ['2026-09_APIGW_リリース計画書.md'],
                    },
                ],
            },
        ],
    };

    private mockArtifacts: Record<string, ViewerArtifact[]> = {
        '20260831_task_rel09': [
            {
                name: '2026-09_APIGW_リリース計画書.md',
                path: '_ainotebook/notebooks/20260831_task_rel09/artifacts/2026-09_APIGW_リリース計画書.md',
                size: 2450,
                updatedAt: '2026-08-31T17:06:05+09:00',
            },
        ],
        '20260831_sys_apigw': [
            {
                name: 'APIGW_アーキテクチャ特性.md',
                path: '_ainotebook/notebooks/20260831_sys_apigw/artifacts/APIGW_アーキテクチャ特性.md',
                size: 1820,
            },
            {
                name: 'デプロイ時注意点_セッション維持.md',
                path: '_ainotebook/notebooks/20260831_sys_apigw/artifacts/デプロイ時注意点_セッション維持.md',
                size: 1340,
            },
        ],
        '20260831_tpl_release': [
            {
                name: 'リリース計画書_標準章立て.md',
                path: '_ainotebook/notebooks/20260831_tpl_release/artifacts/リリース計画書_標準章立て.md',
                size: 1560,
            },
        ],
    };

    private mockSources: Record<string, ViewerSource[]> = {
        '20260831_task_rel09': [
            {
                name: 'pr_diff_v2.patch',
                path: '_ainotebook/notebooks/20260831_task_rel09/sources/pr_diff_v2.patch',
                size: 8400,
                extension: 'patch',
            },
            {
                name: 'meeting_notes_20260830.md',
                path: '_ainotebook/notebooks/20260831_task_rel09/sources/meeting_notes_20260830.md',
                size: 1200,
                extension: 'md',
            },
        ],
    };

    private mockContents: Record<string, string> = {
        '_ainotebook/notebooks/20260831_task_rel09/artifacts/2026-09_APIGW_リリース計画書.md': `# 2026-09 APIGW 本番リリース計画書

## 1. リリース概要
- **対象システム**: 部内 APIGW 基盤
- **リリース予定日時**: 2026-09-15 22:00 〜 23:30 (JST)
- **リリース種別**: 定期機能追加・不具合改修 (Blue/Green デプロイ)
- **責任者**: 碇 (Lead Engineer)

## 2. 変更内容まとめ
- JWT トークン検証キャッシュの TTL 最適化 (PR #142)
- レスポンスヘッダーへの Request-ID 自動付与
- ヘルスチェックエンドポイントのタイムアウト値調整 (3s -> 1s)

## 3. 事前確認事項 & 運用制約
> [!IMPORTANT]
> **Blue/Green 切り替え時のセッション維持**
> 切り替え時に既存の長寿命コネクションが即座に切断されないよう、ドレインタイム（60秒）を必ず確保すること。

## 4. 作業タイムライン
| 時刻 | 作業項目 | 担当 | 確認内容 |
| :--- | :--- | :--- | :--- |
| 22:00 | リリース前ヘルスチェック | 碇 | 既存Green系正常性 |
| 22:15 | Blue系へ新バージョン配備 | AI Agent | コンテナ起動確認 |
| 22:45 | ステージング疎通テスト | 碇 | 主要API 200 OK |
| 23:00 | トラフィック切り替え (ALB) | 碇 | Blueへ50% -> 100% |
| 23:15 | 事後検証 & ドレイン監視 | 碇 | エラーレート 0% 確認 |
| 23:30 | リリース完了判定 | 全員 | レビュー完了 |

## 5. ロールバック手順
切り替え後、5xx エラーが 1% を超えるか主要認証APIに異常が検知された場合、ALB ルーティングを Green 系へ即時 100% 巻き戻す。
`,
    };

    async getNotebooks(): Promise<NotebookMetadata[]> {
        return this.mockNotebooks;
    }

    async getNotebookDetail(notebookId: string): Promise<NotebookDetailData> {
        const metadata = this.mockNotebooks.find((n) => n.id === notebookId) || {
            id: notebookId,
            title: notebookId,
            createdAt: '',
            updatedAt: '',
            tags: [],
            icon: 'book-open',
            description: '',
        };

        return {
            metadata,
            memo: metadata.description,
            artifacts: this.mockArtifacts[notebookId] || [],
            sources: this.mockSources[notebookId] || [],
            sessions: this.mockSessions[notebookId] || [],
            activeSessionId: metadata.activeSessionId,
        };
    }

    async getFileContent(path: string): Promise<string> {
        if (this.mockContents[path]) {
            return this.mockContents[path];
        }
        return `# ${path.split('/').pop()}\n\n（このファイルの内容はローカルモック環境用のサンプルです）`;
    }

    async testConnection(): Promise<{ success: boolean; message: string; projectName?: string }> {
        return {
            success: true,
            message: 'Local モックモードで動作中（ネットワーク通信は行われません）',
            projectName: 'Local Mock Environment',
        };
    }
}
