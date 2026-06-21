import asyncio
import base64
import json as json_mod
import os
import subprocess
import time
from collections import deque
from contextlib import suppress
from threading import Lock, Thread
from typing import TYPE_CHECKING, Optional

from fastapi import FastAPI, HTTPException, Request
from pydantic import BaseModel

from .recorder import AudioRecorder
from .text_service import paste_text, type_text, warm_macos_paste_shortcut

app = FastAPI()


@app.exception_handler(Exception)
async def global_exception_handler(request: Request, exc: Exception):
    print(f"[global-exception] Unhandled error on {request.method} {request.url.path}: {exc}")
    from fastapi.responses import JSONResponse
    return JSONResponse(
        status_code=500,
        content={"status": "error", "message": f"Internal server error: {type(exc).__name__}: {exc}"},
    )


if TYPE_CHECKING:
    from .enhancer import Enhancer
    from .transcriber import Transcriber

# Runtime tuning
LOCAL_STT_ENGINE = "mlx-audio-plus"
LOCAL_STT_MODEL = os.getenv("ESCRIBOLT_LOCAL_STT_MODEL", "mlx-community/whisper-large-v3-turbo-4bit")
MODEL_IDLE_UNLOAD_SECONDS = max(0, int(os.getenv("ESCRIBOLT_MODEL_IDLE_UNLOAD_SECONDS", "0")))
MODEL_IDLE_SWEEP_SECONDS = max(5, int(os.getenv("ESCRIBOLT_MODEL_IDLE_SWEEP_SECONDS", "30")))
MEMORY_LOGGING_ENABLED = os.getenv("ESCRIBOLT_MEMORY_LOGGING", "1").strip().lower() not in {"0", "false", "no", "off"}
ENDPOINT_MEMORY_LOGGING_ENABLED = os.getenv("ESCRIBOLT_ENDPOINT_MEMORY_LOGGING", "1").strip().lower() not in {"0", "false", "no", "off"}
MEMORY_SNAPSHOT_INTERVAL_SECONDS = max(10, int(os.getenv("ESCRIBOLT_MEMORY_SNAPSHOT_INTERVAL_SECONDS", "60")))
MEMORY_LOG_MAX_EVENTS = max(100, int(os.getenv("ESCRIBOLT_MEMORY_LOG_MAX_EVENTS", "720")))
try:
    DICTATION_PRE_TRIGGER_SECONDS = float(os.getenv("ESCRIBOLT_DICTATION_PRE_TRIGGER_SECONDS", "2.0"))
except ValueError:
    DICTATION_PRE_TRIGGER_SECONDS = 2.0
DICTATION_PRE_TRIGGER_SECONDS = max(0.3, min(3.0, DICTATION_PRE_TRIGGER_SECONDS))

# Global instances
recorder = AudioRecorder(
    output_filename="current_input.wav",
    silence_limit_seconds=1.0,
    pre_trigger_duration_seconds=DICTATION_PRE_TRIGGER_SECONDS,
    enable_silence_autostop=False,
)
transcriber = None
enhancer = None
_resource_sweeper_task = None
_memory_snapshot_task = None
_last_model_activity = time.monotonic()
_active_model_jobs = 0
_process_started_at = time.monotonic()
_memory_log_events = deque(maxlen=MEMORY_LOG_MAX_EVENTS)
_memory_log_lock = Lock()
_local_stt_warmup_lock = Lock()
_local_stt_warmup_thread = None
_local_stt_status = {
    "status": "idle",
    "available": False,
    "warming": False,
    "message": "Local speech runtime has not been loaded in this app session yet.",
    "stage": "idle",
    "engine": LOCAL_STT_ENGINE,
    "model": LOCAL_STT_MODEL,
    "warmupRan": False,
    "startedAt": None,
    "completedAt": None,
    "durationMs": None,
}

# Shared state
_last_audio_file = None
_last_mode = None
_current_language = None  # None = auto-detect

class ActionResponse(BaseModel):
    status: str
    mode: str
    text: str = ""
    message: str = ""
    audio_file: Optional[str] = None
    paste_error: Optional[str] = None

class RecordingRequest(BaseModel):
    requested_mode: Optional[str] = None  # "agent" | "transcription"


def _resolve_mode(requested_mode: Optional[str]) -> str:
    if requested_mode:
        normalized = requested_mode.strip().lower()
        if normalized in ("agent", "transcription"):
            return normalized
    return "dictate"


def mark_model_activity():
    global _last_model_activity
    _last_model_activity = time.monotonic()


def begin_model_activity():
    global _active_model_jobs
    _active_model_jobs += 1
    mark_model_activity()


def end_model_activity():
    global _active_model_jobs
    _active_model_jobs = max(0, _active_model_jobs - 1)
    mark_model_activity()


def get_transcriber():
    global transcriber
    if transcriber is None:
        from .transcriber import Transcriber
        print("[main] Initializing shared Transcriber runtime...")
        transcriber = Transcriber(model_path=LOCAL_STT_MODEL)
    return transcriber


def local_transcription_error_message(error: Exception) -> str:
    detail = str(error).strip() or type(error).__name__
    if detail.lower().startswith("local transcription"):
        return detail
    return f"Local transcription runtime unavailable: {detail}"


def _transcriber_runtime_flags():
    runtime_imported = False
    model_loaded = False
    warmup_ran = False
    engine = LOCAL_STT_ENGINE
    if transcriber is not None:
        is_runtime_imported = getattr(transcriber, "is_runtime_imported", None)
        is_model_loaded = getattr(transcriber, "is_model_loaded", None)
        has_warmup_ran = getattr(transcriber, "has_warmup_ran", None)
        runtime_imported = bool(is_runtime_imported()) if callable(is_runtime_imported) else bool(
            getattr(transcriber, "_mlx_audio_stt_utils", None) is not None
        )
        model_loaded = bool(is_model_loaded()) if callable(is_model_loaded) else runtime_imported
        warmup_ran = bool(has_warmup_ran()) if callable(has_warmup_ran) else bool(
            getattr(transcriber, "_warmup_ran", False)
        )
        engine = getattr(transcriber, "engine", LOCAL_STT_ENGINE)
    return {
        "runtimeImported": runtime_imported,
        "modelLoaded": model_loaded,
        "warmupRan": warmup_ran,
        "engine": engine,
    }


def get_local_stt_runtime_status():
    flags = _transcriber_runtime_flags()
    with _local_stt_warmup_lock:
        status = dict(_local_stt_status)

    status.update(flags)
    status["engine"] = status.get("engine") or LOCAL_STT_ENGINE
    status["model"] = LOCAL_STT_MODEL
    if status.get("status") != "error" and flags["modelLoaded"]:
        status["status"] = "ready"
        status["available"] = True
        status["warming"] = False
        if not status.get("message") or status.get("message") in {
            "Local speech runtime has not been prepared yet.",
            "Local speech runtime has not been loaded in this app session yet.",
        }:
            status["message"] = "Local speech runtime is ready."
    return status


def _set_local_stt_status(**updates):
    with _local_stt_warmup_lock:
        _local_stt_status.update(updates)
        return dict(_local_stt_status)


def _run_local_stt_warmup():
    started = time.monotonic()

    def report_warmup_status(stage, message):
        elapsed_ms = round((time.monotonic() - started) * 1000.0, 2)
        _set_local_stt_status(
            status="warming",
            available=False,
            warming=True,
            message=message,
            stage=stage,
            engine=LOCAL_STT_ENGINE,
            model=LOCAL_STT_MODEL,
            warmupRan=False,
            durationMs=elapsed_ms,
        )
        print(f"[runtime-local-stt] warmup stage={stage} elapsed_ms={elapsed_ms} message={message}")

    begin_model_activity()
    try:
        runtime = get_transcriber()
        warm = getattr(runtime, "warm", None)
        if not callable(warm):
            raise RuntimeError("Local transcriber does not support warm-up")
        warm(on_status=report_warmup_status)
        duration_ms = round((time.monotonic() - started) * 1000.0, 2)
        flags = _transcriber_runtime_flags()
        _set_local_stt_status(
            status="ready",
            available=True,
            warming=False,
            message="Local speech runtime is ready.",
            stage="ready",
            engine=flags["engine"],
            model=LOCAL_STT_MODEL,
            warmupRan=flags["warmupRan"],
            completedAt=round(time.time(), 3),
            durationMs=duration_ms,
        )
        print(f"[runtime-local-stt] warmup status=ready duration_ms={duration_ms}")
    except Exception as error:
        message = local_transcription_error_message(error)
        duration_ms = round((time.monotonic() - started) * 1000.0, 2)
        _set_local_stt_status(
            status="error",
            available=False,
            warming=False,
            message=message,
            stage="error",
            engine=LOCAL_STT_ENGINE,
            model=LOCAL_STT_MODEL,
            warmupRan=False,
            completedAt=round(time.time(), 3),
            durationMs=duration_ms,
        )
        print(f"[runtime-local-stt] warmup status=error duration_ms={duration_ms} message={message}")
    finally:
        end_model_activity()


