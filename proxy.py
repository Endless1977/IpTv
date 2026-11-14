#!/usr/bin/env python3
"""Kijkdoos web-server + CORS-proxy (bijv. voor op de Raspberry Pi).

Start:  python3 proxy.py [poort]      (standaard 8090)
Open:   http://<ip-van-pi>:8090/       -> de app
Proxy:  http://<ip-van-pi>:8090/proxy?url=   -> invullen bij Instellingen > CORS-proxy

Alleen nodig voor de browser-versie; de Android- en Windows-app werken zonder.
"""
import sys, os, urllib.request, urllib.parse, http.server, socketserver, ssl

ROOT = os.path.join(os.path.dirname(os.path.abspath(__file__)), 'www')
PORT = int(sys.argv[1]) if len(sys.argv) > 1 else 8090
PASS_HEADERS = ('Range', 'User-Agent', 'Accept')
CTX = ssl.create_default_context()

class H(http.server.SimpleHTTPRequestHandler):
    def __init__(self, *a, **kw): super().__init__(*a, directory=ROOT, **kw)

    def end_headers(self):
        self.send_header('Access-Control-Allow-Origin', '*')
        self.send_header('Access-Control-Allow-Headers', '*')
        self.send_header('Access-Control-Expose-Headers', '*')
        super().end_headers()

    def do_OPTIONS(self):
        self.send_response(204); self.end_headers()

    def do_GET(self):
        if not self.path.startswith('/proxy'):
            return super().do_GET()
        q = urllib.parse.parse_qs(urllib.parse.urlparse(self.path).query)
        url = (q.get('url') or [''])[0]
        if not url.startswith(('http://', 'https://')):
            self.send_error(400, 'url ontbreekt'); return
        hdrs = {k: self.headers[k] for k in PASS_HEADERS if self.headers.get(k)}
        hdrs.setdefault('User-Agent', 'Mozilla/5.0 Kijkdoos')
        try:
            r = urllib.request.urlopen(urllib.request.Request(url, headers=hdrs), timeout=20, context=CTX)
        except urllib.error.HTTPError as e:
            r = e
        except Exception as e:
            self.send_error(502, str(e)[:100]); return
        self.send_response(r.status if hasattr(r, 'status') else r.code)
        for k in ('Content-Type', 'Content-Length', 'Content-Range', 'Accept-Ranges'):
            if r.headers.get(k): self.send_header(k, r.headers[k])
        self.end_headers()
        try:
            while True:
                chunk = r.read(64 * 1024)
                if not chunk: break
                self.wfile.write(chunk)
        except (BrokenPipeError, ConnectionResetError):
            pass

    def log_message(self, *a): pass

class S(socketserver.ThreadingMixIn, http.server.HTTPServer):
    daemon_threads = True; allow_reuse_address = True

if __name__ == '__main__':
    print(f'Kijkdoos draait op http://0.0.0.0:{PORT}/  (proxy: /proxy?url=)')
    S(('0.0.0.0', PORT), H).serve_forever()
