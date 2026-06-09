import React, { useState, useRef, useCallback, useEffect } from 'react';
import {
  extractPitch,
  spectralCentroid,
  computeLoudness,
  mapSoundToColor,
  mapSoundToShape,
  resetSmoothing,
} from './chromesthesia';
import CameraToSound from './CameraToSound';
import './App.css';

function SoundToColor() {
  const [isListening, setIsListening] = useState(false);
  const [colorData, setColorData] = useState({ css: 'hsl(0, 0%, 15%)', hue: 0, saturation: 0, lightness: 15 });
  const [shapeData, setShapeData] = useState({ type: 'circle', size: 80, rotation: 0 });
  const [audioInfo, setAudioInfo] = useState({ freq: 0, note: '', loudness: 0 });

  const audioCtxRef = useRef(null);
  const analyserRef = useRef(null);
  const animFrameRef = useRef(null);
  const streamRef = useRef(null);
  const canvasRef = useRef(null);
  const trailRef = useRef([]);

  const NOTE_NAMES = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B'];

  const analyze = useCallback(() => {
    if (!analyserRef.current) return;

    const analyser = analyserRef.current;
    const frequencyData = new Float32Array(analyser.frequencyBinCount);
    const timeDomainData = new Uint8Array(analyser.fftSize);

    analyser.getFloatFrequencyData(frequencyData);
    analyser.getByteTimeDomainData(timeDomainData);

    const sampleRate = audioCtxRef.current.sampleRate;
    const fftSize = analyser.fftSize;

    const { pitchClass, octave, dominantFreq } = extractPitch(frequencyData, sampleRate, fftSize);
    const centroid = spectralCentroid(frequencyData, sampleRate, fftSize);
    const loudness = computeLoudness(timeDomainData);

    if (loudness > 0.02) {
      const color = mapSoundToColor(pitchClass, octave, loudness, centroid);
      const shape = mapSoundToShape(pitchClass, octave, centroid, loudness);

      setColorData(color);
      setShapeData(shape);
      setAudioInfo({
        freq: Math.round(dominantFreq),
        note: `${NOTE_NAMES[pitchClass]}${octave}`,
        loudness: Math.round(loudness * 100),
      });

      trailRef.current.push({
        ...shape,
        color: color.css,
        x: Math.random() * 0.8 + 0.1,
        y: Math.random() * 0.8 + 0.1,
        opacity: 0.6 + loudness * 0.4,
        time: Date.now(),
      });

      if (trailRef.current.length > 80) {
        trailRef.current = trailRef.current.slice(-80);
      }
    }

    drawCanvas();
    animFrameRef.current = requestAnimationFrame(analyze);
  }, []);

  const drawShape = (ctx, item, x, y, r) => {
    ctx.save();
    ctx.globalAlpha = item.opacity;
    ctx.fillStyle = item.color;
    ctx.strokeStyle = item.color;
    ctx.shadowColor = item.color;
    ctx.shadowBlur = r * 0.6;

    switch (item.type) {
      case 'circle':
        ctx.beginPath();
        ctx.arc(x, y, r, 0, Math.PI * 2);
        ctx.fill();
        break;

      case 'ellipse':
        ctx.save();
        ctx.translate(x, y);
        ctx.rotate((item.rotation || 0) * Math.PI / 180);
        ctx.beginPath();
        ctx.ellipse(0, 0, r, r * (item.ratio || 0.6), 0, 0, Math.PI * 2);
        ctx.fill();
        ctx.restore();
        break;

      case 'ring':
        ctx.lineWidth = item.lineWidth || 3;
        ctx.beginPath();
        ctx.arc(x, y, r, 0, Math.PI * 2);
        ctx.stroke();
        ctx.beginPath();
        ctx.arc(x, y, r * 0.6, 0, Math.PI * 2);
        ctx.stroke();
        break;

      case 'rect':
        ctx.save();
        ctx.translate(x, y);
        ctx.rotate((item.rotation || 0) * Math.PI / 180);
        const cr = item.cornerRadius || 4;
        ctx.beginPath();
        ctx.roundRect(-r, -r * 0.7, r * 2, r * 1.4, cr);
        ctx.fill();
        ctx.restore();
        break;

      case 'diamond':
        ctx.save();
        ctx.translate(x, y);
        ctx.rotate((item.rotation || 0) * Math.PI / 180);
        ctx.beginPath();
        ctx.moveTo(0, -r);
        ctx.lineTo(r * 0.7, 0);
        ctx.lineTo(0, r);
        ctx.lineTo(-r * 0.7, 0);
        ctx.closePath();
        ctx.fill();
        ctx.restore();
        break;

      case 'triangle':
        ctx.save();
        ctx.translate(x, y);
        ctx.rotate((item.rotation || 0) * Math.PI / 180);
        ctx.beginPath();
        ctx.moveTo(0, -r);
        ctx.lineTo(r * 0.87, r * 0.5);
        ctx.lineTo(-r * 0.87, r * 0.5);
        ctx.closePath();
        ctx.fill();
        ctx.restore();
        break;

      case 'star':
        ctx.save();
        ctx.translate(x, y);
        ctx.rotate((item.rotation || 0) * Math.PI / 180);
        const pts = item.points || 5;
        const inner = r * (item.innerRatio || 0.5);
        ctx.beginPath();
        for (let i = 0; i < pts * 2; i++) {
          const angle = (i / (pts * 2)) * Math.PI * 2 - Math.PI / 2;
          const rad = i % 2 === 0 ? r : inner;
          const px = rad * Math.cos(angle);
          const py = rad * Math.sin(angle);
          i === 0 ? ctx.moveTo(px, py) : ctx.lineTo(px, py);
        }
        ctx.closePath();
        ctx.fill();
        ctx.restore();
        break;

      default:
        ctx.beginPath();
        ctx.arc(x, y, r, 0, Math.PI * 2);
        ctx.fill();
    }

    ctx.restore();
  };

  const drawCanvas = () => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    const ctx = canvas.getContext('2d');
    const w = canvas.offsetWidth;
    const h = canvas.offsetHeight;

    ctx.fillStyle = 'rgba(12, 12, 18, 0.06)';
    ctx.fillRect(0, 0, w, h);

    const trail = trailRef.current;
    const now = Date.now();

    trail.forEach((item) => {
      const age = (now - item.time) / 1000;
      const fadeOut = Math.max(0, 1 - age / 5);
      if (fadeOut <= 0) return;

      const x = item.x * w;
      const y = item.y * h;
      const r = item.size * 0.3 * fadeOut;

      const fadedItem = { ...item, opacity: item.opacity * fadeOut };
      drawShape(ctx, fadedItem, x, y, r);
    });
  };

  const startListening = async () => {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      streamRef.current = stream;

      const audioCtx = new (window.AudioContext || window.webkitAudioContext)();
      audioCtxRef.current = audioCtx;

      const source = audioCtx.createMediaStreamSource(stream);
      const analyser = audioCtx.createAnalyser();
      analyser.fftSize = 4096;
      analyser.smoothingTimeConstant = 0.85;
      source.connect(analyser);
      analyserRef.current = analyser;

      const canvas = canvasRef.current;
      if (canvas) {
        const dpr = window.devicePixelRatio || 1;
        canvas.width = canvas.offsetWidth * dpr;
        canvas.height = canvas.offsetHeight * dpr;
        const ctx = canvas.getContext('2d');
        ctx.scale(dpr, dpr);
        ctx.fillStyle = '#0c0c12';
        ctx.fillRect(0, 0, canvas.offsetWidth, canvas.offsetHeight);
      }

      resetSmoothing();
      setIsListening(true);
      animFrameRef.current = requestAnimationFrame(analyze);
    } catch (err) {
      alert('Microphone access denied. Please allow mic access and try again.');
      console.error(err);
    }
  };

  const stopListening = () => {
    if (animFrameRef.current) cancelAnimationFrame(animFrameRef.current);
    if (streamRef.current) streamRef.current.getTracks().forEach((t) => t.stop());
    if (audioCtxRef.current) audioCtxRef.current.close();
    resetSmoothing();
    setIsListening(false);
    trailRef.current = [];
  };

  useEffect(() => {
    return () => stopListening();
  }, []);

  return (
    <div className="sound-feature">
      <div className="visualizer-container">
        <div
          className="color-orb"
          style={{
            background: colorData.css,
            boxShadow: isListening ? `0 0 ${60 + audioInfo.loudness}px ${colorData.css}` : 'none',
            transform: `scale(${isListening ? 0.9 + (audioInfo.loudness / 200) : 1})`,
          }}
        />
        <canvas ref={canvasRef} className="paint-canvas" />
        {isListening && audioInfo.freq > 0 && (
          <div className="audio-info">
            <div className="info-row">
              <span className="info-label">note</span>
              <span className="info-value">{audioInfo.note}</span>
            </div>
            <div className="info-row">
              <span className="info-label">freq</span>
              <span className="info-value">{audioInfo.freq} Hz</span>
            </div>
            <div className="info-row">
              <span className="info-label">volume</span>
              <span className="info-value">{audioInfo.loudness}%</span>
            </div>
            <div className="info-row">
              <span className="info-label">shape</span>
              <span className="info-value">{shapeData.type}</span>
            </div>
            <div className="info-row">
              <span className="info-label">color</span>
              <span className="color-swatch" style={{ background: colorData.css }} />
              <span className="info-value">{colorData.css}</span>
            </div>
          </div>
        )}
      </div>

      <div className="controls">
        <button
          className={`listen-btn ${isListening ? 'active' : ''}`}
          onClick={isListening ? stopListening : startListening}
        >
          {isListening ? '■ Stop' : '● Listen'}
        </button>
        <p className="hint">
          {isListening
            ? 'Play music, sing, or make sounds — watch the colors react'
            : 'Tap Listen to activate your microphone'}
        </p>
      </div>
    </div>
  );
}