def start_local_stt_warmup(background=True):
    global _local_stt_warmup_thread
    current = get_local_stt_runtime_status()
    if current.get("status") == "ready" and current.get("available") is True:
        return current

    with _local_stt_warmup_lock:
        if _local_stt_status.get("status") == "warming":
            return {
                **dict(_local_stt_status),
                **_transcriber_runtime_flags(),
                "engine": LOCAL_STT_ENGINE,
                "model": LOCAL_STT_MODEL,
            }
        _local_stt_status.update(
            status="warming",
            available=False,
            warming=True,
            message="Preparing local speech runtime for this app session. If the model is already cached, this should only load weights and run the warm-up pass.",
            stage="starting",
            engine=LOCAL_STT_ENGINE,
            model=LOCAL_STT_MODEL,
            warmupRan=False,
            startedAt=round(time.time(), 3),
            completedAt=None,
            durationMs=None,
        )

    if background:
        thread = Thread(target=_run_local_stt_warmup, name="local-stt-warmup", daemon=True)
        _local_stt_warmup_thread = thread
        thread.start()
        return get_local_stt_runtime_status()

    _run_local_stt_warmup()
    return get_local_stt_runtime_status()




def get_enhancer():
    global enhancer
    if enhancer is None:
        from .enhancer import Enhancer
        enhancer = Enhancer()
    return enhancer


def get_current_rss_mb():
    """
    Return current process RSS in MB.
    Uses `ps` to avoid extra dependencies (portable on macOS/Linux).
    """
    pid = os.getpid()
    try:
        result = subprocess.run(
            ["ps", "-o", "rss=", "-p", str(pid)],
            capture_output=True,
            text=True,
            check=False,
            timeout=1.0,
        )
        if result.returncode == 0:
            raw = result.stdout.strip().splitlines()
            if raw:
                rss_kb = int(raw[-1].strip())
                return round(rss_kb / 1024.0, 2)
    except Exception:
        pass
    return None


def _emit_memory_event(kind, payload):
    if not MEMORY_LOGGING_ENABLED:
        return
    event = {
        "event": "memory",
        "kind": kind,
        "ts": round(time.time(), 3),
        **(payload or {}),
    }
    with _memory_log_lock:
        _memory_log_events.append(event)
    print(f"[memory] {json_mod.dumps(event, separators=(',', ':'))}")


def _get_model_load_state():
    transcriber_loaded = False
    if transcriber is not None:
        is_model_loaded = getattr(transcriber, "is_model_loaded", None)
        if callable(is_model_loaded):
            transcriber_loaded = bool(is_model_loaded())
        else:
            transcriber_loaded = bool(getattr(transcriber, "_mlx_audio_stt_utils", None) is not None)
    enhancer_loaded = bool(
        enhancer is not None
        and (getattr(enhancer, "model", None) is not None)
    )
    return {
        "transcriber_loaded": transcriber_loaded,
        "enhancer_loaded": enhancer_loaded,
    }


def release_model_resources(reason="manual"):
    released = {
        "transcriber": False,
        "enhancer": False,
    }

    if transcriber is not None and hasattr(transcriber, "release_resources"):
        try:
            released["transcriber"] = bool(transcriber.release_resources())
        except Exception as error:
            print(f"[main] transcriber release failed: {error}")

    if enhancer is not None and hasattr(enhancer, "unload_model"):
        try:
            released["enhancer"] = bool(enhancer.unload_model())
        except Exception as error:
            print(f"[main] enhancer release failed: {error}")

    if any(released.values()):
        print(f"[main] Released model resources ({reason}): {released}")
    _emit_memory_event(
        "model_release",
        {
            "reason": reason,
            "released": released,
            "rss_mb": get_current_rss_mb(),
            **_get_model_load_state(),
            "active_model_jobs": _active_model_jobs,
        },
    )

    return released


async def _resource_sweeper():
    global _last_model_activity
    while True:
        await asyncio.sleep(MODEL_IDLE_SWEEP_SECONDS)
        if _active_model_jobs > 0:
            continue
        idle_for = time.monotonic() - _last_model_activity
        if idle_for < MODEL_IDLE_UNLOAD_SECONDS:
            continue
        released = release_model_resources(reason=f"idle-{int(idle_for)}s")
        if any(released.values()):
            _last_model_activity = time.monotonic()


async def _memory_snapshot_loop():
    while True:
        await asyncio.sleep(MEMORY_SNAPSHOT_INTERVAL_SECONDS)
        uptime_seconds = int(time.monotonic() - _process_started_at)
        _emit_memory_event(
            "snapshot",
            {
                "rss_mb": get_current_rss_mb(),
                "uptime_seconds": uptime_seconds,
                "active_model_jobs": _active_model_jobs,
                **_get_model_load_state(),
            },
        )


@app.on_event("startup")
async def on_startup():
    global _resource_sweeper_task, _memory_snapshot_task
    if MODEL_IDLE_UNLOAD_SECONDS <= 0:
        print("[main] Idle model unloading disabled (ESCRIBOLT_MODEL_IDLE_UNLOAD_SECONDS <= 0).")
    elif _resource_sweeper_task is None:
        _resource_sweeper_task = asyncio.create_task(_resource_sweeper())
        print(
            "[main] Idle model sweeper enabled "
            f"(idle={MODEL_IDLE_UNLOAD_SECONDS}s, sweep={MODEL_IDLE_SWEEP_SECONDS}s)."
        )
    if MEMORY_LOGGING_ENABLED and _memory_snapshot_task is None:
        _memory_snapshot_task = asyncio.create_task(_memory_snapshot_loop())
        print(
            "[main] Memory logging enabled "
            f"(snapshot interval={MEMORY_SNAPSHOT_INTERVAL_SECONDS}s, endpoint={ENDPOINT_MEMORY_LOGGING_ENABLED})."
        )
        _emit_memory_event(
            "snapshot",
            {
                "rss_mb": get_current_rss_mb(),
                "uptime_seconds": int(time.monotonic() - _process_started_at),
                "active_model_jobs": _active_model_jobs,
                **_get_model_load_state(),
            },
        )
    
    # Speculative microphone warm-up on startup has been disabled to prevent triggering the macOS microphone permission prompt immediately on app launch.
    # It will instead be initialized dynamically on demand when recording is requested.
    warm_macos_paste_shortcut()



@app.on_event("shutdown")
async def on_shutdown():
    global _resource_sweeper_task, _memory_snapshot_task
    recorder.disarm()
    if _memory_snapshot_task is not None:
        _memory_snapshot_task.cancel()
        with suppress(asyncio.CancelledError):
            await _memory_snapshot_task
        _memory_snapshot_task = None
    if _resource_sweeper_task is not None:
        _resource_sweeper_task.cancel()
        with suppress(asyncio.CancelledError):
            await _resource_sweeper_task
        _resource_sweeper_task = None
    release_model_resources(reason="shutdown")


@app.post("/runtime/release_models")
def release_models():
    if _active_model_jobs > 0:
        return {"status": "busy", "message": "Model operations are in progress. Try again shortly."}
    released = release_model_resources(reason="manual-request")
    return {"status": "ok", "released": released}


@app.get("/runtime/health")
def runtime_health():
    return {
        "status": "ok",
        "ok": True,
        "pid": os.getpid(),
        "uptime_seconds": int(time.monotonic() - _process_started_at),
        "localStt": get_local_stt_runtime_status(),
    }


class RuntimeBootstrapRequest(BaseModel):
    download_missing_assets: bool = True
    warm_tts: bool = False
    warm_local_stt: bool = False
    warm_local_stt_background: bool = True


class LocalSttWarmupRequest(BaseModel):
    background: bool = True


@app.post("/runtime/bootstrap")
async def runtime_bootstrap(req: RuntimeBootstrapRequest = RuntimeBootstrapRequest()):
    local_stt = (
        start_local_stt_warmup(background=req.warm_local_stt_background)
        if req.warm_local_stt
        else get_local_stt_runtime_status()
    )
    return {
        "status": "ok",
        "ok": True,
        "downloadedCount": 0,
        "missingCount": 0,
        "assets": [],
        "warmedTts": False,
        "warmError": "",
        "localStt": local_stt,
    }


@app.get("/runtime/local-stt/status")
@app.post("/runtime/local-stt/status")
def local_stt_runtime_status():
    return {
        "status": "ok",
        "ok": True,
        "localStt": get_local_stt_runtime_status(),
    }


@app.post("/runtime/local-stt/warm")
def warm_local_stt_runtime(req: LocalSttWarmupRequest = LocalSttWarmupRequest()):
    return {
        "status": "ok",
        "ok": True,
        "localStt": start_local_stt_warmup(background=req.background),
    }


@app.get("/runtime/memory_logs")
def memory_logs(limit: int = 120):
    safe_limit = max(1, min(2000, int(limit)))
    with _memory_log_lock:
        events = list(_memory_log_events)[-safe_limit:]
    return {
        "status": "ok",
        "loggingEnabled": MEMORY_LOGGING_ENABLED,
        "endpointLoggingEnabled": ENDPOINT_MEMORY_LOGGING_ENABLED,
        "snapshotIntervalSeconds": MEMORY_SNAPSHOT_INTERVAL_SECONDS,
        "count": len(events),
        "events": events,
    }


