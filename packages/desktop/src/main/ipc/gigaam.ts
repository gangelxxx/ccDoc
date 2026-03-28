/**
 * GigaAM v3 Speech Recognition
 *
 * Standalone ONNX inference for GigaAM v3 model (CTC-based ASR).
 * Does NOT use @huggingface/transformers pipeline — implements
 * mel spectrogram + CTC decode directly.
 *
 * Model format: istupakov/gigaam-v3-onnx
 *   - model.int8.onnx  (quantized encoder)
 *   - vocab.txt         (257 tokens, blank = 256)
 */

import { readFileSync } from "fs";
import { join } from "path";

// onnxruntime-node is patched to onnxruntime-web in voice.ts (Module._resolveFilename)
// eslint-disable-next-line @typescript-eslint/no-require-imports
const ort = require("onnxruntime-web");

// ─── Constants ───────────────────────────────────────────────

const SAMPLE_RATE = 16000;
const N_MELS = 64;
const N_FFT = 320;
const HOP_LENGTH = 160;
const FFT_SIZE = 512; // next power of 2 >= N_FFT
const N_FREQ_BINS = N_FFT / 2 + 1; // 161
const MEL_F_MIN = 0;
const MEL_F_MAX = 8000;
const BLANK_TOKEN = 256;

// ─── Module State ────────────────────────────────────────────

let session: any = null; // ort.InferenceSession
let vocab: string[] = [];
let modelDir: string | null = null;

// ─── Public API ──────────────────────────────────────────────

/**
 * Pre-load the ONNX model and vocabulary.
 * Subsequent calls with the same dir are no-ops.
 * Call with a different dir to switch models.
 */
export async function loadGigaAM(dir: string): Promise<void> {
  if (session && modelDir === dir) return;

  await disposeGigaAM();

  const modelPath = join(dir, "model.int8.onnx");
  const vocabPath = join(dir, "vocab.txt");

  // Load vocabulary: each line is "<token> <id>"
  const vocabText = readFileSync(vocabPath, "utf-8");
  const vocabMap = new Map<number, string>();
  for (const line of vocabText.split("\n")) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    const lastSpace = trimmed.lastIndexOf(" ");
    if (lastSpace === -1) continue;
    const token = trimmed.slice(0, lastSpace);
    const id = parseInt(trimmed.slice(lastSpace + 1), 10);
    if (!isNaN(id)) vocabMap.set(id, token);
  }

  // Build ordered vocab array
  let maxId = 0;
  vocabMap.forEach((_, id) => { if (id > maxId) maxId = id; });
  vocab = new Array(maxId + 1).fill("");
  vocabMap.forEach((token, id) => {
    vocab[id] = token;
  });

  // Create ONNX inference session
  session = await ort.InferenceSession.create(modelPath, {
    executionProviders: ["cpu"],
  });

  modelDir = dir;
  console.log(`[gigaam] loaded model from ${dir}, vocab size: ${vocab.length}`);
}

/**
 * Transcribe audio to text.
 * @param audio Float32Array of 16kHz mono samples in [-1, 1]
 * @returns Recognized text
 */
export async function transcribeGigaAM(audio: Float32Array): Promise<string> {
  if (!session) {
    throw new Error("[gigaam] Model not loaded. Call loadGigaAM() first.");
  }

  // 1. Compute mel spectrogram: [N_MELS, T]
  const mel = computeMel(audio);
  const numFrames = mel.length / N_MELS;

  // 2. Create ONNX tensors
  //    features: [1, N_MELS, numFrames]
  //    feature_lengths: [1] = numFrames
  const featuresTensor = new ort.Tensor("float32", mel, [1, N_MELS, numFrames]);
  const featureLengthsTensor = new ort.Tensor("int64", BigInt64Array.from([BigInt(numFrames)]), [1]);

  // 3. Run inference
  const results = await session.run({
    features: featuresTensor,
    feature_lengths: featureLengthsTensor,
  });

  // 4. Extract output log probabilities
  //    Output shape is typically [1, T_out, vocabSize]
  const outputTensor = results[Object.keys(results)[0]];
  const logProbs = outputTensor.data as Float32Array;
  const outputShape = outputTensor.dims as number[];
  const vocabSize = outputShape[outputShape.length - 1];
  const timeSteps = logProbs.length / vocabSize;

  // 5. CTC greedy decode
  const text = ctcGreedyDecode(logProbs, timeSteps, vocabSize);

  return text;
}

/**
 * Release ONNX session and free memory.
 */
export async function disposeGigaAM(): Promise<void> {
  if (session) {
    try {
      await session.release();
    } catch {
      /* ignore release errors */
    }
    session = null;
  }
  vocab = [];
  modelDir = null;
}

