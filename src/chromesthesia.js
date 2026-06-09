/**
 * Chromesthesia Engine — Strict Science Version
 *
 * FORWARD (sound → color):
 *   - Pitch class → Hue (Chiou et al., 2013)
 *   - Octave → Lightness (Sun et al., 2018)
 *   - Loudness → Saturation (Anikin & Johansson, 2018)
 *   - Spectral centroid → Lightness boost (Orlandatou, 2015)
 *
 * REVERSE (color → sound):
 *   - Hue → Pitch class (reverse Chiou)
 *   - Lightness → Octave (reverse Sun)
 *   - Saturation → Velocity/volume (reverse Anikin & Johansson)
 *
 * Shape mapping (cross-modal correspondence):
 *   - Spectral centroid → angular vs round (bouba/kiki; Anikin & Johansson, 2018)
 */

const PITCH_CLASS_HUE = {
  0:   0,   // C  → red
  1:  30,   // C# → orange-red
  2:  50,   // D  → orange
  3:  75,   // D# → yellow-orange
  4:  95,   // E  → yellow
  5: 140,   // F  → green
  6: 170,   // F# → cyan-green
  7: 200,   // G  → cyan
  8: 230,   // G# → blue
  9: 260,   // A  → blue-violet
  10: 290,  // A# → violet
  11: 320,  // B  → magenta-violet
};

// Reverse lookup: for a given hue, find the nearest pitch class
const HUE_TO_PITCH_ENTRIES = Object.entries(PITCH_CLASS_HUE)
  .map(([pc, hue]) => ({ pitchClass: parseInt(pc), hue }))
  .sort((a, b) => a.hue - b.hue);

// Note names for display
const NOTE_NAMES = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B'];

// Standard tuning frequencies for each note
function noteFrequency(pitchClass, octave) {
  const midi = octave * 12 + pitchClass + 12;
  return 440 * Math.pow(2, (midi - 69) / 12);
}

// ---- Smoothing state (forward direction) ----
let smoothedHue = 0;
let smoothedLightness = 50;
let smoothedSaturation = 60;
let smoothedCentroid = 0.15;
let isFirstFrame = true;

const HUE_SMOOTHING = 0.06;
const LIGHTNESS_SMOOTHING = 0.12;
const SATURATION_SMOOTHING = 0.15;
const CENTROID_SMOOTHING = 0.1;

export function resetSmoothing() {
  isFirstFrame = true;
}

function hueDelta(from, to) {
  let diff = to - from;
  if (diff > 180) diff -= 360;
  if (diff < -180) diff += 360;
  return diff;
}

// ---- Audio feature extraction ----

export function extractPitch(frequencyData, sampleRate, fftSize) {
  let maxIndex = 0;
  let maxValue = -Infinity;

  for (let i = 2; i < frequencyData.length; i++) {
    if (frequencyData[i] > maxValue) {
      maxValue = frequencyData[i];
      maxIndex = i;
    }
  }

  const dominantFreq = (maxIndex * sampleRate) / fftSize;

  if (dominantFreq < 20) {
    return { dominantFreq: 0, pitchClass: 0, octave: 0 };
  }

  const midiNote = 12 * Math.log2(dominantFreq / 440) + 69;
  const pitchClass = Math.round(midiNote) % 12;
  const octave = Math.floor(Math.round(midiNote) / 12) - 1;

  return { dominantFreq, pitchClass, octave };
}

export function spectralCentroid(frequencyData, sampleRate, fftSize) {
  let weightedSum = 0;
  let totalWeight = 0;

  for (let i = 0; i < frequencyData.length; i++) {
    const amplitude = Math.pow(10, frequencyData[i] / 20);
    const freq = (i * sampleRate) / fftSize;
    weightedSum += freq * amplitude;
    totalWeight += amplitude;
  }

  if (totalWeight === 0) return 0;
  const centroid = weightedSum / totalWeight;
  const maxFreq = sampleRate / 2;
  return Math.min(centroid / maxFreq, 1);
}

export function computeLoudness(timeDomainData) {
  let sum = 0;
  for (let i = 0; i < timeDomainData.length; i++) {
    const sample = (timeDomainData[i] - 128) / 128;
    sum += sample * sample;
  }
  const rms = Math.sqrt(sum / timeDomainData.length);
  return Math.min(rms * 3, 1);
}

// ---- Forward: sound → color (with smoothing) ----