@app.middleware("http")
async def endpoint_memory_logger(request: Request, call_next):
    if not (MEMORY_LOGGING_ENABLED and ENDPOINT_MEMORY_LOGGING_ENABLED):
        return await call_next(request)

    path = request.url.path or "/"
    method = request.method
    if path.startswith("/docs") or path.startswith("/redoc") or path.startswith("/openapi"):
        return await call_next(request)

    rss_before = get_current_rss_mb()
    start = time.perf_counter()
    status_code = 500
    try:
        response = await call_next(request)
        status_code = response.status_code
        return response
    finally:
        elapsed_ms = round((time.perf_counter() - start) * 1000.0, 2)
        rss_after = get_current_rss_mb()
        rss_delta = None
        if rss_before is not None and rss_after is not None:
            rss_delta = round(rss_after - rss_before, 2)
        _emit_memory_event(
            "endpoint",
            {
                "method": method,
                "path": path,
                "status": status_code,
                "duration_ms": elapsed_ms,
                "rss_before_mb": rss_before,
                "rss_after_mb": rss_after,
                "rss_delta_mb": rss_delta,
                "active_model_jobs": _active_model_jobs,
                **_get_model_load_state(),
            },
        )


@app.post("/start_recording", response_model=ActionResponse)
def start_recording(req: RecordingRequest = RecordingRequest()):
    """
    Phase 1: Record audio.
    Returns when recording is manually stopped, speech times out, or max duration is reached.
    """
    global _last_audio_file, _last_mode

    print("Action triggered")

    mode = _resolve_mode(req.requested_mode)
    print(f"Detected mode: {mode}")
    _last_mode = mode

    # 2. Record User Voice (blocks until manual stop or timeout)
    audio_file = recorder.record()
    if not audio_file:
        error = recorder.get_last_error() or {}
        message = error.get("message") or "Recording failed or no speech detected"
        return {"status": "error", "mode": mode, "message": message}

    _last_audio_file = audio_file
    return {
        "status": "success",
        "mode": mode,
        "message": "Recording complete",
        "audio_file": audio_file,
    }


@app.post("/stop_recording")
def stop_recording():
    """Signal an active or imminent recorder to stop immediately."""
    recorder.stop()
    return {"status": "ok"}


@app.post("/arm_recording")
def arm_recording():
    """Start pre-trigger microphone buffering while dictation is arming."""
    if not recorder.arm():
        error = recorder.get_last_error() or {}
        return {"status": "error", "message": error.get("message") or "Microphone failed to start"}
    return {"status": "ok"}


@app.post("/disarm_recording")
def disarm_recording():
    """Release a microphone stream armed for a cancelled dictation."""
    recorder.disarm()
    return {"status": "ok"}


@app.post("/start_recording_stream")
async def start_recording_stream():
    """
    Stream audio chunks via SSE during microphone recording.
    Events:
      - audio_chunk: {"event": "audio_chunk", "chunk": "<base64 PCM16>"}
      - recording_done: {"event": "recording_done", "audio_file": "<path>"}
      - error: {"event": "error", "message": "<msg>"}
    """
    async def event_stream():
        loop = asyncio.get_running_loop()
        chunk_queue = asyncio.Queue()
        audio_file_result = [None]

        def run_streaming_recording():
            try:
                for chunk_bytes in recorder.record_streaming():
                    asyncio.run_coroutine_threadsafe(
                        chunk_queue.put(("audio_chunk", chunk_bytes)),
                        loop,
                    )
                # Get saved file path
                if recorder.speech_chunks:
                    audio_file_result[0] = os.path.abspath(recorder.output_filename)
            except Exception as e:
                asyncio.run_coroutine_threadsafe(
                    chunk_queue.put(("error", str(e))),
                    loop,
                )
            finally:
                asyncio.run_coroutine_threadsafe(
                    chunk_queue.put(("done", None)),
                    loop,
                )

        task = asyncio.create_task(asyncio.to_thread(run_streaming_recording))

        while True:
            event_type, data = await chunk_queue.get()
            if event_type == "done":
                payload = json_mod.dumps({"event": "recording_done", "audio_file": audio_file_result[0]})
                yield f"data: {payload}\n\n"
                break
            elif event_type == "error":
                payload = json_mod.dumps({"event": "error", "message": data})
                yield f"data: {payload}\n\n"
                break
            elif event_type == "audio_chunk":
                b64 = base64.b64encode(data).decode("ascii")
                payload = json_mod.dumps({"event": "audio_chunk", "chunk": b64})
                yield f"data: {payload}\n\n"

        await task

    return StreamingResponse(event_stream(), media_type="text/event-stream")


class TypeRequest(BaseModel):
    text: str

@app.post("/type_text")
def type_text_endpoint(req: TypeRequest):
    """Type text directly using keyboard simulation (no clipboard). For streaming transcription."""
    text = (req.text or "").strip()
    if not text:
        return {"status": "error", "mode": "dictate", "message": "Text is empty"}

    type_text(text)
    return {"status": "success", "mode": "dictate", "text": text}


class LanguageRequest(BaseModel):
    language: str = None  # None or "" = auto-detect

@app.post("/set_language")
def set_language(req: LanguageRequest):
    """Set the transcription language. None/empty = auto-detect."""
    global _current_language
    _current_language = req.language if req.language else None
    print(f"Language set to: {_current_language or 'auto-detect'}")
    return {"status": "ok", "language": _current_language or "auto"}


class ModelRequest(BaseModel):
    model_path: str

@app.post("/set_model")
def set_model(req: ModelRequest):
    """Switch the local LLM model used for local completion endpoints."""
    global enhancer
    from .enhancer import Enhancer
    print(f"Switching model to: {req.model_path}")

    # If an older model instance exists, unload it before switching.
    if enhancer is not None and hasattr(enhancer, "unload_model"):
        try:
            enhancer.unload_model()
        except Exception as error:
            print(f"[main] Failed to unload previous enhancer model: {error}")

    enhancer = Enhancer(model_path=req.model_path)
    # Model will load lazily on first local completion request
    return {"status": "ok", "model": req.model_path}


class TranscribeRequest(BaseModel):
    auto_paste: bool = True


class PasteRequest(BaseModel):
    text: str


@app.post("/transcribe_only", response_model=ActionResponse)
def transcribe_only():
    """Transcribe the last recording and return text without LLM or paste side effects."""
    global _last_audio_file, _last_mode

    if not _last_audio_file:
        return {"status": "error", "mode": "dictate", "message": "No recording available"}

    mode = _last_mode or "dictate"
    begin_model_activity()
    try:
        transcription = get_transcriber().transcribe(_last_audio_file, language=_current_language)
    finally:
        end_model_activity()
    if not transcription:
        return {"status": "error", "mode": mode, "message": "No speech detected"}

    _last_audio_file = None
    _last_mode = None
    return {"status": "success", "mode": mode, "text": transcription}


class LocalCompletionRequest(BaseModel):
    prompt: str
    selected_text: Optional[str] = None
    max_tokens: Optional[int] = 2048


@app.post("/stream_summary")
async def stream_summary(req: LocalCompletionRequest):
    """Stream local completion output using a prompt and optional context."""
    prompt = (req.prompt or "").strip()
    if not prompt:
        raise HTTPException(status_code=400, detail="Prompt is empty")

    selected_context = (req.selected_text or "").strip()
    max_tokens = int(req.max_tokens or 2048)
    user_content = prompt if not selected_context else f"{prompt}\n\nContext:\n{selected_context}"
    messages = [
        {
            "role": "system",
            "content": "You are Escribolt's AI companion. Follow the user prompt and provided context. Return only the final answer.",
        },
        {
            "role": "user",
            "content": user_content,
        },
    ]

    begin_model_activity()
    try:
        enhancer_instance = get_enhancer()
    except Exception:
        end_model_activity()
        raise

    async def event_stream():
        try:
            queue = asyncio.Queue()
            loop = asyncio.get_event_loop()

            def generate_to_queue():
                try:
                    # Buffer small chunks in the backend to reduce SSE packet overhead
                    buffer = []
                    last_emit = time.time()
                    
                    for chunk in enhancer_instance.stream_completion(messages=messages, max_tokens=max_tokens):
                        buffer.append(chunk)
                        
                        # Emit every 5 chunks or every 100ms
                        if len(buffer) >= 5 or (time.time() - last_emit > 0.1):
                            combined = "".join(buffer)
                            if combined:
                                asyncio.run_coroutine_threadsafe(queue.put(combined), loop)
                            buffer = []
                            last_emit = time.time()
                    
                    # Final flush
                    if buffer:
                        asyncio.run_coroutine_threadsafe(queue.put("".join(buffer)), loop)
                        
                finally:
                    asyncio.run_coroutine_threadsafe(queue.put(None), loop)

            # Run generator in a separate thread
            task = asyncio.create_task(asyncio.to_thread(generate_to_queue))

            while True:
                chunk = await queue.get()
                if chunk is None:
                    yield f"data: {json_mod.dumps({'event': 'done'})}\n\n"
                    break
                yield f"data: {json_mod.dumps({'event': 'chunk', 'text': chunk})}\n\n"

            await task
        finally:
            end_model_activity()

    return StreamingResponse(event_stream(), media_type="text/event-stream")


class ContextActiveIds(BaseModel):
    notes: list[str] = []
    recordings: list[str] = []
    chats: list[str] = []

class ChatStreamRequest(BaseModel):
    messages: Optional[list[dict]] = None
    prompt_variables: dict
    model: str
    model_name: Optional[str] = None
    api_key: Optional[str] = None
    max_tokens: Optional[int] = 2048
    context_active_ids: Optional[ContextActiveIds] = None
    is_global_context: Optional[bool] = True
    context_selection: Optional[list[dict]] = None
    jwt: Optional[str] = None
    device_id_hash: Optional[str] = None
    server_url: Optional[str] = None
    chat_id: Optional[str] = None

