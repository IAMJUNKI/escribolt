import pyautogui
import pyperclip
import time
import platform

IS_MAC = platform.system() == 'Darwin'
CMD_KEY = 'command' if IS_MAC else 'ctrl'

def _check_macos_accessibility():
    """Check if the app has Accessibility permissions on macOS."""
    if not IS_MAC:
        return True
    try:
        import Quartz
        return Quartz.AXIsProcessTrusted()
    except ImportError:
        return False

def paste_text(text):
    """Temporarily pastes text without replacing the user's clipboard contents."""
    previous_clipboard = pyperclip.paste()
    try:
        pyperclip.copy(text)
        time.sleep(0.15)
        pyautogui.hotkey(CMD_KEY, 'v')
        time.sleep(0.35)
    finally:
        pyperclip.copy(previous_clipboard)


def type_text(text):
    """Types text directly using keyboard simulation, without touching clipboard.
    Used for real-time streaming transcription where text is typed incrementally."""
    if not text:
        return
    pyautogui.write(text, interval=0.01)