function App() {
  const [activeTab, setActiveTab] = useState('sound');

  return (
    <div className="app">
      <header className="header">
        <svg className="logo" viewBox="0 0 680 290" role="img" xmlns="http://www.w3.org/2000/svg">
          <title>Synthetic Synesthesia</title>
          <defs>
            <linearGradient id="waveGrad" x1="0%" y1="0%" x2="100%" y2="0%">
              <stop offset="0%"   stopColor="#1a1a1a"/>
              <stop offset="38%"  stopColor="#1a1a1a"/>
              <stop offset="50%"  stopColor="#7f77dd"/>
              <stop offset="62%"  stopColor="#378add"/>
              <stop offset="73%"  stopColor="#1d9e75"/>
              <stop offset="82%"  stopColor="#ef9f27"/>
              <stop offset="91%"  stopColor="#e24b4a"/>
              <stop offset="100%" stopColor="#d4537e"/>
            </linearGradient>
            <linearGradient id="textGrad" x1="0%" y1="0%" x2="100%" y2="0%">
              <stop offset="0%"   stopColor="#7f77dd"/>
              <stop offset="25%"  stopColor="#378add"/>
              <stop offset="50%"  stopColor="#1d9e75"/>
              <stop offset="75%"  stopColor="#ef9f27"/>
              <stop offset="100%" stopColor="#e24b4a"/>
            </linearGradient>
            <clipPath id="burstClip">
              <rect x="195" y="55" width="110" height="90"/>
            </clipPath>
          </defs>
          <path d="M80,100 C100,100 108,68 128,68 C148,68 158,132 178,132 C190,132 194,115 196,104" fill="none" stroke="#1a1a1a" strokeWidth="2" strokeLinecap="round"/>
          <g clipPath="url(#burstClip)">
            <path d="M196,104 C198,96 200,72 204,72 C208,72 210,128 214,128 C218,128 220,64 224,64 C228,64 230,136 234,136 C238,136 240,60 244,60 C248,60 250,140 254,140 C258,140 260,62 264,62 C268,62 270,138 274,138 C278,138 280,68 284,68 C288,68 290,132 294,132 C298,132 300,80 303,96" fill="none" stroke="#1a1a1a" strokeWidth="1.8" strokeLinecap="round"/>
          </g>
          <path d="M303,96 C308,114 316,132 330,132 C350,132 360,68 380,68 C400,68 410,132 430,132 C450,132 460,68 480,68 C500,68 510,132 530,132 C550,132 560,68 580,68 C590,68 596,100 600,100" fill="none" stroke="url(#waveGrad)" strokeWidth="2" strokeLinecap="round"/>
          <line x1="80" y1="152" x2="600" y2="152" stroke="#1a1a1a" strokeWidth="0.5" opacity="0.15"/>
          <text x="80" y="205" fontFamily="'Josefin Sans', Helvetica, Arial, sans-serif" fontSize="42" fontWeight="100" letterSpacing="14" fill="#1a1a1a">SYNTHETIC</text>
          <text x="80" y="255" fontFamily="'Josefin Sans', Helvetica, Arial, sans-serif" fontSize="42" fontWeight="400" letterSpacing="5" fill="url(#textGrad)">SYNESTHESIA</text>
        </svg>
        <p className="subtitle">Chromesthesia — hear colors, see sound</p>

        <div className="tab-bar">
          <button
            className={`tab ${activeTab === 'sound' ? 'active' : ''}`}
            onClick={() => setActiveTab('sound')}
          >
            Sound → Color
          </button>
          <button
            className={`tab ${activeTab === 'camera' ? 'active' : ''}`}
            onClick={() => setActiveTab('camera')}
          >
            Color → Sound
          </button>
        </div>
      </header>

      {activeTab === 'sound' ? <SoundToColor /> : <CameraToSound />}

      <footer className="science-note">
        Mappings based on chromesthesia research:
        pitch→hue (Chiou et al., 2013),
        pitch→lightness (Sun et al., 2018),
        loudness→saturation (Anikin & Johansson, 2018),
        timbre→brightness (Orlandatou, 2015)
      </footer>
    </div>
  );
}

export default App;