"""Build dist/: one self-contained index.html (works even opened as a local file) plus PWA files."""
import base64, hashlib, os, re, shutil, sys
ROOT = os.path.dirname(os.path.abspath(__file__))
SRC, VEND, DIST = os.path.join(ROOT, 'src'), os.path.join(ROOT, 'vendor'), os.path.join(ROOT, 'dist')
KATEX = os.path.join(VEND, 'katex-0.16.11', 'dist')
HLJS = os.path.join(VEND, 'hljs')
APP_FILES = ['fsrs.js', 'text.js', 'importer.js', 'db.js', 'col.js', 'prompt.js', 'ui_core.js', 'ui_views.js', 'ui_edit.js',
             'ui_import.js', 'ui_settings.js', 'ui_stats.js', 'ui_io.js', 'apkg.js', 'optimizer.js', 'samples.js', 'main.js']
VERSION = '1.0.0'

def read(p, mode='r'):
    with open(p, mode, **({} if 'b' in mode else {'encoding': 'utf-8'})) as f:
        return f.read()

def katex_css():
    css = read(os.path.join(KATEX, 'katex.min.css'))
    def repl(m):
        name = m.group(1)
        data = base64.b64encode(read(os.path.join(KATEX, 'fonts', name + '.woff2'), 'rb')).decode()
        return 'src:url(data:font/woff2;base64,' + data + ') format("woff2")'
    css, n = re.subn(r'src:url\(fonts/(KaTeX_[\w-]+)\.woff2\) format\("woff2"\),url\(fonts/[\w-]+\.woff\) format\("woff"\),url\(fonts/[\w-]+\.ttf\) format\("truetype"\)', repl, css)
    assert n >= 19, 'font rewrite failed: %d' % n
    assert 'url(fonts/' not in css
    return css

def hljs_css():
    light = read(os.path.join(HLJS, 'styles', 'github.min.css'))
    dark = read(os.path.join(HLJS, 'styles', 'github-dark.min.css'))
    dark = re.sub(r'/\*.*?\*/', '', dark, flags=re.S)
    # scope the dark theme to night mode cards
    def scope(block):
        sel, body = block.group(1), block.group(2)
        sels = ','.join('.nightMode ' + s.strip() for s in sel.split(','))
        return sels + '{' + body + '}'
    dark = re.sub(r'([^{}]+)\{([^{}]*)\}', scope, dark)
    return light + '\n' + dark

def safe_js(js):
    return js.replace('</script', '<\\/script').replace('<!--', '<\\!--')

def build():
    if os.path.isdir(DIST):
        shutil.rmtree(DIST)
    os.makedirs(os.path.join(DIST, 'vendor'))
    vendor_js = '\n;\n'.join(read(p) for p in [
        os.path.join(KATEX, 'katex.min.js'), os.path.join(KATEX, 'contrib', 'auto-render.min.js'),
        os.path.join(KATEX, 'contrib', 'mhchem.min.js'), os.path.join(HLJS, 'highlight.min.js')])
    app_js = ''.join('\n/* ---- %s ---- */\n' % f + read(os.path.join(SRC, f)) for f in APP_FILES if os.path.exists(os.path.join(SRC, f)))
    body_hash = hashlib.sha256((vendor_js + app_js + read(os.path.join(SRC, 'app.css'))).encode()).hexdigest()[:10]
    app_js = "window.APP_NAME='Engram';window.APP_VERSION='%s (%s)';\n" % (VERSION, body_hash) + app_js
    for bad in ['—']:
        assert bad not in app_js, 'em dash in app source'
    html = read(os.path.join(SRC, 'index.html'))
    html = html.replace('/*KATEX_CSS*/', katex_css()).replace('/*HLJS_CSS*/', hljs_css()).replace('/*APP_CSS*/', read(os.path.join(SRC, 'app.css')))
    html = html.replace('/*VENDOR_JS*/', safe_js(vendor_js)).replace('/*APP_JS*/', safe_js(app_js))
    with open(os.path.join(DIST, 'index.html'), 'w', encoding='utf-8') as f:
        f.write(html)
    with open(os.path.join(DIST, 'sw.js'), 'w', encoding='utf-8') as f:
        f.write(read(os.path.join(SRC, 'sw.js')).replace('__VERSION__', body_hash))
    shutil.copy(os.path.join(SRC, 'manifest.webmanifest'), DIST)
    for n in os.listdir(os.path.join(ROOT, 'assets')):
        shutil.copy(os.path.join(ROOT, 'assets', n), DIST)
    shutil.copy(os.path.join(VEND, 'jszip-3.10.1', 'dist', 'jszip.min.js'), os.path.join(DIST, 'vendor'))
    shutil.copy(os.path.join(VEND, 'sql.js-1.10.3', 'dist', 'sql-wasm.js'), os.path.join(DIST, 'vendor'))
    shutil.copy(os.path.join(VEND, 'sql.js-1.10.3', 'dist', 'sql-wasm.wasm'), os.path.join(DIST, 'vendor'))
    shutil.copy(os.path.join(VEND, 'fzstd-0.1.1', 'umd', 'index.js'), os.path.join(DIST, 'vendor', 'fzstd.js'))
    with open(os.path.join(DIST, '.nojekyll'), 'w') as f:
        f.write('')
    size = os.path.getsize(os.path.join(DIST, 'index.html'))
    print('built dist/index.html (%.0f KB), version %s' % (size / 1024, body_hash))

if __name__ == '__main__':
    build()
