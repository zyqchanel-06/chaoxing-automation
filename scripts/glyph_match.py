# -*- coding: utf-8 -*-
"""用字形比对还原混淆字体：混淆字体的 glyph 形状 == 真实汉字。"""
import sys, numpy as np
from fontTools.ttLib import TTFont
from PIL import Image, ImageDraw, ImageFont

SIZE = 48

def render(font, ch, canvas=110, px=80):
    img = Image.new("L", (canvas, canvas), 255)
    d = ImageDraw.Draw(img)
    try:
        d.text((canvas // 2, canvas // 2), ch, font=font, fill=0, anchor="mm")
    except Exception:
        return None
    bbox = img.point(lambda p: 255 - p).getbbox()
    if not bbox:
        return None
    img = img.crop(bbox).resize((SIZE, SIZE), Image.LANCZOS)
    a = np.asarray(img, dtype=np.float32) / 255.0
    return 1.0 - a          # 1 = 墨迹

def load_candidates(ttf_path):
    chars, mats = [], []
    f = ImageFont.truetype(ttf_path, 80)
    for code in range(0x4E00, 0x9FA6):
        ch = chr(code)
        r = render(f, ch)
        if r is None:
            continue
        chars.append(ch)
        mats.append(r.ravel())
    return chars, np.asarray(mats, dtype=np.float32)

def main():
    obf_ttf, out_map = sys.argv[1], sys.argv[2]
    obf = TTFont(obf_ttf)
    codes = sorted(obf.getBestCmap().keys())
    of = ImageFont.truetype(obf_ttf, 80)

    targets, tcodes = [], []
    for c in codes:
        r = render(of, chr(c))
        if r is None:
            continue
        tcodes.append(c)
        targets.append(r.ravel())
    T = np.asarray(targets, dtype=np.float32)
    Tn = T / (np.linalg.norm(T, axis=1, keepdims=True) + 1e-6)

    results = {}
    for cand_ttf in ["C:/Windows/Fonts/msyh.ttc", "C:/Windows/Fonts/simsun.ttc"]:
        try:
            chars, C = load_candidates(cand_ttf)
        except Exception as e:
            print("candidate font failed:", cand_ttf, e)
            continue
        Cn = C / (np.linalg.norm(C, axis=1, keepdims=True) + 1e-6)
        sim = Tn @ Cn.T                       # (31, N)
        order = np.argsort(-sim, axis=1)
        for i, code in enumerate(tcodes):
            top = order[i, :3]
            entry = results.setdefault(code, {})
            entry[cand_ttf.split("/")[-1]] = [
                (chars[j], round(float(sim[i, j]), 4)) for j in top
            ]

    lines = []
    for code in tcodes:
        e = results.get(code, {})
        msyh = e.get("msyh.ttc", [("?", 0)])
        simsun = e.get("simsun.ttc", [("?", 0)])
        agree = "OK " if msyh[0][0] == simsun[0][0] else "?? "
        lines.append(f"{agree}U+{code:04X}\t{chr(code)}\tmsyh={msyh[0][0]}({msyh[0][1]})\tsimsun={simsun[0][0]}({simsun[0][1]})\talt={msyh[1][0]}")
    out = "\n".join(lines)
    print(out)
    with open(out_map, "w", encoding="utf-8") as fh:
        fh.write(out)

main()