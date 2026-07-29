#!/usr/bin/env node
/**
 * Generates short, royalty-free placeholder notification sounds as raw PCM
 * WAV files. No samples or copyrighted audio are used — everything is
 * synthesized from sine oscillators and filtered noise.
 *
 * Output: public/sounds/{opportunity,status,message}.wav
 */
import { mkdirSync, writeFileSync } from "fs";
import { dirname, join } from "path";
import { fileURLToPath } from "url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const OUT_DIR = join(__dirname, "..", "public", "sounds");
const SAMPLE_RATE = 44100;

function samplesFor(durationSeconds) {
  return Math.floor(durationSeconds * SAMPLE_RATE);
}

function sine(freq, t) {
  return Math.sin(2 * Math.PI * freq * t);
}

function whiteNoise() {
  return Math.random() * 2 - 1;
}

/** Simple one-pole low-pass filter — turns harsh white noise into a soft "air" texture. */
function lowPass(samples, alpha) {
  const out = new Float64Array(samples.length);
  let prev = 0;
  for (let i = 0; i < samples.length; i += 1) {
    prev += alpha * (samples[i] - prev);
    out[i] = prev;
  }
  return out;
}

function normalize(samples, peak = 0.9) {
  let max = 0;
  for (const s of samples) max = Math.max(max, Math.abs(s));
  if (max === 0) return samples;
  const scale = peak / max;
  const out = new Float64Array(samples.length);
  for (let i = 0; i < samples.length; i += 1) out[i] = samples[i] * scale;
  return out;
}

function encodeWav(samples, sampleRate = SAMPLE_RATE) {
  const numSamples = samples.length;
  const buffer = Buffer.alloc(44 + numSamples * 2);
  buffer.write("RIFF", 0, "ascii");
  buffer.writeUInt32LE(36 + numSamples * 2, 4);
  buffer.write("WAVE", 8, "ascii");
  buffer.write("fmt ", 12, "ascii");
  buffer.writeUInt32LE(16, 16);
  buffer.writeUInt16LE(1, 20); // PCM
  buffer.writeUInt16LE(1, 22); // mono
  buffer.writeUInt32LE(sampleRate, 24);
  buffer.writeUInt32LE(sampleRate * 2, 28); // byte rate (mono, 16-bit)
  buffer.writeUInt16LE(2, 32); // block align
  buffer.writeUInt16LE(16, 34); // bits per sample
  buffer.write("data", 36, "ascii");
  buffer.writeUInt32LE(numSamples * 2, 40);
  for (let i = 0; i < numSamples; i += 1) {
    const clamped = Math.max(-1, Math.min(1, samples[i]));
    buffer.writeInt16LE(Math.round(clamped * 32767), 44 + i * 2);
  }
  return buffer;
}

/** Soft click/tone — two quick overlapping notes with a fast exponential decay. */
function buildMessageSound() {
  const duration = 0.3;
  const n = samplesFor(duration);
  const out = new Float64Array(n);
  const f1 = 880; // A5
  const f2 = 1318.51; // E6
  for (let i = 0; i < n; i += 1) {
    const t = i / SAMPLE_RATE;
    const env = Math.exp(-t * 15);
    out[i] = (0.6 * sine(f1, t) + 0.4 * sine(f2, t)) * env;
  }
  return normalize(out, 0.6);
}

/** Quiet, airy swell — soft filtered noise blended with a slow sine pad. */
function buildStatusSound() {
  const duration = 0.4;
  const n = samplesFor(duration);
  const noise = new Float64Array(n);
  for (let i = 0; i < n; i += 1) noise[i] = whiteNoise();
  const airy = lowPass(noise, 0.05);
  const out = new Float64Array(n);
  const freq = 659.25; // E5
  for (let i = 0; i < n; i += 1) {
    const t = i / SAMPLE_RATE;
    const swell = Math.sin(Math.PI * (t / duration));
    const tone = sine(freq, t) * 0.35;
    out[i] = (tone + airy[i] * 0.45) * swell;
  }
  return normalize(out, 0.4);
}

/** Soft whoosh (filtered noise + rising pitch sweep) followed by a gentle pop. */
function buildOpportunitySound() {
  const duration = 0.6;
  const n = samplesFor(duration);
  const noise = new Float64Array(n);
  for (let i = 0; i < n; i += 1) noise[i] = whiteNoise();
  const airy = lowPass(noise, 0.035);
  const out = new Float64Array(n);
  const whooshEnd = 0.34;
  const popStart = 0.3;
  for (let i = 0; i < n; i += 1) {
    const t = i / SAMPLE_RATE;
    let sample = 0;
    if (t < whooshEnd) {
      const progress = t / whooshEnd;
      const env = Math.sin(Math.PI * progress);
      const sweepFreq = 320 + progress * 560;
      sample += (airy[i] * 0.55 + sine(sweepFreq, t) * 0.3) * env;
    }
    if (t >= popStart) {
      const pt = t - popStart;
      const popEnv = Math.exp(-pt * 16);
      sample += sine(1046.5, t) * popEnv * 0.6; // C6 pop
    }
    out[i] = sample;
  }
  return normalize(out, 0.75);
}

function writeSound(filename, samples) {
  const path = join(OUT_DIR, filename);
  writeFileSync(path, encodeWav(samples));
  console.log(`Wrote ${path} (${samples.length} samples, ${(samples.length / SAMPLE_RATE).toFixed(2)}s)`);
}

mkdirSync(OUT_DIR, { recursive: true });
writeSound("opportunity.wav", buildOpportunitySound());
writeSound("status.wav", buildStatusSound());
writeSound("message.wav", buildMessageSound());
console.log("Done.");