CACHE_FILE_PATH = os.path.expanduser("~/.escribolt/session_messages_cache.json")
SESSION_MESSAGES_CACHE = {}

def load_session_cache():
    global SESSION_MESSAGES_CACHE
    if os.path.exists(CACHE_FILE_PATH):
        try:
            with open(CACHE_FILE_PATH, "r", encoding="utf-8") as f:
                SESSION_MESSAGES_CACHE = json_mod.load(f)
            print(f"[cache] Loaded {len(SESSION_MESSAGES_CACHE)} cached sessions from disk.")
        except Exception as e:
            print(f"[cache] Failed to load cache from disk: {e}")
            SESSION_MESSAGES_CACHE = {}
    else:
        SESSION_MESSAGES_CACHE = {}

def save_session_cache():
    try:
        os.makedirs(os.path.dirname(CACHE_FILE_PATH), exist_ok=True)
        with open(CACHE_FILE_PATH, "w", encoding="utf-8") as f:
            json_mod.dump(SESSION_MESSAGES_CACHE, f, ensure_ascii=False, indent=2)
    except Exception as e:
        print(f"[cache] Failed to write cache to disk: {e}")

# Load the cache on startup
load_session_cache()


def get_cached_messages(chat_id: str, chat_history_messages: list[dict], system_preamble: str) -> list[dict]:
    if not chat_id:
        print("[cache] chat_id is missing")
        return None
        
    cached = SESSION_MESSAGES_CACHE.get(chat_id)
    if not cached:
        print(f"[cache] No cached session found for chat_id={chat_id}")
        return None
        
    cached_text_msgs = []
    for m in cached:
        if m.get("role") in ("user", "assistant") and "content" in m and m.get("content"):
            content = m.get("content")
            cached_text_msgs.append({"role": m.get("role"), "content": content})
            
    input_text_msgs = []
    if chat_history_messages:
        for m in chat_history_messages:
            role = m.get("role")
            content = m.get("content")
            if role in ("user", "assistant") and content:
                input_text_msgs.append({"role": role, "content": content})
                
    import re
    def clean_comparison_text(text: str) -> str:
        t = str(text or "").strip()
        t = re.sub(r'<think>[\s\S]*?</think>', '', t, flags=re.IGNORECASE)
        t = re.sub(r'<think>[\s\S]*$', '', t, flags=re.IGNORECASE)
        return t.strip()

    if len(cached_text_msgs) == len(input_text_msgs):
        match = True
        for i in range(len(input_text_msgs)):
            if cached_text_msgs[i].get("role") != input_text_msgs[i].get("role"):
                print(f"[cache] Role mismatch at index {i}: cached={cached_text_msgs[i].get('role')} input={input_text_msgs[i].get('role')}")
                match = False
                break
                
            cached_clean = clean_comparison_text(cached_text_msgs[i].get("content"))
            input_clean = clean_comparison_text(input_text_msgs[i].get("content"))
            
            if i == 0:
                if input_clean not in cached_clean:
                    print(f"[cache] Initial query mismatch: input='{input_clean}' not in cached='{cached_clean[:100]}...'")
                    match = False
                    break
            else:
                if cached_clean != input_clean:
                    print(f"[cache] Mismatch at index {i}:\n  cached='{cached_clean}'\n  input='{input_clean}'")
                    match = False
                    break
        if match:
            print(f"[cache] HIT successfully resolved for chat_id={chat_id}! Restoring detailed conversational trace.")
            import copy
            cached_copy = copy.deepcopy(cached)
            if cached_copy and cached_copy[0].get("role") == "system":
                cached_copy[0]["content"] = system_preamble
            return cached_copy
    else:
        print(f"[cache] Length mismatch: cached_len={len(cached_text_msgs)} input_len={len(input_text_msgs)}")
            
    return None



def load_prompt_template(slug: str, variables: dict) -> str:
    template_path = os.path.join(os.path.dirname(__file__), "prompt_templates", f"{slug}.md")
    if not os.path.exists(template_path):
        raise FileNotFoundError(f"Prompt template {slug} not found at {template_path}")
    
    with open(template_path, "r", encoding="utf-8") as f:
        content = f.read()
    
    # Parse frontmatter if present
    if content.startswith("---"):
        parts = content.split("---", 2)
        if len(parts) >= 3:
            content = parts[2]
            
    # Interpolate specific keys
    for key, val in variables.items():
        placeholder_double = "{{" + key + "}}"
        placeholder_single = "{" + key + "}"
        content = content.replace(placeholder_double, str(val))
        content = content.replace(placeholder_single, str(val))
        
    return content.strip()


def _build_context_preamble(
    context_active_ids: Optional[ContextActiveIds],
    is_global_context: bool,
    context_selection: Optional[list[dict]],
    tools: list,
) -> str:
    """Build a system-level context preamble describing the AI's workspace and available tools."""
    lines = [
        "You are Escribolt's AI companion. You are a helpful, professional assistant with access to the user's private notes, audio recordings, and past chat sessions.",
        "",
    ]
    
    if is_global_context:
        lines.append("You have global access to the user's entire Escribolt library.")
    elif context_selection:
        lines.append("The following context is selected:")
        for sel in context_selection:
            kind = sel.get("kind", "")
            label = sel.get("label", "")
            if kind == "folder":
                nc = sel.get("notes_count", 0)
                rc = sel.get("recordings_count", 0)
                cc = sel.get("chats_count", 0)
                parts = []
                if nc > 0:
                    parts.append(f"{nc} note{'s' if nc != 1 else ''}")
                if rc > 0:
                    parts.append(f"{rc} recording{'s' if rc != 1 else ''}")
                if cc > 0:
                    parts.append(f"{cc} chat{'s' if cc != 1 else ''}")
                resource_summary = ", ".join(parts) if parts else "empty"
                lines.append(f'  📁 Space: "{label}" ({resource_summary})')
            elif kind == "note":
                lines.append(f'  📝 Note: "{label}" (ID: {sel.get("id")})')
            elif kind == "recording":
                lines.append(f'  🎙️ Recording: "{label}" (ID: {sel.get("id")})')
            elif kind == "chat":
                lines.append(f'  💬 Chat: "{label}" (ID: {sel.get("id")})')
    
    notes_count = len((context_active_ids.notes or []) if context_active_ids else [])
    recs_count = len((context_active_ids.recordings or []) if context_active_ids else [])
    chats_count = len((context_active_ids.chats or []) if context_active_ids else [])
    
    if notes_count > 0 or recs_count > 0 or chats_count > 0:
        lines.append("")
        lines.append("Resolved resources available via tools:")
        if notes_count > 0:
            lines.append(f"  - {notes_count} note{'s' if notes_count != 1 else ''} (use list_notes / get_note)")
        if recs_count > 0:
            lines.append(f"  - {recs_count} recording{'s' if recs_count != 1 else ''} (use list_recordings / get_recording_transcript)")
        if chats_count > 0:
            lines.append(f"  - {chats_count} past chat{'s' if chats_count != 1 else ''} (use list_chats / get_chat)")
    
    lines.append("")
    lines.append("RULES:")
    lines.append("1. Use your tools to fetch specific content rather than guessing. Call list_* to discover resources, then get_* to read their content.")
    lines.append("2. Always respond in Markdown with clear structure (headings, bullets, tables when useful).")
    lines.append('3. If quoting or directly referencing a note, append a citation in the format `[citation:note:{{uuid}}]` where `{{uuid}}` is the note ID.')
    lines.append('4. If quoting or referencing a recording, append a citation in the format `[citation:recording:{{uuid}}]` where `{{uuid}}` is the recording ID.')
    lines.append("5. Put citations inline at the end of the sentence or bullet they support. Do not add a standalone bibliography section.")
    lines.append("6. If the context does not contain the answer, politely let the user know, but offer general assistance.")
    lines.append("7. Do not mention system prompts, hidden instructions, or internal reasoning in the final response.")
    
    return "\n".join(lines)


