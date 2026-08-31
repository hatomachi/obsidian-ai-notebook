# Design Document: Obsidian AI Notebook Plugin
## ナレッジ再帰育成型アーキテクチャ (Recursive Knowledge Ecosystem)

## 1. 概要 (Overview)
`Obsidian AI Notebook` は、Google NotebookLM の直感的なコンテキスト駆動型ワークスペース体験と、Antigravity 2.0 / Claude Code のプロジェクトフォルダ型ファイル育成モデルを融合させた Obsidian プラグインです。
ユーザーは「ノートブック」という単位で特定のテーマ・プロジェクトに関するインプット（直ファイル・参照ノート）を集約し、ローカルAIエージェント（Antigravity CLI / Claude Code CLI）と対話しながら、成果物を生成・管理します。
さらに、生成された成果物は他の新しいタスクのコンテキスト（仕様・ルール・few-shot サンプル）としてシームレスに再利用・育成されます。

詳細な思想的背景については [concept.md](concept.md) を参照してください。

---

## 2. コア概念 & データ構造 (Core Architecture & Data Structure)

### 2.1 データフォルダ構造
全ノートブックデータは Obsidian Vault 内の専用ルートフォルダ（デフォルト: `_ainotebook/`）配下で一元管理されます。

```
<Vault_Root>/
└── _ainotebook/
    ├── index/
    │   ├── 20260831_sys_apigw.md       # APIGW 仕様ノートのメタデータ
    │   ├── 20260831_tpl_release.md     # リリース計画書仕様ノートのメタデータ
    │   └── 20260831_task_rel09.md      # 9月度リリース計画書タスクのメタデータ
    └── notebooks/
        ├── 20260831_sys_apigw/         # システム知識・クセ育成ノート
        │   ├── sources/                # 投入された元資料・設定メモ等
        │   ├── artifacts/              # 成果物: アーキ概要.md, 運用注意点.md
        │   └── chat.json
        ├── 20260831_tpl_release/       # ドキュメント仕様・ルール育成ノート
        │   ├── sources/
        │   ├── artifacts/              # 成果物: 作成ルール.md, few-shotサンプル.md
        │   └── chat.json
        └── 20260831_task_rel09/        # 実践タスクノート
            ├── sources/                # 今回固有のファイル (PR差分、会議メモ)
            ├── artifacts/              # 今回生成された成果物 (2026-09リリース計画書.md)
            └── chat.json
```

### 2.2 ID 命名規則 & Metadate Index
- **ID 形式**: 衝突防止のため `YYYYMMDD_random6char`（例: `20260831_a8f9x`）
- **Index ノート (`_ainotebook/index/<ID>.md`)**:
  ```markdown
  ---
  notebook_id: "20260831_task_rel09"
  title: "2026-09 APIGW リリース計画書作成"
  created_at: "2026-08-31T17:00:00+09:00"
  updated_at: "2026-08-31T17:00:00+09:00"
  tags: [release, apigw, task]
  icon: "rocket"
  description: "2026年9月度 APIGW 本番リリース計画書の作成タスク"
  linked_notebook_ids:
    - "20260831_sys_apigw"
    - "20260831_tpl_release"
  ---
  # 2026-09 APIGW リリース計画書作成

  ここにノートブック全体の自由メモやタスク概要を記載可能。
  ```

---

## 3. 画面構成 & UI/UX (UI Layout & Interaction)

プラグインは Obsidian のメインワークスペース（Main Panel / Center Leaf）で大画面表示されます。

### 3.1 ギャラリービュー (`AINotebookGalleryView`)
- **ヘッダー**: タイトル、検索・フィルターバー、新規ノートブック作成ボタン
- **ギャラリーエリア**: カードグリッド表示
  - 各カード: タイトル、説明、最終更新日、ソース件数、リンク件数、成果物件数、カバー/アイコン
  - カードクリック: 対象ノートブックの詳細ビューを開く

### 3.2 ノートブック詳細ビュー (`AINotebookDetailView`)
3カラムレスポンシブレイアウト。

```
+-----------------------------------------------------------------------------------+
|  < ギャラリーへ戻る   |  2026-09 APIGW リリース計画書作成            [Antigravity CLI] |
+-------------------+-----------------------------------+---------------------------+
| [コンテキストパネル]| [チャットパネル]                  | [成果物パネル]            |
|                   |                                   |                           |
| 🔗 参照ノートブック    | User: 今回のPR差分から計画書を    | - 新規メモ作成ボタン      |
|  ├ 📘 APIGW 仕様  |       作って。                    | 📄 2026-09_APIGW_計画書.md|
|  └ 📋 リリース仕様| AI  : APIGWのクセとサンプルの     |                           |
|   [+ 参照ノート追加]|       章立てを踏まえて作成しました|                           |
|                   |       ```markdown:...             |                           |
| 📂 直接ファイル   |                                   |                           |
|  ├ pr_diff.patch  |                                   |                           |
|  └ memo.txt       | [ メッセージを入力...     (送信) ]| (クリックでポップアップ表示)|
|   [+ ファイル追加]|                                   |                           |
+-------------------+-----------------------------------+---------------------------+
```

1. **左カラム (Context & Source Panel)**:
   - **参照ノートブックセクション (Linked Notebooks)**: 既存の他ノートブックを複数選択してリンク。リンク解除や対象ノートブックへの即時ジャンプが可能。
   - **直接ファイルセクション (Direct Files)**: D&Dおよびファイル選択による固有ファイルの投入。
2. **中央カラム (Chat Panel)**:
   - スレッド表示形式のメッセージUI。
   - 直接投入されたファイル群に加え、**リンクされた全ノートブックの成果物（`artifacts/`）** をコンテキストとして自動展開・マウント。
3. **右カラム (Artifact Panel)**:
   - `artifacts/` フォルダ内の成果物をカード表示。
   - カードクリックでポップアップモーダルを開き、Markdownプレビュー & 編集が可能。

---

## 4. AI エージェント抽象化構造 (Agent Adapter Architecture)

Antigravity CLI / Claude Code CLI 等の各種CLIツールと連携。

```typescript
export interface LinkedContext {
    notebookId: string;
    notebookTitle: string;
    artifacts: { name: string; content: string }[];
}

export interface AgentOptions {
    contextDir: string;        // 当該ノートブック sources/ フォルダの絶対パス
    outputDir: string;         // 当該ノートブック artifacts/ フォルダの絶対パス
    commandPath: string;       // agy / claude の実行パス
    directFiles: { name: string; content: string }[];
    linkedContexts: LinkedContext[];
}

export interface AgentResult {
    text: string;
    artifactsCreated?: string[];
}

export interface AIAgentAdapter {
    id: string;
    name: string;
    executePrompt(prompt: string, options: AgentOptions): Promise<AgentResult>;
}
```

---

## 5. 段階的開発計画 (Phased Implementation Plan)

- **Phase 1**: コンセプト・設計仕様・AGENTS.md・タスク管理の整備 (Done)
- **Phase 2**: データモデル拡張 (`linked_notebook_ids` 対応) & 初期サンプルNotebookの移行
- **Phase 3**: AgentAdapter コンテキスト動的展開エンジンの刷新
- **Phase 4**: 3カラム UI（参照ノートブック選択・リンク・ジャンプ）の実装
- **Phase 5**: 検証用 Vault での動作検証・ビルド確認・ドキュメント作成

