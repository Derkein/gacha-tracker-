#!/usr/bin/env python3
"""Qimai daily fetch — a small window with two cookie fields, one per account.

Qimai's free tier shows 3 apps/day per account, so two accounts split the six games:
  Cookie 1  →  genshin / hsr / zzz        (HoYo)
  Cookie 2  →  wuwa / endfield / nte
Both run, data/qimai.json is rebuilt, and anything new is committed + pushed. Each field is
pre-filled with the last cookie you used (stored gitignored in scripts/.qimai_cookie /
.qimai_cookie2). If a cookie has expired the log says exactly which one, so you can paste a
fresh string into that field and hit Run again.

Launched by qimai_daily.bat. Needs the repo's normal deps (playwright) plus stdlib tkinter.
"""
import os, sys, subprocess, threading, queue, datetime, time
import tkinter as tk
from tkinter import scrolledtext, font as tkfont

HERE    = os.path.dirname(os.path.abspath(__file__))
GT      = os.path.dirname(HERE)                       # repo root
COOKIE1 = os.path.join(HERE, ".qimai_cookie")         # HoYo
COOKIE2 = os.path.join(HERE, ".qimai_cookie2")        # wuwa/endfield/nte
GROUP1  = ["genshin", "hsr", "zzz"]
GROUP2  = ["wuwa", "endfield", "nte"]
PY      = sys.executable

def read_cookie(path):
    try:
        with open(path, encoding="utf-8") as f:
            return f.read().strip()
    except OSError:
        return ""

def write_cookie(path, val):
    with open(path, "w", encoding="utf-8") as f:
        f.write(val.strip())

