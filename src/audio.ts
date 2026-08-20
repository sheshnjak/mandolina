/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import { getFrequencyForNote, InstrumentType } from "./types";

class MandolinSynth {
  private ctx: AudioContext | null = null;
  private masterVolumeNode: GainNode | null = null;
  private activeOscillators: { osc1: OscillatorNode; osc2?: OscillatorNode; gainNode: GainNode }[] = [];
  private volume: number = 0.6; // Default volume (0.0 to 1.0)
  private currentInstrument: InstrumentType = "mandolin";
  
  constructor() {
    // Lazy initialize to bypass browser autoplay policies
  }

  private init() {
    if (!this.ctx) {
      const AudioContextClass = window.AudioContext || (window as any).webkitAudioContext;
      this.ctx = new AudioContextClass();
      this.masterVolumeNode = this.ctx.createGain();
      this.masterVolumeNode.gain.setValueAtTime(this.volume, this.ctx.currentTime);
      this.masterVolumeNode.connect(this.ctx.destination);
    }
    if (this.ctx.state === "suspended") {
      this.ctx.resume();
    }
  }

  setInstrument(inst: InstrumentType) {
    this.currentInstrument = inst;
  }

  setVolume(vol: number) {
    this.volume = Math.max(0, Math.min(1, vol));
    if (this.masterVolumeNode && this.ctx) {
      this.masterVolumeNode.gain.setValueAtTime(this.volume, this.ctx.currentTime);
    }
  }

  getVolume(): number {
    return this.volume;
  }

  /**
   * Plays a single plucked note with instrument-specific acoustics
   */
  playNote(noteName: string, octave: number, durationSec: number = 1.6, instrument?: InstrumentType) {
    try {
      this.init();
      if (!this.ctx || !this.masterVolumeNode) return;

      const inst = instrument || this.currentInstrument;
      const freq = getFrequencyForNote(noteName, octave);
      const now = this.ctx.currentTime;

      // Adjust duration based on pitch (lower guitar notes ring longer)
      const adjustedDuration = inst === "guitar" && octave <= 2 ? Math.max(durationSec, 2.0) : durationSec;

      // Create a gain node for this specific note's pluck envelope
      const noteGain = this.ctx.createGain();
      noteGain.gain.setValueAtTime(0, now);
      // Instant pluck attack
      noteGain.gain.linearRampToValueAtTime(1.0, now + 0.004);
      // Plucked string decay
      noteGain.gain.exponentialRampToValueAtTime(inst === "guitar" ? 0.35 : 0.3, now + 0.18);
      // Release to 0
      noteGain.gain.exponentialRampToValueAtTime(0.001, now + adjustedDuration);

      if (inst === "guitar") {
        // GUITAR ACOUSTIC TIMBRE: Warm fundamental + 2nd harmonic + woody body resonance
        const osc1 = this.ctx.createOscillator();
        osc1.type = "triangle";
        osc1.frequency.setValueAtTime(freq, now);

        // Body resonance harmonic
        const osc2 = this.ctx.createOscillator();
        osc2.type = "sine";
        osc2.frequency.setValueAtTime(freq * 2, now); // Octave overtone

        const bodyGain = this.ctx.createGain();
        bodyGain.gain.setValueAtTime(0.3, now);
        bodyGain.gain.exponentialRampToValueAtTime(0.01, now + adjustedDuration * 0.8);

        // Pluck bite (transient)
        const clickOsc = this.ctx.createOscillator();
        const clickGain = this.ctx.createGain();
        clickOsc.type = "triangle";
        clickOsc.frequency.setValueAtTime(freq * 3, now);
        clickGain.gain.setValueAtTime(0.12, now);
        clickGain.gain.exponentialRampToValueAtTime(0.001, now + 0.04);

        osc1.connect(noteGain);
        osc2.connect(bodyGain);
        bodyGain.connect(noteGain);
        clickOsc.connect(clickGain);
        clickGain.connect(noteGain);

        noteGain.connect(this.masterVolumeNode);

        osc1.start(now);
        osc2.start(now);
        clickOsc.start(now);

        osc1.stop(now + adjustedDuration);
        osc2.stop(now + adjustedDuration);
        clickOsc.stop(now + adjustedDuration);

        const activeItem = { osc1, osc2, gainNode: noteGain };
        this.activeOscillators.push(activeItem);

        setTimeout(() => {
          this.activeOscillators = this.activeOscillators.filter(item => item !== activeItem);
        }, adjustedDuration * 1000 + 100);

      } else {
        // MANDOLIN SPECIFIC: Two strings tuned to almost the exact same frequency,
        // slightly detuned to create the double-string (course) chorus effect!
        const osc1 = this.ctx.createOscillator();
        const osc2 = this.ctx.createOscillator();

        osc1.type = "triangle";
        osc2.type = "triangle";

        osc1.frequency.setValueAtTime(freq, now);
        osc2.frequency.setValueAtTime(freq, now);

        // Micro-detune standard mandolin strings (+4 cents and -4 cents)
        osc1.detune.setValueAtTime(-4, now);
        osc2.detune.setValueAtTime(4, now);

        // Add a subtle high harmonic to simulate steel pluck click
        const clickOsc = this.ctx.createOscillator();
        const clickGain = this.ctx.createGain();
        clickOsc.type = "sine";
        clickOsc.frequency.setValueAtTime(freq * 3, now);
        clickGain.gain.setValueAtTime(0.15, now);
        clickGain.gain.exponentialRampToValueAtTime(0.001, now + 0.04);

        osc1.connect(noteGain);
        osc2.connect(noteGain);
        clickOsc.connect(clickGain);
        clickGain.connect(noteGain);

        noteGain.connect(this.masterVolumeNode);

        osc1.start(now);
        osc2.start(now);
        clickOsc.start(now);

        osc1.stop(now + durationSec);
        osc2.stop(now + durationSec);
        clickOsc.stop(now + durationSec);

        const activeItem = { osc1, osc2, gainNode: noteGain };
        this.activeOscillators.push(activeItem);

        setTimeout(() => {
          this.activeOscillators = this.activeOscillators.filter(item => item !== activeItem);
        }, durationSec * 1000 + 100);
      }

    } catch (e) {
      console.error("Failed to play note via Web Audio API", e);
    }
  }

