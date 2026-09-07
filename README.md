# Obsidian AI Notebook

NotebookLM-style AI Notebook workspace for Obsidian with local CLI Agent support (Antigravity / Claude Code).

Google NotebookLM のようなコンテキスト駆動型ワークスペース体験を Obsidian 上で再現・拡張するプラグインです。

---

## 主な機能

- **ノートブックギャラリービュー**: NotebookLM 風のカード型ギャラリーUIで複数のノートブックを一覧・管理。
- **3カラムワークスペース**:
  - **左（ソース/Inputs）**: テキスト、画像、PPTX、PDF などをドラッグ＆ドロップで投入。
  - **中央（AIチャット）**: 投入ソースをコンテキストとしたローカル AI エージェントとの対話。
  - **右（成果物/Artifacts）**: 生成されたレポート・要約・メモをカード一覧表示＆ポップアップモーダルで閲覧・編集。
- **AI CLI エージェント連携**:
  - **Antigravity CLI (`agy`)** / **Claude Code CLI (`claude`)** を設定から切り替え可能。
  - **会話の継続**: CLI 側の会話セッションを `--resume` で引き継ぐため、履歴を毎回プロンプトに詰め直しません。
- **ノートブックフォルダ = CLI プロジェクト**:
  - 各ノートブックに `CLAUDE.md` / `AGENTS.md` を自動生成。ターミナルからそのフォルダで素の `claude` を実行しても同じ文脈で動きます。
  - `NOTEBOOK.md` にそのノートブック固有の指示や作業の進め方を書き溜められます（自動生成では上書きされません）。既定では「まず構成案を出してレビューを受けてから作成する」方針が入っています。

---

## インストール方法

### 方法 1: BRAT プラグインを使用（推奨）
1. Obsidian プラグイン [BRAT (Beta Reviewers Auto-update Tester)](https://github.com/TfTHacker/obsidian42-brat) をインストールして有効化します。
2. コマンドパレットから `BRAT: Add a beta plugin for testing` を選択します。
3. リポジトリのURL `https://github.com/hatomachi/obsidian-ai-notebook` を入力して追加します。

### 方法 2: GitHub Releases から手動インストール
1. [GitHub Releases](https://github.com/hatomachi/obsidian-ai-notebook/releases) から最新の `main.js`, `manifest.json`, `styles.css` をダウンロードします。
2. Obsidian Vault の `.obsidian/plugins/obsidian-ai-notebook/` ディレクトリを作成し、上記3ファイルを配置します。
3. Obsidian の設定 > コミュニティプラグイン で再読み込みし、`Obsidian AI Notebook` を有効化します。

## 開発・ビルド

```bash
# 依存関係のインストール
npm install

# Obsidian プラグインビルド
npm run build

# 開発モード (ファイル変更を監視して自動ビルド)
npm run dev

# 単体テスト実行
npm test

# モバイル Web SPA ビューアのビルド (Nginx配信用: dist/ に出力)
npm run build:web

# Web SPA ローカルプレビュー
npm run preview:web
```

---

## モバイル Web SPA ビューア (会社スマホ / Edge対応)

GitLab に同期した `_ainotebook` フォルダ配下のデータを、会社のスマートフォン（Edge ブラウザ等）から閲覧するための静的 SPA ビューアを同梱しています。

1. **ビルド**:
   ```bash
   npm run build:web
   ```
   `dist/` ディレクトリに完全な静的 HTML/JS/CSS（Vanilla TS、約70KBの超軽量バンドル）が出力されます。
2. **Nginx での静的ホスト**:
   任意のパス（ルート `/` またはサブパス `/ainotebook/` 等）に `dist/` 配下のファイルを配置して Nginx でホストします。
3. **GitLab 連携設定**:
   - 画面右上の ⚙️ アイコンから、社内 GitLab の URL（または ALB リバースプロキシ）、Project ID、Branch、PAT（Personal Access Token）を設定します。
   - トークンは端末の `localStorage` にのみ安全に保存され、GitLab REST API 経由で直接 `_ainotebook/` 配下のノートブック一覧、成果物、ソース、チャット履歴を取得・閲覧できます。

---

## ライセンス

MIT License
