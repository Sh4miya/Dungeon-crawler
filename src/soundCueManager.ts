export type SoundCueName =
  | 'guardFootstep'
  | 'keyPickup'
  | 'torchPickup'
  | 'torchToggleOn'
  | 'torchToggleOff'
  | 'doorUnlock'
  | 'alertTrigger'
  | 'houndGrowl'
  | 'houndBark';

type AudioContextCtor = new () => AudioContext;

function getAudioContextCtor(): AudioContextCtor | null {
  const win = window as typeof window & {
    webkitAudioContext?: AudioContextCtor;
  };

  return win.AudioContext ?? win.webkitAudioContext ?? null;
}

export class SoundCueManager {
  private context: AudioContext | null = null;
  private masterGain: GainNode | null = null;
  private initialized = false;

  constructor() {
    const wake = (): void => {
      void this.resume();
    };

    window.addEventListener('pointerdown', wake, { passive: true });
    window.addEventListener('keydown', wake, { passive: true });
  }

  play(cue: SoundCueName): void {
    void this.resume();
    if (!this.context || !this.masterGain) {
      return;
    }

    switch (cue) {
      case 'guardFootstep':
        this.beep(142, 0.07, 'square', 0.42, 0);
        this.beep(96, 0.1, 'triangle', 0.18, 0.03);
        this.beep(620, 0.018, 'square', 0.08, 0.055);
        break;
      case 'keyPickup':
        this.beep(940, 0.08, 'triangle', 0.25, 0);
        this.beep(1180, 0.12, 'sine', 0.19, 0.06);
        break;
      case 'torchPickup':
        this.beep(430, 0.12, 'triangle', 0.24, 0);
        this.beep(590, 0.16, 'sine', 0.16, 0.04);
        break;
      case 'torchToggleOn':
        this.beep(310, 0.08, 'sawtooth', 0.18, 0);
        this.beep(660, 0.14, 'triangle', 0.12, 0.05);
        break;
      case 'torchToggleOff':
        this.beep(420, 0.08, 'triangle', 0.12, 0);
        this.beep(250, 0.1, 'sine', 0.12, 0.03);
        break;
      case 'doorUnlock':
        this.beep(210, 0.08, 'square', 0.26, 0);
        this.beep(156, 0.16, 'triangle', 0.18, 0.04);
        this.beep(510, 0.03, 'square', 0.1, 0.08);
        break;
      case 'alertTrigger':
        this.beep(760, 0.06, 'square', 0.16, 0);
        this.beep(910, 0.06, 'square', 0.16, 0.08);
        this.beep(760, 0.06, 'square', 0.14, 0.16);
        break;
      case 'houndGrowl':
        this.beep(108, 0.22, 'sawtooth', 0.32, 0);
        this.beep(84, 0.28, 'triangle', 0.22, 0.03);
        break;
      case 'houndBark':
        this.beep(210, 0.05, 'square', 0.28, 0);
        this.beep(172, 0.08, 'square', 0.22, 0.04);
        break;
      default:
        break;
    }
  }

  private async resume(): Promise<void> {
    if (!this.initialized) {
      const AudioCtor = getAudioContextCtor();
      if (!AudioCtor) {
        this.initialized = true;
        return;
      }

      this.context = new AudioCtor();
      this.masterGain = this.context.createGain();
      this.masterGain.gain.value = 0.09;
      this.masterGain.connect(this.context.destination);
      this.initialized = true;
    }

    if (this.context?.state === 'suspended') {
      await this.context.resume();
    }
  }

  private beep(
    frequency: number,
    durationSeconds: number,
    type: OscillatorType,
    volume: number,
    startOffsetSeconds: number,
  ): void {
    if (!this.context || !this.masterGain) {
      return;
    }

    const oscillator = this.context.createOscillator();
    const gain = this.context.createGain();
    oscillator.type = type;
    oscillator.frequency.value = frequency;
    oscillator.connect(gain);
    gain.connect(this.masterGain);

    const startAt = this.context.currentTime + startOffsetSeconds;
    const endAt = startAt + durationSeconds;
    gain.gain.setValueAtTime(0.0001, startAt);
    gain.gain.exponentialRampToValueAtTime(volume, startAt + 0.012);
    gain.gain.exponentialRampToValueAtTime(0.0001, endAt);

    oscillator.start(startAt);
    oscillator.stop(endAt + 0.02);
  }
}