export function mapSoundToColor(pitchClass, octave, loudness, centroid) {
  const targetHue = PITCH_CLASS_HUE[pitchClass] || 0;

  const clampedOctave = Math.max(2, Math.min(7, octave));
  let targetLightness = 30 + ((clampedOctave - 2) / 5) * 45;
  targetLightness += centroid * 15;
  targetLightness = Math.min(85, Math.max(25, targetLightness));

  const targetSaturation = 60 + loudness * 40;

  if (isFirstFrame) {
    smoothedHue = targetHue;
    smoothedLightness = targetLightness;
    smoothedSaturation = targetSaturation;
    smoothedCentroid = centroid;
    isFirstFrame = false;
  } else {
    smoothedHue = (smoothedHue + hueDelta(smoothedHue, targetHue) * HUE_SMOOTHING + 360) % 360;
    smoothedLightness += (targetLightness - smoothedLightness) * LIGHTNESS_SMOOTHING;
    smoothedSaturation += (targetSaturation - smoothedSaturation) * SATURATION_SMOOTHING;
    smoothedCentroid += (centroid - smoothedCentroid) * CENTROID_SMOOTHING;
  }

  return {
    hue: Math.round(smoothedHue),
    saturation: Math.round(smoothedSaturation),
    lightness: Math.round(smoothedLightness),
    css: `hsl(${Math.round(smoothedHue)}, ${Math.round(smoothedSaturation)}%, ${Math.round(smoothedLightness)}%)`,
  };
}

export function mapSoundToShape(pitchClass, octave, centroid, loudness) {
  const sharpness = smoothedCentroid;
  const size = 30 + loudness * 180;

  if (sharpness < 0.08) {
    return { type: 'circle', size: size * 1.1, rotation: 0 };
  }
  if (sharpness < 0.15) {
    return { type: 'ellipse', size, ratio: 0.55 + (sharpness - 0.08) * 3, rotation: Math.random() * 180 };
  }
  if (sharpness < 0.22) {
    const cornerRadius = (0.22 - sharpness) * size * 1.5;
    return { type: 'rect', size, cornerRadius, rotation: Math.random() * 15 - 7.5 };
  }
  if (sharpness < 0.30) {
    return { type: 'diamond', size, rotation: Math.random() * 30 };
  }
  if (sharpness < 0.40) {
    return { type: 'triangle', size, rotation: Math.random() * 40 - 20 };
  }
  return { type: 'star', points: 5 + Math.floor((sharpness - 0.4) * 10), size, rotation: Math.random() * 360, innerRatio: 0.45 };
}


// ===========================================================
// REVERSE DIRECTION: color → sound
// ===========================================================

/**
 * Convert RGB to HSL
 */
export function rgbToHsl(r, g, b) {
  r /= 255; g /= 255; b /= 255;
  const max = Math.max(r, g, b), min = Math.min(r, g, b);
  let h, s, l = (max + min) / 2;

  if (max === min) {
    h = s = 0;
  } else {
    const d = max - min;
    s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
    switch (max) {
      case r: h = ((g - b) / d + (g < b ? 6 : 0)) / 6; break;
      case g: h = ((b - r) / d + 2) / 6; break;
      case b: h = ((r - g) / d + 4) / 6; break;
      default: h = 0;
    }
    h *= 360;
  }
  return { h: Math.round(h), s: Math.round(s * 100), l: Math.round(l * 100) };
}

/**
 * Find nearest pitch class for a given hue (reverse of Chiou mapping)
 */
function hueToPitchClass(hue) {
  hue = ((hue % 360) + 360) % 360;
  let bestMatch = 0;
  let bestDist = 999;

  for (const entry of HUE_TO_PITCH_ENTRIES) {
    let dist = Math.abs(hueDelta(hue, entry.hue));
    if (dist < bestDist) {
      bestDist = dist;
      bestMatch = entry.pitchClass;
    }
  }
  return bestMatch;
}

/**
 * Map lightness to octave (reverse of Sun et al.)
 * Lightness 25% → octave 2, 85% → octave 7
 */
function lightnessToOctave(lightness) {
  const clamped = Math.max(25, Math.min(85, lightness));
  const octave = 2 + ((clamped - 25) / 60) * 5;
  return Math.round(octave);
}

/**
 * Map saturation to velocity/volume (reverse of Anikin & Johansson)
 * Saturation 0% → very quiet, 100% → full volume
 */
