"""Resizable Windows chat and offline voice client for Jermi's Assistant."""

import os
import queue
import subprocess
import threading
import time
import tkinter as tk
from pathlib import Path
from tkinter import messagebox, simpledialog
import webbrowser

import requests

ROOT = Path(__file__).resolve().parents[1]
BASE = "http://127.0.0.1:3000"


class Assistant(tk.Tk):
    def __init__(self):
        super().__init__()
        self.title("Jermi's Assistant")
        self.geometry("980x680")
        self.minsize(480, 360)
        self.configure(bg="#0b1025")
        self.events = queue.Queue()
        self.session = requests.Session()
        self.cookies = {}
        self.csrf = ""
        self.voice_on = threading.Event()
        self.last_answer = ""
        self.last_folder = ""
        self.server_process = None
        self._build()
        self.after(100, self._drain)
        self.after(150, self._connect)
        self.protocol("WM_DELETE_WINDOW", self._close)

    def _build(self):
        top = tk.Frame(self, bg="#151d3b", padx=18, pady=14)
        top.pack(fill="x")
        tk.Label(top, text="✦  Jermi's Assistant", fg="#eee8ff", bg="#151d3b",
                 font=("Segoe UI", 17, "bold")).pack(side="left")
        tk.Button(top, text="Open workspace", command=lambda: webbrowser.open(BASE)).pack(side="right", padx=4)
        tk.Button(top, text="Open found folder", command=self._open_folder).pack(side="right", padx=4)

        self.chat = tk.Text(self, bg="#101832", fg="#edf0ff", insertbackground="white",
                            relief="flat", wrap="word", state="disabled", padx=18, pady=16,
                            font=("Segoe UI", 11))
        self.chat.pack(fill="both", expand=True, padx=14, pady=(14, 6))
        self.chat.tag_configure("assistant", foreground="#c9b5ff", spacing1=12)
        self.chat.tag_configure("user", foreground="#93dfe5", spacing1=12)
        self.chat.tag_configure("source", foreground="#94a9d3", lmargin1=20)

        self.status = tk.StringVar(value="Connecting to this PC…")
        tk.Label(self, textvariable=self.status, anchor="w", fg="#9fadd3", bg="#0b1025",
                 font=("Segoe UI", 9)).pack(fill="x", padx=19)
        bottom = tk.Frame(self, bg="#0b1025", padx=14, pady=12)
        bottom.pack(fill="x")
        self.entry = tk.Entry(bottom, bg="#1a2545", fg="white", insertbackground="white",
                              relief="flat", font=("Segoe UI", 11))
        self.entry.pack(side="left", fill="x", expand=True, ipady=10)
        self.entry.bind("<Return>", lambda _event: self._send())
        tk.Button(bottom, text="Send", command=self._send).pack(side="left", padx=(8, 0), ipadx=8, ipady=5)
        self.mic = tk.Button(bottom, text="🎙 Start voice", command=self._toggle_voice)
        self.mic.pack(side="left", padx=(8, 0), ipadx=6, ipady=5)
        tk.Button(bottom, text="🔊 Read aloud", command=self._read_aloud).pack(side="left", padx=(8, 0), ipady=5)

    def _event(self, kind, *values):
        self.events.put((kind, values))

    def _drain(self):
        try:
            while True:
                kind, values = self.events.get_nowait()
                if kind == "message":
                    self._append(*values)
                elif kind == "status":
                    self.status.set(values[0])
                elif kind == "voice":
                    self.mic.configure(text="■ Stop voice" if values[0] else "🎙 Start voice")
                elif kind == "folder":
                    self.last_folder = values[0]
        except queue.Empty:
            pass
        self.after(100, self._drain)

    def _append(self, role, content, sources=None):
        self.chat.configure(state="normal")
        self.chat.insert("end", ("You" if role == "user" else "Jermi's Assistant") + ":\n", role)
        self.chat.insert("end", content + "\n")
        for source in sources or []:
            self.chat.insert("end", "Source: " + source + "\n", "source")
        self.chat.insert("end", "\n")
        self.chat.configure(state="disabled")
        self.chat.see("end")

    def _request(self, route, method="GET", data=None, timeout=30):
        headers = {"x-csrf-token": self.csrf} if method != "GET" else {}
        if self.cookies:
            response = requests.request(method, BASE + route, json=data, headers=headers,
                                        cookies=self.cookies, timeout=timeout)
        else:
            response = self.session.request(method, BASE + route, json=data, headers=headers, timeout=timeout)
        response.raise_for_status()
        return response.json()

    def _connect(self):
        try:
            try:
                session = self._request("/api/session", timeout=2)
            except requests.RequestException:
                self.server_process = subprocess.Popen(["node", "server.mjs"], cwd=ROOT,
                                                       creationflags=subprocess.CREATE_NO_WINDOW)
                for _ in range(40):
                    time.sleep(0.25)
                    try:
                        session = self._request("/api/session", timeout=1)
                        break
                    except requests.RequestException:
                        continue
                else:
                    raise RuntimeError("The local assistant server did not start.")
            if not session["authenticated"]:
                prompt = "Enter your assistant password" if session["configured"] else "Create a password (12 characters minimum)"
                password = simpledialog.askstring("Local access", prompt, show="*", parent=self)
                if not password:
                    self.destroy()
                    return
                endpoint = "/api/login" if session["configured"] else "/api/setup"
                result = self._request(endpoint, "POST", {"password": password})
                self.csrf = result["csrf"]
                del password
            else:
                self.csrf = session["csrf"]
            self.cookies = self.session.cookies.get_dict()
            for item in self._request("/api/messages"):
                self._append(item["role"], item["content"], [c["path"] for c in item.get("citations", [])])
                if item["role"] == "assistant":
                    self.last_answer = item["content"]
            self.status.set("Ready on this PC · Voice recognition runs offline")
        except Exception as error:
            messagebox.showerror("Jermi's Assistant", str(error), parent=self)
            self.status.set("Could not connect to the local assistant")

    def _send(self):
        message = self.entry.get().strip()
        if not message:
            return
        if self.voice_on.is_set():
            self._toggle_voice()
        self.entry.delete(0, "end")
        self._append("user", message)
        threading.Thread(target=self._answer, args=(message,), daemon=True).start()

    def _answer(self, message):
        try:
            answer = self._request("/api/chat", "POST", {"message": message}, timeout=90)
            self.last_answer = answer["content"]
            self._event("message", "assistant", answer["content"], [c["path"] for c in answer.get("citations", [])])
            for action in answer.get("actions", []):
                if action.get("type") == "openFolder":
                    self._event("folder", action["path"])
                    break
            return answer["content"]
        except Exception as error:
            self._event("status", f"Chat error: {error}")
            return "Sorry, I could not answer that right now."

    def _toggle_voice(self):
        if self.voice_on.is_set():
            self.voice_on.clear()
            self._event("voice", False)
            threading.Thread(target=self._stop_backend_voice, daemon=True).start()
        else:
            self.voice_on.set()
            self._event("voice", True)
            threading.Thread(target=self._voice_loop, daemon=True).start()

    def _voice_loop(self):
        try:
            status = self._request("/api/voice/status")
            if not status.get("ready"):
                raise RuntimeError(status.get("reason", "Offline microphone is unavailable"))
            self._event("status", "Speaking…")
            self._request("/api/voice/speak", "POST", {"text": "Hello, I'm Jermi's Assistant. How can I help you today?"}, timeout=50)
            while self.voice_on.is_set():
                self._event("status", "Listening on this PC…")
                heard = self._request("/api/voice/listen", "POST", {}, timeout=40)
                message = heard.get("text", "").strip()
                if not message or not self.voice_on.is_set():
                    continue
                if message.lower() in {"stop listening", "goodbye", "end conversation", "stop voice"}:
                    self.voice_on.clear()
                    break
                self._event("message", "user", message)
                self._event("status", "Thinking…")
                reply = self._answer(message)
                if self.voice_on.is_set():
                    self._event("status", "Speaking…")
                    self._request("/api/voice/speak", "POST", {"text": reply}, timeout=50)
        except Exception as error:
            if self.voice_on.is_set():
                self._event("status", f"Offline voice stopped: {error}")
        finally:
            self.voice_on.clear()
            self._event("voice", False)

    def _read_aloud(self):
        if not self.last_answer:
            self.status.set("No answer to read aloud yet")
            return
        threading.Thread(target=self._read_backend, daemon=True).start()

    def _read_backend(self):
        try:
            self._request("/api/voice/speak", "POST", {"text": self.last_answer}, timeout=50)
        except Exception as error:
            self._event("status", f"Speech error: {error}")

    def _stop_backend_voice(self):
        try:
            self._request("/api/voice/stop", "POST", {}, timeout=3)
        except Exception:
            pass

    def _open_folder(self):
        if self.last_folder and os.path.isdir(self.last_folder):
            os.startfile(self.last_folder)
        else:
            self.status.set("Ask where a file or folder is, then open its location here")

    def _close(self):
        if self.voice_on.is_set():
            self.voice_on.clear()
            try:
                self._request("/api/voice/stop", "POST", {}, timeout=2)
            except Exception:
                pass
        self.destroy()


if __name__ == "__main__":
    Assistant().mainloop()
