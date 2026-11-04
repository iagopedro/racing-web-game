export interface Track { name: string; root: number; melody: number[]; chords: number[] }
export interface Station { name: string; frequency: string; genre: string; bpm: number; wave: OscillatorType; tracks: Track[] }

export const STATIONS: Station[] = [
  { name: 'Mar\u00e9 FM', frequency: '88.4', genre: 'JAZZ & DOWNTEMPO', bpm: 86, wave: 'sine', tracks: [
    { name: 'Janelas abertas', root: 48, melody: [12, 16, 19, -1, 23, 19, 16, -1, 14, 17, 21, -1, 19, 16, 14, 12], chords: [0, 5, 9, 7] },
    { name: 'Avenida do mar', root: 50, melody: [19, -1, 17, 14, 12, -1, 16, 19, 21, 19, -1, 16, 14, 12, -1, 7], chords: [0, 9, 5, 7] },
    { name: 'Domingo sem pressa', root: 45, melody: [12, -1, 19, 16, 14, 12, -1, 9, 12, 16, -1, 19, 24, 21, 19, -1], chords: [0, 5, 2, 7] },
  ] },
  { name: 'Horizonte', frequency: '103.2', genre: 'SYNTH & SUNSET', bpm: 108, wave: 'triangle', tracks: [
    { name: 'Ultima luz', root: 45, melody: [12, 19, 24, 19, 16, 19, 24, 28, 12, 19, 23, 19, 14, 19, 23, 26], chords: [0, 5, 9, 7] },
    { name: 'Linhas de neon', root: 48, melody: [12, 15, 19, 24, 19, 15, 12, 7, 14, 17, 21, 26, 21, 17, 14, 9], chords: [0, 8, 5, 7] },
    { name: 'Depois da curva', root: 43, melody: [19, 24, 26, 24, 19, 16, 14, 16, 17, 21, 24, 21, 17, 14, 12, 14], chords: [0, 5, 7, 0] },
  ] },
  { name: 'Entre Ondas', frequency: '96.7', genre: 'AMBIENT & FLOAT', bpm: 68, wave: 'sine', tracks: [
    { name: 'A cidade dorme', root: 47, melody: [12, -1, -1, 19, -1, -1, 16, -1, 23, -1, -1, 19, -1, 14, -1, -1], chords: [0, 5, 2, 7] },
    { name: 'Maresia', root: 52, melody: [12, -1, 16, -1, 19, -1, -1, 24, 23, -1, 19, -1, 16, -1, 14, -1], chords: [0, 9, 5, 0] },
    { name: 'Farol distante', root: 45, melody: [19, -1, -1, 24, 21, -1, -1, 16, 14, -1, 12, -1, 16, -1, -1, -1], chords: [0, 5, 7, 9] },
  ] },
];

export class AudioSystem {
  stationIndex = 0;
  trackIndex = 0;
  volume = 0.38;
  enabled = true;
  muted = false;
  error = '';
  context?: AudioContext;
  private master?: GainNode;
  private music?: GainNode;
  private engineGain?: GainNode;
  private engine?: OscillatorNode;
  private engineFilter?: BiquadFilterNode;
  private analyser?: AnalyserNode;
  private samples = new Float32Array(256);
  private noise?: AudioBuffer;
  private nextBeat = 0;
  private beat = 0;
  private timer?: ReturnType<typeof setInterval>;
  private driving = false;
  onChange: () => void = () => {};

  get station(): Station { return STATIONS[this.stationIndex]; }
  get track(): Track { return this.station.tracks[this.trackIndex]; }

  async start(): Promise<void> {
    try {
      if (!this.context) {
        this.context = new AudioContext();
        this.master = this.context.createGain();
        this.master.gain.value = this.muted ? 0 : 0.7;
        this.analyser = this.context.createAnalyser();
        this.analyser.fftSize = 512;
        this.master.connect(this.analyser);
        this.analyser.connect(this.context.destination);
        this.music = this.context.createGain();
        this.music.gain.value = 0;
        this.music.connect(this.master);
        this.engineGain = this.context.createGain();
        this.engineGain.gain.value = 0;
        this.engineFilter = this.context.createBiquadFilter();
        this.engineFilter.type = 'lowpass';
        this.engineFilter.frequency.value = 180;
        this.engine = this.context.createOscillator();
        this.engine.type = 'sawtooth';
        this.engine.frequency.value = 35;
        this.engine.connect(this.engineFilter);
        this.engineFilter.connect(this.engineGain);
        this.engineGain.connect(this.master);
        this.engine.start();
        this.noise = this.context.createBuffer(1, this.context.sampleRate, this.context.sampleRate);
        const samples = this.noise.getChannelData(0);
        for (let index = 0; index < samples.length; index++) samples[index] = Math.random() * 2 - 1;
        this.nextBeat = this.context.currentTime + 0.08;
        this.timer = setInterval(() => this.schedule(), 40);
      }
      await this.context.resume();
      this.error = '';
    } catch {
      this.error = 'Audio indisponivel neste navegador.';
      this.onChange();
    }
  }

