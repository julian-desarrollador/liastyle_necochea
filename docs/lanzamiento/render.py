#!/usr/bin/env python3
"""Render Lia Style launch flyers to PNG with headless Chrome."""

from __future__ import annotations

import http.server
import os
import shutil
import socketserver
import subprocess
import threading
import time
from pathlib import Path

ROOT = Path(__file__).resolve().parent
OUT = ROOT / "png"
CHROME = shutil.which("google-chrome-stable") or shutil.which("google-chrome") or "/usr/bin/google-chrome-stable"

JOBS = [
    ("story-crema.html", "story_crema.png", 1080, 1920),
    ("story-oscuro.html", "story_oscuro.png", 1080, 1920),
    ("story-salon.html", "story_salon.png", 1080, 1920),
    ("story-pasos.html", "story_pasos.png", 1080, 1920),
    ("wa-difusion.html", "wa_difusion.png", 1080, 1350),
    ("wa-recepcion.html", "wa_recepcion.png", 1080, 1350),
    ("qr-local.html", "qr_local.png", 1080, 1080),
]


class Handler(http.server.SimpleHTTPRequestHandler):
    def __init__(self, *args, **kwargs):
        super().__init__(*args, directory=str(ROOT), **kwargs)

    def log_message(self, format, *args):  # noqa: A003
        return


def main() -> None:
    OUT.mkdir(exist_ok=True)
    httpd = socketserver.TCPServer(("127.0.0.1", 0), Handler)
    port = httpd.server_address[1]
    thread = threading.Thread(target=httpd.serve_forever, daemon=True)
    thread.start()
    time.sleep(0.3)

    for src, dest, w, h in JOBS:
        out = OUT / dest
        url = f"http://127.0.0.1:{port}/{src}"
        cmd = [
            CHROME,
            "--headless=new",
            "--disable-gpu",
            "--no-sandbox",
            "--hide-scrollbars",
            "--force-device-scale-factor=1",
            f"--window-size={w},{h}",
            "--virtual-time-budget=4000",
            f"--screenshot={out}",
            url,
        ]
        print("render", dest, flush=True)
        subprocess.run(cmd, check=True, stdout=subprocess.DEVNULL, stderr=subprocess.STDOUT)
        size = out.stat().st_size
        print(f"  -> {out} ({size} bytes)", flush=True)

    httpd.shutdown()


if __name__ == "__main__":
    main()
