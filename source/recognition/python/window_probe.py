#!/usr/bin/env python3
"""Enumerate visible top-level Windows windows without entering their processes.

The overlay uses this helper to follow the game HWND, client location, focus and
minimize state. It relies only on documented user32/kernel32 calls and never
requests memory-read, debug or injection privileges.
"""

from __future__ import annotations

import argparse
import ctypes
import json
import os
import sys
import time
from ctypes import wintypes
from pathlib import Path


if os.name != "nt":
    print(json.dumps({"ok": False, "error": "window_probe is Windows-only"}))
    raise SystemExit(2)


user32 = ctypes.WinDLL("user32", use_last_error=True)
kernel32 = ctypes.WinDLL("kernel32", use_last_error=True)
dwmapi = ctypes.WinDLL("dwmapi", use_last_error=True)

PROCESS_QUERY_LIMITED_INFORMATION = 0x1000
DWMWA_EXTENDED_FRAME_BOUNDS = 9
DWMWA_CLOAKED = 14


class RECT(ctypes.Structure):
    _fields_ = [
        ("left", wintypes.LONG), ("top", wintypes.LONG),
        ("right", wintypes.LONG), ("bottom", wintypes.LONG),
    ]


EnumWindowsProc = ctypes.WINFUNCTYPE(wintypes.BOOL, wintypes.HWND, wintypes.LPARAM)
user32.EnumWindows.argtypes = [EnumWindowsProc, wintypes.LPARAM]
user32.EnumWindows.restype = wintypes.BOOL
user32.IsWindowVisible.argtypes = [wintypes.HWND]
user32.IsWindowVisible.restype = wintypes.BOOL
user32.IsIconic.argtypes = [wintypes.HWND]
user32.IsIconic.restype = wintypes.BOOL
user32.GetWindowTextLengthW.argtypes = [wintypes.HWND]
user32.GetWindowTextLengthW.restype = ctypes.c_int
user32.GetWindowTextW.argtypes = [wintypes.HWND, wintypes.LPWSTR, ctypes.c_int]
user32.GetWindowTextW.restype = ctypes.c_int
user32.GetWindowRect.argtypes = [wintypes.HWND, ctypes.POINTER(RECT)]
user32.GetWindowRect.restype = wintypes.BOOL
user32.GetClientRect.argtypes = [wintypes.HWND, ctypes.POINTER(RECT)]
user32.GetClientRect.restype = wintypes.BOOL
user32.ClientToScreen.argtypes = [wintypes.HWND, ctypes.POINTER(wintypes.POINT)]
user32.ClientToScreen.restype = wintypes.BOOL
user32.GetWindowThreadProcessId.argtypes = [wintypes.HWND, ctypes.POINTER(wintypes.DWORD)]
user32.GetWindowThreadProcessId.restype = wintypes.DWORD
user32.GetForegroundWindow.restype = wintypes.HWND
kernel32.OpenProcess.argtypes = [wintypes.DWORD, wintypes.BOOL, wintypes.DWORD]
kernel32.OpenProcess.restype = wintypes.HANDLE
kernel32.CloseHandle.argtypes = [wintypes.HANDLE]
kernel32.CloseHandle.restype = wintypes.BOOL
kernel32.QueryFullProcessImageNameW.argtypes = [wintypes.HANDLE, wintypes.DWORD, wintypes.LPWSTR, ctypes.POINTER(wintypes.DWORD)]
kernel32.QueryFullProcessImageNameW.restype = wintypes.BOOL
dwmapi.DwmGetWindowAttribute.argtypes = [wintypes.HWND, wintypes.DWORD, wintypes.LPVOID, wintypes.DWORD]
dwmapi.DwmGetWindowAttribute.restype = ctypes.c_long


def _title(hwnd: int) -> str:
    length = user32.GetWindowTextLengthW(hwnd)
    if length <= 0:
        return ""
    buffer = ctypes.create_unicode_buffer(length + 1)
    user32.GetWindowTextW(hwnd, buffer, length + 1)
    return buffer.value


def _process_path(pid: int) -> str:
    handle = kernel32.OpenProcess(PROCESS_QUERY_LIMITED_INFORMATION, False, pid)
    if not handle:
        return ""
    try:
        size = wintypes.DWORD(32768)
        buffer = ctypes.create_unicode_buffer(size.value)
        if kernel32.QueryFullProcessImageNameW(handle, 0, buffer, ctypes.byref(size)):
            return buffer.value
        return ""
    finally:
        kernel32.CloseHandle(handle)


def _rect_dict(rect: RECT) -> dict[str, int]:
    return {
        "x": int(rect.left), "y": int(rect.top),
        "width": max(0, int(rect.right - rect.left)),
        "height": max(0, int(rect.bottom - rect.top)),
    }