/**
 * Check if model is currently loaded.
 */
export function isGigaAMLoaded(): boolean {
  return session !== null;
}

// ─── Mel Spectrogram ─────────────────────────────────────────

/**
 * Compute log-mel spectrogram from raw audio.
 *
 * Pipeline:
 *   audio -> STFT (window=320, hop=160, fft=512) -> power spectrum
 *   -> mel filterbank (64 filters, 0-8000 Hz) -> log
 *
 * @returns Float32Array of shape [N_MELS, numFrames] (column-major: mel bins vary fastest)
 */
function computeMel(audio: Float32Array): Float32Array {
  // Generate Hann window
  const window = createHannWindow(N_FFT);

  // Create mel filterbank matrix [N_MELS x N_FREQ_BINS]
  const melFilters = createMelFilterbank(N_MELS, N_FREQ_BINS, SAMPLE_RATE, MEL_F_MIN, MEL_F_MAX);

  // Compute number of frames
  const numFrames = Math.floor((audio.length - N_FFT) / HOP_LENGTH) + 1;
  if (numFrames <= 0) {
    throw new Error(`[gigaam] Audio too short: ${audio.length} samples (need at least ${N_FFT})`);
  }

  // Output: [N_MELS, numFrames] stored as flat array, mel-major (row = mel bin)
  const melSpec = new Float32Array(N_MELS * numFrames);

  // Reusable buffers for FFT
  const real = new Float64Array(FFT_SIZE);
  const imag = new Float64Array(FFT_SIZE);
  const powerSpectrum = new Float64Array(N_FREQ_BINS);

  for (let frame = 0; frame < numFrames; frame++) {
    const offset = frame * HOP_LENGTH;

    // Apply window and zero-pad to FFT_SIZE
    real.fill(0);
    imag.fill(0);
    for (let i = 0; i < N_FFT; i++) {
      real[i] = audio[offset + i] * window[i];
    }

    // In-place FFT
    fft(real, imag);

    // Power spectrum: |X[k]|^2 for k = 0..N_FREQ_BINS-1
    for (let k = 0; k < N_FREQ_BINS; k++) {
      powerSpectrum[k] = real[k] * real[k] + imag[k] * imag[k];
    }

    // Apply mel filterbank and log
    for (let m = 0; m < N_MELS; m++) {
      let sum = 0;
      const filterOffset = m * N_FREQ_BINS;
      for (let k = 0; k < N_FREQ_BINS; k++) {
        sum += melFilters[filterOffset + k] * powerSpectrum[k];
      }
      // Log with floor to avoid -Infinity
      melSpec[m * numFrames + frame] = Math.log(Math.max(sum, 1e-10));
    }
  }

  return melSpec;
}

/**
 * Generate a Hann window of given length.
 * w[n] = 0.5 * (1 - cos(2*pi*n / (N-1)))
 */
function createHannWindow(length: number): Float64Array {
  const window = new Float64Array(length);
  const factor = (2 * Math.PI) / (length - 1);
  for (let i = 0; i < length; i++) {
    window[i] = 0.5 * (1 - Math.cos(factor * i));
  }
  return window;
}

// ─── Mel Filterbank ──────────────────────────────────────────

/**
 * Convert frequency in Hz to mel scale.
 * Uses the HTK formula: mel = 2595 * log10(1 + f/700)
 */
function hzToMel(hz: number): number {
  return 2595 * Math.log10(1 + hz / 700);
}

/**
 * Convert mel scale to frequency in Hz.
 */
function melToHz(mel: number): number {
  return 700 * (Math.pow(10, mel / 2595) - 1);
}

/**
 * Create a mel filterbank matrix.
 *
 * @param nMels Number of mel filters
 * @param nFreqBins Number of FFT frequency bins (n_fft/2 + 1)
 * @param sampleRate Audio sample rate
 * @param fMin Minimum frequency
 * @param fMax Maximum frequency
 * @returns Float64Array of shape [nMels x nFreqBins], row-major
 */
