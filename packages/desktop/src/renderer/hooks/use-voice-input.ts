import { useState, useRef, useCallback } from "react";
import { useAppStore } from "../stores/app.store.js";

/** Linear-interpolation downsample (pure JS) */
function downsample(buffer: Float32Array, fromRate: number, toRate: number): Float32Array {
  if (fromRate === toRate) return buffer;
  const ratio = fromRate / toRate;
  const newLength = Math.round(buffer.length / ratio);
  const result = new Float32Array(newLength);
  for (let i = 0; i < newLength; i++) {
    const srcIdx = i * ratio;
    const lo = Math.floor(srcIdx);
    const hi = Math.min(lo + 1, buffer.length - 1);
    const frac = srcIdx - lo;
    result[i] = buffer[lo] * (1 - frac) + buffer[hi] * frac;
  }
  return result;
}

interface UseVoiceInputOptions {
  onTranscript?: (text: string) => void;
  onError?: (error: string) => void;
}

export function useVoiceInput(opts: UseVoiceInputOptions = {}) {
  const [isRecording, setIsRecording] = useState(false);
  const recordingRef = useRef(false);
  const chunksRef = useRef<Float32Array[]>([]);
  const cleanupRef = useRef<(() => void) | null>(null);
  const sampleRateRef = useRef(48000);

  const voiceModelId = useAppStore((s) => s.voiceModelId);
  const voiceStatuses = useAppStore((s) => s.voiceStatuses);
  const voiceTranscribing = useAppStore((s) => s.voiceTranscribing);
  const transcribeAudio = useAppStore((s) => s.transcribeAudio);
  const addToast = useAppStore((s) => s.addToast);

  const isAvailable = !!(voiceModelId && voiceStatuses[voiceModelId] === "ready");

  const startRecording = useCallback(async () => {
    if (!isAvailable) return;
    try {
      console.log("[voice] requesting getUserMedia...");
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      const track = stream.getAudioTracks()[0];
      const settings = track.getSettings();
      sampleRateRef.current = settings.sampleRate || 48000;
      console.log("[voice] track sampleRate:", sampleRateRef.current);

      chunksRef.current = [];
      recordingRef.current = true;

      // Use MediaStreamTrackProcessor — raw PCM without AudioContext
      // (AudioContext crashes Chromium on some Windows systems)
      if (typeof (globalThis as any).MediaStreamTrackProcessor !== "undefined") {
        console.log("[voice] using MediaStreamTrackProcessor");
        const processor = new (globalThis as any).MediaStreamTrackProcessor({ track });
        const reader = processor.readable.getReader();

        const readLoop = async () => {
          try {
            while (recordingRef.current) {
              const { value, done } = await reader.read();
              if (done || !recordingRef.current) { value?.close(); break; }
              try {
                const samples = new Float32Array(value.numberOfFrames * value.numberOfChannels);
                value.copyTo(samples, { planeIndex: 0 });
                // Take only first channel (mono)
                if (value.numberOfChannels > 1) {
                  chunksRef.current.push(samples.slice(0, value.numberOfFrames));
                } else {
                  chunksRef.current.push(samples);
                }
              } finally {
                value.close();
              }
            }
          } catch (err) {
            console.log("[voice] read loop ended:", err);
          }
          reader.releaseLock();
        };

        readLoop(); // fire and forget

        cleanupRef.current = () => {
          recordingRef.current = false;
          track.stop();
          stream.getTracks().forEach((t) => t.stop());
        };
      } else {
        // Fallback: MediaRecorder (captures WebM, needs conversion in main)
        console.log("[voice] fallback: MediaRecorder");
        const mimeType = MediaRecorder.isTypeSupported("audio/webm;codecs=opus")
          ? "audio/webm;codecs=opus" : undefined;
        const recorder = mimeType
          ? new MediaRecorder(stream, { mimeType })
          : new MediaRecorder(stream);

        const blobChunks: Blob[] = [];
        recorder.ondataavailable = (e) => {
          if (e.data.size > 0) blobChunks.push(e.data);
        };
        recorder.start();

        cleanupRef.current = () => {
          recordingRef.current = false;
          // Will be handled in stopRecording
          (recorder as any)._blobChunks = blobChunks;
          (recorder as any)._stream = stream;
          if (recorder.state !== "inactive") recorder.stop();
        };
      }

      setIsRecording(true);
      console.log("[voice] recording started");
    } catch (err: any) {
      console.error("[voice] startRecording error:", err);
      const msg = err.name === "NotAllowedError" ? "voiceMicPermission" : "voiceError";
      opts.onError?.(msg);
      addToast("error", msg);
    }
  }, [isAvailable, addToast, opts.onError]);

  const stopRecording = useCallback(async (): Promise<string | null> => {
    console.log("[voice] stopping...");
    const cleanup = cleanupRef.current;
    cleanupRef.current = null;
    recordingRef.current = false;
    setIsRecording(false);

    if (cleanup) cleanup();

    // Wait a tick for the read loop to finish
    await new Promise((r) => setTimeout(r, 100));

    const chunks = chunksRef.current;
    chunksRef.current = [];

    if (chunks.length === 0) {
      console.log("[voice] no audio data");
      return null;
    }

    // Concatenate all chunks
    const totalLength = chunks.reduce((s, c) => s + c.length, 0);
    const raw = new Float32Array(totalLength);
    let offset = 0;
    for (const chunk of chunks) {
      raw.set(chunk, offset);
      offset += chunk.length;
    }

    const nativeRate = sampleRateRef.current;
    console.log("[voice] raw samples:", raw.length, "sampleRate:", nativeRate);

    // Downsample to 16kHz in pure JS
    const pcm = nativeRate === 16000 ? raw : downsample(raw, nativeRate, 16000);
    console.log("[voice] PCM 16kHz:", pcm.length, "samples,", (pcm.length / 16000).toFixed(1), "s");

    if (pcm.length < 1600) {
      console.log("[voice] too short, skipping");
      return null;
    }

    try {
      const text = await transcribeAudio(pcm);
      console.log("[voice] result:", text);
      const trimmed = text?.trim();
      // Filter Whisper hallucinations / noise labels
      if (!trimmed || /^\[.*\]$|^\(.*\)$/.test(trimmed)) {
        console.log("[voice] filtered noise label:", trimmed);
        return null;
      }
      opts.onTranscript?.(trimmed);
      return trimmed;
    } catch (err: any) {
      console.error("[voice] transcribe error:", err);
      opts.onError?.("voiceError");
      addToast("error", err.message || "Transcription failed");
      return null;
    }
  }, [transcribeAudio, addToast, opts.onTranscript, opts.onError]);

  const toggleRecording = useCallback(async () => {
    if (isRecording) {
      await stopRecording();
    } else {
      await startRecording();
    }
  }, [isRecording, startRecording, stopRecording]);

  return {
    isRecording,
    isTranscribing: voiceTranscribing,
    isAvailable,
    startRecording,
    stopRecording,
    toggleRecording,
  };
}