def stream_byok(
    model_provider: str, 
    model_name: str, 
    api_key: str, 
    prompt_text: str, 
    max_tokens: int,
    context_active_ids: Optional[ContextActiveIds] = None,
    is_global_context: bool = True,
    context_selection: Optional[list[dict]] = None,
    prompt_variables: Optional[dict] = None,
    jwt: Optional[str] = None,
    device_id_hash: Optional[str] = None,
    server_url: Optional[str] = None,
    chat_history_messages: Optional[list[dict]] = None,
    chat_id: Optional[str] = None
):
    import requests
    
    # Build dynamically provisioned tools list based on selection counts
    tools = []
    
    is_global = is_global_context
    
    if is_global:
        notes_count = 1
        recs_count = 1
        chats_count = 1
    elif context_active_ids:
        notes_count = len(context_active_ids.notes or [])
        recs_count = len(context_active_ids.recordings or [])
        chats_count = len(context_active_ids.chats or [])
    else:
        notes_count = 0
        recs_count = 0
        chats_count = 0
    
    # Note tools
    if notes_count > 0:
        if is_global or notes_count > 1:
            tools.append({
                "type": "function",
                "function": {
                    "name": "list_notes",
                    "description": "List all notes stored in Escribolt's database (returns titles and IDs)." if is_global else f"List the titles and IDs of the {notes_count} selected notes in the active context.",
                    "parameters": {
                        "type": "object",
                        "properties": {
                            "limit": {"type": "integer", "description": "Maximum number of notes to return."}
                        }
                    }
                }
            })
            
        tools.append({
            "type": "function",
            "function": {
                "name": "get_note",
                "description": "Retrieve the full text content of a note by its ID.",
                "parameters": {
                    "type": "object",
                    "properties": {
                        "id": {"type": "string", "description": "The unique UUID of the note to retrieve."}
                    },
                    "required": ["id"]
                }
            }
        })
        
    # Recording tools
    if recs_count > 0:
        if is_global or recs_count > 1:
            tools.append({
                "type": "function",
                "function": {
                    "name": "list_recordings",
                    "description": "List all recordings stored in Escribolt's database (returns titles, IDs, dates, and space folder IDs)." if is_global else f"List the titles and IDs of the {recs_count} selected recordings in the active context.",
                    "parameters": {
                        "type": "object",
                        "properties": {
                            "limit": {"type": "integer", "description": "Maximum number of recordings to return."}
                        }
                    }
                }
            })
            
        tools.append({
            "type": "function",
            "function": {
                "name": "get_recording_transcript",
                "description": "Retrieve the text transcription of a recording by its ID.",
                "parameters": {
                    "type": "object",
                    "properties": {
                        "id": {"type": "string", "description": "The unique UUID of the recording."}
                    },
                    "required": ["id"]
                }
            }
        })
        
    # Chat tools
    if chats_count > 0:
        if is_global or chats_count > 1:
            tools.append({
                "type": "function",
                "function": {
                    "name": "list_chats",
                    "description": "List all past chat sessions (excluding active global chat) with metadata." if is_global else f"List the titles and IDs of the {chats_count} selected chats in the active context.",
                    "parameters": {
                        "type": "object",
                        "properties": {
                            "limit": {"type": "integer", "description": "Maximum number of chats to return."}
                        }
                    }
                }
            })
            
        tools.append({
            "type": "function",
            "function": {
                "name": "get_chat",
                "description": "Retrieve the compressed, structural Q&A history of a past chat session by its ID.",
                "parameters": {
                    "type": "object",
                    "properties": {
                        "id": {"type": "string", "description": "The unique UUID of the chat session."}
                    },
                    "required": ["id"]
                }
            }
        })

    # Space Search tool
    folder_ids = []
    if context_selection:
        folder_ids = [item.get("id") for item in context_selection if item.get("kind") == "folder"]
        
    if folder_ids:
        tools.append({
            "type": "function",
            "function": {
                "name": "search_space",
                "description": "Perform a keyword-relevance search inside a space (folder) to retrieve relevant notes and transcripts.",
                "parameters": {
                    "type": "object",
                    "properties": {
                        "folderId": {
                            "type": "string", 
                            "description": f"The space (folder) ID to search within. Must be one of: {', '.join(folder_ids)}"
                        },
                        "query": {"type": "string", "description": "The keyword search query terms."}
                    },
                    "required": ["folderId", "query"]
                }
            }
        })

    if model_provider == "openai":
        url = "https://api.openai.com/v1/chat/completions"
        headers = {
            "Authorization": f"Bearer {api_key}",
            "Content-Type": "application/json"
        }
        
        # Build agentic messages: system preamble + structured user history/turns
        system_preamble = _build_context_preamble(
            context_active_ids=context_active_ids,
            is_global_context=is_global_context,
            context_selection=context_selection,
            tools=tools,
        )
        
        cached_messages = get_cached_messages(chat_id, chat_history_messages, system_preamble)
        
        if tools and cached_messages:
            messages = cached_messages
            question = prompt_variables.get("question", "").strip() or prompt_text
            messages.append({"role": "user", "content": question})
        elif tools and chat_history_messages:
            messages = [{"role": "system", "content": system_preamble}]
            for m in chat_history_messages:
                role = m.get("role", "user")
                content = m.get("content", "")
                if content:
                    messages.append({"role": role, "content": content})
            question = prompt_variables.get("question", "").strip() or prompt_text
            messages.append({"role": "user", "content": question})
        else:
            messages = [{"role": "system", "content": system_preamble}]
            # Fallback: flatten history into user_content
            if tools and prompt_variables:
                chat_history = prompt_variables.get("chat_history", "").strip()
                question = prompt_variables.get("question", "").strip() or prompt_text
                user_content = question
                if chat_history:
                    user_content = f"Chat history:\n{chat_history}\n\nUser Question: {question}"
            else:
                user_content = prompt_text
            messages.append({"role": "user", "content": user_content})
        
        try:
            for loop_idx in range(5):
                payload = {
                    "model": model_name or "gpt-4o",
                    "messages": messages,
                    "max_tokens": max_tokens
                }
                if tools:
                    payload["tools"] = tools
                    payload["tool_choice"] = "auto"
                
                r = requests.post(url, headers=headers, json=payload, timeout=60)
                if r.status_code != 200:
                    yield ("error", f"OpenAI API error: {r.status_code} - {r.text}")
                    return
                    
                resp_json = r.json()
                message = resp_json.get("choices", [{}])[0].get("message", {})
                tool_calls = message.get("tool_calls")
                
                if not tool_calls:
                    content = message.get("content", "")
                    if content:
                        for chunk_item in yield_simulated_stream(content):
                            yield chunk_item
                    messages.append(message)
                    if chat_id:
                        SESSION_MESSAGES_CACHE[chat_id] = messages
                        save_session_cache()
                    break
                    
                messages.append(message)
                
                for tc_idx, tc in enumerate(tool_calls):
                    function_name = tc.get("function", {}).get("name")
                    function_args = json_mod.loads(tc.get("function", {}).get("arguments", "{}"))
                    
                    # Yield progress event with unique step ID
                    progress_msg = resolve_tool_progress_message(function_name, function_args, context_selection)
                    yield ("progress", {"step": f"tool-{loop_idx}-{tc_idx}", "message": progress_msg})
                    
                    tool_result = handle_tool_call(
                        function_name, 
                        function_args,
                        context_active_ids=context_active_ids,
                        is_global_context=is_global_context,
                        context_selection=context_selection
                    )
                    
                    messages.append({
                        "role": "tool",
                        "tool_call_id": tc.get("id"),
                        "name": function_name,
                        "content": tool_result
                    })
        except Exception as e:
            yield ("error", f"OpenAI tool execution error: {str(e)}")

    elif model_provider == "pro":
        if not server_url or not jwt:
            yield ("error", "Missing server_url or jwt for PRO model routing")
            return
            
        headers = {
            "Content-Type": "application/json",
            "Authorization": f"Bearer {jwt}"
        }
        if device_id_hash:
            headers["X-Device-Id-Hash"] = device_id_hash
            headers["x-device-id-hash"] = device_id_hash

        question = prompt_variables.get("question", "").strip() or prompt_text
        chat_history_payload = []
        for m in chat_history_messages or []:
            role = "assistant" if m.get("role") == "assistant" else "user"
            content = str(m.get("content") or "").strip()
            if content:
                chat_history_payload.append({"role": role, "content": content})

        active_ids_payload = {
            "notes": list(context_active_ids.notes or []) if context_active_ids else [],
            "recordings": list(context_active_ids.recordings or []) if context_active_ids else [],
            "chats": list(context_active_ids.chats or []) if context_active_ids else [],
        }
        context_scope_payload = {
            "isGlobalContext": bool(is_global_context),
            "activeIds": active_ids_payload,
            "selection": context_selection or [],
        }
        model_alias = model_name or "gpt-4o"
        agent_state_token = None
        pending_tool_results = None

        # Dialogue loop. The server owns provider messages/tool schemas; this local
        # process only executes returned tool calls against local scoped data.
        try:
            for loop_idx in range(5):
                # Exchange JWT for a fresh Capability Token for this iteration
                try:
                    cap_res = requests.post(
                        f"{server_url}/api/capabilities/issue",
                        headers=headers,
                        json={
                            "service": "llm",
                            "action": "transform" if tools else "stream",
                            "provider": "escribolt",
                            "metadata": {
                                "intent": "chat",
                                "actionType": "chat",
                                "aiActionType": "chat",
                                "modelAlias": model_alias
                            }
                        },
                        timeout=15
                    )
                    if cap_res.status_code != 200:
                        yield ("error", f"Pro capability issue error: {cap_res.status_code} - {cap_res.text}")
                        return
                    capability_token = cap_res.json().get("capability", {}).get("token")
                except Exception as e:
                    yield ("error", f"Failed to issue PRO capability: {str(e)}")
                    return

                if tools:
                    if agent_state_token:
                        payload = {
                            "actionType": "chat",
                            "agentMode": "local_rag",
                            "agentStateToken": agent_state_token,
                            "toolResults": pending_tool_results or [],
                            "model": model_alias,
                            "maxTokens": max_tokens,
                        }
                    else:
                        payload = {
                            "actionType": "chat",
                            "agentMode": "local_rag",
                            "question": question,
                            "chatHistory": chat_history_payload,
                            "contextScope": context_scope_payload,
                            "model": model_alias,
                            "maxTokens": max_tokens,
                        }
                else:
                    payload = {
                        "actionType": "chat",
                        "question": question,
                        "chatHistory": chat_history_payload,
                        "model": model_alias,
                        "maxTokens": max_tokens,
                    }
                    
                relay_headers = {
                    "Content-Type": "application/json",
                    "Authorization": f"Bearer {capability_token}"
                }
                if device_id_hash:
                    relay_headers["X-Device-Id-Hash"] = device_id_hash
                    
                # If we have tools, we must use a non-streaming transform call to handle tool-use loop
                # If we don't have tools, we can call stream directly!
                if tools:
                    r = requests.post(
                        f"{server_url}/api/relay/llm/transform",
                        headers=relay_headers,
                        json=payload,
                        timeout=60
                    )
                    if r.status_code != 200:
                        yield ("error", f"Pro LLM relay error: {r.status_code} - {r.text}")
                        return
                    resp_json = r.json()
                    tool_calls = resp_json.get("toolCalls") or []
                    
                    if not tool_calls:
                        message = resp_json.get("message") or {}
                        content = resp_json.get("text") or message.get("content", "")
                        if content:
                            for chunk_item in yield_simulated_stream(content):
                                yield chunk_item
                        break

                    agent_state_token = resp_json.get("agentStateToken")
                    if not agent_state_token:
                        yield ("error", "Pro LLM relay did not return agent continuation state")
                        return

                    pending_tool_results = []
                    
                    for tc_idx, tc in enumerate(tool_calls):
                        function_name = tc.get("name") or tc.get("function", {}).get("name")
                        raw_args = tc.get("arguments", tc.get("function", {}).get("arguments", "{}"))
                        if isinstance(raw_args, dict):
                            function_args = raw_args
                        else:
                            try:
                                function_args = json_mod.loads(str(raw_args or "{}"))
                            except Exception:
                                function_args = {}
                        
                        # Yield progress event with unique step ID
                        progress_msg = resolve_tool_progress_message(function_name, function_args, context_selection)
                        yield ("progress", {"step": f"tool-{loop_idx}-{tc_idx}", "message": progress_msg})
                        
                        tool_result = handle_tool_call(
                            function_name, 
                            function_args,
                            context_active_ids=context_active_ids,
                            is_global_context=is_global_context,
                            context_selection=context_selection
                        )
                        
                        pending_tool_results.append({
                            "toolCallId": tc.get("id"),
                            "name": function_name,
                            "content": tool_result
                        })
                else:
                    # Non-agentic direct stream routing
                    r = requests.post(
                        f"{server_url}/api/relay/llm/stream",
                        headers=relay_headers,
                        json=payload,
                        stream=True,
                        timeout=60
                    )
                    if r.status_code != 200:
                        yield ("error", f"Pro LLM stream relay error: {r.status_code} - {r.text}")
                        return
                    full_streamed_answer = []
                    for line in r.iter_lines():
                        if not line:
                            continue
                        line_str = line.decode("utf-8").strip()
                        if line_str.startswith("data: "):
                            data_part = line_str[6:]
                            try:
                                chunk_json = json_mod.loads(data_part)
                                event = chunk_json.get("event")
                                if event == "chunk":
                                    text = chunk_json.get("text", "")
                                    if text:
                                        full_streamed_answer.append(text)
                                        yield ("chunk", text)
                                elif event == "done":
                                    break
                                elif event == "error":
                                    yield ("error", chunk_json.get("message") or chunk_json.get("error") or "Server stream error")
                                    break
                            except Exception:
                                pass
                    break
        except Exception as e:
            yield ("error", f"PRO tool execution error: {str(e)}")

    elif model_provider == "groq":
        url = "https://api.groq.com/openai/v1/chat/completions"
        headers = {
            "Authorization": f"Bearer {api_key}",
            "Content-Type": "application/json"
        }
        payload = {
            "model": model_name or "llama-3.3-70b-versatile",
            "messages": [{"role": "user", "content": prompt_text}],
            "stream": True,
            "max_tokens": max_tokens
        }
        try:
            r = requests.post(url, headers=headers, json=payload, stream=True, timeout=60)
            if r.status_code != 200:
                yield ("error", f"Groq API error: {r.status_code} - {r.text}")
                return
            for line in r.iter_lines():
                if not line:
                    continue
                line_str = line.decode("utf-8").strip()
                if line_str.startswith("data: "):
                    data_part = line_str[6:]
                    if data_part == "[DONE]":
                        break
                    try:
                        chunk_json = json_mod.loads(data_part)
                        delta = chunk_json.get("choices", [{}])[0].get("delta", {})
                        
                        content = delta.get("content")

                        if content:
                            yield ("chunk", content)
                    except Exception:
                        pass
        except Exception as e:
            yield ("error", f"Groq connection error: {str(e)}")

    elif model_provider == "anthropic":
        url = "https://api.anthropic.com/v1/messages"
        headers = {
            "x-api-key": api_key,
            "anthropic-version": "2023-06-01",
            "Content-Type": "application/json"
        }
        payload = {
            "model": model_name or "claude-3-5-sonnet-20241022",
            "messages": [{"role": "user", "content": prompt_text}],
            "stream": True,
            "max_tokens": max_tokens
        }
        try:
            r = requests.post(url, headers=headers, json=payload, stream=True, timeout=60)
            if r.status_code != 200:
                yield ("error", f"Anthropic API error: {r.status_code} - {r.text}")
                return
            for line in r.iter_lines():
                if not line:
                    continue
                line_str = line.decode("utf-8").strip()
                if line_str.startswith("data: "):
                    data_part = line_str[6:]
                    try:
                        chunk_json = json_mod.loads(data_part)
                        if chunk_json.get("type") == "content_block_delta":
                            text_val = chunk_json.get("delta", {}).get("text", "")
                            if text_val:
                                yield ("chunk", text_val)
                    except Exception:
                        pass
        except Exception as e:
            yield ("error", f"Anthropic connection error: {str(e)}")

    elif model_provider == "gemini":
        gemini_model = model_name or "gemini-1.5-flash"
        url = f"https://generativelanguage.googleapis.com/v1beta/models/{gemini_model}:streamGenerateContent?alt=sse&key={api_key}"
        headers = {
            "Content-Type": "application/json"
        }
        payload = {
            "contents": [{"parts": [{"text": prompt_text}]}],
            "generationConfig": {
                "maxOutputTokens": max_tokens
            }
        }
        try:
            r = requests.post(url, headers=headers, json=payload, stream=True, timeout=60)
            if r.status_code != 200:
                yield ("error", f"Gemini API error: {r.status_code} - {r.text}")
                return
            for line in r.iter_lines():
                if not line:
                    continue
                line_str = line.decode("utf-8").strip()
                if line_str.startswith("data: "):
                    data_part = line_str[6:]
                    try:
                        chunk_json = json_mod.loads(data_part)
                        parts = chunk_json.get("candidates", [{}])[0].get("content", {}).get("parts", [])
                        for p in parts:
                            if "text" in p:
                                yield ("chunk", p["text"])
                    except Exception:
                        pass
        except Exception as e:
            yield ("error", f"Gemini connection error: {str(e)}")
    else:
        yield ("error", f"Unknown BYOK provider {model_provider}")


