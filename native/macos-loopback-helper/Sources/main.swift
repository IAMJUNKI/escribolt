import Foundation
import AVFoundation
import ScreenCaptureKit
import CoreMedia
import Darwin

enum HelperError: LocalizedError {
    case missingOutputPath
    case noDisplayFound
    case failedToAddAssetWriterInput(String)
    case writerStartFailed(String)

    var errorDescription: String? {
        switch self {
        case .missingOutputPath:
            return "Missing --output (or --output-system) argument."
        case .noDisplayFound:
            return "No display source is available for ScreenCaptureKit."
        case .failedToAddAssetWriterInput(let destination):
            return "Unable to add audio input to asset writer (\(destination))."
        case .writerStartFailed(let reason):
            return "Asset writer failed to start: \(reason)"
        }
    }
}

struct HelperArguments {
    let systemOutputPath: String
    let microphoneOutputPath: String?
    let probeOnly: Bool
}

func escapedForJSON(_ text: String) -> String {
    text
        .replacingOccurrences(of: "\\", with: "\\\\")
        .replacingOccurrences(of: "\"", with: "\\\"")
        .replacingOccurrences(of: "\n", with: "\\n")
}

@available(macOS 13.0, *)
final class LoopbackRecorder: NSObject, SCStreamOutput, SCStreamDelegate {
    private enum CaptureRole {
        case system
        case microphone
    }

    enum MicrophoneCaptureMode: String {
        case none
        case screenCaptureKit = "screen-capture-kit"
        case avAudioRecorder = "av-audio-recorder"
    }

    private let systemOutputURL: URL
    private let microphoneOutputURL: URL?
    private let sampleQueue = DispatchQueue(label: "escribolt.loopback.sample-queue")
    private let microphoneOutputType = SCStreamOutputType(rawValue: 2)

    private var stream: SCStream?
    private var systemWriter: AVAssetWriter?
    private var systemWriterInput: AVAssetWriterInput?
    private var microphoneWriter: AVAssetWriter?
    private var microphoneWriterInput: AVAssetWriterInput?
    private var stopping = false
    private let stopSemaphore = DispatchSemaphore(value: 0)
    private var lastLevelEmitNanos: UInt64 = 0
    private(set) var microphoneCaptureEnabled = false
    private(set) var microphoneCaptureMode: MicrophoneCaptureMode = .none
    private var fallbackMicRecorder: AVAudioRecorder?

    init(systemOutputURL: URL, microphoneOutputURL: URL?) {
        self.systemOutputURL = systemOutputURL
        self.microphoneOutputURL = microphoneOutputURL
        super.init()
    }

    func start() async throws {
        let content = try await SCShareableContent.excludingDesktopWindows(false, onScreenWindowsOnly: true)
        guard let display = content.displays.first else {
            throw HelperError.noDisplayFound
        }

        let filter = SCContentFilter(display: display, excludingWindows: [])
        let config = SCStreamConfiguration()
        config.capturesAudio = true
        config.excludesCurrentProcessAudio = false
        config.width = 2
        config.height = 2
        config.minimumFrameInterval = CMTime(value: 1, timescale: 1)
        config.sampleRate = 48_000
        config.channelCount = 2

        let microphoneRequested = microphoneOutputURL != nil
        let microphoneFeatureEnabled = microphoneRequested && enableMicrophoneCaptureIfSupported(on: config)

        let stream = SCStream(filter: filter, configuration: config, delegate: self)
        try stream.addStreamOutput(self, type: .audio, sampleHandlerQueue: sampleQueue)

        if microphoneFeatureEnabled, let microphoneOutputType {
            do {
                try stream.addStreamOutput(self, type: microphoneOutputType, sampleHandlerQueue: sampleQueue)
                microphoneCaptureEnabled = true
                microphoneCaptureMode = .screenCaptureKit
            } catch {
                microphoneCaptureEnabled = false
                fputs("{\"status\":\"warning\",\"message\":\"\(escapedForJSON("Unable to enable microphone output on this ScreenCaptureKit runtime: \(error.localizedDescription)"))\"}\n", stderr)
            }
        }

        if microphoneRequested && !microphoneCaptureEnabled && startFallbackMicrophoneRecorder() {
            microphoneCaptureEnabled = true
            microphoneCaptureMode = .avAudioRecorder
        }

        self.stream = stream
        try await stream.startCapture()
    }