  private note(midi: number, when: number, length: number, gain: number, wave: OscillatorType): void {
    const context = this.context!;
    const oscillator = context.createOscillator();
    const envelope = context.createGain();
    oscillator.type = wave;
    oscillator.frequency.value = 440 * 2 ** ((midi - 69) / 12);
    envelope.gain.setValueAtTime(0.0001, when);
    envelope.gain.exponentialRampToValueAtTime(gain, when + Math.min(0.04, length / 4));
    envelope.gain.exponentialRampToValueAtTime(0.0001, when + length);
    oscillator.connect(envelope);
    envelope.connect(this.music!);
    oscillator.start(when);
    oscillator.stop(when + length + 0.02);
    oscillator.onended = () => { oscillator.disconnect(); envelope.disconnect(); };
  }

  private percussion(when: number, kick: boolean, snare: boolean): void {
    const context = this.context!;
    const envelope = context.createGain();
    envelope.connect(this.music!);
    if (kick) {
      const oscillator = context.createOscillator();
      oscillator.frequency.setValueAtTime(130, when);
      oscillator.frequency.exponentialRampToValueAtTime(42, when + 0.13);
      envelope.gain.setValueAtTime(0.35, when);
      envelope.gain.exponentialRampToValueAtTime(0.001, when + 0.22);
      oscillator.connect(envelope);
      oscillator.start(when);
      oscillator.stop(when + 0.24);
      oscillator.onended = () => { oscillator.disconnect(); envelope.disconnect(); };
    } else {
      const source = context.createBufferSource();
      source.buffer = this.noise!;
      const filter = context.createBiquadFilter();
      filter.type = 'highpass';
      filter.frequency.value = snare ? 1600 : 7000;
      source.connect(filter);
      filter.connect(envelope);
      envelope.gain.setValueAtTime(snare ? 0.13 : 0.045, when);
      envelope.gain.exponentialRampToValueAtTime(0.001, when + (snare ? 0.12 : 0.045));
      source.start(when);
      source.stop(when + 0.15);
      source.onended = () => { source.disconnect(); filter.disconnect(); envelope.disconnect(); };
    }
  }

  private schedule(): void {
    const context = this.context;
    if (!context || context.state !== 'running') return;
    if (this.nextBeat < context.currentTime - 0.3) this.nextBeat = context.currentTime + 0.05;
    while (this.nextBeat < context.currentTime + 0.15) {
      const station = this.station;
      const track = this.track;
      const duration = 60 / station.bpm / 2;
      const step = this.beat % 16;
      const chord = track.chords[Math.floor(this.beat / 16) % track.chords.length];
      if (this.enabled) {
        if (step % 8 === 0) {
          for (const interval of [0, 4, 7, 11]) this.note(track.root + chord + interval, this.nextBeat, duration * 7.8, 0.035, 'sine');
        }
        if (step % 4 === 0) this.note(track.root + chord - 12, this.nextBeat, duration * 2.8, 0.17, 'triangle');
        const melody = track.melody[step];
        if (melody >= 0) this.note(track.root + melody, this.nextBeat, duration * (this.stationIndex === 2 ? 5 : 1.5), 0.08, station.wave);
        if (this.stationIndex !== 2) {
          this.percussion(this.nextBeat, step % 8 === 0 || step === 11, step % 8 === 4);
        }
      }
      this.beat++;
      this.nextBeat += duration;
      if (this.beat >= 256) {
        this.trackIndex = (this.trackIndex + 1) % station.tracks.length;
        this.beat = 0;
        this.onChange();
      }
    }
  }

  changeStation(direction: number): void {
    this.stationIndex = (this.stationIndex + direction + STATIONS.length) % STATIONS.length;
    this.trackIndex = 0;
    this.beat = 0;
    this.onChange();
  }

  nextTrack(): void {
    this.trackIndex = (this.trackIndex + 1) % this.station.tracks.length;
    this.beat = 0;
    this.onChange();
  }

  update(driving: boolean, speed: number, throttle: number): void {
    this.driving = driving;
    if (!this.context) return;
    const now = this.context.currentTime;
    this.master!.gain.setTargetAtTime(this.muted ? 0 : 0.7, now, 0.08);
    this.music!.gain.setTargetAtTime(driving && this.enabled ? this.volume * 0.7 : 0, now, 0.2);
    this.engineGain!.gain.setTargetAtTime(driving ? 0.035 + Math.abs(throttle) * 0.035 : 0, now, 0.12);
    this.engine!.frequency.setTargetAtTime(32 + Math.abs(speed) * 2.6 + Math.abs(throttle) * 14, now, 0.1);
    this.engineFilter!.frequency.setTargetAtTime(150 + Math.abs(speed) * 9, now, 0.1);
  }

  setPaused(paused: boolean): void {
    if (!this.context) return;
    if (paused) void this.context.suspend();
    else void this.start();
  }

  get level(): number {
    if (!this.analyser || !this.driving) return 0;
    this.analyser.getFloatTimeDomainData(this.samples);
    return Math.sqrt(this.samples.reduce((sum, sample) => sum + sample * sample, 0) / this.samples.length);
  }

  dispose(): void { clearInterval(this.timer); void this.context?.close(); }
}