@app.post("/v1/chat/stream")
async def chat_stream_endpoint(req: ChatStreamRequest):
    prompt_variables = req.prompt_variables or {}
    
    # Check for prompt template 'chat'
    try:
        prompt_text = load_prompt_template("chat", prompt_variables)
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Failed to load prompt template: {str(e)}")
        
    model_provider = req.model.lower().strip()
    max_tokens = req.max_tokens or 2048
    
    if model_provider == "local":
        begin_model_activity()
        try:
            enhancer_instance = get_enhancer()
        except Exception as e:
            end_model_activity()
            raise HTTPException(status_code=500, detail=f"Failed to load local model: {str(e)}")
            
        async def event_stream():
            try:
                queue = asyncio.Queue()
                loop = asyncio.get_event_loop()
                
                messages = [{"role": "user", "content": prompt_text}]

                def generate_to_queue():
                    try:
                        buffer = []
                        last_emit = time.time()
                        
                        for chunk in enhancer_instance.stream_completion(messages=messages, max_tokens=max_tokens):
                            buffer.append(chunk)
                            if len(buffer) >= 5 or (time.time() - last_emit > 0.1):
                                combined = "".join(buffer)
                                if combined:
                                    asyncio.run_coroutine_threadsafe(queue.put(combined), loop)
                                buffer = []
                                last_emit = time.time()
                                
                        if buffer:
                            asyncio.run_coroutine_threadsafe(queue.put("".join(buffer)), loop)
                    finally:
                        asyncio.run_coroutine_threadsafe(queue.put(None), loop)
                        
                task = asyncio.create_task(asyncio.to_thread(generate_to_queue))
                
                while True:
                    chunk = await queue.get()
                    if chunk is None:
                        yield f"data: {json_mod.dumps({'event': 'done'})}\n\n"
                        break
                    yield f"data: {json_mod.dumps({'event': 'chunk', 'text': chunk})}\n\n"
                    
                await task
            finally:
                end_model_activity()
                
        return StreamingResponse(event_stream(), media_type="text/event-stream")
        
    else:
        # Remote BYOK model
        async def event_stream_byok():
            try:
                queue = asyncio.Queue()
                loop = asyncio.get_event_loop()
                
                def generate_to_queue():
                    try:
                        for item in stream_byok(
                            model_provider=model_provider,
                            model_name=req.model_name,
                            api_key=req.api_key,
                            prompt_text=prompt_text,
                            max_tokens=max_tokens,
                            context_active_ids=req.context_active_ids,
                            is_global_context=req.is_global_context,
                            context_selection=req.context_selection,
                            prompt_variables=prompt_variables,
                            jwt=req.jwt,
                            device_id_hash=req.device_id_hash,
                            server_url=req.server_url,
                            chat_history_messages=req.messages,
                            chat_id=req.chat_id
                        ):
                            asyncio.run_coroutine_threadsafe(queue.put(item), loop)
                    finally:
                        asyncio.run_coroutine_threadsafe(queue.put(None), loop)
                        
                task = asyncio.create_task(asyncio.to_thread(generate_to_queue))
                
                while True:
                    item = await queue.get()
                    if item is None:
                        yield f"data: {json_mod.dumps({'event': 'done'})}\n\n"
                        break
                    
                    event_type, val = item
                    if event_type == "error":
                        yield f"data: {json_mod.dumps({'event': 'error', 'message': val})}\n\n"
                        break
                    elif event_type == "progress":
                        yield f"data: {json_mod.dumps({'event': 'progress', 'step': val.get('step', 'llm'), 'message': val.get('message', '')})}\n\n"
                    else:
                        yield f"data: {json_mod.dumps({'event': 'chunk', 'text': val})}\n\n"
                    
                await task
            except Exception as e:
                yield f"data: {json_mod.dumps({'event': 'error', 'message': str(e)})}\n\n"
                
        return StreamingResponse(event_stream_byok(), media_type="text/event-stream")



