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
        │   ├── sessions/               # チャットセッション群
        │   │   └── session_01.json
        │   └── chat.json               # （旧形式互換）
        ├── 20260831_tpl_release/       # ドキュメント仕様・ルール育成ノート
        │   ├── sources/
        │   ├── artifacts/              # 成果物: 作成ルール.md, few-shotサンプル.md
        │   ├── sessions/
        │   └── chat.json
        └── 20260831_task_rel09/        # 実践タスクノート
            ├── sources/                # 今回固有のファイル (PR差分、会議メモ)
            ├── artifacts/              # 今回生成された成果物 (2026-09リリース計画書.md)
            ├── sessions/
            │   ├── session_draft.json  # ドラフト作成セッション
            │   └── session_review.json # レビュー・修正セッション
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
  active_session_id: "session_20260831_draft"
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
| [コンテキストパネル]| [💬 AI チャット] [💬ドラフト ▼][+新規]| [成果物パネル]            |
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
   - **マルチチャットセッション対応**: 過去セッションの選択・切り替え、新規セッションの作成（+）、リネーム・削除。
   - スレッド表示形式のメッセージUI（MarkdownRenderer + コピー機能）。
   - 直接投入されたファイル群に加え、**リンクされた全ノートブックの成果物（`artifacts/`）** および直近の会話履歴をプロンプトに統合展開。
3. **右カラム (Artifact Panel)**:
   - `artifacts/` フォルダ内の成果物をカード表示。
   - カードクリックでポップアップモーダルを開き、Markdownプレビュー & 編集が可能。

---

## 4. AI エージェント抽象化構造 (Agent Adapter Architecture)

Antigravity CLI / Claude Code CLI 等の各種自律エージェントCLIツールと連携。
ノートブックルートを作業ディレクトリ（`cwd`）としてエージェントに渡し、`artifacts/` 配下の成果物を直接作成・部分編集（Write/Edit）させます。

```typescript
export interface LinkedContext {
    notebookId: string;
    notebookTitle: string;
    description: string;
    artifacts: { name: string; title: string; path: string; content: string }[];
}

export interface AgentOptions {
    notebookDir: string;       // 当該ノートブックルートの絶対パス (CLI cwd)
    sourcesDir: string;        // 当該ノートブック sources/ フォルダの絶対パス
    artifactsDir: string;      // 当該ノートブック artifacts/ フォルダの絶対パス
    commandPath: string;       // agy / claude の実行パス
    maxTurns?: number;         // ターン上限（暴走防止）
    linkedContexts?: LinkedContext[];
    chatHistory?: ChatMessage[]; // 直近の対話履歴（マルチターン文脈）
    onStdoutChunk?: (chunk: string) => void; // ストリーミングコールバック
    abortSignal?: AbortSignal;               // キャンセル用シグナル
}

export interface AgentResult {
    text: string;
    artifactsCreated?: string[];
    artifactsModified?: string[];
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
- **Phase 2**: データモデル拡張 (`linked_notebook_ids` 対応) & ナレッジ再帰育成アーキテクチャ (Done)
- **Phase 3**: エージェント直接編集モデルへの移行 (Done)
  - CLI `cwd` のノートブックルート化と自動編集権限付与 (`--permission-mode acceptEdits` / `--mode accept-edits`)
  - 成果物の段階的作成・部分修正および mtime による編集競合防止ガード
  - レビュー成果物（`review_*.md`）フローと識別表示
  - イベントログ駆動型生成来歴 (Provenance) 記録
  - `spawn` による stdout ストリーミング & 中止（キャンセル）機能
- **Phase 4**: チーム展開・高度な目録管理 (Future Scope)