function saturationToVelocity(saturation) {
  return Math.max(0.1, Math.min(1, saturation / 100));
}

/**
 * Reverse map: HSL color → musical note
 * Returns { pitchClass, octave, frequency, noteName, velocity }
 */
export function mapColorToNote(h, s, l) {
  const pitchClass = hueToPitchClass(h);
  const octave = lightnessToOctave(l);
  const velocity = saturationToVelocity(s);
  const frequency = noteFrequency(pitchClass, octave);
  const noteName = `${NOTE_NAMES[pitchClass]}${octave}`;

  return { pitchClass, octave, frequency, noteName, velocity };
}

/**
 * Extract dominant colors from image data using simple k-means-style clustering.
 * Returns array of { r, g, b, h, s, l, count } sorted by frequency.
 */
export function extractDominantColors(imageData, numColors = 4) {
  const pixels = imageData.data;
  const sampleStep = 4; // sample every 4th pixel for speed
  const samples = [];

  for (let i = 0; i < pixels.length; i += 4 * sampleStep) {
    const r = pixels[i];
    const g = pixels[i + 1];
    const b = pixels[i + 2];
    // Skip very dark and very light (near-black backgrounds, near-white glare)
    const brightness = (r + g + b) / 3;
    if (brightness > 15 && brightness < 245) {
      samples.push([r, g, b]);
    }
  }

  if (samples.length === 0) {
    return [{ r: 128, g: 128, b: 128, h: 0, s: 0, l: 50, count: 1 }];
  }

  // Initialize centroids by picking evenly spaced samples
  let centroids = [];
  for (let i = 0; i < numColors; i++) {
    const idx = Math.floor((i / numColors) * samples.length);
    centroids.push([...samples[idx]]);
  }

  // Run k-means for 8 iterations
  for (let iter = 0; iter < 8; iter++) {
    const clusters = centroids.map(() => []);

    // Assign each sample to nearest centroid
    for (const px of samples) {
      let bestIdx = 0;
      let bestDist = Infinity;
      for (let c = 0; c < centroids.length; c++) {
        const dr = px[0] - centroids[c][0];
        const dg = px[1] - centroids[c][1];
        const db = px[2] - centroids[c][2];
        const dist = dr * dr + dg * dg + db * db;
        if (dist < bestDist) {
          bestDist = dist;
          bestIdx = c;
        }
      }
      clusters[bestIdx].push(px);
    }

    // Recalculate centroids
    for (let c = 0; c < centroids.length; c++) {
      if (clusters[c].length === 0) continue;
      const sum = [0, 0, 0];
      for (const px of clusters[c]) {
        sum[0] += px[0]; sum[1] += px[1]; sum[2] += px[2];
      }
      centroids[c] = [
        Math.round(sum[0] / clusters[c].length),
        Math.round(sum[1] / clusters[c].length),
        Math.round(sum[2] / clusters[c].length),
      ];
    }
  }

  // Build results with counts
  const clusterCounts = centroids.map(() => 0);
  for (const px of samples) {
    let bestIdx = 0;
    let bestDist = Infinity;
    for (let c = 0; c < centroids.length; c++) {
      const dr = px[0] - centroids[c][0];
      const dg = px[1] - centroids[c][1];
      const db = px[2] - centroids[c][2];
      const dist = dr * dr + dg * dg + db * db;
      if (dist < bestDist) {
        bestDist = dist;
        bestIdx = c;
      }
    }
    clusterCounts[bestIdx]++;
  }

  const results = centroids.map((c, i) => {
    const hsl = rgbToHsl(c[0], c[1], c[2]);
    return {
      r: c[0], g: c[1], b: c[2],
      h: hsl.h, s: hsl.s, l: hsl.l,
      count: clusterCounts[i],
    };
  });

  // Sort by count descending (most dominant first)
  results.sort((a, b) => b.count - a.count);

  // Filter out duplicates (centroids that converged to same color)
  const filtered = [results[0]];
  for (let i = 1; i < results.length; i++) {
    const isDuplicate = filtered.some(f => {
      const dh = Math.abs(hueDelta(f.h, results[i].h));
      const ds = Math.abs(f.s - results[i].s);
      const dl = Math.abs(f.l - results[i].l);
      return dh < 15 && ds < 15 && dl < 15;
    });
    if (!isDuplicate && results[i].count > 0) {
      filtered.push(results[i]);
    }
  }

  return filtered.slice(0, numColors);
}