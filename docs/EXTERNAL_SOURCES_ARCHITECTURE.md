# 外部巨大ソース（GitLab / Confluence / Box）連携アーキテクチャ設計書

## 💡 核心思想: 「ナレッジ精錬工場（Refinery Architecture）」

社内の膨大なデータ（GitLab のコード群、Confluence の大量Wiki、Box の大容量資料）を AI ノートブックに接続し、**「人間がチマチマ選ぶ一手間を完全排除」** し、**「AIが自律探索・選別してガサッと集め」**、さらに **「人間のフィードバックで探索知恵を学習・再帰育成」** していくアーキテクチャ。

ゆくゆくは、散らかった Confluence や Box の情報をノートブックで精錬し、**Obsidian Vault 側を新マスタとして引き取っていく（移行工場）** ことを目指す。

---

## 🏗️ 2大ソース別アプローチ（Dual Strategy）

| ソース種別 | 収集アプローチ | 容量・パフォーマンス対策 | 探索・選別の主役 | 人間の役割 |
| :--- | :--- | :--- | :--- | :--- |
| **GitLab** | リポジトリ単位でガサッとローカル裏キャッシュ（`sources/.cache/gitlab/<repo>/`） | `.gitignore` でリポジトリ容量0バイト / 差分のみ更新 | Claude Code / Antigravity CLI（grep / glob で爆速探索） | ざっくり指示 ＋ フォルダ位置の助言 |
| **Confluence** (および **Box**) | Search API (CQL) によるオンデマンド抽出（関連上位 5〜10 件のみピンポイント取得） | スペース全DLは即死するためAPI検索に特化。本文のみMarkdown化（数KB） | Confluence 検索API ＋ AIフィルタリング | キーワード指示 ＋ 「この親ページ配下を見ろ」と教育 |

---

## 🔄 再帰育成学習ループ（Pointer Directory / HINTS.md）

AIが収集した情報がピント外れだった場合、人間が「このフォルダ配下を探せ」とフィードバックする。

```markdown
# 🧭 探索の知恵（Search Hints / HINTS.md）

## Confluence
- **認証・アーキテクチャ関連**:
  - 全社検索はノイズ（古い仕様書や他部署メモ）が多い。
  - 必ず Space: `ARCH` かつ Ancestor: `2025年リニューアル` (ID: 987654) の配下を優先検索すること。
  - （2026-09-12 学習: ユーザーフィードバックによる）
```

- 次回以降、AIは `CLAUDE.md` 経由でこの `HINTS.md` を前提知識として読み込むため、最初から正しい場所だけをピンポイントに探索する。

---

## 🧪 個人PCでの開発・検証戦略: 「Confluenceカオス・シミュレーター」

個人PCでは会社の Confluence にアクセスできないため、手元で「社内Wikiのゴミ山・カオス階層」を完全に再現するローカルモックサーバー（Node.js + ミニ全文検索）を構築して開発・検証を行う。

### シミュレーター要件:
1. **カオスデータの自動生成**:
   - `PROD-OLD / 2021年 / 認証仕様書.md`（非推奨の古いJWT仕様）
   - `CORP / 総務 / セキュリティカード紛失時の認証手続き.md`（ノイズ）
   - `DEV-ARCH / 2024年 / 認証基盤移行計画.md`
   - `DEV-ARCH / 2025年リニューアル / 最新API定義 / JWTトークン仕様書.md`（★大正解）
   - その他ダミーページ 100〜200 ページ
2. **Confluence REST API 互換エンドポイント**:
   - `GET /rest/api/content/search?cql=text ~ "認証"`（ノイズだらけの10件を返す）
   - `GET /rest/api/content/search?cql=ancestor = "2025リニューアル" AND text ~ "認証"`（正解の最新仕様書のみ返す）
   - `GET /rest/api/content/:id?expand=body.storage`（HTML本文を返す）
3. **HTML ➡ Markdown 変換パイプライン**:
   - TurndownService 等で Confluence の HTML/Storage Format を Obsidian 用の美しい Markdown に正規化して `sources/` に落とす。

---

## 🎯 次回セッション用プロンプト（コピペ用）

次回セッション開始時、ユーザーは以下のプロンプトをそのまま送信してください：

```markdown
前回のセッション (conversation://13983b74-4171-4f09-b034-996a2d870c3c) で合意した「外部巨大ソース連携: ナレッジ精錬工場アーキテクチャ（docs/EXTERNAL_SOURCES_ARCHITECTURE.md）」の実装を開始します。

まずは「Confluence API オンデマンド抽出パイプライン」の実装と検証を進めるため、以下のステップで進めてください：

1. 【テスト環境構築】社内Wikiのリアルなゴミ山・階層構造を再現する「Confluenceカオス・シミュレーター（ローカルモックサーバー）」を tools/ または tests/mock/ に構築し、CQL検索およびページ取得APIをモック化する。
2. 【コアロジック実装】Confluence API クライアント（CQL検索、ancestor指定、HTML→Markdown変換、sources/ へのスタブ配置）を実装する。
3. 【AI・UI連携】キーワードから関連ページをガサッと集める仕組み、および人間の「このフォルダ配下を探せ」というフィードバックを HINTS.md に記憶・反映する学習ループを実装する。
4. 【動作検証】モックサーバーに対して検索〜抽出〜学習ループが期待通りに動作することをテストする。
```
