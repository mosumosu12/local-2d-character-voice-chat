# 1枚絵だけで、あなたのオリジナルキャラとリアルタイムで会話

**キャラの絵が1枚あれば、そのキャラとリアルタイムで声で会話できます。**
画面の中のキャラが、口パク・まばたき・表情を変えながら、自分の声で返事をします。Live2D のモデルは要りません。

```
あなたのキャラの絵 1枚
  → 目と口だけ描き替えた絵を作る（画像生成AI）  → 動くキャラにする（自動）  → 性格と声を決める
  → ブラウザで話しかけると、キャラが口パクしながら声で返事
```

- 立ち絵1枚を**網目状に変形させて動かす**ので、継ぎ目が出ない。首かしげ・呼吸・髪の揺れ・まばたき・口パク・表情（笑顔/困り/怒り）つき
- **ハンズフリー**：画面の「ハンズフリー」にチェックを入れると、ボタンを押さずに話しかけるだけで会話できる（話し始め・話し終わりを自動で見つける。キャラが話している間は聞かない）
- 目と口の位置は、描き替えた絵との違いから**自動で見つける**（座標を測らなくてよい）。作り方と道具つき（[docs/AVATAR.md](docs/AVATAR.md)）
- 話し終わってから **約1秒で相槌**、**3〜4秒で本返事**の声。声の大きさに合わせて口が動く
- 声と書き起こしは**自分のPCのGPU**で動く（[speech.cpp](https://github.com/nyosegawa/speech.cpp)）。外に音声を送らない
- 返事を考えるのは Claude。**Claude のサブスク（Pro/Max）でそのまま動く**。API キーでも可

> 絵なしで、チャット画面だけで話す版はこちら → [local-voice-character-chat](https://github.com/mosumosu12/local-voice-character-chat)

### デモ（音声あり・約1分40秒）

https://github.com/mosumosu12/local-2d-character-voice-chat/raw/main/docs/demo.mp4

**ハンズフリー**（ボタンを押さずに話しかけるだけ）で、男性の声で話しかけて、キャラ（りん）が口パク・笑顔で声で返事をしています。
キャラは、立ち絵1枚と画像生成AIで描き替えた目・口の絵から、このリポジトリの `tools/avatar/make_model.py` で作ったものです（上半身）。
※デモのキャラの絵・声・設定はこのリポジトリには含まれません。

> 絵なしで、チャット画面だけで話す版はこちら → [local-voice-character-chat](https://github.com/mosumosu12/local-voice-character-chat)

```
ブラウザ（押して話す／ハンズフリー）
  └→ server.py ── 書き起こし（Qwen3-ASR）──┐
                 ├ 相槌を選ぶ（Jev / Claude）→ 先に一声だけ返す
                 └ 返事（Claude）→ 声（Irodori-TTS）→ ブラウザで再生
```

## 必要なもの

- Python 3.10 以上・ffmpeg
- speech.cpp を動かすPC（Windows/Linux は Vulkan、Mac は Metal。VRAM 8GB 程度〜）
- Claude Code（`claude` コマンド）＋ Claude の Pro/Max プラン、または Anthropic の API キー
- （任意）OpenRouter の API キー：相槌選びが速くなる（1回 約0.003円）
- キャラの絵を作る時だけ: 元の絵を渡して描き替えてもらえる画像生成AI（ChatGPT の画像生成など）・Python の numpy / scipy / Pillow
- 声を説明文から作る時だけ: [Irodori-TTS](https://github.com/Aratako/Irodori-TTS) を入れた Python 環境（NVIDIA の GPU）

## 使い方（絵を入れる → 声を決める → 話す）

### 準備：声と書き起こしのサーバー（speech.cpp）

[speech.cpp のリリース](https://github.com/nyosegawa/speech.cpp/releases) から自分のPC用を落としておきます（起動はステップ2で声を決めてから）。

#### 返事役（Claude）のログイン

サブスクで動かす場合（自分用に使う時）: **`CLAUDE_CODE_OAUTH_TOKEN` が必須**です。
普段の Claude Code のログインは使いません（普段の設定や CLAUDE.md が会話に混ざらないよう、空の設定で起動するため）。

```
claude setup-token          # Claude Code の機能。表示されたトークンを↓に入れる
export CLAUDE_CODE_OAUTH_TOKEN=...
```

> サブスクのトークンを自分用のアプリで使ってよいかは、Anthropic の利用規約を各自で確認してください。人に使わせる時は API キーを使うのが安全です。

API で動かす場合（従量課金）: `export ANTHROPIC_API_KEY=...`

### ステップ1：キャラの絵を入れる

`characters/sample/` を `characters/<名前>/` にコピーして、立ち絵1枚からキャラの絵を作ります（Live2D 不要）。

```
# ① 画像生成AIに立ち絵を渡して「目を閉じて口を開けた絵」（と、あれば笑顔・困り顔・怒り顔）を描き替えてもらう
#    頼み方は docs/AVATAR.md にそのまま使える文があります
# ② 動くキャラにする（位置合わせ・目と口の位置探し・色味合わせは自動）
python3 tools/avatar/make_model.py characters/<名前>/avatar \
    --base 立ち絵.png --blink-mouth 目を閉じて口を開けた絵.png --smile 笑顔.png --troubled 困り顔.png --angry 怒り顔.png
```

`characters/<名前>/avatar/check.png` で、見つけた目・口の位置を確かめられます。詳しくは **[docs/AVATAR.md](docs/AVATAR.md)**。
`characters/<名前>/avatar/model.json` があると、会話画面の上にキャラが出て、口パク・まばたき・呼吸・髪の揺れ・表情の切り替えをします。

### ステップ2：性格と声を決める

**性格**：`characters/<名前>/character.json` の `name` と `system_prompt` を書き換えます。
相槌（`fillers`）は「いつ使うか（`when`）」を具体的に書くほど外れが減ります。キーは半角の英小文字だけにしてください（例 `ehehe`）。

**声**：次のどちらかで、10秒前後の参照の wav を用意します。

- 自分の声や、使ってよいと許可を得た声を録る
- **声の録音が無い時は、説明文から作る**（Irodori-TTS の VoiceDesign・NVIDIA の GPU が必要）

  ```
  python3 tools/make_voice.py --caption "落ち着いた優しい青年の声。中低音でやわらかく、穏やかに話す。" --out voices/<名前>
  ```
  候補が6本できるので、聞いて1本選びます。**選んだ1本をずっと使う**のがコツです（説明文から毎回作ると、毎回ちがう声になります）。

> ⚠ **参照声は、自分の声か、使ってよいと許可を得た声、または説明文から作った声だけ**にしてください。
> Irodori-TTS のモデルカードでは、本人の同意なく実在の人（声優・有名人など）の声をまねることは禁止されています。

声が決まったら speech.cpp を起動します。`--add-voice` の名前を `character.json` の `"voice"` に書きます。

```
speech serve irodori-tts-mf qwen3-asr-1.7b --host 0.0.0.0 --port 8955 --add-voice <名前>=voices/<名前>/cand_s3.wav
```

（`--port` を付けないと speech.cpp は 8080 で待ち受けます。モデル名は `curl http://<speech.cppのPC>:8955/v1/models` の名前と合わせ、違えば環境変数 `ASR_MODEL` / `TTS_MODEL` で直します）

最後に、相槌の声をそのキャラの声で作っておきます。

```
export SPEECH_URL=http://<speech.cppのPC>:8955     # 同じPCなら不要
CHARACTER=<名前> python3 make_fillers.py
```

### ステップ3：話す

```
CHARACTER=<名前> python3 server.py            # → http://localhost:8960/
```

既定ではこのPCからしか開けません。スマホから話す時は `--host 0.0.0.0` を付け、ブラウザの決まりで **https も必要**なので、自己署名の証明書を作って `--https` を付けます（初回だけ警告が出ます）。

```
openssl req -x509 -newkey rsa:2048 -nodes -keyout key.pem -out cert.pem -days 365 -subj /CN=voicechat
CHARACTER=sample python3 server.py 8960 --https --host 0.0.0.0
```

> ⚠ このサーバーにはパスワード等の認証がありません。**自宅のLANの中だけ**で使い、インターネットに公開しないでください（開けた人が誰でもあなたの Claude と GPU を使えてしまいます）。


## 設定（環境変数）

| 変数 | 既定 | 内容 |
|---|---|---|
| `SPEECH_URL` | `http://127.0.0.1:8955` | speech.cpp のサーバー |
| `CHARACTER` | `sample` | `characters/` の下のフォルダ名 |
| `CHARACTERS_DIR` | `./characters` | キャラのフォルダを別の場所に置く時 |
| `CLI_MODEL` | `sonnet` | サブスクで動かす時のモデル（`haiku` にすると速く軽い） |
| `API_MODEL` | `claude-sonnet-5-5` | API で動かす時のモデル |
| `OPENROUTER_API_KEY` | なし | あれば相槌を Jev で選ぶ（0.2〜0.5秒）。無ければ Claude Haiku（約0.9秒） |
| `ASR_MODEL` / `TTS_MODEL` | `Qwen3-ASR-1.7B` / `Irodori-TTS-v4.1-Small-MF` | speech.cpp のモデル名 |

## 作ってみて分かったコツ

- 返事の文は「。」で区切らず「、」でつないで最後だけ「。」にして TTS に渡す（1文ずつ作られて間が空くのを防ぐ）
- Irodori-TTS v4.1 は少しゆっくり話すので `speed` は 1.1 前後
- 相槌は「相槌なし」も選択肢に入れ、自信が低い時は出さない。外れた相槌は無いより悪い
- 本返事には「もう『えへへ』と言った」と伝えて、同じ言葉で始めないようにする
- 書き起こしはキャラ名をよく聞き間違えるので、返事役に「聞き間違いは意味を汲んで」と書いておく

## 使っているもの

- [speech.cpp](https://github.com/nyosegawa/speech.cpp)（MIT）
- [Irodori-TTS](https://huggingface.co/Aratako/Irodori-TTS-v4.1-Small-MF)（MIT＋利用上の注意：本人の同意なく実在人物の声をまねない・誤情報目的のディープフェイクに使わない）
- [Irodori-TTS VoiceDesign](https://huggingface.co/Aratako/Irodori-TTS-500M-v2-VoiceDesign)（説明文から声を作る時だけ・任意）
- [Qwen3-ASR](https://huggingface.co/Qwen/Qwen3-ASR-1.7B)（Apache-2.0）
- [Jev](https://openrouter.ai/docs/guides/community/jev)（OpenRouter 経由・任意）
- Claude（Anthropic）

モデルの重みはこのリポジトリに含まれません。各配布元から取得してください。

## ライセンス

MIT