  /**
   * Triggers a fast repeated sequence of pluck attacks for a given note (Tremolo effect)
   * Returns a function to stop the tremolo.
   */
  startTremolo(noteName: string, octave: number, speedHz: number = 8): () => void {
    try {
      this.init();
      if (!this.ctx || !this.masterVolumeNode) return () => {};

      let isPlaying = true;
      const intervalMs = 1000 / speedHz;
      
      const playStroke = () => {
        if (!isPlaying || !this.ctx) return;
        
        const freq = getFrequencyForNote(noteName, octave);
        const now = this.ctx.currentTime;
        
        // Tremolo strokes are very short and quick
        const strokeGain = this.ctx.createGain();
        strokeGain.gain.setValueAtTime(0, now);
        strokeGain.gain.linearRampToValueAtTime(0.9, now + 0.002);
        strokeGain.gain.exponentialRampToValueAtTime(0.1, now + (intervalMs / 1000) * 0.8);
        strokeGain.gain.setValueAtTime(0, now + intervalMs / 1000);
        
        const osc1 = this.ctx.createOscillator();
        const osc2 = this.ctx.createOscillator();
        
        osc1.type = "triangle";
        osc2.type = "triangle";
        
        osc1.frequency.setValueAtTime(freq, now);
        osc2.frequency.setValueAtTime(freq, now);
        
        // Slightly wider detune for fast picking vibration
        osc1.detune.setValueAtTime(-6, now);
        osc2.detune.setValueAtTime(6, now);
        
        osc1.connect(strokeGain);
        osc2.connect(strokeGain);
        strokeGain.connect(this.masterVolumeNode!);
        
        osc1.start(now);
        osc2.start(now);
        
        osc1.stop(now + intervalMs / 1000);
        osc2.stop(now + intervalMs / 1000);
        
        setTimeout(() => {
          if (isPlaying) {
            playStroke();
          }
        }, intervalMs);
      };
      
      // Start the loop
      playStroke();
      
      return () => {
        isPlaying = false;
      };
    } catch (e) {
      console.error("Failed to start tremolo", e);
      return () => {};
    }
  }

  stopAll() {
    try {
      this.activeOscillators.forEach(item => {
        item.osc1.disconnect();
        if (item.osc2) item.osc2.disconnect();
        item.gainNode.disconnect();
      });
      this.activeOscillators = [];
    } catch (e) {
      console.error("Failed to stop oscillators", e);
    }
  }
}

export const synth = new MandolinSynth();
