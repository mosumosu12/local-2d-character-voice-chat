"""1枚絵＋「目と口だけ描き替えた絵」から、会話画面で動くキャラ（model.json）を作る。

  python3 tools/avatar/make_model.py characters/<名前>/avatar \\
      --base 立ち絵.png --blink-mouth 目を閉じて口を開けた絵.png \\
      [--smile 笑顔.png] [--troubled 困り顔.png] [--angry 怒り顔.png]

描き替えた絵は、画像生成AIの「画像の編集」で作る（頼み方は docs/AVATAR.md）。
- 描き替えた絵が少しずれたり大きさが違っても、元の絵に重なるように自動で合わせる
- 目と口の位置は、元の絵と「目を閉じて口を開けた絵」の違う所から自動で見つける（人が座標を測らなくてよい）
- 首・肩・髪・胸の位置は、見つけた目の位置と大きさから決める（標準的な立ち絵の比率）
- 確認用に check.png（見つけた目・口・髪の範囲を描いた絵）を出す。ずれていたら model.json の数値を直す
"""
import argparse, json, sys
from pathlib import Path
import numpy as np

# 注意: Python 3.14 と numpy 1.x の組み合わせでは、関数の中の `a - b` が a を書き換えてしまうことがある
# （numpy の「使い捨ての配列は上書きして速くする」最適化が、3.14 の参照の数え方の変化で誤動作する）。
# 配列どうしの計算は np.subtract などの関数で書く
sub, mul, absd = np.subtract, np.multiply, lambda x, y: np.abs(np.subtract(x, y))
from PIL import Image, ImageDraw, ImageFilter
from scipy import ndimage

# 標準の立ち絵（目と目の間 100px・目の中点 (516, 211.5)）での位置。見つけた目に合わせて拡大・移動して使う
REF_MID, REF_D = (516.0, 211.5), 100.0
TEMPLATE = {
    'headPivot': ('xy', [540, 355]),
    'naturalMotion': {'left': ('yyxxs_', [150, 850, 380, 240, 110, 75]), 'right': ('yyxxs_', [150, 850, 660, 800, 110, 75]),
                      'faceProtect': ('xyss', [540, 236, 130, 101]), 'chestRegion': ('xyss', [540, 565, 140, 125])},
    'breathing': {'neckY': ('y', 320), 'shoulderY': ('y', 385), 'liftY': ('y', 465), 'anchorY': ('y', 702), 'swellY': ('y', 515),
                  'swellHalfHeight': ('s', 116), 'nodDepth': ('s', 133), 'rise': ('s', 5.26), 'shoulderLift': ('s', 3.32)},
}
BREATH_FIXED = {'version': 2, 'stretch': 0.004, 'swell': 0.008, 'nodDeg': 0.8, 'hairFollow': 0.85, 'headLag': {'freq': 1.4, 'damping': 0.9},
                'hairLag': {'freq': 1.0, 'damping': 0.65}, 'period': 4.2, 'speakPeriod': 3.1, 'amp': 0.72, 'speakAmp': 1.0,
                'jitter': 0.07, 'ampJitter': 0.08, 'blendSeconds': 0.9, 'speakHold': 1.2}


def cut_background(im):
    """背景が透明でなければ、外周とつながった単色の背景を抜く"""
    im = im.convert('RGBA'); a = np.asarray(im)
    if (a[:, :, 3] < 250).mean() > 0.05:
        return im
    rgb = a[:, :, :3].astype(int)
    edge = np.concatenate([rgb[0], rgb[-1], rgb[:, 0], rgb[:, -1]]); bgc = np.median(edge, 0)
    near = absd(rgb, bgc).max(2) < 14
    lab, _ = ndimage.label(near)
    ids = set(np.unique(np.concatenate([lab[0], lab[-1], lab[:, 0], lab[:, -1]]))) - {0}
    fg = ndimage.binary_fill_holes(~np.isin(lab, list(ids)))
    fg = ndimage.binary_opening(fg, iterations=1)
    alpha = Image.fromarray((fg * 255).astype(np.uint8)).filter(ImageFilter.GaussianBlur(1))
    out = im.copy(); out.putalpha(alpha); return out


