# Design Document: Obsidian AI Notebook Plugin

## 1. 概要 (Overview)
`Obsidian AI Notebook` は、Google NotebookLM の直感的なコンテキスト駆動型ワークスペース体験を Obsidian 上で再現・拡張するカスタムプラグインです。
ユーザーは「ノートブック」という単位で特定のテーマやプロジェクトに関する多様なインプットソース（テキスト、画像、PPTX、PDFなど）を集約し、ローカルAIエージェント（Antigravity CLI / Claude Code CLI）と対話しながら、レポートやメモなどの成果物を生成・管理できます。

---

## 2. コア概念 & データ構造 (Core Architecture & Data Structure)

### 2.1 データフォルダ構造
全ノートブックデータは Obsidian Vault 内の専用ルートフォルダ（デフォルト: `_ainotebook/`）配下で管理されます。

```
<Vault_Root>/
└── _ainotebook/
    ├── index/
    │   ├── 20260822_a8f9x.md   # ノートブックのメタデータ管理用 Index Markdown
    │   └── 20260822_k3m2p.md
    └── notebooks/
        ├── 20260822_a8f9x/
        │   ├── sources/        # D&D等で追加されたソースファイル群
        │   ├── artifacts/      # AIまたは手動で作成された成果物 (Markdown等)
        │   └── chat.json       # チャット履歴データ
        └── 20260822_k3m2p/
            ├── sources/
            ├── artifacts/
            └── chat.json
```

### 2.2 ID 命名規則 & Metadate Index
- **ID 形式**: 衝突防止のため `YYYYMMDD_random6char`（例: `20260822_a8f9x`）
- **Index ノート (`_ainotebook/index/<ID>.md`)**:
  ```markdown
  ---
  notebook_id: "20260822_a8f9x"
  title: "AI Notebook プラグイン設計"
  created_at: "2026-08-22T22:00:00+09:00"
  updated_at: "2026-08-22T22:00:00+09:00"
  tags: [plugin, design, ai]
  icon: "book-open"
  description: "NotebookLMライクなObsidianプラグインの基本設計"
  ---
  # AI Notebook プラグイン設計

  ここにノートブック全体の自由メモや説明を記載可能。
  ```

---

## 3. 画面構成 & UI/UX (UI Layout & Interaction)

プラグインは Obsidian のメインワークスペース（Main Panel / Center Leaf）で大画面表示されます。

### 3.1 ギャラリービュー (`AINotebookGalleryView`)
- **ヘッダー**: タイトル、検索・フィルターバー、新規ノートブック作成ボタン
- **ギャラリーエリア**: カードグリッド表示
  - 各カード: タイトル、説明、最終更新日、ソース件数、成果物件数、カバー/アイコン
  - カードクリック: 対象ノートブックの詳細ビューを開く

### 3.2 ノートブック詳細ビュー (`AINotebookDetailView`)
3カラムレスポンシブレイアウト。

```
+-----------------------------------------------------------------------------------+
|  < ギャラリーへ戻る   |  ノートブックタイトル : AI Notebook 設計           [設定]  |
+-------------------+-----------------------------------+---------------------------+
| [ソースパネル]    | [チャットパネル]                  | [成果物パネル]            |
| - D&D Drop Zone   |                                   | - 新規メモ作成ボタン      |
| - ソースファイル一覧 | User: この資料から要約を作って     | - 生成レポート 1          |
|   ├ doc1.pdf      | AI  : 以下のポイントにまとめました | - 生成サマリー 2          |
|   ├ slide.pptx    |       [成果物として保存]          | - アイデアメモ 3          |
|   └ image.png     |                                   |                           |
|                   | [ メッセージを入力...     (送信) ]| (クリックでポップアップ表示)|
+-------------------+-----------------------------------+---------------------------+
```

1. **左カラム (Source Panel)**:
   - ドラッグ＆ドロップターゲットエリア。テキスト、画像、PPTX、PDF等のあらゆる形式のファイルに対応。
   - 投入されたファイルは Vault 内の `_ainotebook/notebooks/<ID>/sources/` へコピー保存。
   - ファイルクリックでObsidian内プレビュー。
2. **中央カラム (Chat Panel)**:
   - スレッド表示形式のメッセージUI。
   - ユーザー入力 & AIストリーミングレスポンス。
   - コンテキストとして `sources/` 内の全ファイルを指定。
3. **右カラム (Artifact Panel)**:
   - `artifacts/` フォルダ内の成果物（メモ、分析レポート、マインドマップ等）をカード表示。
   - カードクリックでポップアップモーダルを開き、Markdownプレビュー & 編集が可能。

---

## 4. AI エージェント抽象化構造 (Agent Adapter Architecture)

多様なCLI環境（開発環境: `antigravity` / 会社環境: `claude` (claude-code)）に対応するため、アダプターパターンを採用。

```typescript
export interface AgentOptions {
    contextDir: string;        // sources/ フォルダの絶対パス
    outputDir: string;         // artifacts/ フォルダの絶対パス
    model?: string;
    systemPrompt?: string;
}

export interface AgentStreamChunk {
    type: 'text' | 'artifact_created' | 'error';
    content: string;
    metadata?: any;
}

export interface AIAgentAdapter {
    id: string;
    name: string;
    isAvailable(): Promise<boolean>;
    executePrompt(
        prompt: string,
        options: AgentOptions,
        onChunk: (chunk: AgentStreamChunk) => void
    ): Promise<void>;
}
```

### アダプター実装:
- **`AntigravityCliAdapter`**: `antigravity` CLI を Node.js `child_process.spawn` で起動。コンテキストフォルダとして `sources/` を渡す。
- **`ClaudeCodeAdapter`**: `claude` (Claude Code CLI) を同様に呼び出し。

---

## 5. 段階的開発計画 (Phased Implementation Plan)

- **Phase 1**: プロジェクト環境構築、設定画面、データ管理クラス (`NotebookManager`) の実装
- **Phase 2**: ギャラリービュー (`AINotebookGalleryView`) の構築とノートブック作成フロー
- **Phase 3**: 3カラム ノートブック詳細ビュー（ソースD&D・成果物モーダル表示）の実装
- **Phase 4**: Agent Adapter基盤と Antigravity CLI によるチャット・成果物生成機能の実装
- **Phase 5**: デザインブラッシュアップ、UI polish、動作検証・ドキュメント作成
