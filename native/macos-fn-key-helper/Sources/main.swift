import Foundation
import AppKit
import ApplicationServices

private var eventTapHandle: CFMachPort?
private var runLoopSource: CFRunLoopSource?
private var fnIsDown = false

private func emitJson(_ payload: [String: Any], toStderr: Bool = false) {
    guard JSONSerialization.isValidJSONObject(payload),
          let data = try? JSONSerialization.data(withJSONObject: payload, options: []),
          let line = String(data: data, encoding: .utf8) else {
        return
    }

    if toStderr {
        FileHandle.standardError.write((line + "\n").data(using: .utf8)!)
    } else {
        FileHandle.standardOutput.write((line + "\n").data(using: .utf8)!)
    }
}

private func stopEventTap() {
    if let source = runLoopSource {
        CFRunLoopRemoveSource(CFRunLoopGetCurrent(), source, .commonModes)
        runLoopSource = nil
    }
    if let tap = eventTapHandle {
        CFMachPortInvalidate(tap)
        eventTapHandle = nil
    }
}

private func emitInputMonitoringStatus(requestAccess: Bool) {
    let granted = requestAccess
        ? CGRequestListenEventAccess()
        : CGPreflightListenEventAccess()
    emitJson([
        "type": "status",
        "status": granted ? "granted" : "denied",
        "permission": "input-monitoring",
        "requested": requestAccess,
        "timestamp": Date().timeIntervalSince1970,
    ])
}

private func handleSignal(_ signal: Int32) {
    stopEventTap()
    emitJson([
        "type": "status",
        "status": "stopped",
        "signal": signal,
    ])
    exit(0)
}

private let callback: CGEventTapCallBack = { proxy, type, event, _ in
    if type == .tapDisabledByTimeout || type == .tapDisabledByUserInput {
        if let tap = eventTapHandle {
            CGEvent.tapEnable(tap: tap, enable: true)
        }
        emitJson([
            "type": "status",
            "status": "warning",
            "message": "Event tap was disabled and has been re-enabled.",
        ], toStderr: true)
        return Unmanaged.passUnretained(event)
    }

    if type == .flagsChanged {
        let fnPressed = event.flags.contains(.maskSecondaryFn)
        if fnPressed != fnIsDown {
            fnIsDown = fnPressed
            emitJson([
                "type": "event",
                "event": fnPressed ? "fn_down" : "fn_up",
                "timestamp": Date().timeIntervalSince1970,
            ])
        }
        return Unmanaged.passUnretained(event)
    }

    if type == .keyDown {
        let keyCode = event.getIntegerValueField(.keyboardEventKeycode)
        if keyCode == 49 {
            let fnPressed = event.flags.contains(.maskSecondaryFn) || fnIsDown
            emitJson([
                "type": "event",
                "event": "space_down",
                "fn": fnPressed,
                "timestamp": Date().timeIntervalSince1970,
            ])
        } else if keyCode == 45 {
            let fnPressed = event.flags.contains(.maskSecondaryFn) || fnIsDown
            emitJson([
                "type": "event",
                "event": "n_down",
                "fn": fnPressed,
                "timestamp": Date().timeIntervalSince1970,
            ])
        } else if keyCode == 15 {
            let fnPressed = event.flags.contains(.maskSecondaryFn) || fnIsDown
            emitJson([
                "type": "event",
                "event": "r_down",
                "fn": fnPressed,
                "timestamp": Date().timeIntervalSince1970,
            ])
        }
    }

    return Unmanaged.passUnretained(event)
}

private func startEventTap() -> Bool {
    let mask = (1 << CGEventType.flagsChanged.rawValue) | (1 << CGEventType.keyDown.rawValue)
    guard let eventTap = CGEvent.tapCreate(
        tap: .cgSessionEventTap,
        place: .headInsertEventTap,
        options: .listenOnly,
        eventsOfInterest: CGEventMask(mask),
        callback: callback,
        userInfo: nil
    ) else {
        emitJson([
            "type": "status",
            "status": "error",
            "message": "Unable to create global keyboard event tap. Enable Accessibility/Input Monitoring permissions.",
        ], toStderr: true)
        return false
    }

    eventTapHandle = eventTap
    guard let source = CFMachPortCreateRunLoopSource(kCFAllocatorDefault, eventTap, 0) else {
        emitJson([
            "type": "status",
            "status": "error",
            "message": "Unable to create run loop source for event tap.",
        ], toStderr: true)
        return false
    }

    runLoopSource = source
    CFRunLoopAddSource(CFRunLoopGetCurrent(), source, .commonModes)
    CGEvent.tapEnable(tap: eventTap, enable: true)
    return true
}

let arguments = CommandLine.arguments
if arguments.contains("--preflight-input-monitoring") {
    emitInputMonitoringStatus(requestAccess: false)
    exit(CGPreflightListenEventAccess() ? 0 : 2)
}
if arguments.contains("--request-input-monitoring") {
    emitInputMonitoringStatus(requestAccess: true)
    exit(CGPreflightListenEventAccess() ? 0 : 2)
}
if arguments.contains("--probe-event-tap") {
    if startEventTap() {
        emitJson([
            "type": "status",
            "status": "granted",
            "permission": "fn-listener",
            "timestamp": Date().timeIntervalSince1970,
        ])
        stopEventTap()
        exit(0)
    }
    exit(2)
}

signal(SIGTERM) { signal in
    handleSignal(signal)
}
signal(SIGINT) { signal in
    handleSignal(signal)
}

let started = startEventTap()
if !started {
    exit(2)
}

emitJson([
    "type": "status",
    "status": "ready",
    "timestamp": Date().timeIntervalSince1970,
])

CFRunLoopRun()
