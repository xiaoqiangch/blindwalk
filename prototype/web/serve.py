#!/usr/bin/env python3
"""步迷 · 局域网服务（给 iPhone 打开 / 装到主屏用）。

用法：
    python3 serve.py            # 默认 8799 端口
    python3 serve.py 9000       # 自定义端口

启动后终端会打印类似：
    📱 手机上打开：http://192.168.1.24:8788/
"""
import http.server
import socket
import socketserver
import sys
import os

PORT = int(sys.argv[1]) if len(sys.argv) > 1 else 8799


def lan_ip() -> str:
    """找真正的局域网地址。
    注意：直接 connect 8.8.8.8 在有 VPN（utun 隧道）时可能返回 198.18.0.1 这类假地址，
    iPhone 走不到。这里按网卡优先级挑：en0 优先，其次其他 en*，最后才回落。"""
    import subprocess, re
    def addr_of(iface: str) -> str:
        try:
            out = subprocess.run(["/usr/sbin/ipconfig", "getifaddr", iface],
                                 capture_output=True, text=True, timeout=3).stdout.strip()
            return out
        except Exception:
            return ""

    # en0 = 通常的 Wi-Fi / 以太网主网卡
    for iface in ["en0", "en1", "en2"]:
        ip = addr_of(iface)
        if ip and not ip.startswith("169.254") and not ip.startswith("198.18"):
            return ip

    # 兜底：扫所有 en*
    try:
        names = subprocess.run(["/sbin/ifconfig", "-l"], capture_output=True, text=True).stdout.split()
        for name in names:
            if not name.startswith("en"):
                continue
            ip = addr_of(name)
            if ip and not ip.startswith("169.254") and not ip.startswith("198.18"):
                return ip
    except Exception:
        pass

    return "127.0.0.1"


class Handler(http.server.SimpleHTTPRequestHandler):
    extensions_map = {
        **http.server.SimpleHTTPRequestHandler.extensions_map,
        ".webmanifest": "application/manifest+json",
        ".json": "application/json",
        ".js": "text/javascript",
        ".css": "text/css",
        ".png": "image/png",
        ".html": "text/html",
        ".svg": "image/svg+xml",
    }

    def end_headers(self):
        # Service Worker 必须不被缓存，否则更新后拿不到新版本
        if self.path.endswith("sw.js") or self.path.endswith("manifest.webmanifest"):
            self.send_header("Cache-Control", "no-cache, no-store, must-revalidate")
        self.send_header("X-Content-Type-Options", "nosniff")
        super().end_headers()

    def log_message(self, fmt, *args):
        pass  # 安静一点


def main():
    os.chdir(os.path.dirname(os.path.abspath(__file__)))
    ip = lan_ip()
    socketserver.TCPServer.allow_reuse_address = True
    print()
    print("  步迷 Walkaholic · 局域网服务")
    print("  ─────────────────────────────────────────────")
    print(f"  📱 iPhone 打开：  http://{ip}:{PORT}/")
    print(f"  💻 本机电脑预览： http://127.0.0.1:{PORT}/")
    print()
    print("  装到主屏：Safari 打开上面地址 → 分享 → 添加到主屏幕")
    print("  停止服务：Control + C")
    print()
    with socketserver.TCPServer(("0.0.0.0", PORT), Handler) as httpd:
        try:
            httpd.serve_forever()
        except KeyboardInterrupt:
            print("\n已停止。")


if __name__ == "__main__":
    main()
