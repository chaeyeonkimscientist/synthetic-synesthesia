import React, { useState, useRef, useCallback, useEffect } from 'react';
import * as Tone from 'tone';
import { extractDominantColors, mapColorToNote } from './chromesthesia';

function CameraToSound() {
  const [isActive, setIsActive] = useState(false);
  const [dominantColors, setDominantColors] = useState([]);
  const [chordNotes, setChordNotes] = useState([]);
  const [focusPoint, setFocusPoint] = useState(null);
  const [isPlaying, setIsPlaying] = useState(false);

  const videoRef = useRef(null);
  const canvasRef = useRef(null);
  const overlayCanvasRef = useRef(null);
  const streamRef = useRef(null);
  const animFrameRef = useRef(null);
  const synthRef = useRef(null);
  const currentFreqsRef = useRef([]);
  const playingRef = useRef(false);

  const FOCUS_RADIUS = 60;

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

      // Use individual synths for smooth frequency gliding
      const synths = [];
      for (let i = 0; i < 4; i++) {
        const synth = new Tone.Synth({
          oscillator: { type: 'sine' },
          envelope: {
            attack: 0.4,
            decay: 0.3,
            sustain: 0.7,
            release: 1.2,
          },
        }).toDestination();
        synth.volume.value = -14;
        synths.push(synth);
      }
      synthRef.current = synths;

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
      synthRef.current.forEach((s) => {
        s.triggerRelease();
        s.dispose();
      });
    }
    playingRef.current = false;
    setIsActive(false);
    setIsPlaying(false);
    setDominantColors([]);
    setChordNotes([]);
    setFocusPoint(null);
  };

  const updateSound = useCallback((notes) => {
    if (!synthRef.current || !playingRef.current) return;

    const synths = synthRef.current;

    notes.forEach((note, i) => {
      if (i >= synths.length) return;
      const synth = synths[i];
      const targetFreq = note.frequency;
      const prevFreq = currentFreqsRef.current[i];

      if (!prevFreq) {
        // First note — trigger attack
        synth.triggerAttack(targetFreq, Tone.now(), note.velocity * 0.4);
      } else if (Math.abs(targetFreq - prevFreq) > 2) {
        // Frequency changed — ramp smoothly
        synth.frequency.rampTo(targetFreq, 0.3);
      }
    });

    currentFreqsRef.current = notes.map((n) => n.frequency);
  }, []);

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

    const notes = colors.map((c) => {
      const note = mapColorToNote(c.h, c.s, c.l);
      return { ...note, color: c };
    });
    setChordNotes(notes);

    // Continuously update sound if playing
    updateSound(notes);

    drawOverlay(colors);

    setTimeout(() => {
      animFrameRef.current = requestAnimationFrame(analyzeFrame);
    }, 200);
  }, [focusPoint, updateSound]);

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
      ctx.fillText('tap elsewhere to move · tap circle to clear', fx, fy + fr + 18);
    }
  };

  const handleCanvasClick = (e) => {
    if (!isActive) return;

    const rect = e.currentTarget.getBoundingClientRect();
    const x = (e.clientX - rect.left) / rect.width;
    const y = (e.clientY - rect.top) / rect.height;

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

  const toggleSound = () => {
    if (!synthRef.current || chordNotes.length === 0) return;

    if (isPlaying) {
      // Stop all synths
      synthRef.current.forEach((s) => s.triggerRelease());
      currentFreqsRef.current = [];
      playingRef.current = false;
      setIsPlaying(false);
    } else {
      // Start continuous playback
      playingRef.current = true;
      setIsPlaying(true);

      chordNotes.forEach((note, i) => {
        if (i < synthRef.current.length) {
          synthRef.current[i].triggerAttack(note.frequency, Tone.now(), note.velocity * 0.4);
        }
      });
      currentFreqsRef.current = chordNotes.map((n) => n.frequency);
    }
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

      {dominantColors.length > 0 && (
        <div className="color-notes">
          {chordNotes.map((note, i) => (
            <div key={i} className="color-note-card">
              <div
                className="note-color-swatch"
                style={{
                  background: `rgb(${note.color.r}, ${note.color.g}, ${note.color.b})`,
                  boxShadow: isPlaying ? `0 0 8px rgb(${note.color.r}, ${note.color.g}, ${note.color.b})` : 'none',
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
              onClick={toggleSound}
              disabled={chordNotes.length === 0}
            >
              {isPlaying ? '■ Stop sound' : '♫ Start sound'}
            </button>
            <button className="listen-btn stop" onClick={stopCamera}>
              ✕ Close
            </button>
          </div>
        )}
        <p className="hint">
          {!isActive
            ? 'Open your camera to see colors become sound'
            : isPlaying
            ? 'Sound shifts continuously as colors change · tap video to focus'
            : 'Tap Start sound — the chord will follow the camera in real time'}
        </p>
      </div>
    </div>
  );
}

export default CameraToSound;