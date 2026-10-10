"""声の録音が無くても、「どんな声か」の説明文からキャラの声を作る（Irodori-TTS の VoiceDesign）。

  python3 tools/make_voice.py --caption "落ち着いた優しい青年の声。中低音でやわらかく、穏やかに話す。" \
      --text "やあ、こんにちは。今日はどんな一日だった？" --seeds 1 2 3 4 5 6 --out voices/haru

- `voices/haru/cand_s1.wav` … のように候補ができるので、聞いて1本選ぶ
- 選んだ1本を speech.cpp の `--add-voice haru=voices/haru/cand_s3.wav` に渡せば、その声で話す
- ★毎回この説明文から作ると、同じ説明でも毎回ちがう声になる。**1本選んだら、以後はその wav を使い続ける**

必要なもの: Irodori-TTS（https://github.com/Aratako/Irodori-TTS）を入れた Python 環境と、NVIDIA の GPU。
初回はモデル（Aratako/Irodori-TTS-500M-v2-VoiceDesign）を自動でダウンロードする。
"""
import argparse, subprocess
from pathlib import Path
from huggingface_hub import hf_hub_download
from irodori_tts.inference_runtime import (RuntimeKey, SamplingRequest, default_runtime_device,
                                           get_cached_runtime, save_wav)

ap = argparse.ArgumentParser()
ap.add_argument('--caption', required=True, help='どんな声か（日本語の説明文）')
ap.add_argument('--text', default='こんにちは。今日はどんな一日だった？よかったら、話を聞かせてね。', help='候補に読ませる文')
ap.add_argument('--seeds', type=int, nargs='+', default=[1, 2, 3, 4, 5, 6])
ap.add_argument('--steps', type=int, default=56)
ap.add_argument('--out', default='voices/new')
a = ap.parse_args()

ckpt = hf_hub_download(repo_id='Aratako/Irodori-TTS-500M-v2-VoiceDesign', filename='model.safetensors')
dev = default_runtime_device()
rt, _ = get_cached_runtime(RuntimeKey(checkpoint=ckpt, model_device=dev, codec_repo='Aratako/Semantic-DACVAE-Japanese-32dim',
                                       model_precision='fp32', codec_device=dev, codec_precision='fp32', enable_watermark=False,
                                       compile_model=False, compile_dynamic=False))
if not rt.model_cfg.use_caption_condition:
    raise SystemExit('このモデルは説明文から声を作れません（VoiceDesign 版を使ってください）')
out = Path(a.out); out.mkdir(parents=True, exist_ok=True)
for seed in a.seeds:
    r = rt.synthesize(SamplingRequest(
        text=a.text, caption=a.caption, ref_wav=None, ref_latent=None, no_ref=True, ref_normalize_db=-16.0, ref_ensure_max=True,
        num_candidates=1, decode_mode='sequential', seconds=30.0, max_ref_seconds=30.0, num_steps=a.steps, seed=seed,
        cfg_guidance_mode='independent', cfg_scale_text=2.0, cfg_scale_caption=4.0, cfg_scale_speaker=0.0,
        cfg_min_t=0.5, cfg_max_t=1.0, context_kv_cache=True, trim_tail=True))
    raw = out / f'raw_s{seed}.wav'; save_wav(raw, r.audio, r.sample_rate)
    # 参照声として使いやすいよう、前後の無音を切って音量をそろえる（ffmpeg が無ければ raw をそのまま使う）
    dst = out / f'cand_s{seed}.wav'
    try:
        subprocess.run(['ffmpeg', '-v', 'error', '-y', '-i', str(raw), '-af',
                        'silenceremove=start_periods=1:start_threshold=-45dB,areverse,silenceremove=start_periods=1:start_threshold=-45dB,areverse,loudnorm=I=-16:TP=-1.5',
                        '-ar', '24000', '-ac', '1', str(dst)], check=True)
        raw.unlink()
    except (FileNotFoundError, subprocess.CalledProcessError):
        raw.rename(dst)
    print('作った:', dst, flush=True)
print('聞いて1本選び、speech.cpp の --add-voice <名前>=<選んだwav> に渡してください')
