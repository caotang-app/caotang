#!/usr/bin/env python3
"""Builds NotoEmoji-Regular.woff from the upstream Noto Emoji variable font.

Run: python3 vendor/noto-emoji/build.py <path to NotoEmoji[wght].ttf>

The source is the file README.md names, at the commit it names, and its SHA-256 is checked before anything is built. The
output is written beside this script, and its SHA-256 is compared with SHA256SUMS. The same source and the same fontTools
version give the same bytes.

The steps:

1. The variable font is instanced at its default weight, 400 (Regular), into a static TrueType font: the weight axis, its
   variation tables and the style table go. The PDF exporter embeds a static font; a PDF cannot carry a variable one.
2. Every character the font maps is kept, with every glyph the `ccmp` feature reaches from them: the ligatures that draw a
   ZWJ sequence, a flag, a keycap or a tag sequence as one picture. GSUB stays (the exporter lays emoji out through it);
   the vertical metrics and the grid-fitting table go. Each glyph is padded to 4 bytes, because fontkit's subsetter copies
   glyph data as it finds it.
3. The result is stored as WOFF 1.0 (zlib), which the exporter unpacks before fontkit reads it.
"""

import hashlib
import sys
from pathlib import Path

import fontTools
from fontTools import subset
from fontTools.ttLib import TTFont
from fontTools.varLib import instancer

FONTTOOLS_VERSION = "4.61.1"
SOURCE_SHA256 = "de6c18832938afc99caf132b39d6a30a19bac7f2e812e28db2535b4608d27551"
OUTPUT = "NotoEmoji-Regular.woff"
HERE = Path(__file__).resolve().parent


def sha256(path: Path) -> str:
    return hashlib.sha256(path.read_bytes()).hexdigest()


def main() -> int:
    if len(sys.argv) != 2:
        print(__doc__.splitlines()[2].strip(), file=sys.stderr)
        return 2
    if fontTools.version != FONTTOOLS_VERSION:
        print(f"fontTools {FONTTOOLS_VERSION} is required (found {fontTools.version})", file=sys.stderr)
        return 1
    source = Path(sys.argv[1])
    if sha256(source) != SOURCE_SHA256:
        print(f"{source} is not the pinned source (SHA-256 {SOURCE_SHA256})", file=sys.stderr)
        return 1

    # The head table keeps its upstream dates, so the output does not depend on when it was built.
    font = TTFont(source, recalcTimestamp=False)
    font = instancer.instantiateVariableFont(font, {"wght": 400}, updateFontNames=False)

    options = subset.Options()
    options.layout_features = ["ccmp"]
    options.hinting = False
    options.notdef_outline = True
    options.name_IDs = ["*"]
    options.name_languages = ["*"]
    options.drop_tables += ["vhea", "vmtx", "gasp", "STAT", "DSIG"]
    options.flavor = "woff"
    subsetter = subset.Subsetter(options)
    subsetter.populate(unicodes=font.getBestCmap().keys())
    subsetter.subset(font)
    font["glyf"].padding = 4

    output = HERE / OUTPUT
    subset.save_font(font, str(output), options)
    digest = sha256(output)
    expected = (HERE / "SHA256SUMS").read_text().split() if (HERE / "SHA256SUMS").exists() else []
    pinned = expected[expected.index(OUTPUT) - 1] if OUTPUT in expected else None
    print(f"{OUTPUT}: {output.stat().st_size} bytes, SHA-256 {digest}")
    if pinned is not None and pinned != digest:
        print(f"the output differs from SHA256SUMS ({pinned})", file=sys.stderr)
        return 1
    return 0


if __name__ == "__main__":
    sys.exit(main())
