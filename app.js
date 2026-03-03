'use strict';

// ============================================================
// Configuration
// ============================================================
const CONFIG = {
  // Display
  startRadius: 14,
  targetRadius: 18,
  cursorRadius: 7,
  handDotRadius: 4,
  targetDistance: 140,
  moveThreshold: 12,
  reachThreshold: 125,

  // Audio
  bpm: 120,
  normalFreq: 800,
  distinctiveFreq: 1200,
  beatDuration: 0.08,
  volume: 0.35,

  // Rotation (degrees)
  beat2Rotation: 30,   // clockwise
  beat4Rotation: -30,  // counter-clockwise

  // Timing (ms)
  holdDuration: 500,
  feedbackDuration: 1000,
  itiDuration: 500,
  timingWindow: 300,
  preRhythmDelay: 200,

  // Target directions (degrees, 0=up, clockwise)
  targetAngles: [0, 45, 90, 135, 180, 225, 270, 315],

  // Colors
  colors: {
    bgTop: '#0a0a1a',
    bgBottom: '#12122a',
    start: 'rgba(255,255,255,0.5)',
    startActive: 'rgba(100,255,130,0.7)',
    beat2: '#4cc9f0',
    beat4: '#f72585',
    cursor: '#ffffff',
    cursorGlow: 'rgba(255,255,255,0.2)',
    handDot: 'rgba(255,255,255,0.3)',
    trail: 'rgba(255,255,255,0.25)',
    targetFill: 'rgba(255,255,255,0.08)',
    feedbackGood: '#4ade80',
    feedbackBad: '#f87171',
  },

  // Experiment phases
  phases: [
    {
      name: 'practice',
      label: '練習',
      description: 'まずは操作に慣れましょう。下半分でマウスを動かし、上半分のカーソルでターゲットに到達してください。回転なし・リズムなしです。',
      trials: 8,
      rotation: false,
      rhythm: false,
    },
    {
      name: 'baseline',
      label: 'ベースライン',
      description: 'リズムに合わせてリーチングを行います。指定されたビートのタイミングで動きを開始してください。このフェーズでは回転はかかりません。',
      trials: 16,
      rotation: false,
      rhythm: true,
    },
    {
      name: 'adaptation',
      label: '適応',
      description: 'リズムに合わせてリーチングを行います。上半分のカーソルの動きに注目し、ターゲットに到達するよう調整してください。',
      trials: 80,
      rotation: true,
      rhythm: true,
    },
    {
      name: 'washout',
      label: 'ウォッシュアウト',
      description: '引き続きリズムに合わせてリーチングを行ってください。このフェーズでは回転はかかりません。',
      trials: 16,
      rotation: false,
      rhythm: true,
    },
  ],
};


// ============================================================
// Utility Functions
// ============================================================
function deg2rad(deg) {
  return deg * Math.PI / 180;
}

function rad2deg(rad) {
  return rad * 180 / Math.PI;
}

function rotatePoint(dx, dy, angleDeg) {
  const rad = deg2rad(angleDeg);
  const c = Math.cos(rad);
  const s = Math.sin(rad);
  return {
    x: dx * c - dy * s,
    y: dx * s + dy * c,
  };
}

function dist(x1, y1, x2, y2) {
  return Math.hypot(x2 - x1, y2 - y1);
}

function getAngleDeg(dx, dy) {
  // 0 = up, clockwise positive
  return (rad2deg(Math.atan2(dx, -dy)) + 360) % 360;
}

function angleDiff(a, b) {
  let d = a - b;
  while (d > 180) d -= 360;
  while (d < -180) d += 360;
  return d;
}