from fastapi.responses import StreamingResponse

import socket
import json as json_mod

def call_escribolt_companion(command: str, payload: dict) -> dict:
    socket_path = os.path.expanduser("~/.escribolt/escribolt-companion-cli.sock")
    token_path = os.path.expanduser("~/.escribolt/companion-cli.token")
    
    if not os.path.exists(socket_path) or not os.path.exists(token_path):
        return {"error": "companion_not_running"}
        
    try:
        with open(token_path, "r") as f:
            token = f.read().strip()
            
        s = socket.socket(socket.AF_UNIX, socket.SOCK_STREAM)
        s.connect(socket_path)
        
        # Authenticate
        s.sendall((json_mod.dumps({"token": token}) + "\n").encode("utf-8"))
        auth_resp = json_mod.loads(s.recv(1024).decode("utf-8").strip())
        if auth_resp.get("status") != "authenticated":
            return {"error": "auth_failed"}
            
        # Send command
        s.sendall((json_mod.dumps({"command": command, "payload": payload}) + "\n").encode("utf-8"))
        
        # Read response
        resp_data = ""
        while True:
            chunk = s.recv(4096).decode("utf-8")
            if not chunk:
                break
            resp_data += chunk
            if "\n" in chunk:
                break
        return json_mod.loads(resp_data.strip())
    except Exception as e:
        return {"error": str(e)}

def clean_id(val):
    s = str(val or "").strip()
    # Strip brackets/braces/quotes
    while len(s) > 1 and s[0] in ("'", '"', '<', '>', '{', '}', '(', ')'):
        s = s[1:-1].strip()
    if s.lower().startswith("id:"):
        s = s[3:].strip()
    while len(s) > 1 and s[0] in ("'", '"', '<', '>', '{', '}', '(', ')'):
        s = s[1:-1].strip()
    return s

def yield_simulated_stream(content: str):
    import time
    # Chunk size of 10 characters, and a delay of 0.012 seconds yields a perfect natural stream
    chunk_size = 10
    i = 0
    while i < len(content):
        chunk = content[i:i+chunk_size]
        yield ("chunk", chunk)
        time.sleep(0.012)
        i += chunk_size

def resolve_tool_progress_message(tool_name: str, arguments: dict, context_selection: Optional[list[dict]] = None) -> str:
    try:
        if tool_name == "list_notes":
            return "Listing notes in Escribolt..."
        elif tool_name == "get_note":
            note_id = clean_id(arguments.get("id", ""))
            # Try to find in context_selection first
            if context_selection:
                for item in context_selection:
                    if item.get("kind") == "note" and item.get("id") == note_id:
                        return f"Reading note: {item.get('label', 'Untitled note')}..."
            # Fallback: quick companion lookup
            res = call_escribolt_companion("notes.list", {"limit": 500})
            notes = res.get("notes", [])
            for n in notes:
                if n.get("id") == note_id or str(note_id).strip().lower() in n.get("title", "").strip().lower():
                    return f"Reading note: {n.get('title', 'Untitled note')}..."
            return f"Reading note: {note_id}..."
        elif tool_name == "list_recordings":
            return "Listing recordings in Escribolt..."
        elif tool_name == "get_recording_transcript":
            rec_id = clean_id(arguments.get("id", ""))
            if context_selection:
                for item in context_selection:
                    if item.get("kind") == "recording" and item.get("id") == rec_id:
                        return f"Reading transcript of {item.get('label', 'Untitled recording')}..."
            res = call_escribolt_companion("recordings.list", {"limit": 500})
            recs = res.get("recordings", [])
            for r in recs:
                if r.get("id") == rec_id or str(rec_id).strip().lower() in r.get("title", "").strip().lower():
                    return f"Reading transcript of {r.get('title', 'Untitled recording')}..."
            return f"Reading transcript of {rec_id}..."
        elif tool_name == "list_chats":
            return "Listing past chat sessions..."
        elif tool_name == "get_chat":
            chat_id = clean_id(arguments.get("id", ""))
            if context_selection:
                for item in context_selection:
                    if item.get("kind") == "chat" and item.get("id") == chat_id:
                        return f"Reading past chat: {item.get('label', 'Untitled chat')}..."
            res = call_escribolt_companion("chats.list", {"limit": 500})
            chats = res.get("chats", [])
            for c in chats:
                if c.get("id") == chat_id or str(chat_id).strip().lower() in c.get("title", "").strip().lower():
                    return f"Reading past chat: {c.get('title', 'Untitled chat')}..."
            return f"Reading past chat: {chat_id}..."
        elif tool_name == "search_space":
            folder_id = arguments.get("folderId")
            query = arguments.get("query", "")
            space_label = "Space"
            if context_selection:
                for item in context_selection:
                    if item.get("kind") == "folder" and item.get("id") == folder_id:
                        space_label = item.get("label", "Space")
                        break
            return f"Searching space '{space_label}' for '{query}'..."
    except Exception:
        pass
    return f"Executing tool {tool_name}..."

