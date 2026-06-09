import React, { useState, useRef, useCallback, useEffect } from 'react';
import * as Tone from 'tone';
import { extractDominantColors, mapColorToNote, rgbToHsl } from './chromesthesia';

function CameraToSound() {
  const [isActive, setIsActive] = useState(false);
  const [dominantColors, setDominantColors] = useState([]);
  const [chordNotes, setChordNotes] = useState([]);
  const [focusPoint, setFocusPoint] = useState(null); // null = whole frame
  const [isPlaying, setIsPlaying] = useState(false);

  const videoRef = useRef(null);
  const canvasRef = useRef(null);
  const overlayCanvasRef = useRef(null);
  const streamRef = useRef(null);
  const animFrameRef = useRef(null);
  const synthRef = useRef(null);

  const FOCUS_RADIUS = 60; // px radius for tap-to-focus

  const startCamera = async () => {
    try {
      await Tone.start();

      const stream = await navigator.mediaDevices.getUserMedia({
        video: { facingMode: 'environment', width: 640, height: 480 },
      });
      streamRef.current = stream;

      if (videoRef.current) {
        videoRef.current.srcObject = stream;
        videoRef.current.play();
      }

      // Create a polyphonic synth for chord playback
      synthRef.current = new Tone.PolySynth(Tone.Synth, {
        maxPolyphony: 4,
        voice: Tone.Synth,
        options: {
          oscillator: { type: 'sine' },
          envelope: {
            attack: 0.3,
            decay: 0.4,
            sustain: 0.6,
            release: 1.5,
          },
        },
      }).toDestination();

      synthRef.current.volume.value = -8;

      setIsActive(true);
      setFocusPoint(null);
    } catch (err) {
      alert('Camera access denied. Please allow camera access and try again.');
      console.error(err);
    }
  };

  const stopCamera = () => {
    if (animFrameRef.current) cancelAnimationFrame(animFrameRef.current);
    if (streamRef.current) streamRef.current.getTracks().forEach((t) => t.stop());
    if (synthRef.current) {
      synthRef.current.releaseAll();
      synthRef.current.dispose();
    }
    setIsActive(false);
    setIsPlaying(false);
    setDominantColors([]);
    setChordNotes([]);
    setFocusPoint(null);
  };

  const analyzeFrame = useCallback(() => {
    const video = videoRef.current;
    const canvas = canvasRef.current;
    if (!video || !canvas || video.readyState < 2) {
      animFrameRef.current = requestAnimationFrame(analyzeFrame);
      return;
    }

    const ctx = canvas.getContext('2d');
    canvas.width = video.videoWidth;
    canvas.height = video.videoHeight;
    ctx.drawImage(video, 0, 0);

    let imageData;
    if (focusPoint) {
      // Extract only the focused region
      const x = Math.max(0, Math.round(focusPoint.x * canvas.width) - FOCUS_RADIUS);
      const y = Math.max(0, Math.round(focusPoint.y * canvas.height) - FOCUS_RADIUS);
      const w = Math.min(FOCUS_RADIUS * 2, canvas.width - x);
      const h = Math.min(FOCUS_RADIUS * 2, canvas.height - y);
      imageData = ctx.getImageData(x, y, w, h);
    } else {
      imageData = ctx.getImageData(0, 0, canvas.width, canvas.height);
    }

    const colors = extractDominantColors(imageData, 4);
    setDominantColors(colors);

    // Map each color to a musical note
    const notes = colors.map((c) => {
      const note = mapColorToNote(c.h, c.s, c.l);
      return { ...note, color: c };
    });
    setChordNotes(notes);

    drawOverlay(colors);

    // Slow down analysis to ~4fps (every 250ms) for stability
    setTimeout(() => {
      animFrameRef.current = requestAnimationFrame(analyzeFrame);
    }, 250);
  }, [focusPoint]);

  const drawOverlay = (colors) => {
    const overlay = overlayCanvasRef.current;
    const video = videoRef.current;
    if (!overlay || !video) return;

    overlay.width = overlay.offsetWidth * (window.devicePixelRatio || 1);
    overlay.height = overlay.offsetHeight * (window.devicePixelRatio || 1);
    const ctx = overlay.getContext('2d');
    ctx.scale(window.devicePixelRatio || 1, window.devicePixelRatio || 1);
    const w = overlay.offsetWidth;
    const h = overlay.offsetHeight;

    ctx.clearRect(0, 0, w, h);

    // Draw focus circle if active
    if (focusPoint) {
      const fx = focusPoint.x * w;
      const fy = focusPoint.y * h;
      const fr = FOCUS_RADIUS * (w / 640);

      ctx.strokeStyle = 'rgba(255, 255, 255, 0.8)';
      ctx.lineWidth = 2;
      ctx.setLineDash([6, 4]);
      ctx.beginPath();
      ctx.arc(fx, fy, fr, 0, Math.PI * 2);
      ctx.stroke();
      ctx.setLineDash([]);

      ctx.fillStyle = 'rgba(255, 255, 255, 0.5)';
      ctx.font = '11px -apple-system, sans-serif';
      ctx.textAlign = 'center';
      ctx.fillText('tap elsewhere to move focus', fx, fy + fr + 18);
    }
  };

  const handleCanvasClick = (e) => {
    if (!isActive) return;

    const rect = e.currentTarget.getBoundingClientRect();
    const x = (e.clientX - rect.left) / rect.width;
    const y = (e.clientY - rect.top) / rect.height;

    // If tapping near existing focus, clear it (go back to whole frame)
    if (focusPoint) {
      const dx = x - focusPoint.x;
      const dy = y - focusPoint.y;
      if (Math.sqrt(dx * dx + dy * dy) < 0.05) {
        setFocusPoint(null);
        return;
      }
    }
    setFocusPoint({ x, y });
  };

  const playChord = () => {
    if (!synthRef.current || chordNotes.length === 0) return;

    synthRef.current.releaseAll();

    const frequencies = chordNotes.map((n) => n.frequency);
    const velocities = chordNotes.map((n) => n.velocity);

    frequencies.forEach((freq, i) => {
      synthRef.current.triggerAttack(freq, Tone.now(), velocities[i] * 0.5);
    });

    setIsPlaying(true);

    // Release after 3 seconds
    setTimeout(() => {
      if (synthRef.current) {
        synthRef.current.releaseAll();
        setIsPlaying(false);
      }
    }, 3000);
  };

  const playAndHold = () => {
    if (!synthRef.current || chordNotes.length === 0) return;

    if (isPlaying) {
      synthRef.current.releaseAll();
      setIsPlaying(false);
      return;
    }

    const frequencies = chordNotes.map((n) => n.frequency);
    const velocities = chordNotes.map((n) => n.velocity);

    frequencies.forEach((freq, i) => {
      synthRef.current.triggerAttack(freq, Tone.now(), velocities[i] * 0.5);
    });
    setIsPlaying(true);
  };

  useEffect(() => {
    if (isActive) {
      animFrameRef.current = requestAnimationFrame(analyzeFrame);
    }
    return () => {
      if (animFrameRef.current) cancelAnimationFrame(animFrameRef.current);
    };
  }, [isActive, analyzeFrame]);

  useEffect(() => {
    return () => stopCamera();
  }, []);

  return (
    <div className="camera-feature">
      <div className="camera-container">
        <video ref={videoRef} className="camera-feed" playsInline muted />
        <canvas ref={canvasRef} style={{ display: 'none' }} />
        <canvas
          ref={overlayCanvasRef}
          className="camera-overlay"
          onClick={handleCanvasClick}
        />

        {!isActive && (
          <div className="camera-placeholder">
            <span className="camera-icon">◉</span>
            <p>Point your camera at something colorful</p>
          </div>
        )}
      </div>

      {/* Color → Note display */}
      {dominantColors.length > 0 && (
        <div className="color-notes">
          {chordNotes.map((note, i) => (
            <div key={i} className="color-note-card">
              <div
                className="note-color-swatch"
                style={{
                  background: `rgb(${note.color.r}, ${note.color.g}, ${note.color.b})`,
                }}
              />
              <div className="note-info">
                <span className="note-name">{note.noteName}</span>
                <span className="note-freq">{Math.round(note.frequency)} Hz</span>
              </div>
            </div>
          ))}
        </div>
      )}

      <div className="controls">
        {!isActive ? (
          <button className="listen-btn" onClick={startCamera}>
            ◉ Open Camera
          </button>
        ) : (
          <div className="camera-controls">
            <button
              className={`listen-btn ${isPlaying ? 'active' : ''}`}
              onClick={playAndHold}
              disabled={chordNotes.length === 0}
            >
              {isPlaying ? '■ Stop chord' : '♫ Play chord'}
            </button>
            <button className="listen-btn stop" onClick={stopCamera}>
              ✕ Close
            </button>
          </div>
        )}
        <p className="hint">
          {!isActive
            ? 'Open your camera to see colors become sound'
            : focusPoint
            ? 'Tap the focus circle to go back to whole frame'
            : 'Tap anywhere on the video to focus on a specific area'}
        </p>
      </div>
    </div>
  );
}

export default CameraToSound;