function createMelFilterbank(
  nMels: number,
  nFreqBins: number,
  sampleRate: number,
  fMin: number,
  fMax: number,
): Float64Array {
  const filters = new Float64Array(nMels * nFreqBins);

  const melMin = hzToMel(fMin);
  const melMax = hzToMel(fMax);

  // nMels + 2 equally spaced points on the mel scale
  const melPoints = new Float64Array(nMels + 2);
  const melStep = (melMax - melMin) / (nMels + 1);
  for (let i = 0; i < nMels + 2; i++) {
    melPoints[i] = melMin + i * melStep;
  }

  // Convert mel points to FFT bin indices
  const fftFreqResolution = sampleRate / FFT_SIZE;
  const binIndices = new Float64Array(nMels + 2);
  for (let i = 0; i < nMels + 2; i++) {
    const hz = melToHz(melPoints[i]);
    binIndices[i] = hz / fftFreqResolution;
  }

  // Build triangular filters
  for (let m = 0; m < nMels; m++) {
    const left = binIndices[m];
    const center = binIndices[m + 1];
    const right = binIndices[m + 2];
    const filterOffset = m * nFreqBins;

    for (let k = 0; k < nFreqBins; k++) {
      if (k >= left && k <= center && center > left) {
        filters[filterOffset + k] = (k - left) / (center - left);
      } else if (k > center && k <= right && right > center) {
        filters[filterOffset + k] = (right - k) / (right - center);
      }
      // else: 0 (already initialized)
    }
  }

  return filters;
}

// ─── FFT ─────────────────────────────────────────────────────

/**
 * In-place radix-2 Cooley-Tukey FFT.
 *
 * Both `real` and `imag` arrays must have length that is a power of 2.
 * After execution, arrays contain the DFT result.
 */
function fft(real: Float64Array, imag: Float64Array): void {
  const n = real.length;
  if (n <= 1) return;

  // Bit-reversal permutation
  let j = 0;
  for (let i = 0; i < n - 1; i++) {
    if (i < j) {
      // Swap real[i] <-> real[j]
      let temp = real[i];
      real[i] = real[j];
      real[j] = temp;
      // Swap imag[i] <-> imag[j]
      temp = imag[i];
      imag[i] = imag[j];
      imag[j] = temp;
    }
    let k = n >> 1;
    while (k <= j) {
      j -= k;
      k >>= 1;
    }
    j += k;
  }

  // Butterfly stages
  for (let size = 2; size <= n; size *= 2) {
    const halfSize = size / 2;
    const angle = (-2 * Math.PI) / size;

    // Twiddle factor step
    const wReal = Math.cos(angle);
    const wImag = Math.sin(angle);

    for (let start = 0; start < n; start += size) {
      let curWReal = 1;
      let curWImag = 0;

      for (let k = 0; k < halfSize; k++) {
        const evenIdx = start + k;
        const oddIdx = start + k + halfSize;

        // Butterfly: multiply odd element by twiddle factor
        const tReal = curWReal * real[oddIdx] - curWImag * imag[oddIdx];
        const tImag = curWReal * imag[oddIdx] + curWImag * real[oddIdx];

        real[oddIdx] = real[evenIdx] - tReal;
        imag[oddIdx] = imag[evenIdx] - tImag;
        real[evenIdx] = real[evenIdx] + tReal;
        imag[evenIdx] = imag[evenIdx] + tImag;

        // Advance twiddle factor: W *= w_step
        const newWReal = curWReal * wReal - curWImag * wImag;
        curWImag = curWReal * wImag + curWImag * wReal;
        curWReal = newWReal;
      }
    }
  }
}

// ─── CTC Decode ──────────────────────────────────────────────

/**
 * CTC greedy decoding.
 *
 * For each time step, pick the token with highest log-probability.
 * Remove blank tokens and consecutive duplicates, then map to strings.
 *
 * @param logProbs Flat array of shape [timeSteps, vocabSize]
 * @param timeSteps Number of time steps
 * @param vocabSize Vocabulary size
 * @returns Decoded text
 */
function ctcGreedyDecode(
  logProbs: Float32Array,
  timeSteps: number,
  vocabSize: number,
): string {
  const tokens: number[] = [];
  let prevToken = -1;

  for (let t = 0; t < timeSteps; t++) {
    const offset = t * vocabSize;

    // Argmax over vocab dimension
    let bestIdx = 0;
    let bestVal = logProbs[offset];
    for (let v = 1; v < vocabSize; v++) {
      if (logProbs[offset + v] > bestVal) {
        bestVal = logProbs[offset + v];
        bestIdx = v;
      }
    }

    // Skip blank token and consecutive duplicates
    if (bestIdx !== BLANK_TOKEN && bestIdx !== prevToken) {
      tokens.push(bestIdx);
    }
    prevToken = bestIdx;
  }

  // Map token IDs to strings
  const pieces = tokens.map((id) => vocab[id] ?? "");

  // SentencePiece convention: \u2581 (lower one eighth block) represents word boundary (space)
  const raw = pieces.join("");
  const text = raw.replace(/\u2581/g, " ").trim();

  return text;
}