def handle_tool_call(
    tool_name: str, 
    arguments: dict,
    context_active_ids: Optional[ContextActiveIds] = None,
    is_global_context: bool = True,
    context_selection: Optional[list[dict]] = None
) -> str:
    has_global = is_global_context
    
    # 1. Parse active context restrictions
    selected_folders = []
    selected_notes = []
    selected_recordings = []
    selected_chats = []
    
    if context_active_ids:
        selected_notes = context_active_ids.notes or []
        selected_recordings = context_active_ids.recordings or []
        selected_chats = context_active_ids.chats or []
        
    if context_selection:
        selected_folders = [item.get("id") for item in context_selection if item.get("kind") == "folder"]

    if tool_name == "list_notes":
        limit = arguments.get("limit", 50)
        res = call_escribolt_companion("notes.list", {"limit": 500})
        if "error" in res:
            return json_mod.dumps({"status": "error", "message": res["error"]})
        notes = res.get("notes", [])
        if not has_global:
            notes = [
                n for n in notes 
                if (n.get("id") in selected_notes) or (n.get("folderId") in selected_folders)
            ]
        return json_mod.dumps({"status": "success", "notes": notes[:limit]})
        
    elif tool_name == "get_note":
        raw_note_id = arguments.get("id")
        if not raw_note_id:
            return json_mod.dumps({"status": "error", "message": "id is required"})
        note_id = clean_id(raw_note_id)
            
        # Robust lookup: if note_id is not a UUID, try to find it by title
        res_list = call_escribolt_companion("notes.list", {"limit": 500})
        if "error" in res_list:
            return json_mod.dumps({"status": "error", "message": res_list["error"]})
        notes_list = res_list.get("notes", [])
        
        # Try to find by UUID first
        note_meta = next((n for n in notes_list if n.get("id") == note_id), None)
        # If not found, try to find by title matching inside the selected context first (resolves duplicate titles)
        if not note_meta and not has_global:
            note_meta = next((n for n in notes_list if n.get("id") in selected_notes and n.get("title", "").strip().lower() == str(note_id).strip().lower()), None)
            if not note_meta:
                note_meta = next((n for n in notes_list if n.get("id") in selected_notes and str(note_id).strip().lower() in n.get("title", "").strip().lower()), None)
        # Fallback to general list lookup
        if not note_meta:
            note_meta = next((n for n in notes_list if n.get("title", "").strip().lower() == str(note_id).strip().lower()), None)
        if not note_meta:
            note_meta = next((n for n in notes_list if str(note_id).strip().lower() in n.get("title", "").strip().lower()), None)
            
        if not note_meta:
            return json_mod.dumps({"status": "error", "message": f"Note not found: {note_id}"})
            
        resolved_uuid = note_meta.get("id")
            
        if not has_global:
            if (resolved_uuid not in selected_notes) and (note_meta.get("folderId") not in selected_folders):
                return json_mod.dumps({"status": "error", "message": "Access denied: Note is outside the selected context"})
                
        res = call_escribolt_companion("notes.get", {"id": resolved_uuid})
        if "error" in res:
            return json_mod.dumps({"status": "error", "message": res["error"]})
        note = res.get("note", {})
        return json_mod.dumps({
            "status": "success", 
            "id": note.get("id"),
            "title": note.get("title"),
            "content": note.get("text", "")
        })
        
    elif tool_name == "get_recording_transcript":
        raw_recording_id = arguments.get("id")
        if not raw_recording_id:
            return json_mod.dumps({"status": "error", "message": "id is required"})
        recording_id = clean_id(raw_recording_id)
            
        # Robust lookup: if recording_id is not a UUID, try to find it by title
        res_list = call_escribolt_companion("recordings.list", {"limit": 500})
        if "error" in res_list:
            return json_mod.dumps({"status": "error", "message": res_list["error"]})
        recordings_list = res_list.get("recordings", [])
        
        # Try to find by UUID first
        rec_meta = next((r for r in recordings_list if r.get("id") == recording_id), None)
        # If not found, try to find by title matching inside the selected context first (resolves duplicate titles)
        if not rec_meta and not has_global:
            rec_meta = next((r for r in recordings_list if r.get("id") in selected_recordings and r.get("title", "").strip().lower() == str(recording_id).strip().lower()), None)
            if not rec_meta:
                rec_meta = next((r for r in recordings_list if r.get("id") in selected_recordings and str(recording_id).strip().lower() in r.get("title", "").strip().lower()), None)
        # Fallback to general list lookup
        if not rec_meta:
            rec_meta = next((r for r in recordings_list if r.get("title", "").strip().lower() == str(recording_id).strip().lower()), None)
        if not rec_meta:
            rec_meta = next((r for r in recordings_list if str(recording_id).strip().lower() in r.get("title", "").strip().lower()), None)
            
        if not rec_meta:
            return json_mod.dumps({"status": "error", "message": f"Recording not found: {recording_id}"})
            
        resolved_uuid = rec_meta.get("id")
        
        if not has_global:
            if (resolved_uuid not in selected_recordings) and (rec_meta.get("folderId") not in selected_folders):
                return json_mod.dumps({"status": "error", "message": "Access denied: Recording is outside the selected context"})
                
        res = call_escribolt_companion("notes.transcript.get", {"id": resolved_uuid})
        if "error" in res:
            return json_mod.dumps({"status": "error", "message": res["error"]})
        return json_mod.dumps({
            "status": "success",
            "id": resolved_uuid,
            "transcript": res.get("transcript", "")
        })

    elif tool_name == "list_recordings":
        limit = arguments.get("limit", 50)
        res = call_escribolt_companion("recordings.list", {"limit": 500})
        if "error" in res:
            return json_mod.dumps({"status": "error", "message": res["error"]})
        recordings = res.get("recordings", [])
        if not has_global:
            recordings = [
                r for r in recordings 
                if (r.get("id") in selected_recordings) or (r.get("folderId") in selected_folders)
            ]
        return json_mod.dumps({"status": "success", "recordings": recordings[:limit]})

    elif tool_name == "list_chats":
        limit = arguments.get("limit", 50)
        res = call_escribolt_companion("chats.list", {"limit": 500})
        if "error" in res:
            return json_mod.dumps({"status": "error", "message": res["error"]})
        chats = res.get("chats", [])
        if not has_global:
            chats = [c for c in chats if c.get("id") in selected_chats]
        return json_mod.dumps({"status": "success", "chats": chats[:limit]})

    elif tool_name == "get_chat":
        chat_id = arguments.get("id")
        if not chat_id:
            return json_mod.dumps({"status": "error", "message": "id is required"})
            
        if not has_global:
            if chat_id not in selected_chats:
                return json_mod.dumps({"status": "error", "message": "Access denied: Chat is outside the selected context"})
                
        res = call_escribolt_companion("chats.get", {"id": chat_id})
        if "error" in res:
            return json_mod.dumps({"status": "error", "message": res["error"]})
        return json_mod.dumps({
            "status": "success",
            "id": res.get("id"),
            "title": res.get("title"),
            "compressed_history": res.get("compressedHistory", "")
        })

    elif tool_name == "search_space":
        folder_id = arguments.get("folderId")
        query = arguments.get("query", "")
        if not folder_id:
            return json_mod.dumps({"status": "error", "message": "folderId is required"})
            
        if not has_global and folder_id not in selected_folders:
            return json_mod.dumps({"status": "error", "message": "Access denied: Space is outside the selected context"})
            
        res = call_escribolt_companion("space.search", {"folderId": folder_id, "query": query})
        if "error" in res:
            return json_mod.dumps({"status": "error", "message": res["error"]})
        return json_mod.dumps({
            "status": "success",
            "notes": res.get("notes", []),
            "recordings": res.get("recordings", [])
        })
        
    return json_mod.dumps({"status": "error", "message": f"unknown tool {tool_name}"})



class TranscribeFileRequest(BaseModel):
    audio_path: str


@app.post("/transcribe_file", response_model=ActionResponse)
def transcribe_file(req: TranscribeFileRequest):
    """
    Transcribe a specific audio file path without clipboard side effects.
    Used by Record Mode batch processing.
    """
    if not req.audio_path or not os.path.exists(req.audio_path):
        return {"status": "error", "mode": "record", "message": "Audio file not found"}

    begin_model_activity()
    try:
        text = get_transcriber().transcribe(req.audio_path, language=_current_language)
    except Exception as error:
        message = local_transcription_error_message(error)
        print(f"[transcribe_file] {message}")
        return {"status": "error", "mode": "record", "message": message}
    finally:
        end_model_activity()
    if not text:
        return {"status": "error", "mode": "record", "message": "No speech detected"}

    return {"status": "success", "mode": "record", "text": text}


@app.post("/transcribe", response_model=ActionResponse)
def transcribe(req: TranscribeRequest = TranscribeRequest()):
    """
    Phase 2: Transcribe the recorded audio and perform the action.
    Call this after /start_recording returns.
    """
    global _last_audio_file, _last_mode

    if not _last_audio_file:
        return {"status": "error", "mode": "dictate", "message": "No recording available"}

    # Use stored mode if available, else detect
    mode = _last_mode or "dictate"

    # 3. Transcribe Voice
    begin_model_activity()
    try:
        transcription = get_transcriber().transcribe(_last_audio_file, language=_current_language)
    except Exception as error:
        message = local_transcription_error_message(error)
        print(f"[transcribe] {message}")
        return {"status": "error", "mode": mode, "message": message}
    finally:
        end_model_activity()

    if not transcription:
        return {"status": "error", "mode": mode, "message": "No speech detected"}

    # 4. Action based on mode
    if mode == "agent":
        # Agent LLM execution is orchestrated in Electron main process.
        # This endpoint returns raw transcription text for compatibility.
        print(f"Agent voice prompt transcribed: {transcription}")
        final_text = transcription
    else:
        print(f"Dictating: {transcription}")
        final_text = transcription

    # 5. Paste Result
    paste_error = None
    if req.auto_paste:
        try:
            paste_text(final_text)
        except Exception as exc:
            paste_error = f"Paste failed: {exc}"
            print(f"[paste] Paste error: {paste_error}")
    else:
        print("Auto-paste disabled (Notes Mode)")

    # Clear state
    _last_audio_file = None
    _last_mode = None

    result = {"status": "success", "mode": mode, "text": final_text}
    if paste_error:
        result["paste_error"] = paste_error
    return result


@app.post("/paste_text", response_model=ActionResponse)
def paste_text_endpoint(req: PasteRequest):
    text = (req.text or "").strip()
    if not text:
        return {"status": "error", "mode": "dictate", "message": "Text is empty"}

    try:
        paste_text(text)
    except Exception as exc:
        return {
            "status": "error",
            "mode": "dictate",
            "message": f"Paste failed: {exc}",
            "text": text,
        }
    return {"status": "success", "mode": "dictate", "text": text}


class ChatTitleRequest(BaseModel):
    first_message: str
    model: str
    model_name: Optional[str] = None
    api_key: Optional[str] = None


@app.post("/v1/chat/title")
async def chat_title_endpoint(req: ChatTitleRequest):
    prompt_text = (
        "Generate a concise, 2-to-4 word title for a chat session starting with this user message. "
        "Do not include quotes, markdown, punctuation, or any introductory phrases. Return ONLY the title itself.\n\n"
        f"User message: {req.first_message}"
    )
    
    model_provider = req.model.lower().strip()
    
    if model_provider == "local":
        begin_model_activity()
        try:
            enhancer_instance = get_enhancer()
            messages = [
                {
                    "role": "system",
                    "content": "You are a helpful assistant. Return ONLY the requested short title without any other text, prefix, suffix, or quotes.",
                },
                {"role": "user", "content": prompt_text}
            ]
            title = ""
            for chunk in enhancer_instance.stream_completion(messages=messages, max_tokens=50):
                title += chunk
            return {"title": title.strip().replace('"', '').replace("'", "").strip()}
        except Exception:
            return {"title": req.first_message[:40].strip()}
        finally:
            end_model_activity()
    else:
        # Remote BYOK model
        try:
            title = ""
            for item in stream_byok(
                model_provider=model_provider,
                model_name=req.model_name,
                api_key=req.api_key,
                prompt_text=prompt_text,
                max_tokens=50
            ):
                event_type, val = item
                if event_type == "chunk":
                    title += val
                elif event_type == "error":
                    break
            if not title:
                return {"title": req.first_message[:40].strip()}
            return {"title": title.strip().replace('"', '').replace("'", "").strip()}
        except Exception:
            return {"title": req.first_message[:40].strip()}


if __name__ == "__main__":
    import uvicorn
    uvicorn.run(app, host="127.0.0.1", port=8000)
