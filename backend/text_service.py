import ctypes
import time
import platform
from ctypes.util import find_library

import pyautogui
import pyperclip

IS_MAC = platform.system() == 'Darwin'
CMD_KEY = 'command' if IS_MAC else 'ctrl'
MAC_KEY_V = 0x09
MAC_KEY_COMMAND = 0x37
K_CG_HID_EVENT_TAP = 0
K_CG_EVENT_FLAG_MASK_COMMAND = 0x00100000

_COREGRAPHICS = None
_COREFOUNDATION = None
_MAC_PASTE_SHORTCUT_WARMED = False

def _check_macos_accessibility():
    """Check if the app has Accessibility permissions on macOS."""
    if not IS_MAC:
        return True
    try:
        import Quartz
        return Quartz.AXIsProcessTrusted()
    except ImportError:
        return False


def _load_macos_event_frameworks():
    global _COREGRAPHICS, _COREFOUNDATION
    if _COREGRAPHICS is not None and _COREFOUNDATION is not None:
        return _COREGRAPHICS, _COREFOUNDATION

    core_graphics_path = (
        find_library("CoreGraphics")
        or "/System/Library/Frameworks/CoreGraphics.framework/CoreGraphics"
    )
    core_foundation_path = (
        find_library("CoreFoundation")
        or "/System/Library/Frameworks/CoreFoundation.framework/CoreFoundation"
    )

    core_graphics = ctypes.cdll.LoadLibrary(core_graphics_path)
    core_foundation = ctypes.cdll.LoadLibrary(core_foundation_path)

    core_graphics.CGEventCreateKeyboardEvent.argtypes = [
        ctypes.c_void_p,
        ctypes.c_uint16,
        ctypes.c_bool,
    ]
    core_graphics.CGEventCreateKeyboardEvent.restype = ctypes.c_void_p
    core_graphics.CGEventSetFlags.argtypes = [ctypes.c_void_p, ctypes.c_uint64]
    core_graphics.CGEventSetFlags.restype = None
    core_graphics.CGEventPost.argtypes = [ctypes.c_uint32, ctypes.c_void_p]
    core_graphics.CGEventPost.restype = None
    core_foundation.CFRelease.argtypes = [ctypes.c_void_p]
    core_foundation.CFRelease.restype = None

    _COREGRAPHICS = core_graphics
    _COREFOUNDATION = core_foundation
    return _COREGRAPHICS, _COREFOUNDATION


def _post_macos_key_event(key_code, key_down, flags=0):
    core_graphics, core_foundation = _load_macos_event_frameworks()
    event = core_graphics.CGEventCreateKeyboardEvent(None, key_code, key_down)
    if not event:
        raise RuntimeError("Unable to create macOS keyboard event.")
    try:
        core_graphics.CGEventSetFlags(event, flags)
        core_graphics.CGEventPost(K_CG_HID_EVENT_TAP, event)
    finally:
        core_foundation.CFRelease(event)


def _paste_shortcut_macos():
    command_down = False
    try:
        _post_macos_key_event(MAC_KEY_COMMAND, True, K_CG_EVENT_FLAG_MASK_COMMAND)
        command_down = True
        time.sleep(0.035)
        _post_macos_key_event(MAC_KEY_V, True, K_CG_EVENT_FLAG_MASK_COMMAND)
        time.sleep(0.015)
        _post_macos_key_event(MAC_KEY_V, False, K_CG_EVENT_FLAG_MASK_COMMAND)
        time.sleep(0.035)
    finally:
        if command_down:
            try:
                _post_macos_key_event(MAC_KEY_COMMAND, False, 0)
            except Exception:
                pass


def warm_macos_paste_shortcut(force=False):
    """Prime macOS keyboard event synthesis without typing visible text."""
    global _MAC_PASTE_SHORTCUT_WARMED
    if not IS_MAC:
        return True
    if _MAC_PASTE_SHORTCUT_WARMED and not force:
        return True

    command_down = False
    try:
        _post_macos_key_event(MAC_KEY_COMMAND, True, K_CG_EVENT_FLAG_MASK_COMMAND)
        command_down = True
        time.sleep(0.03)
        _MAC_PASTE_SHORTCUT_WARMED = True
        return True
    except Exception as exc:
        print(f"[paste] macOS shortcut warmup failed: {exc}")
        return False
    finally:
        if command_down:
            try:
                _post_macos_key_event(MAC_KEY_COMMAND, False, 0)
            except Exception:
                pass


def _paste_shortcut():
    if IS_MAC:
        _paste_shortcut_macos()
    else:
        pyautogui.hotkey(CMD_KEY, 'v')


def _copy_clipboard_and_wait(text, timeout=0.75):
    pyperclip.copy(text)
    deadline = time.monotonic() + timeout
    last_error = None
    while time.monotonic() < deadline:
        try:
            if pyperclip.paste() == text:
                return
        except Exception as exc:
            last_error = exc
        time.sleep(0.025)
    if last_error:
        raise RuntimeError(f"Clipboard verification failed: {last_error}")
    raise RuntimeError("Clipboard did not update before paste shortcut.")

def paste_text(text):
    """Temporarily pastes text without replacing the user's clipboard contents."""
    previous_clipboard = pyperclip.paste()
    try:
        _copy_clipboard_and_wait(text)
        time.sleep(0.08)
        warm_macos_paste_shortcut(force=True)
        time.sleep(0.04)
        _paste_shortcut()
        time.sleep(0.5)
    finally:
        pyperclip.copy(previous_clipboard)


def type_text(text):
    """Types text directly using keyboard simulation, without touching clipboard.
    Used for real-time streaming transcription where text is typed incrementally."""
    if not text:
        return
    pyautogui.write(text, interval=0.01)
