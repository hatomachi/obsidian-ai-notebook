# AGENTS.md - Obsidian AI Notebook Workspace Rules

## 核心設計思想 & ドキュメント参照 (Core Concepts)

本プロジェクトの開発・機能拡張を行う際は、必ず以下の設計書およびコンセプト定義を参照・遵守してください。

1. **[設計コンセプト & アーキテクチャ思想 (concept.md)](file:///Users/s-ikari/work/obsidian-ai-notebook/concept.md)**:
   - **ナレッジ再帰育成型エコシステム (Recursive Knowledge Ecosystem)** の定義
   - Antigravity 2.0 / プロジェクトフォルダ型ナレッジ管理思想（すべての Notebook が対等なワークスペースであり、成果物が次のタスクのコンテキストになる）
   - Linked Context モデル（物理コピーではなく参照リンクによる動的コンテキスト結合）
2. **[設計仕様書 (design-doc.md)](file:///Users/s-ikari/work/obsidian-ai-notebook/design-doc.md)**:
   - データ構造・ID命名規則・3カラムUI/UX・Agent Adapterの抽象化設計
3. **[タスク管理チケット (TASK-021.md)](file:///Users/s-ikari/work/project/task-management/tickets/TASK-021.md)**:
   - 全体タスク・進捗状況

3. **[エージェント実行モデル (design-doc.md 第4章)](file:///Users/s-ikari/work/obsidian-ai-notebook/design-doc.md)**:
   - 薄いラッパー原則、`--permission-mode` / `--resume` / `stream-json` の使い方、**過去に撤去したアンチパターン一覧**

---

## 最重要ルール: エージェントの振る舞いを設計しない (Thin Wrapper Principle)

本プラグインは CLI エージェント（Claude Code / Antigravity CLI）の判断に介入しません。以下は**実装してはいけません**。過去にすべて実装し、実害が出たため撤去済みです。

- 行動規範をシステムプロンプト（`--append-system-prompt` 等）に注入する
- 「必ずファイルを作れ」「質問するな」といった強制ルールを与える
- 成果物が生成されなかったときの自動リトライ
- 対話履歴をテキストとしてプロンプトに再注入する（`--resume` を使うこと）
- エージェント応答からコードブロックを抽出して成果物ファイルを作る
- `sources/` や `artifacts/` のファイル一覧を毎回プロンプトに列挙する（`CLAUDE.md` に書くこと）
- **ツール制限（`--disallowedTools` / `--tools`）や権限モードで振る舞いを傾向づける**

最後の項目は特に間違えやすいので補足します。「相談モード = Write 禁止」という実装を一度入れましたが、**ツールを取り上げるのは能力の剥奪であって、方針の伝達ではありません。** 書けなくしても計画が出るとは限らず、実際には「見積を作成して」と打ったユーザーに AI が「Write が使えない」と答えるだけになりました。実行モードの UI ごと撤去済みです。再導入しないこと。

作業の進め方（例: まず計画を出してレビューを受ける）を既定にしたい場合は、**`NOTEBOOK.md` の初期テンプレート**に書きます。自動生成の `CLAUDE.md` に書くと隠れたプロンプト注入に戻るため不可。`NOTEBOOK.md` はユーザーが見えて・編集できて・消せる層です。

振る舞いの切り替えが必要な場合は、必ず CLI ネイティブのオプションで表現してください。
新しい CLI フラグを使うときは `supports('--flag')` でガードすること（`detectSupportedFlags()`）。バージョンによって存在しないフラグがあります。

### 非対話実行 (-p) の落とし穴

**承認プロンプトを発生させうる引数を渡してはいけません。** `-p` には応答手段がなく、許可待ちのまま何も起きずに終了します。

- `--permission-mode plan` は禁止。`ExitPlanMode` の承認を人間に求めるため `-p` で停止する（実測済み）
- 権限モードは常に `bypassPermissions`（旧版は `--dangerously-skip-permissions`）
- stdin を開いたまま `y` を自動送信する回避策は取らない。TTY 前提で効かないうえ、過剰介入

判断に迷ったら: **その処理はターミナルから素の `claude` を叩いたときにも成立するか？** 成立しないならラッパーの過剰介入です。

---

## 不具合調査の起点

各ノートブックフォルダ直下の `_last_agent_debug.md` に最新実行のログが残ります。

- **0. 実行されたツール** — エージェントが Write/Edit を呼んだか。空なら「そもそも書こうとしていない」
- **1. 実行引数** — どのフラグが実際に渡ったか（`--help` 検出の結果が反映される）
- **CLI セッションID** — `--resume` が効いているか

ターミナルからノートブックフォルダに `cd` して素の `claude` を実行すれば、同じ `CLAUDE.md` を読んだ同一条件で再現できます。プラグイン起因か CLI 起因かはこれで切り分けます。

---

## ビルドおよび動作検証ルール

1. **動作検証用 Vault パス**:
   - `/Users/s-ikari/work/playground/ainotebook-test-vault`

2. **プラグイン自動配置・同期設定**:
   - ビルド成果物の配備先: `/Users/s-ikari/work/playground/ainotebook-test-vault/.obsidian/plugins/obsidian-ai-notebook/`
   - `esbuild.config.mjs` にビルド終了フック (`copyPlugin`) が組み込まれています。
   - `npm run build` または `npm run dev` を実行すると、`main.js`, `manifest.json`, `styles.css` が上記検証用 Vault へ自動的に移送・同期されます。

3. **開発作業ガイドライン**:
   - コードの変更・修正を行った際は、常に `npm run build` を実行して検証用 Vault へ最新コードが反映されていることを確認・維持してください。

---

## リリース & バージョン更新ルール (Release Workflow)

ユーザーが実機（Obsidian BRAT プラグイン等）で動作確認・アップデートを行うため、修正や機能追加を push して動作確認を依頼する際は、**必ずバージョンを更新し、Git タグを作成してプッシュすること**。

1. **バージョン番号の更新**:
   - `manifest.json` の `"version"`
   - `package.json` の `"version"`
   - （例: `0.2.0` -> `0.2.1`）
2. **ビルド & 同期**:
   - `npm run build` でビルド成果物を最新化。
3. **コミット & タグ作成 & プッシュ**:
   - `git add manifest.json package.json ...`
   - `git commit -m "chore(release): bump version to X.X.X"`
   - `git tag X.X.X`
   - `git push && git push --tags`
4. **GitHub Actions 自動リリース**:
   - プッシュされたタグにより `.github/workflows/release.yml` が自動実行され、GitHub Release が発行・配信されます。