def on_white(im):
    w = Image.new('RGB', im.size, (255, 255, 255)); w.paste(im, (0, 0), im if im.mode == 'RGBA' else None); return w


def align(base, var):
    """描き替えた絵を、元の絵にいちばん重なる倍率・位置に合わせる"""
    W, H = base.size; k = 4
    B = np.asarray(on_white(base).convert('L').resize((W // k, H // k)), np.float32)
    M = np.asarray(base.getchannel('A').resize((W // k, H // k))) > 128
    v0 = on_white(var)
    best = None
    for s in np.arange(0.90, 1.101, 0.01):
        sw, sh = round(W * s / k), round(H * s / k)
        G = np.asarray(v0.convert('L').resize((sw, sh)), np.float32)
        for dx in range(-16, 17):
            for dy in range(-16, 17):
                # 生成絵を s 倍して、中心を (dx,dy)*k ずらして置く
                ox, oy = (W // k - sw) // 2 + dx, (H // k - sh) // 2 + dy
                c = np.full((H // k, W // k), 255, np.float32)
                x0, y0 = max(0, ox), max(0, oy); x1, y1 = min(W // k, ox + sw), min(H // k, oy + sh)
                if x1 <= x0 or y1 <= y0: continue
                c[y0:y1, x0:x1] = G[y0 - oy:y1 - oy, x0 - ox:x1 - ox]
                d = absd(c, B)[M].mean()
                if best is None or d < best[0]: best = (d, s, ox * k, oy * k)
    d, s, ox, oy = best
    out = Image.new('RGB', (W, H), (255, 255, 255)); out.paste(v0.resize((round(W * s), round(H * s)), Image.LANCZOS), (ox, oy))
    return out, {'scale': round(float(s), 3), 'offset': [int(ox), int(oy)], 'diff': round(float(d), 2)}


def find_face(base, blink):
    """元の絵と「目を閉じて口を開けた絵」の違う所 → 左目・右目・口"""
    a = np.asarray(on_white(base), np.int16); b = np.asarray(blink, np.int16)
    alpha = np.asarray(base.getchannel('A')) > 128
    diff = (absd(a, b).max(2) > 40) & alpha
    diff = ndimage.binary_opening(diff, iterations=1)
    diff = ndimage.binary_closing(diff, iterations=3)
    lab, n = ndimage.label(diff)
    if n < 3: sys.exit('目と口の違いが見つかりません。目を閉じて口を開けた絵になっているか確認してください')
    comps = []
    for i, sl in enumerate(ndimage.find_objects(lab), 1):
        area = int((lab[sl] == i).sum())
        if area < 30: continue
        y0, y1, x0, x1 = sl[0].start, sl[0].stop, sl[1].start, sl[1].stop
        comps.append({'area': area, 'cx': (x0 + x1) / 2, 'cy': (y0 + y1) / 2, 'w': x1 - x0, 'h': y1 - y0})
    comps = sorted(comps, key=lambda c: -c['area'])[:10]
    best = None
    # 2つの目（ほぼ同じ高さ・離れている）と、その下の口、の組み合わせで一番もっともらしい物
    for i in range(len(comps)):
        for j in range(len(comps)):
            if i == j or comps[i]['cx'] >= comps[j]['cx']: continue
            L, R = comps[i], comps[j]; dx = R['cx'] - L['cx']
            if dx < 20 or abs(R['cy'] - L['cy']) > 0.6 * dx: continue
            mx, my = (L['cx'] + R['cx']) / 2, (L['cy'] + R['cy']) / 2
            for m in range(len(comps)):
                if m in (i, j): continue
                M = comps[m]; down = M['cy'] - my
                if not (0.35 * dx < down < 1.6 * dx) or abs(M['cx'] - mx) > 0.5 * dx: continue
                score = L['area'] + R['area'] + M['area'] - abs(L['area'] - R['area'])
                if best is None or score > best[0]: best = (score, L, R, M)
    if not best: sys.exit('目・口の並びが見つかりません。check.png を出すので、描き替えた絵を確認してください')
    return best[1], best[2], best[3]


def tone_match(base, var, region, features):
    """描き替えた絵の色味を元の絵に合わせる。画像生成AIは全体を少し暗く・明るく描き直すことがあり、
    そのまま差し替えると目や口のまわりだけ色が変わって見える。顔の中の、目・口以外の肌で比べて色ごとに掛け直す"""
    a = np.array(on_white(base), dtype=np.float32, copy=True); b = np.array(var, dtype=np.float32, copy=True)
    ys, xs = np.ogrid[:a.shape[0], :a.shape[1]]
    inside = lambda c, k=1.0: np.add(np.square(np.subtract(xs, c[0]) / (c[2] * k)), np.square(np.subtract(ys, c[1]) / (c[3] * k))) < 1
    ring = inside(region)
    for f in features: ring &= ~inside(f, 1.6)
    ring &= np.asarray(base.getchannel('A')) > 200
    d = absd(a, b).max(axis=2)
    ring &= d < 60          # 描き替えで形が変わった所（髪の毛先など）は除く
    if ring.sum() < 200: return var, [1, 1, 1]
    g = np.clip(np.median(a[ring], 0) / np.maximum(1, np.median(b[ring], 0)), 0.75, 1.33)
    return Image.fromarray(np.clip(mul(b, g), 0, 255).astype(np.uint8)), [round(float(x), 3) for x in g]


def main():
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument('out'); ap.add_argument('--base', required=True); ap.add_argument('--blink-mouth', required=True)
    for k in ('smile', 'troubled', 'angry'): ap.add_argument('--' + k)
    args = ap.parse_args()
    out = Path(args.out); out.mkdir(parents=True, exist_ok=True)
    base = cut_background(Image.open(args.base)); W, H = base.size
    log = {}
    blink, log['blink_mouth'] = align(base, Image.open(args.blink_mouth))
    L, R, M = find_face(base, blink)
    mx, my = (L['cx'] + R['cx']) / 2, (L['cy'] + R['cy']) / 2; s = (R['cx'] - L['cx']) / REF_D
    tilt = (R['cy'] - L['cy']) / (R['cx'] - L['cx'])
    X = lambda x: round(mx + (x - REF_MID[0]) * s, 1); Y = lambda y: round(my + (y - REF_MID[1]) * s, 1); S = lambda v: round(v * s, 2)
    conv = {'x': X, 'y': Y, 's': S, '_': lambda v: v}
    def place(kind, v):
        if isinstance(v, list): return [conv[c](x) for c, x in zip(kind, v)]
        return conv[kind](v)

    eye = lambda c: [round(c['cx'], 1), round(c['cy'], 1), round(max(c['w'] * 0.62, 39 * s), 1), round(max(c['h'] * 0.75, 27 * s), 1)]
    mouth = [round(M['cx'], 1), round(M['cy'], 1), round(max(M['w'] * 0.7, 29 * s), 1), round(max(M['h'] * 0.8, 22 * s), 1)]
    cx, cy = mouth[0], mouth[1]
    face = place('xyss', [540, 236, 130, 101])
    feats = [eye(L), eye(R), mouth]
    blink, log['blink_mouth']['tone'] = tone_match(base, blink, face, feats)
    model = {'name': out.parent.name, 'width': W, 'height': H,
             'textures': {'base': 'base.png', 'blinkMouth': 'blink_mouth.png'},
             'headPivot': place('xy', TEMPLATE['headPivot'][1]),
             'eyeL': eye(L), 'eyeR': eye(R), 'mouthRegion': mouth,
             'mouthSampleY': [round(cy - 18 * s, 1), round(cy + 25 * s, 1)],
             'mouthCornerX': [round(cx - 18 * s, 1), round(cx + 20 * s, 1)],
             'mouthClosure': [round(cy - 3 * s - tilt * 18 * s, 1), round(cy - 3 * s + tilt * 20 * s, 1), S(3), 0.28],
             'naturalMotion': {'version': 1, 'defaultHairGain': 3,
                               **{k: place(*v) for k, v in TEMPLATE['naturalMotion'].items()}},
             'breathing': {**BREATH_FIXED, **{k: place(*v) for k, v in TEMPLATE['breathing'].items()}}}
    model['breathing']['anchorY'] = min(H - 1, model['breathing']['anchorY'])
    base.save(out / 'base.png'); blink.putalpha(base.getchannel('A')); blink.save(out / 'blink_mouth.png')

    # 表情（無い物は元の絵＝変化なし）。差分の目は眉まで含めるので、範囲を上に広げる
    names = {'smile': args.smile, 'troubled': args.troubled, 'angryClosed': args.angry, 'angryOpen': args.angry}
    tex = {}
    for name, path in names.items():
        if not path: tex[name] = 'base.png'; continue
        fn = ('angry' if name.startswith('angry') else name) + '.png'
        if not (out / fn).exists() or name != 'angryOpen':
            v, log[name] = align(base, Image.open(path)); v, log[name]['tone'] = tone_match(base, v, face, feats); v.putalpha(base.getchannel('A')); v.save(out / fn)
        tex[name] = fn
    tex['troubledBlink'] = tex['angryBlink'] = 'blink_mouth.png'   # 表情の途中のまばたきは、閉じ目の絵で
    ex = lambda e: [e[0], round(e[1] - 10 * s, 1), round(max(e[2], 42 * s), 1), round(max(e[3], 42 * s), 1)]
    model['expressions'] = {'version': 2, 'textureSize': [W, H], 'textures': tex,
                            'eyeL': ex(model['eyeL']), 'eyeR': ex(model['eyeR']), 'mouthRegion': mouth, 'mouthSampleY': model['mouthSampleY'],
                            'smileMouthRest': 0.55, 'speechSmileMouthRest': 0.2,
                            'angryMouthClosure': [round(cy + 2 * s, 1), round(cy + 2 * s, 1), S(-3), 0.28], 'angryMouthCornerX': model['mouthCornerX']}
    (out / 'model.json').write_text(json.dumps(model, ensure_ascii=False, indent=1))

    # 確認用の絵：見つけた目・口（赤）、髪が揺れる範囲（青）、顔を守る範囲（緑）、首の回転の中心（黄）
    chk = on_white(base).convert('RGBA'); ov = Image.new('RGBA', chk.size); d = ImageDraw.Draw(ov)
    for c, col in ((model['eyeL'], (255, 0, 0, 255)), (model['eyeR'], (255, 0, 0, 255)), (mouth, (255, 0, 0, 255)), (face, (0, 200, 0, 255))):
        d.ellipse((c[0] - c[2], c[1] - c[3], c[0] + c[2], c[1] + c[3]), outline=col, width=3)
    for side in ('left', 'right'):
        y0, y1, xa, xb = model['naturalMotion'][side][:4]; d.line((xa, y0, xb, y1), fill=(0, 90, 255, 255), width=4)
    hx, hy = model['headPivot']; d.ellipse((hx - 8, hy - 8, hx + 8, hy + 8), fill=(255, 210, 0, 255))
    chk.alpha_composite(ov); chk.convert('RGB').save(out / 'check.png')
    print(json.dumps({'目と目の間(px)': round(R['cx'] - L['cx'], 1), '左目': model['eyeL'], '右目': model['eyeR'], '口': mouth, '位置合わせ': log},
                     ensure_ascii=False, indent=1))
    print(f'できました: {out}/model.json  （確認用 {out}/check.png）')


if __name__ == '__main__':
    main()
