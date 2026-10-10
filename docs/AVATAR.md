# キャラの絵を出して、口パクさせる

会話画面の上にキャラの絵を出して、**声に合わせて口を動かし、まばたき・呼吸・首かしげ・髪の揺れ・表情（笑顔・困り・怒り）**をさせる方法です。
用意するのは**キャラの立ち絵1枚**と、それを画像生成AIで少しだけ描き替えた絵です。Live2D のモデルは要りません。

```
立ち絵1枚
  └ ① 目と口だけ描き替えた絵を作る（画像生成AIの「画像の編集」）
  └ ② model.json を作る（tools/avatar/make_model.py・目と口の位置は自動で見つける）
  └ ③ 会話画面で動かす（置くだけで自動で出る）
```

できあがりは `characters/<名前>/avatar/` に入ります。このフォルダに `model.json` があると、会話画面に絵が出ます（無ければ今まで通り文字だけ）。

## しくみ

絵をパーツに切り分けるのではなく、**1枚の絵を網目状に少しずつ変形させて動かします**（WebGL2）。

- 首かしげ・呼吸・髪の揺れ・胸の揺れ・うなずき … 絵の各所を、ばねの計算で少し遅れて動かす（頭→髪の順に遅れてついてくる）
- まばたき・口パク … 目と口のところだけ、「目を閉じて口を開けた絵」に差し替える。口は声の大きさに合わせて開き具合を変える
- 表情 … 目・眉と口のところだけ、笑顔・困り顔・怒り顔の絵に差し替える
  - 切り替えは、短いまばたきで**目を閉じている間に入れ替える**（0〜0.1秒で閉じる → 0.13秒で入れ替え → 0.16〜0.32秒で開く）。
    開いた目と閉じた目を混ぜながら移ると、目が二重に見えるため
  - 笑顔は少し開いた笑い口から、声に合わせてさらに開く。困り顔は閉じた口（Λ）のまま開かない。怒り顔は「閉じた口」と「開いた口」を声に合わせて使い分ける
- 話し始めに小さくうなずく。首をかしげると、髪が少し遅れてついてきて、ばねのように揺れて止まる

切り分けないので、**止まっている時の見た目は元の絵そのもの**で、継ぎ目も出ません。

---

## ① 目と口だけ描き替えた絵を作る

画像生成AIの「画像の編集」（ChatGPT の画像生成など、元の絵を渡して描き替えてもらえる物）に、立ち絵を渡して次のように頼みます。
**必須なのは1枚目だけ**。表情の絵は無ければその表情が出ないだけです。

| 作る絵 | 頼み方（英語の方が位置がずれにくい） |
|---|---|
| 目を閉じて口を開けた絵（必須） | `Edit this exact image. Change ONLY her eyes and mouth: both eyes gently closed exactly where they are now, and the mouth open in a small natural talking shape at the same place. Eyebrows unchanged. Keep EVERY other pixel identical: same pose, same hair, same clothes, same position and size, same framing, same canvas size, same plain white background. No zoom, no crop, no redesign.` |
| 笑顔 | `... Change ONLY her eyes and mouth: joyful closed crescent smiling eyes (^ ^) and a happy small open-mouth smile, at the same positions. Eyebrows relaxed. ...` |
| 困り顔 | `... Change ONLY her eyebrows, eyes and mouth: worried troubled eyebrows raised in the middle, slightly anxious open eyes, and a small closed wavy worried mouth, at the same positions. ...` |
| 怒り顔（口を閉じる） | `... Change ONLY her eyebrows, eyes and mouth: angry eyebrows slanted down toward the center, sharp annoyed open eyes, and a closed pouting frown mouth, at the same positions. ...` |
| 怒り顔（口を開ける） | `... Change ONLY her eyebrows, eyes and mouth: angry eyebrows slanted down toward the center, sharp annoyed open eyes, and the mouth open while angrily talking (not a smile), at the same positions. ...` |
| 困り顔の閉じ目 | `... Change ONLY her eyebrows, eyes and mouth: worried troubled eyebrows raised in the middle, both eyes gently closed, and a small closed wavy worried mouth, at the same positions. ...` |
| 怒り顔の閉じ目 | `... Change ONLY her eyebrows, eyes and mouth: angry eyebrows slanted down toward the center, both eyes closed in annoyance, and a closed pouting frown mouth, at the same positions. ...` |

（`...` の所は1枚目と同じ「Keep EVERY other pixel identical ～」を付けます）

- 困り顔の口は**閉じた口**に、怒り顔の口は**笑い口にしない**ように頼みます（笑い口が混ざると苦笑いに見えます）
- 怒り顔の「口を開ける」が無いと、怒り顔で話しても口は閉じたままです
- 表情の閉じ目が無いと、その表情の途中のまばたきで、一瞬だけ眉が普通の形に戻ります

