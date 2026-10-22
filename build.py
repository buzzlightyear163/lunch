#!/usr/bin/env python3
"""Assembles src/ into one self-contained index.html.
Usage: python3 build.py            -> writes index.html (full page for Vercel / any static host)
       python3 build.py --fragment OUT -> writes a head-less fragment (for an artifact preview)"""
import sys, pathlib, urllib.parse

root = pathlib.Path(__file__).parent
src = root / 'src'
css = (src / 'style.css').read_text()
engine = (src / 'engine.js').read_text()
app = (src / 'app.js').read_text()
scenes = (src / 'scenes.js').read_text()
motion = (src / 'motion.js').read_text()
body = (src / 'body.html').read_text()

mark = ('<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64"><rect width="64" height="64" fill="#0d0c0b"/>'
        '<rect x="6" y="13" width="52" height="10" rx="1" fill="#efe8db"/>'
        '<path d="M7 27H43A4.2 4.2 0 0 0 43 32A4.2 4.2 0 0 0 43 37H7A1 1 0 0 1 6 36V28A1 1 0 0 1 7 27Z" fill="#e6492f"/>'
        '<rect x="6" y="41" width="52" height="10" rx="1" fill="#efe8db"/></svg>')
favicon = 'data:image/svg+xml,' + urllib.parse.quote(mark)

head = f'''<title>LUNCH</title>
<meta name="claude:viewport-fit-sides" content="cover">
<meta name="description" content="Bots ate your lunch. LUNCH finds every sandwich attack on your pump.fun swaps, shows what it cost you, and tunes your slippage.">
<meta name="theme-color" content="#0d0c0b">
<meta property="og:title" content="LUNCH · Bots ate your lunch.">
<meta property="og:description" content="Check any Solana wallet for sandwich attacks on pump.fun and PumpSwap.">
<link rel="icon" href="{favicon}">
<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Archivo:wdth,wght@62..125,100..900&family=Martian+Mono:wdth,wght@75..112.5,300..700&display=swap">
<style>
{css}
</style>'''

THREE_URL = 'https://cdnjs.cloudflare.com/ajax/libs/three.js/r128/three.min.js'
scripts = (f'<script src="{THREE_URL}"></script>\n'
           f'<script>\n{engine}\n</script>\n<script>\n{app}\n</script>\n'
           f'<script>\n{scenes}\n</script>\n<script>\n{motion}\n</script>')

if len(sys.argv) > 2 and sys.argv[1] == '--fragment':
    out = pathlib.Path(sys.argv[2])
    out.write_text(head + '\n' + body + '\n' + scripts + '\n')
    print('fragment ->', out)
else:
    page = ('<!doctype html>\n<html lang="en">\n<head>\n<meta charset="utf-8">\n'
            '<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">\n'
            + head + '\n</head>\n<body>\n' + body + '\n' + scripts + '\n</body>\n</html>\n')
    (root / 'index.html').write_text(page)
    print('page ->', root / 'index.html', len(page), 'bytes')
