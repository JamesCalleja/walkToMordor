#!/usr/bin/env python3
import http.server
import os
import socket
import socketserver

PORT = int(os.environ.get("PORT", 8080))
PUBLIC_DIR = os.path.join(os.path.dirname(os.path.abspath(__file__)), "public")


def get_lan_ip():
    try:
        s = socket.socket(socket.AF_INET, socket.SOCK_DGRAM)
        s.connect(("8.8.8.8", 80))
        ip = s.getsockname()[0]
        s.close()
        return ip
    except Exception:
        return "127.0.0.1"


class Handler(http.server.SimpleHTTPRequestHandler):
    def __init__(self, *args, **kwargs):
        super().__init__(*args, directory=PUBLIC_DIR, **kwargs)

    def end_headers(self):
        self.send_header("Cache-Control", "no-cache")
        super().end_headers()


if __name__ == "__main__":
    socketserver.TCPServer.allow_reuse_address = True
    lan_ip = get_lan_ip()
    with socketserver.TCPServer(("0.0.0.0", PORT), Handler) as httpd:
        print(f"💍 Walk to Mordor PWA running!")
        print(f"   • Local Mac browser:   http://localhost:{PORT}")
        print(f"   • OnePlus Nord (Wi-Fi): http://{lan_ip}:{PORT}")
        httpd.serve_forever()