def _frame_bounds(hwnd: int) -> dict[str, int]:
    rect = RECT()
    if dwmapi.DwmGetWindowAttribute(hwnd, DWMWA_EXTENDED_FRAME_BOUNDS, ctypes.byref(rect), ctypes.sizeof(rect)) != 0:
        user32.GetWindowRect(hwnd, ctypes.byref(rect))
    return _rect_dict(rect)


def _client_bounds(hwnd: int) -> dict[str, int]:
    rect = RECT()
    if not user32.GetClientRect(hwnd, ctypes.byref(rect)):
        return _frame_bounds(hwnd)
    origin = wintypes.POINT(0, 0)
    if not user32.ClientToScreen(hwnd, ctypes.byref(origin)):
        return _frame_bounds(hwnd)
    return {
        "x": int(origin.x), "y": int(origin.y),
        "width": max(0, int(rect.right - rect.left)),
        "height": max(0, int(rect.bottom - rect.top)),
    }


def snapshot(
    title_terms: list[str] | None = None,
    process_terms: list[str] | None = None,
    hwnd_terms: list[int] | None = None,
) -> dict:
    title_terms = [term.casefold() for term in (title_terms or []) if term]
    process_terms = [term.casefold() for term in (process_terms or []) if term]
    hwnd_terms = {int(hwnd) for hwnd in (hwnd_terms or []) if int(hwnd) > 0}
    foreground = int(user32.GetForegroundWindow() or 0)
    windows: list[dict] = []
    process_queries = 0

    @EnumWindowsProc
    def callback(hwnd, _lparam):
        nonlocal process_queries
        hwnd_value = int(hwnd)
        if hwnd_terms and hwnd_value not in hwnd_terms:
            return True
        if not user32.IsWindowVisible(hwnd):
            return True
        title = _title(hwnd)
        if not title:
            return True
        pid_value = wintypes.DWORD()
        user32.GetWindowThreadProcessId(hwnd, ctypes.byref(pid_value))
        title_match = not title_terms or any(term in title.casefold() for term in title_terms)
        if hwnd_terms:
            process_path = ""
            process_name = ""
            include = True
        else:
            # Filter by title before opening any process. Process-name fallback
            # is opt-in and only applied to the already-small title match set.
            if title_terms and not title_match:
                return True
            process_queries += 1
            process_path = _process_path(pid_value.value)
            process_name = Path(process_path).name if process_path else ""
            process_match = not process_terms or any(term in process_name.casefold() for term in process_terms)
            include = title_match and process_match
        if not include:
            return True
        cloaked = wintypes.DWORD()
        dwmapi.DwmGetWindowAttribute(hwnd, DWMWA_CLOAKED, ctypes.byref(cloaked), ctypes.sizeof(cloaked))
        frame = _frame_bounds(hwnd)
        client = _client_bounds(hwnd)
        windows.append({
            "hwnd": str(hwnd_value), "pid": int(pid_value.value),
            "title": title, "processName": process_name, "processPath": process_path,
            "frameBounds": frame, "clientBounds": client,
            "visible": True, "minimized": bool(user32.IsIconic(hwnd)),
            "cloaked": bool(cloaked.value), "foreground": hwnd_value == foreground,
        })
        return True

    if not user32.EnumWindows(callback, 0):
        raise ctypes.WinError(ctypes.get_last_error())
    return {
        "ok": True,
        "timestampMs": int(time.time() * 1000),
        "windows": windows,
        "processQueries": process_queries,
    }


def main() -> int:
    parser = argparse.ArgumentParser(description="Report top-level Windows window bounds")
    parser.add_argument("--title", action="append", default=[], help="Case-insensitive title substring (repeatable)")
    parser.add_argument("--process", action="append", default=[], help="Case-insensitive process substring (repeatable)")
    parser.add_argument("--hwnd", action="append", default=[], type=int, help="Trusted HWND to follow without opening its process")
    parser.add_argument("--watch", type=int, default=0, metavar="MS", help="Emit JSON lines repeatedly")
    args = parser.parse_args()
    try:
        if args.watch > 0:
            while True:
                print(json.dumps(snapshot(args.title, args.process, args.hwnd), separators=(",", ":")), flush=True)
                time.sleep(max(0.1, args.watch / 1000))
        else:
            print(json.dumps(snapshot(args.title, args.process, args.hwnd), separators=(",", ":")))
    except KeyboardInterrupt:
        return 0
    except Exception as exc:
        print(json.dumps({"ok": False, "error": str(exc)}))
        return 1
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
