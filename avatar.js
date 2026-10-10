// 会話画面のキャラ（1枚絵を変形させて動かす 2.5D）。描画と動きは portrait/ の中。
// キャラは characters/<名前>/avatar/model.json と画像（tools/avatar/make_model.py が作る）。
//   const av = await Avatar.load(canvas, '/avatar/');
//   av.mouth = 0..1（声の大きさ）   av.mood = 'neutral' | 'smile' | 'troubled' | 'angry'   av.nod()
import { PortraitRenderer } from '/portrait/renderer.js';
import { MotionController } from '/portrait/motion.js';

const MOODS = { neutral: [0, 0, 0], smile: [1, 0, 0], troubled: [0, 1, 0], angry: [0, 0, 1] };

async function load(canvas, base) {
  const cfg = await (await fetch(base + 'model.json', { cache: 'no-store' })).json();
  // 画像のパスは model.json の場所から見た相対パス
  const url = (p) => (/^(https?:)?\//.test(p) ? p : base + p);
  cfg.textures = Object.fromEntries(Object.entries(cfg.textures).map(([k, v]) => [k, url(v)]));
  if (cfg.expressions?.textures)
    cfg.expressions.textures = Object.fromEntries(Object.entries(cfg.expressions.textures).map(([k, v]) => [k, url(v)]));
  canvas.width = cfg.width; canvas.height = cfg.height;
  const renderer = new PortraitRenderer(canvas, cfg); await renderer.init();
  const motion = new MotionController();
  const av = { mouth: 0, mood: 'neutral', nod() { motion.nod(); } };
  // 表情の切り替えは、短いまばたきで目を閉じている間に入れ替える（開いた目と閉じた目を混ぜると目が二重に見えるため）
  //   0〜0.1秒で閉じる → 0.13秒で新しい表情に入れ替え → 0.16〜0.32秒で開く。その間は口も閉じ気味にする
  const ease = (x) => { x = Math.max(0, Math.min(1, x)); return x * x * (3 - 2 * x); };
  const st = { w: [0, 0, 0], from: [0, 0, 0], to: [0, 0, 0], mood: 'neutral', at: -9, init: 0, lastVoice: -9,
    rest: cfg.expressions?.smileMouthRest ?? 0.55 };
  let lastClosure = 0;
  let last = performance.now() / 1000;
  function frame(ms) {
    const t = ms / 1000, dt = Math.min(0.05, Math.max(0, t - last)); last = t;
    const want = av.mood in MOODS ? av.mood : 'neutral';
    if (want !== st.mood) { st.mood = want; st.from = st.w.slice(); st.to = MOODS[want]; st.at = t; st.init = lastClosure; }
    const e = t - st.at;
    const closure = e < 0.32 ? (st.init + (1 - st.init) * ease(e / 0.1)) * (1 - ease((e - 0.16) / 0.16)) : 0;
    st.w = (e < 0.13 ? st.from : st.to).slice(); lastClosure = closure;
    // 会話画面の口の値（RMS×5）を、配信モデルの口の値（(RMS-0.008)×12）にそろえる
    const level = Math.max(0, Math.min(1, (av.mouth / 5 - 0.008) * 12));
    if (av.mouth > 0.02) st.lastVoice = t;
    const speaking = t - st.lastVoice < 0.4;
    const s = motion.update(t, dt, { demo: false, mouth: 0, audioActive: speaking, audioMouth: level, tilt: 0, breathing: 0.5,
      hair: 0.5, hairGain: cfg.naturalMotion?.defaultHairGain ?? 3, bpm: 180, audioTime: 0, testTilt: null });
    // 笑顔で話している間は、笑顔の口の「休み開き」を小さくする（開きっぱなしに見えないように）
    const restT = speaking ? (cfg.expressions?.speechSmileMouthRest ?? st.rest) : (cfg.expressions?.smileMouthRest ?? 0.55);
    st.rest += (restT - st.rest) * Math.min(1, dt / 0.12);
    renderer.draw({ ...s, smileRest: st.rest, mouth: s.mouth * (1 - closure), blink: Math.max(s.blink, closure), settle: closure,
      expressionWeights: st.w }, t);
    requestAnimationFrame(frame);
  }
  requestAnimationFrame(frame);
  return av;
}

window.Avatar = { load };
window.dispatchEvent(new Event('avatar-ready'));
