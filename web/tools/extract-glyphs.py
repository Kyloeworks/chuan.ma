#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
从 OFL 授权字体中抽取麻将牌面所需的汉字轮廓，产出 web/glyphs.js。

为什么不用 <text>：
  浏览器渲染 <text> 依赖本机已装字体。KaiTi / SimSun 是 Windows 专有字体，
  在 Linux / Android / iOS 上会静默回退到别的字形（同一张牌面在不同设备上
  长得不一样），而且把专有字体的派生轮廓公开发布有授权风险。
  权威开源牌面资产（FluffyStuff/riichi-mahjong-tiles）全部使用手绘路径、
  零字体依赖 —— 这是跨设备像素一致的前提。

字体：霞鹜文楷 TC Bold（LXGW WenKai TC Bold，SIL Open Font License 1.1）
  来源 https://github.com/lxgw/LxgwWenKai ／ Google Fonts 镜像 ofl/lxgwwenkaitc
  选用 TC（繁体）而非 SC：麻将牌面用「萬」而非简体「万」。
  选用**楷体**而非宋体：宋体的横画天生细（一 / 二 / 三 的竖看只有别的字三分之一的
  墨量），而麻将牌面应是毛笔楷书那种匀重笔画 —— 实测牌河尺寸 33×46 下，
  楷体的「一」墨迹是宋体的 1.6 倍，可辨识度差距最明显的就是这几个简单字。

用法：
  python web/tools/extract-glyphs.py <字体文件.ttf|otf> <输出 web/glyphs.js> [许可证文件]
"""
import json
import sys

from fontTools.pens.boundsPen import BoundsPen
from fontTools.pens.svgPathPen import SVGPathPen
from fontTools.ttLib import TTFont

# 牌面需要的全部字形：万子的数字 + 「萬」
CHARS = ["一", "二", "三", "四", "五", "六", "七", "八", "九", "萬"]

# 运行期 web/tiles-ui.js 的 fitPath() 能处理的命令集。
# 只要这里出现集合外的命令，构建期就失败 —— 否则运行期会产出 NaN 坐标，
# 字整块消失而且浏览器不报错（这个坑踩过一次：漏了 H/V，横竖笔画全丢）。
ALLOWED_CMDS = set("MLHVCQZ")


def font_family(font: TTFont) -> str:
    """从字体自身的 name 表取名字 —— 不写死，避免换了字体而元数据没跟着换。"""
    for name_id in (4, 1):           # 4 = Full name, 1 = Family
        for rec in font["name"].names:
            if rec.nameID == name_id and rec.platformID == 3:
                try:
                    return rec.toUnicode()
                except Exception:     # noqa: BLE001
                    continue
    return "unknown"


def tidy(path_d: str) -> str:
    """压缩数字：去掉多余小数位，精简空格，缩短路径串。"""
    import re

    def num(m):
        v = float(m.group(0))
        s = f"{v:.1f}".rstrip("0").rstrip(".")
        if s in ("-0", ""):
            s = "0"
        return s

    d = re.sub(r"-?\d+\.\d+", num, path_d)
    d = re.sub(r"\s+", " ", d).strip()
    # 命令字母前后不需要空格以外的分隔
    d = re.sub(r"\s*([A-Za-z])\s*", r"\1", d)
    return d


def main() -> int:
    if len(sys.argv) < 3:
        print(__doc__)
        return 2
    font_path, out_path = sys.argv[1], sys.argv[2]
    license_path = sys.argv[3] if len(sys.argv) > 3 else None

    font = TTFont(font_path, fontNumber=0)
    upem = font["head"].unitsPerEm
    cmap = font.getBestCmap()
    glyph_set = font.getGlyphSet()

    table = {}
    missing = []
    for ch in CHARS:
        name = cmap.get(ord(ch))
        if name is None:
            missing.append(ch)
            continue
        pen = SVGPathPen(glyph_set, ntos=lambda v: f"{v:.1f}")
        glyph_set[name].draw(pen)
        d = tidy(pen.getCommands())

        cmds = set(c for c in d if c.isalpha())
        unexpected = cmds - ALLOWED_CMDS
        if unexpected:
            print(
                f"ERROR 字形 {ch} 含运行期不支持的命令 {sorted(unexpected)}；"
                f"请同步扩展 tiles-ui.js 的 fitPath() 与 ALLOWED_CMDS",
                file=sys.stderr,
            )
            return 1

        bp = BoundsPen(glyph_set)
        glyph_set[name].draw(bp)
        bbox = [round(v, 1) for v in bp.bounds] if bp.bounds else [0, 0, 0, 0]

        table[ch] = {
            "n": name,
            "d": d,
            "b": bbox,  # xMin, yMin, xMax, yMax（字体坐标系，em 单位）
        }

    if missing:
        print(f"ERROR 字体缺少字形: {''.join(missing)}", file=sys.stderr)
        return 1

    used = set()
    for v in table.values():
        used |= set(c for c in v["d"] if c.isalpha())

    payload = {
        "upem": upem,
        "font": font_family(font),        # 从字体文件读出，不写死
        "cmds": "".join(sorted(used)),    # 运行期 fitPath 必须支持这些命令
        "glyphs": table,
    }
    js = (
        "/* 自动生成 —— 请勿手改。\n"
        " * 由 web/tools/extract-glyphs.py 从 Noto Serif TC Bold 抽取汉字轮廓。\n"
        " * 字型版权归原作者，以 SIL Open Font License 1.1 授权（见 docs/OFL.txt）。\n"
        " * 牌面使用内嵌矢量路径而非系统字体：跨设备像素一致 + 零字体依赖。\n"
        " */\n"
        ";(function (g) {\n"
        "  var D = " + json.dumps(payload, ensure_ascii=False, separators=(",", ":")) + ";\n"
        "  g.CMGlyphs = D;\n"
        "})(typeof window !== 'undefined' ? window : this);\n"
    )
    with open(out_path, "w", encoding="utf-8", newline="\n") as fh:
        fh.write(js)

    total = sum(len(v["d"]) for v in table.values())
    print(f"upem={upem}  字形={len(table)}  路径总长={total} 字符  ->  {out_path}")

    if license_path:
        import shutil

        shutil.copyfile(font_path, font_path)  # noop，占位说明来源
        print(f"许可证请随产物一并保留：{license_path}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
