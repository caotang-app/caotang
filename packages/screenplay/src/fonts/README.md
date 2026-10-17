# Fonts of the screenplay PDF

| File | Font | Source | SHA-256 | License |
| --- | --- | --- | --- | --- |
| `courier-prime-regular.ts` | Courier Prime Regular 3.018, as base64 | google/fonts, `ofl/courierprime/CourierPrime-Regular.ttf` (71188 bytes) | `72f793376f8e2841656bf21d77a5de010f2929bd6956a22ee848ad0c7eb978af` (the TTF) | OFL 1.1, `OFL.txt` |
| `NotoSansMonoCJKsc-Regular.otf` | Noto Sans Mono CJK SC Regular 2.004 | https://github.com/notofonts/noto-cjk/raw/Sans2.004/Sans/Mono/NotoSansMonoCJKsc-Regular.otf (16393784 bytes, tag `Sans2.004`, commit 523d033d6cb47f4a80c58a35753646f5c3608a78) | `ec04cc376b34887cedbdf84074e2e226ed2761eeabdcb9173fc1dd7bfd153ef7` | OFL 1.1, `OFL-NotoSansMonoCJK.txt` |

Courier Prime is the screenplay font. Noto Sans Mono CJK SC is the fallback for every character WinAnsi cannot encode: Hanzi, kana, Hangul and more. Both are byte for byte as published. `test/pdf-font.test.ts` and `test/pdf-cjk.test.ts` check the files.

`noto-cjk-coverage.ts` lists the code points the Noto font maps. It is generated from the font: run `node packages/screenplay/scripts/cjk-coverage.mjs` after the font changes.

The Noto file is loaded only by `src/cjk-font.ts`, through a dynamic import, and only for a script that needs it.