    func stopAndWait(timeoutSeconds: TimeInterval = 8.0) {
        if stopping {
            return
        }
        stopping = true

        Task {
            if let stream {
                do {
                    try await stream.stopCapture()
                } catch {
                    fputs("{\"status\":\"warning\",\"message\":\"\(escapedForJSON("stopCapture failed: \(error.localizedDescription)"))\"}\n", stderr)
                }
            }
            self.stopFallbackMicrophoneRecorder()
            self.finishWriters()
            self.stopSemaphore.signal()
        }

        _ = stopSemaphore.wait(timeout: .now() + timeoutSeconds)
    }

    private func enableMicrophoneCaptureIfSupported(on config: SCStreamConfiguration) -> Bool {
        let selectorAndKeyPairs: [(selector: String, key: String)] = [
            ("setCaptureMicrophone:", "captureMicrophone"),
            ("setCapturesMicrophone:", "capturesMicrophone"),
        ]

        for pair in selectorAndKeyPairs {
            let selector = NSSelectorFromString(pair.selector)
            if config.responds(to: selector) {
                config.setValue(NSNumber(value: true), forKey: pair.key)
                return true
            }
        }
        return false
    }

    private func startFallbackMicrophoneRecorder() -> Bool {
        guard let microphoneOutputURL else {
            return false
        }

        let authorizationStatus = AVCaptureDevice.authorizationStatus(for: .audio)
        if authorizationStatus == .denied || authorizationStatus == .restricted {
            fputs("{\"status\":\"warning\",\"message\":\"\(escapedForJSON("Microphone permission is denied or restricted."))\"}\n", stderr)
            return false
        }
        if authorizationStatus == .notDetermined {
            let semaphore = DispatchSemaphore(value: 0)
            var granted = false
            AVCaptureDevice.requestAccess(for: .audio) { didGrant in
                granted = didGrant
                semaphore.signal()
            }
            _ = semaphore.wait(timeout: .now() + 5.0)
            if !granted {
                fputs("{\"status\":\"warning\",\"message\":\"\(escapedForJSON("Microphone permission was not granted."))\"}\n", stderr)
                return false
            }
        }

        do {
            try FileManager.default.removeItem(at: microphoneOutputURL)
        } catch {
            // Ignore when file does not exist.
        }

        let settings: [String: Any] = [
            AVFormatIDKey: kAudioFormatMPEG4AAC,
            AVSampleRateKey: 48_000,
            AVNumberOfChannelsKey: 1,
            AVEncoderBitRateKey: 64_000,
        ]

        do {
            let recorder = try AVAudioRecorder(url: microphoneOutputURL, settings: settings)
            guard recorder.prepareToRecord(), recorder.record() else {
                fputs("{\"status\":\"warning\",\"message\":\"\(escapedForJSON("AVAudioRecorder could not start microphone recording."))\"}\n", stderr)
                return false
            }
            fallbackMicRecorder = recorder
            return true
        } catch {
            fputs("{\"status\":\"warning\",\"message\":\"\(escapedForJSON("AVAudioRecorder microphone fallback failed: \(error.localizedDescription)"))\"}\n", stderr)
            return false
        }
    }

    private func stopFallbackMicrophoneRecorder() {
        guard let recorder = fallbackMicRecorder else {
            return
        }
        recorder.stop()
        fallbackMicRecorder = nil
    }