> 立ち絵のコツ: 正面向き・顔がはっきり見える・背景は透明か単色。
> **白い襟・レース・白い服のキャラは、背景を透明にした絵を使ってください**（白い背景を抜く時に、背景とつながった白い服まで抜けることがあります）。
> 頭の上から足元まで入っている必要はありません。上半身だけでも動きます。

> AIは頼んだ所以外も少し描き直したり、少し拡大したり、全体の色味を変えたりします。
> ②の道具が**位置・大きさ・色味を元の絵に合わせ直す**ので、多少のずれは気にしなくて大丈夫です。
> ただし、顔の向きや髪型が変わってしまった絵は使えません。何回か作って、元の絵に一番近い物を選んでください。

## ② model.json を作る

```
python3 tools/avatar/make_model.py characters/<名前>/avatar \
    --base 立ち絵.png --blink-mouth 目を閉じて口を開けた絵.png \
    --smile 笑顔.png --troubled 困り顔.png --angry 怒り顔.png --angry-open 怒り顔_口を開ける.png \
    --troubled-blink 困り顔の閉じ目.png --angry-blink 怒り顔の閉じ目.png
```

- 背景が単色なら自動で透明にします
- 描き替えた絵を、元の絵に重なる位置・大きさに合わせ直します（拡大・ずれを自動で直す）
- **目と口の位置は、元の絵と「目を閉じて口を開けた絵」の違う所から自動で見つけます**（人が座標を測る必要はありません）
- 首の回転の中心・呼吸で動く範囲・髪が揺れる範囲は、見つけた目の位置と大きさから、標準的な立ち絵の比率で決めます。
  **これは仮の値です。** 髪型（長い髪・短い髪・片側だけのポニーテール）や体型で合う範囲が違うので、③で動かして確かめて、合わなければ直してください
- 描き替えた絵の色味（明るさ）を、元の絵の肌の色に合わせます

最後に `check.png` と `check_dark.png`（暗い背景に置いた絵。白い服や髪の先が抜けていないかを見る）ができます。

- 赤い丸 … 見つけた目と口（ここが差し替わる）
- 緑の丸 … 顔（髪が揺れても顔は動かさない範囲）
- 青い線 … ここより外側の髪が揺れる
- 黄色の点 … 首をかしげる時の回転の中心

ずれている時は `model.json` の数値を直します（座標は絵の左上からの px）。

| 見え方 | 直す所 |
|---|---|
| 口を開くと鼻の下に線が出る | `mouthSampleY`（口の絵を読み取る上下の範囲）の上側を下げる |
| 閉じる途中の口が歪む | `mouthCornerX`（口角のx）と `mouthClosure`（閉じた口の左右の高さ・曲がり） |
| 髪を揺らすと服や顔まで動く | `naturalMotion.left/right` の内側のxを外へ・`faceProtect` を広げる |
| 首をかしげると首だけ伸びる | `headPivot` を首の付け根あたりへ |
| 服の白い所が欠ける | 背景を透明にした立ち絵を使う |

| キー | 中身 |
|---|---|
| `eyeL` `eyeR` `mouthRegion` | 目・口の範囲 `[中心x, 中心y, 横の半径, 縦の半径]` |
| `headPivot` | 首をかしげる時の回転の中心 `[x, y]` |
| `naturalMotion.left/right` | 揺れる髪 `[上端y, 下端y, 上端での内側のx, 下端での内側のx, ぼかし幅, 強さ]` |
| `naturalMotion.faceProtect` | 髪を揺らしても動かさない顔の範囲 |
| `breathing` | 呼吸（首・肩・胸の高さと、動く量） |
| `expressions` | 表情の絵と、表情の時に差し替える目（眉まで含めて少し広め）・口の範囲 |

## ③ 会話画面で動かす

`characters/<名前>/avatar/model.json` があれば、会話画面に自動で出ます。

- 声の大きさに合わせて口が開く（返事の声も相槌の声も）
- 返事の文に `character.json` の `smile_words`（例 `えへへ|やった|うれし`）が入っていると、笑顔で話す
- 確かめる順番: 通常の顔 → まばたき → 口（閉じ・少し・大きく・閉じる途中）→ 表情ごとのまばたきと口 → 首かしげと髪
- まばたき・呼吸・髪の揺れは、ずっと自動で動く

ほかのページで使う時は:

```html
<canvas id="av"></canvas>
<script type="module">
  import '/avatar.js';
  const av = await Avatar.load(document.getElementById('av'), '/avatar/');
  av.mouth = 0.6;          // 0〜1（声の大きさ）
  av.mood = 'smile';       // 'neutral' | 'smile' | 'troubled' | 'angry'
  av.nod();                // うなずく
</script>
```

WebGL2 が使えるブラウザが必要です（今のパソコン・スマホのブラウザならほぼ使えます）。
