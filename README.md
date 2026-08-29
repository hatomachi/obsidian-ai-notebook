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

---

## 開発・ビルド

```bash
# 依存関係のインストール
npm install

# ビルド
npm run build

# 開発モード (ファイル変更を監視して自動ビルド)
npm run dev
```

---

## ライセンス

MIT License