    private func audioSettings(from sampleBuffer: CMSampleBuffer) -> [String: Any] {
        var sampleRate = 48_000.0
        var channels = 1
        if let formatDesc = CMSampleBufferGetFormatDescription(sampleBuffer),
           let asbdPointer = CMAudioFormatDescriptionGetStreamBasicDescription(formatDesc) {
            let asbd = asbdPointer.pointee
            if asbd.mSampleRate > 0 {
                sampleRate = asbd.mSampleRate
            }
            if asbd.mChannelsPerFrame > 0 {
                channels = Int(asbd.mChannelsPerFrame)
            }
        }

        return [
            AVFormatIDKey: kAudioFormatMPEG4AAC,
            AVSampleRateKey: sampleRate,
            AVNumberOfChannelsKey: max(1, channels),
            AVEncoderBitRateKey: channels > 1 ? 128_000 : 64_000,
        ]
    }

    private func makeWriter(outputURL: URL, from sampleBuffer: CMSampleBuffer) throws -> (writer: AVAssetWriter, input: AVAssetWriterInput) {
        do {
            try FileManager.default.removeItem(at: outputURL)
        } catch {
            // Ignore when file does not exist.
        }

        let writer = try AVAssetWriter(outputURL: outputURL, fileType: .m4a)
        let input = AVAssetWriterInput(mediaType: .audio, outputSettings: audioSettings(from: sampleBuffer))
        input.expectsMediaDataInRealTime = true

        guard writer.canAdd(input) else {
            throw HelperError.failedToAddAssetWriterInput(outputURL.lastPathComponent)
        }
        writer.add(input)

        guard writer.startWriting() else {
            throw HelperError.writerStartFailed(writer.error?.localizedDescription ?? "unknown writer error")
        }
        writer.startSession(atSourceTime: CMSampleBufferGetPresentationTimeStamp(sampleBuffer))
        return (writer: writer, input: input)
    }

    private func configureWriterIfNeeded(for role: CaptureRole, from sampleBuffer: CMSampleBuffer) throws {
        switch role {
        case .system:
            if systemWriter != nil {
                return
            }
            let configured = try makeWriter(outputURL: systemOutputURL, from: sampleBuffer)
            systemWriter = configured.writer
            systemWriterInput = configured.input
        case .microphone:
            guard let microphoneOutputURL else {
                return
            }
            if microphoneWriter != nil {
                return
            }
            let configured = try makeWriter(outputURL: microphoneOutputURL, from: sampleBuffer)
            microphoneWriter = configured.writer
            microphoneWriterInput = configured.input
        }
    }

    private func appendSample(_ sampleBuffer: CMSampleBuffer, for role: CaptureRole) {
        do {
            try configureWriterIfNeeded(for: role, from: sampleBuffer)
        } catch {
            fputs("{\"status\":\"error\",\"message\":\"\(escapedForJSON("Failed to configure \(role == .microphone ? "microphone" : "system") writer: \(error.localizedDescription)"))\"}\n", stderr)
            return
        }

        let writer: AVAssetWriter?
        let writerInput: AVAssetWriterInput?
        switch role {
        case .system:
            writer = systemWriter
            writerInput = systemWriterInput
        case .microphone:
            writer = microphoneWriter
            writerInput = microphoneWriterInput
        }

        guard let writer, let writerInput else {
            return
        }
        guard writer.status == .writing else {
            return
        }
        guard writerInput.isReadyForMoreMediaData else {
            return
        }

        if !writerInput.append(sampleBuffer), writer.status == .failed {
            let message = writer.error?.localizedDescription ?? "audio append failed"
            fputs("{\"status\":\"error\",\"message\":\"\(escapedForJSON(message))\"}\n", stderr)
        }
    }