class App:
    def __init__(self, root):
        self.root = root
        self.q = queue.Queue()
        self.running = False
        root.title("Qimai daily fetch")
        root.geometry("820x640")
        root.minsize(680, 520)

        mono = tkfont.nametofont("TkFixedFont")

        head = tk.Label(root, text="Fetch all six games (two accounts, 3 each) and push new days",
                        font=("Segoe UI", 11, "bold"), anchor="w")
        head.pack(fill="x", padx=12, pady=(12, 2))

        self._cookie_field("Cookie 1  —  HoYo  (genshin · hsr · zzz)", read_cookie(COOKIE1), "box1")
        self._cookie_field("Cookie 2  —  wuwa · endfield · nte", read_cookie(COOKIE2), "box2")

        bar = tk.Frame(root); bar.pack(fill="x", padx=12, pady=(4, 6))
        self.btn = tk.Button(bar, text="Run  ▶   fetch all 6 & push",
                             font=("Segoe UI", 10, "bold"), command=self.on_run)
        self.btn.pack(side="left")
        self.status = tk.Label(bar, text="Ready.", anchor="w", font=("Segoe UI", 10))
        self.status.pack(side="left", padx=12)

        self.log = scrolledtext.ScrolledText(root, height=16, wrap="word", font=mono,
                                             state="disabled", bg="#111", fg="#ddd",
                                             insertbackground="#ddd")
        self.log.pack(fill="both", expand=True, padx=12, pady=(0, 12))
        self.log.tag_config("err", foreground="#ff7a6b")
        self.log.tag_config("ok",  foreground="#6bd08a")
        self.log.tag_config("hd",  foreground="#7aa2ff")

        self.root.after(80, self._pump)

    def _cookie_field(self, label, value, attr):
        tk.Label(self.root, text=label, anchor="w", font=("Segoe UI", 9, "bold"),
                 fg="#333").pack(fill="x", padx=12, pady=(6, 1))
        box = tk.Text(self.root, height=3, wrap="char", font=("Consolas", 9),
                      bg="#f6f6f6", relief="solid", borderwidth=1)
        box.insert("1.0", value)
        box.pack(fill="x", padx=12)
        setattr(self, attr, box)

    # ---- logging (called from the worker thread via a queue) ----
    def _put(self, text, tag=None):
        self.q.put((text, tag))

    def _pump(self):
        try:
            while True:
                text, tag = self.q.get_nowait()
                self.log.configure(state="normal")
                self.log.insert("end", text, tag or ())
                self.log.see("end")
                self.log.configure(state="disabled")
        except queue.Empty:
            pass
        self.root.after(80, self._pump)

    def set_status(self, text, kind="normal"):
        colors = {"normal": "#333", "err": "#c0392b", "ok": "#1f9d57", "busy": "#b06a00"}
        self.status.config(text=text, fg=colors.get(kind, "#333"))

    # ---- run ----
    def on_run(self):
        if self.running:
            return
        c1 = self.box1.get("1.0", "end").strip()
        c2 = self.box2.get("1.0", "end").strip()
        # persist for next launch (pre-fill) even if the run then fails
        if c1: write_cookie(COOKIE1, c1)
        if c2: write_cookie(COOKIE2, c2)
        self.running = True
        self.btn.config(state="disabled")
        self.set_status("Working…", "busy")
        self.log.configure(state="normal"); self.log.delete("1.0", "end"); self.log.configure(state="disabled")
        threading.Thread(target=self._worker, args=(c1, c2), daemon=True).start()

    def _stream(self, cmd, env):
        """Run a child process, stream combined output to the log, return the full text."""
        self._put("$ " + " ".join(os.path.basename(c) if c == PY else c for c in cmd) + "\n", "hd")
        buf = []
        try:
            p = subprocess.Popen(cmd, cwd=GT, env=env, stdout=subprocess.PIPE,
                                 stderr=subprocess.STDOUT, text=True, encoding="utf-8",
                                 errors="replace", bufsize=1)
        except Exception as e:
            self._put(f"  failed to start: {e}\n", "err"); return ""
        for line in p.stdout:
            buf.append(line)
            low = line.lower()
            tag = "err" if ("not logged in" in low or "error" in low or "could not" in low) \
                  else "ok" if "new day" in low or "pushed" in low else None
            self._put("  " + line, tag)
        p.wait()
        return "".join(buf)

    def _git(self, *args):
        r = subprocess.run(["git", *args], cwd=GT, capture_output=True, text=True,
                           encoding="utf-8", errors="replace")
        return r.returncode, (r.stdout or "") + (r.stderr or "")

    def _worker(self, c1, c2):
        stale, any_run = [], False
        for cookie, games, name in ((c1, GROUP1, "Cookie 1 (HoYo)"),
                                    (c2, GROUP2, "Cookie 2 (wuwa/endfield/nte)")):
            if not cookie:
                self._put(f"\n{name}: empty — skipping {', '.join(games)}.\n", "err")
                continue
            any_run = True
            self._put(f"\n=== {name}: fetching {', '.join(games)} ===\n", "hd")
            env = dict(os.environ, QIMAI_COOKIE=cookie, PYTHONIOENCODING="utf-8")
            out = self._stream([PY, os.path.join("scripts", "fetch_qimai_today.py"), *games], env)
            if "NOT LOGGED IN" in out:
                stale.append(name)

        self._put("\n=== Rebuilding data/qimai.json ===\n", "hd")
        self._stream([PY, os.path.join("scripts", "build_qimai.py")], dict(os.environ, PYTHONIOENCODING="utf-8"))

        self._put("\n=== Commit & push (only if new) ===\n", "hd")
        self._git("add", "data/qimai_daily", "data/qimai.json")
        code, _ = self._git("diff", "--cached", "--quiet")
        pushed = False
        if code == 0:
            self._put("  No new Qimai days — nothing to push.\n")
        else:
            today = datetime.date.today().isoformat()
            self._git("commit", "-m", f"chore: Qimai revenue for {today}")
            for attempt in range(1, 4):
                self._git("pull", "--rebase", "origin", "main")
                pc, pout = self._git("push")
                self._put("  " + pout.strip() + "\n")
                if pc == 0:
                    pushed = True; break
                self._put(f"  push attempt {attempt} lost a race; retrying…\n", "err")
                time.sleep(5)

        # final status
        if stale:
            who = " and ".join(stale)
            self._put(f"\n⚠ {who} looks EXPIRED (Qimai rejected it). Paste a fresh cookie into "
                      f"that field above and click Run again.\n", "err")
            self.root.after(0, lambda: self.set_status(f"{who}: expired — update the cookie & Run again.", "err"))
        elif not any_run:
            self.root.after(0, lambda: self.set_status("No cookies entered.", "err"))
        elif pushed:
            self.root.after(0, lambda: self.set_status("Done — new days pushed. ✔", "ok"))
        else:
            self.root.after(0, lambda: self.set_status("Done — nothing new to push. ✔", "ok"))
        self._put("\nFinished.\n", "ok")
        self.root.after(0, self._finish)

    def _finish(self):
        self.running = False
        self.btn.config(state="normal")

def main():
    root = tk.Tk()
    App(root)
    root.mainloop()

if __name__ == "__main__":
    main()