function shuffleArray(arr) {
  const a = [...arr];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

function generateTargetSequence(count, angles) {
  const result = [];
  const repeats = Math.ceil(count / angles.length);
  for (let r = 0; r < repeats; r++) {
    result.push(...shuffleArray(angles));
  }
  return result.slice(0, count);
}


// ============================================================
// Rhythm Player (Web Audio API)
// ============================================================
class RhythmPlayer {
  constructor() {
    this.ctx = null;
    this.beatInterval = 60 / CONFIG.bpm;
  }

  init() {
    this.ctx = new (window.AudioContext || window.webkitAudioContext)();
  }

  resume() {
    if (this.ctx && this.ctx.state === 'suspended') {
      return this.ctx.resume();
    }
  }

  get currentTime() {
    return this.ctx ? this.ctx.currentTime : 0;
  }

  playClick(time, freq, dur = CONFIG.beatDuration) {
    if (!this.ctx) return;
    const osc = this.ctx.createOscillator();
    const gain = this.ctx.createGain();
    osc.connect(gain);
    gain.connect(this.ctx.destination);

    osc.frequency.value = freq;
    osc.type = 'sine';

    gain.gain.setValueAtTime(CONFIG.volume, time);
    gain.gain.exponentialRampToValueAtTime(0.001, time + dur);

    osc.start(time);
    osc.stop(time + dur + 0.01);
  }

  playGo(time) {
    // A brief "go" beep for practice trials
    this.playClick(time, 1000, 0.06);
  }

  scheduleMeasure(startTime) {
    const times = [];
    for (let i = 0; i < 4; i++) {
      const t = startTime + i * this.beatInterval;
      const freq = (i === 3) ? CONFIG.distinctiveFreq : CONFIG.normalFreq;
      this.playClick(t, freq);
      times.push(t);
    }
    return times;
  }
}


// ============================================================
// Display System
// ============================================================
class Display {
  constructor(topCanvas, bottomCanvas) {
    this.topCanvas = topCanvas;
    this.bottomCanvas = bottomCanvas;
    this.topCtx = topCanvas.getContext('2d');
    this.bottomCtx = bottomCanvas.getContext('2d');
    this.dpr = window.devicePixelRatio || 1;
    this.width = 0;
    this.halfHeight = 0;
    this.topCenter = { x: 0, y: 0 };
    this.bottomCenter = { x: 0, y: 0 };
    this.resize();
    window.addEventListener('resize', () => this.resize());
  }

  resize() {
    const dpr = this.dpr;
    const w = window.innerWidth;
    const dividerH = 44;
    const totalH = window.innerHeight || document.documentElement.clientHeight;
    const h = Math.floor((totalH - dividerH) / 2);

    this.topCanvas.width = w * dpr;
    this.topCanvas.height = h * dpr;
    this.topCanvas.style.width = w + 'px';
    this.topCanvas.style.height = h + 'px';

    this.bottomCanvas.width = w * dpr;
    this.bottomCanvas.height = h * dpr;
    this.bottomCanvas.style.width = w + 'px';
    this.bottomCanvas.style.height = h + 'px';

    this.topCtx.setTransform(dpr, 0, 0, dpr, 0, 0);
    this.bottomCtx.setTransform(dpr, 0, 0, dpr, 0, 0);

    this.width = w;
    this.halfHeight = h;
    this.topCenter = { x: w / 2, y: h / 2 };
    this.bottomCenter = { x: w / 2, y: h / 2 };

    // Scale display elements for small screens
    const minDim = Math.min(w, h);
    this.scale = Math.min(1, minDim / 350);
  }

  clear() {
    const w = this.width;
    const h = this.halfHeight;
    this.topCtx.fillStyle = CONFIG.colors.bgTop;
    this.topCtx.fillRect(0, 0, w, h);
    this.bottomCtx.fillStyle = CONFIG.colors.bgBottom;
    this.bottomCtx.fillRect(0, 0, w, h);
  }

  circle(ctx, x, y, r, color, filled = true) {
    ctx.beginPath();
    ctx.arc(x, y, r, 0, Math.PI * 2);
    if (filled) {
      ctx.fillStyle = color;
      ctx.fill();
    } else {
      ctx.strokeStyle = color;
      ctx.lineWidth = 2;
      ctx.stroke();
    }
  }

  drawStartCircle(ctx, cx, cy, active) {
    const color = active ? CONFIG.colors.startActive : CONFIG.colors.start;
    const r = CONFIG.startRadius * this.scale;
    this.circle(ctx, cx, cy, r, color, false);
    if (active) {
      this.circle(ctx, cx, cy, r * 0.4, color);
    }
  }

  drawTarget(ctx, cx, cy, angleDeg, color) {
    const rad = deg2rad(angleDeg);
    const d = CONFIG.targetDistance * this.scale;
    const tx = cx + d * Math.sin(rad);
    const ty = cy - d * Math.cos(rad);

    const tr = CONFIG.targetRadius * this.scale;
    // Filled background
    this.circle(ctx, tx, ty, tr, CONFIG.colors.targetFill);
    // Outline
    ctx.beginPath();
    ctx.arc(tx, ty, tr, 0, Math.PI * 2);
    ctx.strokeStyle = color;
    ctx.lineWidth = 2.5;
    ctx.stroke();
  }

  drawCursor(ctx, x, y, color = CONFIG.colors.cursor) {
    // Glow
    this.circle(ctx, x, y, CONFIG.cursorRadius + 4, CONFIG.colors.cursorGlow);
    // Main dot
    this.circle(ctx, x, y, CONFIG.cursorRadius, color);
  }

  drawTrail(ctx, points, color = CONFIG.colors.trail) {
    if (points.length < 2) return;
    ctx.beginPath();
    ctx.moveTo(points[0].x, points[0].y);
    for (let i = 1; i < points.length; i++) {
      ctx.lineTo(points[i].x, points[i].y);
    }
    ctx.strokeStyle = color;
    ctx.lineWidth = 2.5;
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    ctx.stroke();
  }

  drawLabel(ctx, x, y, text, color = '#ffffff88', size = 13) {
    ctx.font = `${size}px 'Segoe UI', sans-serif`;
    ctx.fillStyle = color;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(text, x, y);
  }

  drawEndpointFeedback(ctx, cx, cy, targetAngle, endpointAngle, color) {
    // Draw line from center to endpoint direction
    const endRad = deg2rad(endpointAngle);
    const len = CONFIG.targetDistance * this.scale;
    const ex = cx + len * Math.sin(endRad);
    const ey = cy - len * Math.cos(endRad);

    ctx.beginPath();
    ctx.moveTo(cx, cy);
    ctx.lineTo(ex, ey);
    ctx.strokeStyle = color;
    ctx.lineWidth = 2;
    ctx.setLineDash([4, 4]);
    ctx.stroke();
    ctx.setLineDash([]);
  }

  render(state) {
    this.clear();

    const tc = this.topCenter;
    const bc = this.bottomCenter;
    const s = this.scale;

    // Draw start circles
    this.drawStartCircle(this.topCtx, tc.x, tc.y, state.atStart);
    this.drawStartCircle(this.bottomCtx, bc.x, bc.y, state.atStart);

    // Draw target on top canvas
    if (state.showTarget) {
      const color = state.condition === 'beat2' ? CONFIG.colors.beat2 :
                    state.condition === 'beat4' ? CONFIG.colors.beat4 : '#aaaaaa';
      this.drawTarget(this.topCtx, tc.x, tc.y, state.targetAngle, color);
    }

    // Draw trail on top canvas
    if (state.trail && state.trail.length > 1) {
      this.drawTrail(this.topCtx, state.trail);
    }

    // Draw visual cursor (rotated) on top canvas
    if (state.showCursor) {
      const vx = tc.x + state.visualDx * s;
      const vy = tc.y + state.visualDy * s;
      this.drawCursor(this.topCtx, vx, vy);
    }

    // Draw hand dot on bottom canvas
    if (state.showHand) {
      const hx = bc.x + state.handDx;
      const hy = bc.y + state.handDy;
      this.circle(this.bottomCtx, hx, hy, CONFIG.handDotRadius, CONFIG.colors.handDot);
    }

    // Feedback overlay on top canvas
    if (state.showFeedback) {
      this.drawEndpointFeedback(
        this.topCtx, tc.x, tc.y,
        state.targetAngle, state.endpointAngle,
        state.feedbackGood ? CONFIG.colors.feedbackGood : CONFIG.colors.feedbackBad
      );
    }

    // Message on bottom canvas
    if (state.bottomMessage) {
      this.drawLabel(
        this.bottomCtx, bc.x, bc.y + CONFIG.targetDistance * s + 40,
        state.bottomMessage, 'rgba(255,255,255,0.35)', 14
      );
    }
  }
}


// ============================================================
// Trial State Machine
// ============================================================
const TrialState = {
  WAIT_START: 'wait_start',
  HOLDING: 'holding',
  PRE_RHYTHM: 'pre_rhythm',
  RHYTHM: 'rhythm',
  REACHING: 'reaching',
  FEEDBACK: 'feedback',
  ITI: 'iti',
};


// ============================================================
// Main Application
// ============================================================
class App {
  constructor() {
    // DOM elements
    this.topCanvas = document.getElementById('top-canvas');
    this.bottomCanvas = document.getElementById('bottom-canvas');
    this.overlay = document.getElementById('overlay');
    this.conditionLabel = document.getElementById('condition-label');
    this.trialInfo = document.getElementById('trial-info');
    this.phaseLabel = document.getElementById('phase-label');
    this.trialCounter = document.getElementById('trial-counter');
    this.timingFeedback = document.getElementById('timing-feedback');
    this.beatDots = document.querySelectorAll('.beat-dot');

    // Systems
    this.display = new Display(this.topCanvas, this.bottomCanvas);
    this.audio = new RhythmPlayer();

    // State
    this.participantId = '';
    this.running = false;
    this.phaseIndex = -1;
    this.trialIndex = 0;
    this.trials = [];
    this.trialState = null;
    this.allData = [];

    // Current trial data
    this.currentTrial = null;

    // Hand tracking
    this.handDx = 0;
    this.handDy = 0;
    this.visualDx = 0;
    this.visualDy = 0;
    this.trail = [];
    this.atStart = false;
    this.movementStarted = false;
    this.touching = false;

    // Timing
    this.holdStart = 0;
    this.rhythmAudioStart = 0;
    this.rhythmPerfStart = 0;
    this.beatTimes = [];
    this.feedbackStart = 0;
    this.itiStart = 0;
    this.movementOnsetPerf = 0;
    this.lastPointerTime = 0;

    // Beat tracking
    this.currentBeat = -1;

    this.init();
  }

  init() {
    this.setupEventListeners();
    this.showScreen('screen-welcome');
    this.gameLoop();
  }

  setupEventListeners() {
    // Start button
    document.getElementById('btn-start').addEventListener('click', () => {
      this.participantId = document.getElementById('participant-id').value || 'unknown';
      this.audio.init();
      this.startExperiment();
    });

    // Phase start
    document.getElementById('btn-phase-start').addEventListener('click', () => {
      this.audio.resume();
      this.hideOverlay();
      this.startPhaseTrials();
    });

    // Phase next
    document.getElementById('btn-phase-next').addEventListener('click', () => {
      this.nextPhase();
    });

    // Download
    document.getElementById('btn-download').addEventListener('click', () => {
      this.downloadCSV();
    });

    // Pointer tracking - use bottom canvas for capture
    this.bottomCanvas.addEventListener('pointerdown', (e) => this.onPointerDown(e));
    this.bottomCanvas.addEventListener('pointermove', (e) => this.onPointerMove(e));
    this.bottomCanvas.addEventListener('pointerup', (e) => this.onPointerUp(e));
    this.bottomCanvas.addEventListener('pointercancel', (e) => this.onPointerUp(e));

    // Also track on the top canvas and document (finger might start there)
    this.topCanvas.addEventListener('pointerdown', (e) => this.onPointerDown(e));
    this.topCanvas.addEventListener('pointermove', (e) => this.onPointerMove(e));
    this.topCanvas.addEventListener('pointerup', (e) => this.onPointerUp(e));
    this.topCanvas.addEventListener('pointercancel', (e) => this.onPointerUp(e));

    // For mouse: also track on document so hover works outside canvas
    document.addEventListener('pointermove', (e) => {
      if (e.pointerType === 'mouse') {
        this.touching = true; // Mouse is always "touching"
        this.onPointerMove(e);
      }
    });

    // Prevent context menu on long press
    document.addEventListener('contextmenu', (e) => {
      if (this.running) e.preventDefault();
    });
  }

  onPointerMove(e) {
    e.preventDefault();
    if (!this.running) return;

    // Use bottom canvas center as reference, map from wherever the touch is
    const rect = this.bottomCanvas.getBoundingClientRect();
    const mouseX = e.clientX - rect.left;
    const mouseY = e.clientY - rect.top;

    this.handDx = mouseX - this.display.bottomCenter.x;
    this.handDy = mouseY - this.display.bottomCenter.y;
    this.lastPointerTime = performance.now();
    this.touching = true;

    // Visual cursor is updated each frame in gameLoop via updateVisualCursor
    this.updateVisualCursor();
  }

  onPointerDown(e) {
    e.preventDefault();
    // Resume audio context on user gesture
    this.audio.resume();

    // Capture pointer for continuous tracking on touch devices
    try {
      e.target.setPointerCapture(e.pointerId);
    } catch (_) {}

    this.touching = true;

    // Also update position immediately
    if (this.running) {
      const rect = this.bottomCanvas.getBoundingClientRect();
      const mouseX = e.clientX - rect.left;
      const mouseY = e.clientY - rect.top;
      this.handDx = mouseX - this.display.bottomCenter.x;
      this.handDy = mouseY - this.display.bottomCenter.y;
      this.updateVisualCursor();
    }
  }

  onPointerUp(e) {
    e.preventDefault();
    try {
      e.target.releasePointerCapture(e.pointerId);
    } catch (_) {}
    this.touching = false;
  }

  getCurrentRotation() {
    if (!this.currentTrial) return 0;
    if (!this.movementStarted) return 0;
    return this.currentTrial.rotation;
  }

  updateVisualCursor() {
    const rotation = this.getCurrentRotation();
    const rotated = rotatePoint(this.handDx, this.handDy, rotation);
    this.visualDx = rotated.x;
    this.visualDy = rotated.y;
  }

  // --------------------------------------------------
  // Experiment Flow
  // --------------------------------------------------
  startExperiment() {
    this.phaseIndex = -1;
    this.allData = [];
    this.nextPhase();
  }

  nextPhase() {
    this.phaseIndex++;
    if (this.phaseIndex >= CONFIG.phases.length) {
      this.endExperiment();
      return;
    }

    const phase = CONFIG.phases[this.phaseIndex];
    this.showScreen('screen-phase-intro');
    document.getElementById('phase-title').textContent = `${phase.label}フェーズ`;
    document.getElementById('phase-description').textContent = phase.description;
    document.getElementById('phase-trial-count').textContent = `試行数: ${phase.trials}`;
  }

  startPhaseTrials() {
    const phase = CONFIG.phases[this.phaseIndex];
    this.trials = this.generateTrials(phase);
    this.trialIndex = 0;
    this.running = true;

    // Show trial info
    this.trialInfo.classList.remove('hidden');
    this.phaseLabel.textContent = phase.label;

    // Show/hide beat indicator based on rhythm phase
    const beatIndicator = document.getElementById('beat-indicator');
    if (phase.rhythm) {
      beatIndicator.style.visibility = 'visible';
    } else {
      beatIndicator.style.visibility = 'hidden';
    }

    this.startTrial();
  }

  generateTrials(phase) {
    const trials = [];

    if (phase.rhythm) {
      // Rhythm conditions: alternate beat2 and beat4
      const halfCount = Math.floor(phase.trials / 2);
      const beat2Targets = generateTargetSequence(halfCount, CONFIG.targetAngles);
      const beat4Targets = generateTargetSequence(halfCount, CONFIG.targetAngles);

      for (let i = 0; i < halfCount; i++) {
        trials.push({
          phase: phase.name,
          condition: 'beat2',
          reachBeat: 2,
          targetAngle: beat2Targets[i],
          rotation: phase.rotation ? CONFIG.beat2Rotation : 0,
        });
        trials.push({
          phase: phase.name,
          condition: 'beat4',
          reachBeat: 4,
          targetAngle: beat4Targets[i],
          rotation: phase.rotation ? CONFIG.beat4Rotation : 0,
        });
      }
    } else {
      // Practice: no rhythm, no conditions
      const targets = generateTargetSequence(phase.trials, CONFIG.targetAngles);
      for (let i = 0; i < phase.trials; i++) {
        trials.push({
          phase: phase.name,
          condition: 'none',
          reachBeat: 0,
          targetAngle: targets[i],
          rotation: 0,
        });
      }
    }

    return trials;
  }

  startTrial() {
    if (this.trialIndex >= this.trials.length) {
      this.endPhase();
      return;
    }

    const trial = this.trials[this.trialIndex];
    this.currentTrial = {
      ...trial,
      trialNum: this.trialIndex + 1,
      globalTrialNum: this.allData.length + 1,
      movementOnsetTime: 0,
      beatDelta: 0,
      endpointAngle: 0,
      directionError: 0,
      movementDuration: 0,
      timingAccurate: false,
    };

    // Reset state
    this.trail = [];
    this.movementStarted = false;
    this.atStart = false;
    this.currentBeat = -1;

    // Update UI
    this.trialCounter.textContent = `${this.trialIndex + 1} / ${this.trials.length}`;
    this.updateConditionLabel(trial.condition);
    this.clearBeatIndicator();
    this.setupBeatIndicator(trial.condition, trial.reachBeat);
    this.timingFeedback.classList.add('hidden');

    // Enter wait_start state
    this.setTrialState(TrialState.WAIT_START);
  }

  setTrialState(state) {
    this.trialState = state;
  }

  // --------------------------------------------------
  // Game Loop
  // --------------------------------------------------
  gameLoop() {
    if (this.running && this.trialState) {
      this.updateTrial();
      this.renderFrame();
    }
    requestAnimationFrame(() => this.gameLoop());
  }

  updateTrial() {
    const now = performance.now();
    // Always update visual cursor with current rotation state
    this.updateVisualCursor();
    const handDist = Math.hypot(this.handDx, this.handDy);

    switch (this.trialState) {

      case TrialState.WAIT_START:
        this.atStart = this.touching && handDist < CONFIG.startRadius * 2;
        if (this.atStart) {
          this.holdStart = now;
          this.setTrialState(TrialState.HOLDING);
        }
        break;

      case TrialState.HOLDING:
        this.atStart = this.touching && handDist < CONFIG.startRadius * 2.5;
        if (!this.atStart) {
          this.setTrialState(TrialState.WAIT_START);
          break;
        }
        if (now - this.holdStart >= CONFIG.holdDuration) {
          if (this.currentTrial.condition === 'none') {
            // Practice: play go beep and go straight to waiting for movement
            this.audio.playGo(this.audio.currentTime + 0.05);
            this.setTrialState(TrialState.REACHING);
            this.movementStarted = false;
            this.currentTrial._waitingForMovement = true;
            this.currentTrial._goTime = now;
          } else {
            // Rhythm trial: go to pre-rhythm
            this.setTrialState(TrialState.PRE_RHYTHM);
            this._preRhythmStart = now;
          }
        }
        break;

      case TrialState.PRE_RHYTHM:
        if (now - this._preRhythmStart >= CONFIG.preRhythmDelay) {
          // Schedule rhythm
          const audioStart = this.audio.currentTime + 0.05;
          this.beatTimes = this.audio.scheduleMeasure(audioStart);
          this.rhythmAudioStart = audioStart;
          this.rhythmPerfStart = now;
          this.currentBeat = -1;
          this.setTrialState(TrialState.RHYTHM);
        }
        break;

      case TrialState.RHYTHM: {
        // Update current beat based on audio timing
        const audioNow = this.audio.currentTime;
        let newBeat = -1;
        for (let i = 3; i >= 0; i--) {
          if (audioNow >= this.beatTimes[i] - 0.01) {
            newBeat = i;
            break;
          }
        }
        if (newBeat !== this.currentBeat) {
          this.currentBeat = newBeat;
          this.updateBeatIndicator(newBeat);
        }

        // Check if participant started moving
        if (!this.movementStarted && handDist > CONFIG.moveThreshold) {
          this.movementStarted = true;
          this.movementOnsetPerf = now;
          this.trail = [];

          // Calculate timing relative to target beat
          const targetBeatIdx = this.currentTrial.reachBeat - 1;
          const targetBeatAudioTime = this.beatTimes[targetBeatIdx];
          const targetBeatPerfTime = this.rhythmPerfStart +
            (targetBeatAudioTime - this.rhythmAudioStart) * 1000;
          const beatDelta = now - targetBeatPerfTime;

          this.currentTrial.movementOnsetTime = now;
          this.currentTrial.beatDelta = beatDelta;
          this.currentTrial.timingAccurate = Math.abs(beatDelta) <= CONFIG.timingWindow;

          this.setTrialState(TrialState.REACHING);
        }

        // If all beats played and no movement, wait a bit then timeout
        const measureEnd = this.rhythmPerfStart +
          (this.beatTimes[3] - this.rhythmAudioStart) * 1000 + 1000;
        if (now > measureEnd && !this.movementStarted) {
          // Timed out - go back to wait start
          this.setTrialState(TrialState.WAIT_START);
        }
        break;
      }

      case TrialState.REACHING: {
        // For practice trials, detect movement onset
        if (this.currentTrial._waitingForMovement && !this.movementStarted) {
          if (handDist > CONFIG.moveThreshold) {
            this.movementStarted = true;
            this.movementOnsetPerf = now;
            this.currentTrial.movementOnsetTime = now;
            this.currentTrial._waitingForMovement = false;
          }
          break;
        }

        if (!this.movementStarted) break;

        // Record trail in visual space (scaled for display)
        const tc = this.display.topCenter;
        const s = this.display.scale;
        this.trail.push({ x: tc.x + this.visualDx * s, y: tc.y + this.visualDy * s });

        // Check if reached target distance (scaled for screen size)
        if (handDist >= CONFIG.reachThreshold * s) {
          this.onReachComplete(now);
        }

        // On touch devices: if finger is lifted during reach, complete it
        if (!this.touching && this.movementStarted && handDist > CONFIG.moveThreshold * 2) {
          this.onReachComplete(now);
        }

        // Timeout: if reaching takes longer than 5 seconds, end the trial
        if (now - this.movementOnsetPerf > 5000) {
          this.onReachComplete(now);
        }
        break;
      }

      case TrialState.FEEDBACK:
        if (now - this.feedbackStart >= CONFIG.feedbackDuration) {
          this.setTrialState(TrialState.ITI);
          this.itiStart = now;
        }
        break;

      case TrialState.ITI:
        if (now - this.itiStart >= CONFIG.itiDuration) {
          this.trialIndex++;
          this.startTrial();
        }
        break;
    }
  }

  onReachComplete(now) {
    // Calculate endpoint angle using HAND position (not rotated visual cursor)
    // This captures the actual motor adaptation/aftereffect
    const handAngle = getAngleDeg(this.handDx, this.handDy);
    const visualAngle = getAngleDeg(this.visualDx, this.visualDy);
    const targetAngle = this.currentTrial.targetAngle;
    const error = angleDiff(handAngle, targetAngle);
    const duration = now - this.movementOnsetPerf;

    this.currentTrial.handAngle = handAngle;
    this.currentTrial.endpointAngle = visualAngle;
    this.currentTrial.directionError = error;
    this.currentTrial.movementDuration = duration;

    // Save trial data
    this.allData.push({ ...this.currentTrial });

    // Show timing feedback for rhythm trials
    if (this.currentTrial.condition !== 'none') {
      this.showTimingFeedback(this.currentTrial.beatDelta, this.currentTrial.timingAccurate);
    }

    this.feedbackStart = now;
    this.setTrialState(TrialState.FEEDBACK);
  }

  endPhase() {
    this.running = false;
    this.conditionLabel.classList.add('hidden');
    this.trialInfo.classList.add('hidden');
    this.clearBeatIndicator();

    const phase = CONFIG.phases[this.phaseIndex];

    if (this.phaseIndex < CONFIG.phases.length - 1) {
      this.showScreen('screen-phase-end');
      document.getElementById('phase-end-message').textContent =
        `${phase.label}フェーズが完了しました。少し休憩してから次のフェーズに進んでください。`;
    } else {
      this.nextPhase(); // will call endExperiment
    }
  }

  endExperiment() {
    this.running = false;
    this.conditionLabel.classList.add('hidden');
    this.trialInfo.classList.add('hidden');
    this.clearBeatIndicator();
    this.showScreen('screen-end');
    this.drawResultsGraph();
    this.showResultsSummary();
  }

  // --------------------------------------------------
  // Rendering
  // --------------------------------------------------
  renderFrame() {
    const showTarget = this.trialState !== TrialState.WAIT_START &&
                       this.trialState !== TrialState.ITI;

    const showCursor = (this.trialState === TrialState.REACHING && this.movementStarted) ||
                       this.trialState === TrialState.FEEDBACK;

    const showHand = this.trialState !== TrialState.ITI;

    let bottomMessage = '';
    if (this.trialState === TrialState.WAIT_START) {
      bottomMessage = 'スタート位置に移動してください';
    } else if (this.trialState === TrialState.HOLDING) {
      bottomMessage = 'そのまま...';
    } else if (this.trialState === TrialState.RHYTHM && !this.movementStarted) {
      const beat = this.currentTrial.reachBeat;
      bottomMessage = `ビート ${beat} で動いてください`;
    }

    this.display.render({
      atStart: this.atStart,
      showTarget,
      showCursor,
      showHand,
      showFeedback: this.trialState === TrialState.FEEDBACK,
      condition: this.currentTrial ? this.currentTrial.condition : 'none',
      targetAngle: this.currentTrial ? this.currentTrial.targetAngle : 0,
      handDx: this.handDx,
      handDy: this.handDy,
      visualDx: this.visualDx,
      visualDy: this.visualDy,
      trail: this.trail,
      endpointAngle: this.currentTrial ? (this.currentTrial.handAngle || this.currentTrial.endpointAngle || 0) : 0,
      feedbackGood: this.currentTrial ? Math.abs(this.currentTrial.directionError) < 15 : false,
      bottomMessage,
    });
  }

  // --------------------------------------------------
  // UI Helpers
  // --------------------------------------------------
  showScreen(screenId) {
    this.overlay.classList.remove('hidden');
    document.querySelectorAll('.screen').forEach(s => s.classList.remove('active'));
    document.getElementById(screenId).classList.add('active');
  }

  hideOverlay() {
    this.overlay.classList.add('hidden');
  }

  updateConditionLabel(condition) {
    const label = this.conditionLabel;
    label.classList.remove('beat2', 'beat4');
    if (condition === 'beat2') {
      label.textContent = 'ビート 2';
      label.classList.add('beat2');
      label.classList.remove('hidden');
    } else if (condition === 'beat4') {
      label.textContent = 'ビート 4';
      label.classList.add('beat4');
      label.classList.remove('hidden');
    } else {
      label.classList.add('hidden');
    }
  }

  setupBeatIndicator(condition, reachBeat) {
    this.beatDots.forEach((dot, i) => {
      dot.classList.remove('target-beat2', 'target-beat4', 'active');
      if (condition === 'beat2' && i === 1) {
        dot.classList.add('target-beat2');
      } else if (condition === 'beat4' && i === 3) {
        dot.classList.add('target-beat4');
      }
    });
  }

  clearBeatIndicator() {
    this.beatDots.forEach(dot => {
      dot.classList.remove('active', 'target-beat2', 'target-beat4');
    });
    this.currentBeat = -1;
  }

  updateBeatIndicator(beatIndex) {
    this.beatDots.forEach((dot, i) => {
      if (i === beatIndex) {
        dot.classList.add('active');
      } else {
        dot.classList.remove('active');
      }
    });
  }

  showTimingFeedback(beatDelta, accurate) {
    const el = this.timingFeedback;
    el.classList.remove('hidden', 'good', 'early', 'late');

    if (accurate) {
      el.textContent = 'Good!';
      el.classList.add('good');
    } else if (beatDelta < 0) {
      el.textContent = '早い';
      el.classList.add('early');
    } else {
      el.textContent = '遅い';
      el.classList.add('late');
    }

    // Auto-hide after feedback
    setTimeout(() => {
      el.classList.add('hidden');
    }, CONFIG.feedbackDuration - 100);
  }

  // --------------------------------------------------
  // Results and Data Export
  // --------------------------------------------------
  showResultsSummary() {
    const container = document.getElementById('results-summary');
    const totalTrials = this.allData.length;
    const adaptTrials = this.allData.filter(d => d.phase === 'adaptation');
    const beat2Adapt = adaptTrials.filter(d => d.condition === 'beat2');
    const beat4Adapt = adaptTrials.filter(d => d.condition === 'beat4');
    const washTrials = this.allData.filter(d => d.phase === 'washout');
    const beat2Wash = washTrials.filter(d => d.condition === 'beat2');
    const beat4Wash = washTrials.filter(d => d.condition === 'beat4');

    const avgError = (arr) => {
      if (arr.length === 0) return 'N/A';
      const mean = arr.reduce((s, d) => s + d.directionError, 0) / arr.length;
      return mean.toFixed(1) + '°';
    };

    const lastN = (arr, n) => arr.slice(-Math.min(n, arr.length));

    container.innerHTML = `
      <p><strong>参加者ID:</strong> ${this.participantId}</p>
      <p><strong>総試行数:</strong> ${totalTrials}</p>
      <hr style="border-color:#333; margin:8px 0">
      <p><strong>適応フェーズ (最後10試行の平均方向誤差):</strong></p>
      <p style="padding-left:16px">
        ビート2 (右30°回転): ${avgError(lastN(beat2Adapt, 10))}<br>
        ビート4 (左30°回転): ${avgError(lastN(beat4Adapt, 10))}
      </p>
      <p><strong>ウォッシュアウトフェーズ (平均方向誤差 = 残効):</strong></p>
      <p style="padding-left:16px">
        ビート2: ${avgError(beat2Wash)}<br>
        ビート4: ${avgError(beat4Wash)}
      </p>
    `;
  }

  drawResultsGraph() {
    const canvas = document.getElementById('results-canvas');
    const ctx = canvas.getContext('2d');
    const W = canvas.width;
    const H = canvas.height;

    ctx.fillStyle = '#0d0d1a';
    ctx.fillRect(0, 0, W, H);

    // Margins
    const ml = 70, mr = 30, mt = 30, mb = 50;
    const plotW = W - ml - mr;
    const plotH = H - mt - mb;

    // Collect data by phase for plotting
    const beat2Data = [];
    const beat4Data = [];
    let beat2Idx = 0;
    let beat4Idx = 0;

    // Only plot rhythm trials (baseline, adaptation, washout)
    const rhythmTrials = this.allData.filter(d => d.condition !== 'none');

    rhythmTrials.forEach(d => {
      if (d.condition === 'beat2') {
        beat2Data.push({ x: beat2Idx++, y: d.directionError, phase: d.phase });
      } else {
        beat4Data.push({ x: beat4Idx++, y: d.directionError, phase: d.phase });
      }
    });

    const maxTrials = Math.max(beat2Data.length, beat4Data.length, 1);
    const maxError = 60;

    // Draw axes
    ctx.strokeStyle = '#444';
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(ml, mt);
    ctx.lineTo(ml, mt + plotH);
    ctx.lineTo(ml + plotW, mt + plotH);
    ctx.stroke();

    // Y axis labels
    ctx.fillStyle = '#888';
    ctx.font = '11px sans-serif';
    ctx.textAlign = 'right';
    ctx.textBaseline = 'middle';
    for (let e = -maxError; e <= maxError; e += 20) {
      const y = mt + plotH / 2 - (e / maxError) * (plotH / 2);
      ctx.fillText(e + '°', ml - 8, y);
      ctx.beginPath();
      ctx.strokeStyle = '#222';
      ctx.moveTo(ml, y);
      ctx.lineTo(ml + plotW, y);
      ctx.stroke();
    }

    // Zero line
    ctx.beginPath();
    ctx.strokeStyle = '#555';
    ctx.setLineDash([4, 4]);
    ctx.moveTo(ml, mt + plotH / 2);
    ctx.lineTo(ml + plotW, mt + plotH / 2);
    ctx.stroke();
    ctx.setLineDash([]);

    // X axis label
    ctx.fillStyle = '#888';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'top';
    ctx.fillText('試行番号', ml + plotW / 2, mt + plotH + 30);

    // Y axis label
    ctx.save();
    ctx.translate(15, mt + plotH / 2);
    ctx.rotate(-Math.PI / 2);
    ctx.fillText('方向誤差 (°)', 0, 0);
    ctx.restore();

    // Draw phase boundaries
    let prevPhase = '';
    let phaseStarts = [];
    rhythmTrials.forEach((d, i) => {
      if (d.phase !== prevPhase) {
        phaseStarts.push({ idx: Math.floor(i / 2), phase: d.phase });
        prevPhase = d.phase;
      }
    });

    phaseStarts.forEach((ps, idx) => {
      if (idx > 0) {
        const x = ml + (ps.idx / maxTrials) * plotW;
        ctx.beginPath();
        ctx.strokeStyle = '#555';
        ctx.setLineDash([3, 3]);
        ctx.moveTo(x, mt);
        ctx.lineTo(x, mt + plotH);
        ctx.stroke();
        ctx.setLineDash([]);
      }
      // Phase label at top
      const nextStart = phaseStarts[idx + 1] ? phaseStarts[idx + 1].idx : maxTrials;
      const labelX = ml + ((ps.idx + nextStart) / 2 / maxTrials) * plotW;
      const phaseConfig = CONFIG.phases.find(p => p.name === ps.phase);
      if (phaseConfig) {
        ctx.fillStyle = '#666';
        ctx.textAlign = 'center';
        ctx.textBaseline = 'bottom';
        ctx.font = '11px sans-serif';
        ctx.fillText(phaseConfig.label, labelX, mt - 5);
      }
    });

    // Plot data points
    function plotData(data, color) {
      if (data.length === 0) return;

      // Draw points
      data.forEach(d => {
        const x = ml + (d.x / maxTrials) * plotW;
        const y = mt + plotH / 2 - (d.y / maxError) * (plotH / 2);
        const clampedY = Math.max(mt, Math.min(mt + plotH, y));

        ctx.beginPath();
        ctx.arc(x, clampedY, 3, 0, Math.PI * 2);
        ctx.fillStyle = color;
        ctx.globalAlpha = 0.6;
        ctx.fill();
        ctx.globalAlpha = 1.0;
      });

      // Draw moving average (window of 5)
      if (data.length >= 5) {
        ctx.beginPath();
        ctx.strokeStyle = color;
        ctx.lineWidth = 2;
        const windowSize = 5;
        let first = true;
        for (let i = 0; i <= data.length - windowSize; i++) {
          const window = data.slice(i, i + windowSize);
          const avgY = window.reduce((s, d) => s + d.y, 0) / windowSize;
          const avgX = window.reduce((s, d) => s + d.x, 0) / windowSize;
          const px = ml + (avgX / maxTrials) * plotW;
          const py = mt + plotH / 2 - (avgY / maxError) * (plotH / 2);
          const clampedPy = Math.max(mt, Math.min(mt + plotH, py));
          if (first) {
            ctx.moveTo(px, clampedPy);
            first = false;
          } else {
            ctx.lineTo(px, clampedPy);
          }
        }
        ctx.stroke();
      }
    }

    plotData(beat2Data, CONFIG.colors.beat2);
    plotData(beat4Data, CONFIG.colors.beat4);

    // Legend
    const legendX = ml + plotW - 120;
    const legendY = mt + 15;
    ctx.globalAlpha = 1.0;

    ctx.fillStyle = CONFIG.colors.beat2;
    ctx.fillRect(legendX, legendY, 12, 12);
    ctx.fillStyle = '#aaa';
    ctx.font = '11px sans-serif';
    ctx.textAlign = 'left';
    ctx.textBaseline = 'middle';
    ctx.fillText('ビート2 (+30°)', legendX + 18, legendY + 6);

    ctx.fillStyle = CONFIG.colors.beat4;
    ctx.fillRect(legendX, legendY + 20, 12, 12);
    ctx.fillStyle = '#aaa';
    ctx.fillText('ビート4 (-30°)', legendX + 18, legendY + 26);
  }

  downloadCSV() {
    const headers = [
      'participant_id',
      'global_trial',
      'phase',
      'trial_in_phase',
      'condition',
      'reach_beat',
      'target_angle',
      'rotation_applied',
      'hand_angle',
      'visual_cursor_angle',
      'direction_error',
      'beat_delta_ms',
      'timing_accurate',
      'movement_duration_ms',
    ];

    const rows = this.allData.map(d => [
      this.participantId,
      d.globalTrialNum,
      d.phase,
      d.trialNum,
      d.condition,
      d.reachBeat,
      d.targetAngle.toFixed(1),
      d.rotation.toFixed(1),
      (d.handAngle || 0).toFixed(2),
      d.endpointAngle.toFixed(2),
      d.directionError.toFixed(2),
      d.beatDelta.toFixed(1),
      d.timingAccurate ? 1 : 0,
      d.movementDuration.toFixed(1),
    ].join(','));

    const csv = [headers.join(','), ...rows].join('\n');
    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `rhythm_motor_${this.participantId}_${Date.now()}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  }
}


// ============================================================
// Entry Point
// ============================================================
document.addEventListener('DOMContentLoaded', () => {
  new App();
});