    private func finishWriter(writer: inout AVAssetWriter?, writerInput: inout AVAssetWriterInput?) {
        guard let activeWriter = writer else {
            return
        }

        writerInput?.markAsFinished()
        let finishSemaphore = DispatchSemaphore(value: 0)
        activeWriter.finishWriting {
            finishSemaphore.signal()
        }
        _ = finishSemaphore.wait(timeout: .now() + 5.0)

        if activeWriter.status == .failed {
            let message = activeWriter.error?.localizedDescription ?? "unknown writer failure"
            fputs("{\"status\":\"error\",\"message\":\"\(escapedForJSON(message))\"}\n", stderr)
        }

        writer = nil
        writerInput = nil
    }

    private func finishWriters() {
        finishWriter(writer: &systemWriter, writerInput: &systemWriterInput)
        finishWriter(writer: &microphoneWriter, writerInput: &microphoneWriterInput)
    }

    func stream(_ stream: SCStream, didStopWithError error: Error) {
        fputs("{\"status\":\"error\",\"message\":\"\(escapedForJSON("SCStream stopped: \(error.localizedDescription)"))\"}\n", stderr)
        stopAndWait()
    }

    func stream(_ stream: SCStream, didOutputSampleBuffer sampleBuffer: CMSampleBuffer, of outputType: SCStreamOutputType) {
        guard CMSampleBufferIsValid(sampleBuffer), CMSampleBufferDataIsReady(sampleBuffer) else {
            return
        }

        if outputType == .audio {
            emitLevelIfNeeded(from: sampleBuffer)
            appendSample(sampleBuffer, for: .system)
            return
        }

        if microphoneCaptureEnabled,
           microphoneCaptureMode == .screenCaptureKit,
           let microphoneOutputType,
           outputType.rawValue == microphoneOutputType.rawValue {
            emitLevelIfNeeded(from: sampleBuffer)
            appendSample(sampleBuffer, for: .microphone)
        }
    }

    private func emitLevelIfNeeded(from sampleBuffer: CMSampleBuffer) {
        let now = DispatchTime.now().uptimeNanoseconds
        if now - lastLevelEmitNanos < 45_000_000 {
            return
        }

        guard let formatDesc = CMSampleBufferGetFormatDescription(sampleBuffer),
              let asbdPointer = CMAudioFormatDescriptionGetStreamBasicDescription(formatDesc) else {
            return
        }
        let asbd = asbdPointer.pointee
        guard asbd.mFormatID == kAudioFormatLinearPCM else {
            return
        }

        guard let blockBuffer = CMSampleBufferGetDataBuffer(sampleBuffer) else {
            return
        }

        var totalLength = 0
        var dataPointer: UnsafeMutablePointer<Int8>?
        let pointerStatus = CMBlockBufferGetDataPointer(
            blockBuffer,
            atOffset: 0,
            lengthAtOffsetOut: nil,
            totalLengthOut: &totalLength,
            dataPointerOut: &dataPointer
        )
        guard pointerStatus == kCMBlockBufferNoErr,
              let bytes = dataPointer,
              totalLength > 0 else {
            return
        }

        var sumSquares = 0.0
        var sampleCount = 0

        if asbd.mBitsPerChannel == 32 && (asbd.mFormatFlags & kAudioFormatFlagIsFloat) != 0 {
            let count = totalLength / MemoryLayout<Float>.size
            let floatPtr = UnsafeRawPointer(bytes).assumingMemoryBound(to: Float.self)
            for index in stride(from: 0, to: count, by: 2) {
                let sample = Double(floatPtr[index])
                sumSquares += sample * sample
                sampleCount += 1
            }
        } else if asbd.mBitsPerChannel == 16 {
            let count = totalLength / MemoryLayout<Int16>.size
            let int16Ptr = UnsafeRawPointer(bytes).assumingMemoryBound(to: Int16.self)
            for index in stride(from: 0, to: count, by: 2) {
                let sample = Double(int16Ptr[index]) / Double(Int16.max)
                sumSquares += sample * sample
                sampleCount += 1
            }
        } else {
            return
        }

        guard sampleCount > 0 else {
            return
        }

        let rms = sqrt(sumSquares / Double(sampleCount))
        let level = min(1.0, max(0.0, rms * 3.4))
        lastLevelEmitNanos = now
        print("{\"status\":\"level\",\"value\":\(String(format: "%.5f", level))}")
        fflush(stdout)
    }
}

func argumentValue(arguments: [String], for flag: String) -> String? {
    guard let index = arguments.firstIndex(of: flag) else {
        return nil
    }
    let valueIndex = arguments.index(after: index)
    guard valueIndex < arguments.endIndex else {
        return nil
    }
    return arguments[valueIndex]
}

func parseHelperArguments(arguments: [String]) -> HelperArguments? {
    let probeOnly = arguments.contains("--probe") || arguments.contains("--permission-probe")
    let systemOutputPath = argumentValue(arguments: arguments, for: "--output-system")
        ?? argumentValue(arguments: arguments, for: "--output")
    guard let systemOutputPath, !systemOutputPath.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty else {
        return nil
    }

    let microphoneOutputPath = argumentValue(arguments: arguments, for: "--output-mic")
    let cleanMicPath = microphoneOutputPath?.trimmingCharacters(in: .whitespacesAndNewlines)
    return HelperArguments(
        systemOutputPath: systemOutputPath,
        microphoneOutputPath: cleanMicPath?.isEmpty == false ? cleanMicPath : nil,
        probeOnly: probeOnly
    )
}

enum SignalRegistry {
    static var sources: [DispatchSourceSignal] = []
}

@available(macOS 13.0, *)
func installSignalHandlers(for recorder: LoopbackRecorder) {
    [SIGINT, SIGTERM].forEach { signalValue in
        signal(signalValue, SIG_IGN)
        let source = DispatchSource.makeSignalSource(signal: signalValue, queue: .main)
        source.setEventHandler {
            recorder.stopAndWait()
            exit(0)
        }
        source.resume()
        SignalRegistry.sources.append(source)
    }
}

guard #available(macOS 13.0, *) else {
    fputs("{\"status\":\"error\",\"message\":\"ScreenCaptureKit requires macOS 13 or newer.\"}\n", stderr)
    exit(1)
}

let args = CommandLine.arguments
guard let helperArguments = parseHelperArguments(arguments: args) else {
    fputs("{\"status\":\"error\",\"message\":\"\(escapedForJSON(HelperError.missingOutputPath.localizedDescription))\"}\n", stderr)
    exit(64)
}

let systemOutputURL = URL(fileURLWithPath: helperArguments.systemOutputPath).standardizedFileURL
let microphoneOutputURL = helperArguments.microphoneOutputPath.map { URL(fileURLWithPath: $0).standardizedFileURL }
let recorder = LoopbackRecorder(systemOutputURL: systemOutputURL, microphoneOutputURL: microphoneOutputURL)
installSignalHandlers(for: recorder)

Task {
    do {
        try await recorder.start()
        if let microphoneOutputURL {
            print("{\"status\":\"started\",\"output\":\"\(escapedForJSON(systemOutputURL.path))\",\"microphone\":\(recorder.microphoneCaptureEnabled ? "true" : "false"),\"microphoneMode\":\"\(recorder.microphoneCaptureMode.rawValue)\",\"microphoneOutput\":\"\(escapedForJSON(microphoneOutputURL.path))\"}")
        } else {
            print("{\"status\":\"started\",\"output\":\"\(escapedForJSON(systemOutputURL.path))\",\"microphone\":false,\"microphoneMode\":\"none\"}")
        }
        fflush(stdout)
        if helperArguments.probeOnly {
            try? await Task.sleep(nanoseconds: 650_000_000)
            recorder.stopAndWait(timeoutSeconds: 3.0)
            exit(0)
        }
    } catch {
        fputs("{\"status\":\"error\",\"message\":\"\(escapedForJSON(error.localizedDescription))\"}\n", stderr)
        exit(2)
    }
}

dispatchMain()
