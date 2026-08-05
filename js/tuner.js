
(function(){
  window.__toneType = window.__toneType || 'piano';
  var toneTypeSelect = document.getElementById('toneTypeSelect');
  toneTypeSelect.value = window.__toneType;
  toneTypeSelect.addEventListener('change', function(){
    window.__toneType = toneTypeSelect.value;
    var leadToneSelectEl = document.getElementById('leadToneSelect');
    if (leadToneSelectEl) leadToneSelectEl.value = toneTypeSelect.value;
    window.__toneEngine.ensureInstrumentPreloaded(window.__getSharedToneCtx(), toneTypeSelect.value);
  });

  window.__strumPattern = window.__strumPattern || 'block';
  var strumPatternSelect = document.getElementById('strumPatternSelect');
  strumPatternSelect.value = window.__strumPattern;
  strumPatternSelect.addEventListener('change', function(){
    window.__strumPattern = strumPatternSelect.value;
    if (typeof window.__refreshAllCardPatternRows === 'function') window.__refreshAllCardPatternRows();
  });

  // One shared AudioContext for all short reference/chord tone playback
  // (tuner reference tones, in-tune chime, chart chord playback) instead of
  // each script maintaining its own separate persistent context.
  window.__getSharedToneCtx = function(){
    if(!window.__sharedToneCtx){
      window.__sharedToneCtx = new (window.AudioContext || window.webkitAudioContext)();
    }
    if(window.__sharedToneCtx.state === 'suspended') window.__sharedToneCtx.resume();
    return window.__sharedToneCtx;
  };

  // Master output bus -- every voice connects here instead of straight to
  // ctx.destination. Two stages:
  //   1) a high-pass filter at 42Hz -- below the lowest note this app ever
  //      actually plays (piano samples bottom out at A1/55Hz, guitar's
  //      lowest string is E2/82Hz), so it only removes genuine sub-rumble/
  //      junk, never real musical content. A shelf cut was here originally,
  //      but with the octave-companion doubling removed from chord playback
  //      (that was the real source of excess low-end buildup, not the plain
  //      fundamentals), a surgical HPF below all real content is the more
  //      correct tool than broadly attenuating legitimate bass.
  //   2) a fast, high-ratio compressor acting as a safety limiter, so a
  //      6-note chord (still several simultaneous oscillators/voices) can
  //      never sum past 0dBFS and hard-clip, regardless of how many voices
  //      stack at once.
  // Built once per AudioContext and cached on the context itself.
  window.__getMasterBus = function(ctx){
    if(ctx.__masterBusInput) return ctx.__masterBusInput;
    var hpf = ctx.createBiquadFilter();
    hpf.type = 'highpass';
    hpf.frequency.value = 42;
    hpf.Q.value = 0.707; // standard Butterworth slope, no resonant peak at the cutoff

    // Hard-mute control -- inserted here specifically so a "Stop" action
    // can instantly silence every currently-sounding voice in one place.
    // Clearing a setTimeout only prevents FUTURE notes from being
    // scheduled; it can't retroactively cancel a Web Audio node's own
    // already-baked-in .start()/.stop() times, which is why a chord or
    // lead note could keep ringing for its full duration (up to a whole
    // beat count) after Stop was pressed. Every voice already connects to
    // hpf, so routing hpf through this gain node before the limiter means
    // every existing playback function is silenced by this without any
    // of them needing to change.
    var muteGain = ctx.createGain();
    muteGain.gain.value = 1;

    var limiter = ctx.createDynamicsCompressor();
    limiter.threshold.value = -8;
    limiter.knee.value = 6;
    limiter.ratio.value = 16;   // near-limiter, catches peaks without obviously "pumping" on normal material
    limiter.attack.value = 0.003;
    limiter.release.value = 0.25;

    hpf.connect(muteGain);
    muteGain.connect(limiter);
    limiter.connect(ctx.destination);
    ctx.__masterBusInput = hpf; // everything connects to this node
    ctx.__masterMuteGain = muteGain;
    return hpf;
  };

  // Instantly silences everything currently playing through the master
  // bus, regardless of which function started it (chord, bass, top note,
  // lead pattern, grid lead, drum pattern, metronome -- all of them route
  // through the same chain). A fast ramp rather than an instant jump to
  // avoid an audible click, restored shortly after so the NEXT playback
  // isn't silently muted forever.
  window.__hardStopAllAudio = function(ctx){
    window.__getMasterBus(ctx); // ensures __masterMuteGain exists even if called before any voice has played yet
    var g = ctx.__masterMuteGain;
    if (!g) return;
    var now = ctx.currentTime;
    g.gain.cancelScheduledValues(now);
    g.gain.setValueAtTime(g.gain.value, now); // hold whatever the current value actually is, in case a ramp was already mid-flight
    g.gain.linearRampToValueAtTime(0, now + 0.02);
    g.gain.setValueAtTime(0, now + 0.03);
    g.gain.linearRampToValueAtTime(1, now + 0.06);
  };

  // ============================================================
  // Shared instrument-voice engine -- one implementation used by both this
  // script (tuner reference tones) and the Chart mode module script (chord
  // playback), instead of duplicating piano-sample-loading and synthesis
  // code in two places.
  //
  // Three instrument voices beyond the plain oscillator waveforms:
  //   'piano'  -- real sampled Salamander Grand Piano notes (24 samples,
  //               A/C/D#/F# every octave 1-6), pitch-shifted between
  //               sampled notes via playbackRate -- the standard sparse
  //               multisampling technique.
  //   'rhodes' -- FM synthesis. Real Rhodes tone comes from a struck metal
  //               tine picked up electromagnetically; FM synthesis (one
  //               oscillator modulating another's frequency) is the classic,
  //               well-established way to approximate that bell-like
  //               "bark into a pure tone" character without needing samples.
  //   'organ'  -- additive synthesis, stacking harmonics at fixed amplitude
  //               ratios with a fast on/off envelope, matching a real
  //               organ's sustained (not decaying) character.
  // ============================================================
  window.__toneEngine = (function(){
    var PIANO_NOTE_NAMES = [];
    ['A','C','D#','F#'].forEach(function(base){
      for(var oct=1; oct<=6; oct++) PIANO_NOTE_NAMES.push(base + oct);
    });
    var NOTE_SEMITONE = {'C':-9,'C#':-8,'D':-7,'D#':-6,'E':-5,'F':-4,'F#':-3,'G':-2,'G#':-1,'A':0,'A#':1,'B':2};
    function noteNameToFreq(name){
      // parse e.g. "D#4" -> base "D#", octave 4
      var m = name.match(/^([A-G]#?)(\d)$/);
      var base = m[1], octave = parseInt(m[2], 10);
      var semitoneFromA4 = NOTE_SEMITONE[base] + (octave - 4) * 12;
      return 440 * Math.pow(2, semitoneFromA4 / 12);
    }
    var PIANO_FREQS = {};
    PIANO_NOTE_NAMES.forEach(function(n){ PIANO_FREQS[n] = noteNameToFreq(n); });

    // Acoustic bass samples -- single recording per instrument, pitch-
    // shifted across the whole range via playbackRate, same technique as
    // the piano system above just simplified to one sample instead of a
    // per-note collection. rootFreq is the actual pitch of the recorded
    // sample (verified against the source files' own note naming, not
    // guessed): E1 for the electric bass (Yamaha RBX low string,
    // MIDI 28 in the source SFZ), C1 for the double bass (pizzicato,
    // named directly in the source filename).
    var BASS_SAMPLES = {
      electricbass: { file: 'electricBass.wav', rootFreq: noteNameToFreq('E1') },
      doublebass: { file: 'doubleBass.wav', rootFreq: noteNameToFreq('C1') },
    };
    var bassBuffers = {};
    var bassLoadPromises = {};
    function ensureBassSampleLoaded(ctx, type){
      var info = BASS_SAMPLES[type];
      if(!info) return Promise.resolve();
      if(bassLoadPromises[type]) return bassLoadPromises[type];
      bassLoadPromises[type] = fetch('./audio/bass/' + info.file)
        .then(function(r){ return r.arrayBuffer(); })
        .then(function(buf){ return ctx.decodeAudioData(buf); })
        .then(function(audioBuffer){ bassBuffers[type] = audioBuffer; })
        .catch(function(err){ console.error('Failed to load bass sample', type, err); });
      return bassLoadPromises[type];
    }
    function playAcousticBassNote(ctx, type, freq, startAt, gain, duration){
      var buffer = bassBuffers[type];
      if(!buffer) return; // not loaded yet -- caller is expected to await ensureBassSampleLoaded first
      var info = BASS_SAMPLES[type];
      var src = ctx.createBufferSource();
      src.buffer = buffer;
      src.playbackRate.value = freq / info.rootFreq;
      var g = ctx.createGain();
      g.gain.setValueAtTime(0, startAt);
      g.gain.linearRampToValueAtTime(gain, startAt + 0.008);
      g.gain.setValueAtTime(gain, startAt + Math.max(0.05, duration - 0.15));
      g.gain.linearRampToValueAtTime(0, startAt + duration);
      src.connect(g); g.connect(window.__getMasterBus(ctx));
      src.start(startAt);
      src.stop(startAt + duration + 0.05);
    }

    var pianoBuffers = {};
    var pianoLoadPromise = null;
    function ensurePianoLoaded(ctx){
      if(pianoLoadPromise) return pianoLoadPromise;
      pianoLoadPromise = Promise.all(PIANO_NOTE_NAMES.map(function(n){
        // File names on disk use 's' for sharp instead of a literal '#' --
        // GitHub Pages tolerated '#' in filenames, but Netlify (and some
        // other static hosts) reject it outright, so the files were renamed
        // to avoid the problem rather than working around it per-host.
        var fileName = n.replace('#', 's') + 'v8.mp3';
        return fetch('./audio/piano/' + fileName)
          .then(function(r){ return r.arrayBuffer(); })
          .then(function(buf){ return ctx.decodeAudioData(buf); })
          .then(function(audioBuffer){ pianoBuffers[n] = audioBuffer; })
          .catch(function(err){ console.error('Failed to load piano sample', n, err); });
      }));
      return pianoLoadPromise;
    }
    function nearestPianoSample(freq){
      var best = null, bestDiff = Infinity;
      PIANO_NOTE_NAMES.forEach(function(n){
        var diff = Math.abs(Math.log2(freq / PIANO_FREQS[n]));
        if(diff < bestDiff){ bestDiff = diff; best = n; }
      });
      return best;
    }

    function playPianoNote(ctx, freq, startAt, gain, duration){
      var nearest = nearestPianoSample(freq);
      var buffer = pianoBuffers[nearest];
      if(!buffer) return; // not loaded yet -- caller is expected to await ensurePianoLoaded first
      var src = ctx.createBufferSource();
      src.buffer = buffer;
      src.playbackRate.value = freq / PIANO_FREQS[nearest];
      var g = ctx.createGain();
      g.gain.setValueAtTime(0, startAt);
      g.gain.linearRampToValueAtTime(gain, startAt + 0.008);
      g.gain.setValueAtTime(gain, startAt + Math.max(0.05, duration - 0.15));
      g.gain.linearRampToValueAtTime(0, startAt + duration);
      src.connect(g); g.connect(window.__getMasterBus(ctx));
      src.start(startAt);
      src.stop(startAt + duration + 0.05);
    }

    function playRhodesNote(ctx, freq, startAt, gain, duration){
      var modRatio = 1.4; // slightly inharmonic ratio -- part of what gives FM electric piano its bell-like character
      var carrier = ctx.createOscillator();
      carrier.type = 'sine'; carrier.frequency.value = freq;
      var modulator = ctx.createOscillator();
      modulator.type = 'sine'; modulator.frequency.value = freq * modRatio;
      var modGain = ctx.createGain(); // controls modulation depth over time
      // Both ramp points below are PROPORTIONAL to the actual note duration
      // (capped at a sensible maximum), not fixed wall-clock times. The
      // previous fixed-time version scheduled its "bark decay finishes"
      // point at a hardcoded 0.35s -- for any note shorter than that (very
      // reachable: a fast tempo with a short beat count, or especially the
      // bass-note preview path, which passes duration through with no
      // floor at all), the FINAL ramp-to-zero would need to end BEFORE that
      // point already happened, an invalid backwards time schedule. Browsers
      // handle that inconsistently, and it's the likely source of the
      // "static -- almost like a faint replay of the arp" artifact: each
      // arpeggiated note stacks its own copy of this glitch at its own
      // staggered start time, so several of them firing in quick succession
      // sounds like a repeating pattern. Scaling to the real duration makes
      // this mathematically impossible regardless of how short a note is.
      var barkPoint = Math.min(0.35, duration * 0.4);
      // Peak modulation depth -- previously freq*2.2, which pushed the
      // carrier's INSTANTANEOUS frequency negative at every realistic guitar
      // chord pitch (verified: at low E, the swing went as low as -98Hz).
      // Negative frequency isn't invalid, but it means the waveform's phase
      // flips every time the sweep crosses zero, which reads as harsh,
      // static-like noise -- present on every note's attack regardless of
      // duration or arpeggiate state, matching what was actually reported.
      // freq*0.8 keeps the excursion contained (about 9x at peak) while
      // staying comfortably positive across the full guitar range.
      modGain.gain.setValueAtTime(freq * 0.8, startAt);
      modGain.gain.exponentialRampToValueAtTime(Math.max(1, freq * 0.04), startAt + barkPoint);
      modGain.gain.linearRampToValueAtTime(0, startAt + duration);

      modulator.connect(modGain);
      modGain.connect(carrier.frequency);
      var outGain = ctx.createGain();
      var fadeStart = duration * 0.75; // EXPERIMENT: hold at full gain until 75% through the note, then fade to true silence for the remaining 25% -- simpler than the previous partial-sustain-drop, to see if an earlier, cleaner fade resolves the reported static
      outGain.gain.setValueAtTime(0, startAt);
      outGain.gain.linearRampToValueAtTime(gain, startAt + Math.min(0.008, duration * 0.1));
      outGain.gain.setValueAtTime(gain, startAt + fadeStart);
      outGain.gain.linearRampToValueAtTime(0, startAt + duration);
      carrier.connect(outGain); outGain.connect(window.__getMasterBus(ctx));
      modulator.start(startAt); carrier.start(startAt);
      modulator.stop(startAt + duration + 0.05); carrier.stop(startAt + duration + 0.05);
    }

    // Wurly -- same FM technique as Rhodes, but with an integer (harmonic,
    // not inharmonic) modulator ratio. That's the real structural
    // difference behind why a Wurlitzer sounds reedier/more "growly" and a
    // Rhodes sounds more bell-like/glassy -- an integer ratio reinforces
    // the harmonic series instead of adding inharmonic partials.
    function playWurlyNote(ctx, freq, startAt, gain, duration){
      var modRatio = 1; // integer ratio -- reedier, more harmonic than Rhodes' 1.4
      var carrier = ctx.createOscillator();
      carrier.type = 'sine'; carrier.frequency.value = freq;
      var modulator = ctx.createOscillator();
      modulator.type = 'sine'; modulator.frequency.value = freq * modRatio;
      var modGain = ctx.createGain();
      var barkPoint = Math.min(0.22, duration * 0.4); // proportional -- see Rhodes for why (same fix, same reasoning)
      // Same fix as Rhodes -- freq*1.6 pushed the carrier negative at every
      // realistic chord pitch; freq*0.6 stays positive with a ~4x excursion.
      modGain.gain.setValueAtTime(freq * 0.6, startAt);
      modGain.gain.exponentialRampToValueAtTime(Math.max(1, freq * 0.06), startAt + barkPoint); // faster initial "bark" than Rhodes -- more percussive attack
      modGain.gain.linearRampToValueAtTime(0, startAt + duration);
      modulator.connect(modGain);
      modGain.connect(carrier.frequency);
      var outGain = ctx.createGain();
      var fadeStart = duration * 0.75; // EXPERIMENT: same fade-earlier approach as Rhodes
      outGain.gain.setValueAtTime(0, startAt);
      outGain.gain.linearRampToValueAtTime(gain, startAt + Math.min(0.006, duration * 0.1));
      outGain.gain.setValueAtTime(gain, startAt + fadeStart);
      outGain.gain.linearRampToValueAtTime(0, startAt + duration);
      carrier.connect(outGain); outGain.connect(window.__getMasterBus(ctx));
      modulator.start(startAt); carrier.start(startAt);
      modulator.stop(startAt + duration + 0.05); carrier.stop(startAt + duration + 0.05);
    }

    // DX E.Piano -- brighter, glassier FM character using a much higher
    // modulator ratio (the classic DX7-style relationship behind that
    // famous crystalline '80s electric piano sound), with a sharper,
    // shorter initial transient than either Rhodes or Wurly.
    function playDxEpNote(ctx, freq, startAt, gain, duration){
      var modRatio = 14; // high ratio -- produces the bright, bell/glass-like DX7 EP character
      var carrier = ctx.createOscillator();
      carrier.type = 'sine'; carrier.frequency.value = freq;
      var modulator = ctx.createOscillator();
      modulator.type = 'sine'; modulator.frequency.value = freq * modRatio;
      var modGain = ctx.createGain();
      var barkPoint = Math.min(0.15, duration * 0.4); // proportional -- see Rhodes for why (same fix, same reasoning)
      // freq*0.9 didn't actually go negative, but it's still a huge relative
      // swing (~20x the fundamental at peak) -- freq*0.4 keeps the same
      // relative character (still the lowest depth of the three) with a far
      // more contained, less harsh excursion (~2.3x).
      modGain.gain.setValueAtTime(freq * 0.4, startAt); // lower peak depth than Rhodes/Wurly -- high ratios need less depth to sound bright
      modGain.gain.exponentialRampToValueAtTime(Math.max(0.5, freq * 0.015), startAt + barkPoint); // very fast initial transient
      modGain.gain.linearRampToValueAtTime(0, startAt + duration);
      modulator.connect(modGain);
      modGain.connect(carrier.frequency);
      var outGain = ctx.createGain();
      var fadeStart = duration * 0.75; // EXPERIMENT: same fade-earlier approach as Rhodes
      outGain.gain.setValueAtTime(0, startAt);
      outGain.gain.linearRampToValueAtTime(gain, startAt + Math.min(0.004, duration * 0.1));
      outGain.gain.setValueAtTime(gain, startAt + fadeStart);
      outGain.gain.linearRampToValueAtTime(0, startAt + duration);
      carrier.connect(outGain); outGain.connect(window.__getMasterBus(ctx));
      modulator.start(startAt); carrier.start(startAt);
      modulator.stop(startAt + duration + 0.05); carrier.stop(startAt + duration + 0.05);
    }

    // Bright Piano -- the exact same real Salamander recordings as Piano,
    // just routed through a high-shelf boost for a different character.
    // Zero new sample weight; this is a genuinely common technique (many
    // commercial piano libraries offer "bright"/"soft" variants of one
    // underlying sample set through processing, not separate recordings).
    function playBrightPianoNote(ctx, freq, startAt, gain, duration){
      var nearest = nearestPianoSample(freq);
      var buffer = pianoBuffers[nearest];
      if(!buffer) return;
      var src = ctx.createBufferSource();
      src.buffer = buffer;
      src.playbackRate.value = freq / PIANO_FREQS[nearest];
      var brightFilter = ctx.createBiquadFilter();
      brightFilter.type = 'highshelf';
      brightFilter.frequency.value = 2500;
      brightFilter.gain.value = 7; // dB boost above 2.5kHz
      var g = ctx.createGain();
      g.gain.setValueAtTime(0, startAt);
      g.gain.linearRampToValueAtTime(gain, startAt + 0.008);
      g.gain.setValueAtTime(gain, startAt + Math.max(0.05, duration - 0.15));
      g.gain.linearRampToValueAtTime(0, startAt + duration);
      src.connect(brightFilter); brightFilter.connect(g); g.connect(window.__getMasterBus(ctx));
      src.start(startAt);
      src.stop(startAt + duration + 0.05);
    }

    // Toy Piano -- pure synthesis, no real samples at all. High-ratio FM
    // with a very short, plucky envelope for that small bright bell-like
    // character, plus a quiet octave-up layer for extra shimmer.
    function playToyPianoNote(ctx, freq, startAt, gain, duration){
      [1, 2].forEach(function(octaveMult, i){
        var voiceFreq = freq * octaveMult;
        var voiceGain = i === 0 ? gain : gain * 0.25;
        var carrier = ctx.createOscillator();
        carrier.type = 'sine'; carrier.frequency.value = voiceFreq;
        var modulator = ctx.createOscillator();
        modulator.type = 'sine'; modulator.frequency.value = voiceFreq * 3.5;
        var modGain = ctx.createGain();
        modGain.gain.setValueAtTime(voiceFreq * 1.2, startAt);
        modGain.gain.exponentialRampToValueAtTime(Math.max(0.5, voiceFreq * 0.02), startAt + 0.1);
        modulator.connect(modGain);
        modGain.connect(carrier.frequency);
        var outGain = ctx.createGain();
        var noteDur = Math.min(duration, 0.9); // toy piano notes ring out briefly regardless of the requested duration -- it's a small, plucky sound
        outGain.gain.setValueAtTime(0, startAt);
        outGain.gain.linearRampToValueAtTime(voiceGain, startAt + 0.003);
        outGain.gain.exponentialRampToValueAtTime(Math.max(0.001, voiceGain * 0.05), startAt + noteDur);
        carrier.connect(outGain); outGain.connect(window.__getMasterBus(ctx));
        modulator.start(startAt); carrier.start(startAt);
        modulator.stop(startAt + noteDur + 0.05); carrier.stop(startAt + noteDur + 0.05);
      });
    }

    function playOrganNote(ctx, freq, startAt, gain, duration){
      // drawbar-style stacked harmonics, fast percussive-click attack then
      // sustained (real organs don't decay the way a struck/plucked
      // instrument does -- they sustain until released)
      var harmonics = [ {mult:1, amp:0.5}, {mult:2, amp:0.22}, {mult:3, amp:0.14}, {mult:4, amp:0.09} ];
      harmonics.forEach(function(h){
        var osc = ctx.createOscillator();
        osc.type = 'sine'; osc.frequency.value = freq * h.mult;
        var g = ctx.createGain();
        var amp = gain * h.amp;
        g.gain.setValueAtTime(0, startAt);
        g.gain.linearRampToValueAtTime(amp, startAt + 0.015);
        g.gain.setValueAtTime(amp, startAt + Math.max(0.05, duration - 0.08));
        g.gain.linearRampToValueAtTime(0, startAt + duration);
        osc.connect(g); g.connect(window.__getMasterBus(ctx));
        osc.start(startAt); osc.stop(startAt + duration + 0.05);
      });
    }

    // Rock Organ -- same drawbar harmonic stack as Organ, but pushed
    // through a soft-clip distortion stage and a rotary-speaker-style
    // tremolo (amplitude LFO), for the classic overdriven Hammond/Leslie
    // character rather than a clean church-organ tone.
    function makeDistortionCurve(amount){
      var samples = 256, curve = new Float32Array(samples), deg = Math.PI / 180;
      for(var i = 0; i < samples; i++){
        var x = (i * 2) / samples - 1;
        curve[i] = (3 + amount) * x * 20 * deg / (Math.PI + amount * Math.abs(x));
      }
      return curve;
    }
    function playRockOrganNote(ctx, freq, startAt, gain, duration){
      var harmonics = [ {mult:1, amp:0.5}, {mult:2, amp:0.3}, {mult:3, amp:0.22}, {mult:4, amp:0.16} ];
      var shaper = ctx.createWaveShaper();
      shaper.curve = makeDistortionCurve(28);
      shaper.oversample = '2x';
      var tremolo = ctx.createGain();
      var lfo = ctx.createOscillator();
      lfo.type = 'sine'; lfo.frequency.value = 6; // rotary-speaker-ish tremolo rate
      var lfoDepth = ctx.createGain();
      lfoDepth.gain.value = 0.18;
      lfo.connect(lfoDepth);
      lfoDepth.connect(tremolo.gain);
      tremolo.gain.value = 0.82; // base level the LFO modulates around
      lfo.start(startAt); lfo.stop(startAt + duration + 0.05);

      shaper.connect(tremolo);
      tremolo.connect(window.__getMasterBus(ctx));

      harmonics.forEach(function(h){
        var osc = ctx.createOscillator();
        osc.type = 'sine'; osc.frequency.value = freq * h.mult;
        var g = ctx.createGain();
        var amp = gain * h.amp * 0.8; // a bit of headroom before the distortion stage
        g.gain.setValueAtTime(0, startAt);
        g.gain.linearRampToValueAtTime(amp, startAt + 0.015);
        g.gain.setValueAtTime(amp, startAt + Math.max(0.05, duration - 0.08));
        g.gain.linearRampToValueAtTime(0, startAt + duration);
        osc.connect(g); g.connect(shaper);
        osc.start(startAt); osc.stop(startAt + duration + 0.05);
      });
    }

    // Synth Pad -- slow-attack detuned oscillator stack, ambient/dreamy.
    function playSynthPadNote(ctx, freq, startAt, gain, duration){
      var detunes = [-6, 0, 6]; // cents -- subtle chorused width
      detunes.forEach(function(cents){
        var osc = ctx.createOscillator();
        osc.type = 'sawtooth';
        osc.frequency.value = freq * Math.pow(2, cents / 1200);
        var filter = ctx.createBiquadFilter();
        filter.type = 'lowpass';
        filter.frequency.value = freq * 4;
        var g = ctx.createGain();
        var amp = gain * 0.3;
        g.gain.setValueAtTime(0, startAt);
        g.gain.linearRampToValueAtTime(amp, startAt + Math.min(0.5, duration * 0.35)); // slow attack is the whole character here
        g.gain.setValueAtTime(amp, startAt + Math.max(0.05, duration - 0.25));
        g.gain.linearRampToValueAtTime(0, startAt + duration);
        osc.connect(filter); filter.connect(g); g.connect(window.__getMasterBus(ctx));
        osc.start(startAt); osc.stop(startAt + duration + 0.05);
      });
    }

    // Synth Bass -- sub-heavy, punchy, simple waveform for exploring lower
    // voicings specifically.
    // Sub Bass -- pure sine fundamental plus a quiet sub-octave, almost no
    // harmonic content. Clean, deep, disappears into the mix rather than
    // cutting through it -- electronic/modern styles where the bass is
    // meant to be felt more than heard as a distinct timbre.
    function playSubBassNote(ctx, freq, startAt, gain, duration){
      const osc = ctx.createOscillator();
      osc.type = 'sine'; osc.frequency.value = freq;
      const sub = ctx.createOscillator();
      sub.type = 'sine'; sub.frequency.value = freq / 2;
      const g = ctx.createGain();
      g.gain.setValueAtTime(0, startAt);
      g.gain.linearRampToValueAtTime(gain, startAt + 0.015);
      g.gain.setValueAtTime(gain, startAt + Math.max(0.05, duration - 0.1));
      g.gain.linearRampToValueAtTime(0, startAt + duration);
      const subGain = ctx.createGain(); subGain.gain.value = 0.5;
      osc.connect(g);
      sub.connect(subGain); subGain.connect(g);
      g.connect(window.__getMasterBus(ctx));
      osc.start(startAt); osc.stop(startAt + duration + 0.05);
      sub.start(startAt); sub.stop(startAt + duration + 0.05);
    }

    // FM Bass -- a sine carrier frequency-modulated by a second oscillator
    // tuned to the same pitch, producing extra inharmonic overtones a plain
    // waveform can't. More aggressive/metallic edge than Synth Bass or Sub
    // Bass -- suits funk/rock lines that need to cut through a denser mix.
    function playFmBassNote(ctx, freq, startAt, gain, duration){
      const carrier = ctx.createOscillator();
      carrier.type = 'sine'; carrier.frequency.value = freq;
      const modulator = ctx.createOscillator();
      modulator.type = 'sine'; modulator.frequency.value = freq * 1.5; // inharmonic ratio -- the source of the metallic edge
      const modGain = ctx.createGain();
      modGain.gain.setValueAtTime(freq * 3, startAt); // modulation depth starts high (bright attack)...
      modGain.gain.exponentialRampToValueAtTime(Math.max(20, freq * 0.5), startAt + 0.15); // ...and settles into a cleaner sustain, same "punchy attack, simpler sustain" shape Synth Bass already uses
      modulator.connect(modGain); modGain.connect(carrier.frequency);
      const g = ctx.createGain();
      g.gain.setValueAtTime(0, startAt);
      g.gain.linearRampToValueAtTime(gain, startAt + 0.01);
      g.gain.setValueAtTime(gain, startAt + Math.max(0.05, duration - 0.1));
      g.gain.linearRampToValueAtTime(0, startAt + duration);
      carrier.connect(g); g.connect(window.__getMasterBus(ctx));
      modulator.start(startAt); modulator.stop(startAt + duration + 0.05);
      carrier.start(startAt); carrier.stop(startAt + duration + 0.05);
    }

    function playSynthBassNote(ctx, freq, startAt, gain, duration){
      var osc = ctx.createOscillator();
      osc.type = 'triangle'; osc.frequency.value = freq;
      var sub = ctx.createOscillator();
      sub.type = 'sine'; sub.frequency.value = freq / 2; // sub-octave for weight
      var filter = ctx.createBiquadFilter();
      filter.type = 'lowpass';
      filter.frequency.setValueAtTime(freq * 6, startAt);
      filter.frequency.exponentialRampToValueAtTime(Math.max(200, freq * 2), startAt + 0.2); // punchy filter-close envelope
      var g = ctx.createGain();
      g.gain.setValueAtTime(0, startAt);
      g.gain.linearRampToValueAtTime(gain, startAt + 0.008);
      g.gain.setValueAtTime(gain, startAt + Math.max(0.05, duration - 0.1));
      g.gain.linearRampToValueAtTime(0, startAt + duration);
      var subGain = ctx.createGain(); subGain.gain.value = 0.6;
      osc.connect(filter); filter.connect(g);
      sub.connect(subGain); subGain.connect(g);
      g.connect(window.__getMasterBus(ctx));
      osc.start(startAt); osc.stop(startAt + duration + 0.05);
      sub.start(startAt); sub.stop(startAt + duration + 0.05);
    }

    return {
      isInstrument: function(type){
        return type === 'piano' || type === 'rhodes' || type === 'organ' ||
               type === 'wurly' || type === 'dxep' || type === 'brightpiano' ||
               type === 'toypiano' || type === 'rockorgan' || type === 'synthpad' || type === 'synthbass' ||
               type === 'subbass' || type === 'fmbass' || type === 'electricbass' || type === 'doublebass';
      },
      ensurePianoLoaded: ensurePianoLoaded,
      ensureBassSampleLoaded: ensureBassSampleLoaded,
      // Single source of truth for "does selecting this instrument need
      // a real sample loaded before it can actually make sound" --
      // avoids each caller needing its own if/else that has to be kept
      // in sync by hand (which is exactly how Electric Bass/Double Bass
      // ended up silent: the sample-loading half of switching to them
      // only existed in one of three places that needed it).
      ensureInstrumentPreloaded: function(ctx, type){
        if (type === 'piano' || type === 'brightpiano') { ensurePianoLoaded(ctx); return; }
        if (type === 'electricbass' || type === 'doublebass') { ensureBassSampleLoaded(ctx, type); return; }
      },
      playNote: function(ctx, type, freq, startAt, gain, duration){
        if(type === 'piano') playPianoNote(ctx, freq, startAt, gain, duration);
        else if(type === 'rhodes') playRhodesNote(ctx, freq, startAt, gain, duration);
        else if(type === 'organ') playOrganNote(ctx, freq, startAt, gain, duration);
        else if(type === 'wurly') playWurlyNote(ctx, freq, startAt, gain, duration);
        else if(type === 'dxep') playDxEpNote(ctx, freq, startAt, gain, duration);
        else if(type === 'brightpiano') playBrightPianoNote(ctx, freq, startAt, gain, duration);
        else if(type === 'toypiano') playToyPianoNote(ctx, freq, startAt, gain, duration);
        else if(type === 'rockorgan') playRockOrganNote(ctx, freq, startAt, gain, duration);
        else if(type === 'synthpad') playSynthPadNote(ctx, freq, startAt, gain, duration);
        else if(type === 'synthbass') playSynthBassNote(ctx, freq, startAt, gain, duration);
        else if(type === 'subbass') playSubBassNote(ctx, freq, startAt, gain, duration);
        else if(type === 'fmbass') playFmBassNote(ctx, freq, startAt, gain, duration);
        else if(type === 'electricbass' || type === 'doublebass') playAcousticBassNote(ctx, type, freq, startAt, gain, duration);
      }
    };
  })();

  // Pre-warm piano samples immediately if that's the default/saved tone --
  // must come after window.__toneEngine is actually defined above (this used
  // to be attempted earlier in the script, before the engine existed yet,
  // which would have thrown on every page load).
  if (window.__toneType === 'piano' || window.__toneType === 'brightpiano') {
    window.__toneEngine.ensurePianoLoaded(window.__getSharedToneCtx());
  }

  var STRINGS = [
    {note:'E2', freq:82.41, label:'E'},
    {note:'A2', freq:110.00, label:'A'},
    {note:'D3', freq:146.83, label:'D'},
    {note:'G3', freq:196.00, label:'G'},
    {note:'B3', freq:246.94, label:'B'},
    {note:'E4', freq:329.63, label:'E'}
  ];
  var NOTE_NAMES = ['C','C#','D','D#','E','F','F#','G','G#','A','A#','B'];

  var pegsEl = document.getElementById('pegs');
  var ball = document.getElementById('ball');
  var noteNameEl = document.getElementById('noteName');
  var centsEl = document.getElementById('centsReadout');
  var statusDot = document.getElementById('statusDot');
  var statusText = document.getElementById('statusText');
  var micBtn = document.getElementById('micBtn');
  var ticksEl = document.getElementById('ticks');
  var engineNote = document.getElementById('engineNote');
  var targetValueEl = document.getElementById('targetValue');
  var liveValueEl = document.getElementById('liveValue');

  STRINGS.forEach(function(s, idx){
    var el = document.createElement('button');
    el.type = 'button';
    el.className = 'peg';
    el.textContent = s.label;
    el.dataset.idx = idx;
    el.setAttribute('aria-label', s.label + ' string, ' + s.freq.toFixed(2) + ' Hz reference tone');
    el.addEventListener('click', function(){
      playReferenceTone(s.freq, el);
      targetValueEl.textContent = s.label + ' string \u00b7 ' + s.freq.toFixed(2) + ' Hz';
    });
    pegsEl.appendChild(el);
  });
  var pegEls = Array.prototype.slice.call(pegsEl.children);

  for(var c=-50; c<=50; c+=10){
    var tick = document.createElement('span');
    if(c===0) tick.className = 'center';
    ticksEl.appendChild(tick);
  }

  var audioCtx, mediaStream, workletNode, analyser, rafId, silentGain;
  var listening = false;
  var wakeLock = null;

  // small median-of-3 filter to reject single-frame outliers without the lag
  // that exponential smoothing introduces on a continuously moving pitch
  var freqHistory = [];
  var HISTORY_LEN = 3;
  var RESET_JUMP_RATIO = 0.08;
  var justReset = false; // flags when medianFilter cleared history due to a big jump (new string/pluck)

  // YIN's best-known failure mode is octave errors -- briefly reporting double
  // or half the true fundamental when a note's harmonic balance shifts (very
  // common as a held note decays). A raw ~100%/50% jump isn't a new note, but
  // our own 8%-jump reset logic was treating it as one and wiping the whole
  // rolling average from a single bad frame. Correcting it at the source,
  // before it ever reaches the averaging pipeline, is the actual fix -- not
  // another downstream smoothing layer.
  var lastTrueFreq = null;
  function correctOctaveError(freq, reference){
    if(!reference) return freq;
    var ratio = freq / reference;
    if(ratio > 1.85 && ratio < 2.15) return freq / 2;
    if(ratio > 0.465 && ratio < 0.54)  return freq * 2;
    return freq;
  }

  function medianFilter(freq){
    justReset = false;
    if(freqHistory.length > 0){
      var last = freqHistory[freqHistory.length - 1];
      if(Math.abs(freq - last) / last > RESET_JUMP_RATIO){
        freqHistory = [];
        justReset = true;
      }
    }
    freqHistory.push(freq);
    if(freqHistory.length > HISTORY_LEN) freqHistory.shift();
    var sorted = freqHistory.slice().sort(function(a,b){ return a-b; });
    return sorted[Math.floor(sorted.length/2)];
  }

  // Rolling ~500ms average -- this is how a lot of players actually tune: pick
  // continuously and settle on the average pitch rather than reacting to any
  // single pluck. Using this as the "true" value for every decision (zone
  // color, note lock, chime) is what makes the whole thing feel calmer AND
  // matches how the instrument is actually played/tuned.
  var rollingWindow = []; // {t, f} pairs
  var ROLLING_WINDOW_MS = 500;
  function pushRolling(freq, now){
    if(justReset) rollingWindow = []; // don't average across a string change
    rollingWindow.push({t: now, f: freq});
    while(rollingWindow.length && now - rollingWindow[0].t > ROLLING_WINDOW_MS){
      rollingWindow.shift();
    }
  }
  function rollingAverage(){
    if(!rollingWindow.length) return null;
    var sum = 0;
    for(var i=0;i<rollingWindow.length;i++) sum += rollingWindow[i].f;
    return sum / rollingWindow.length;
  }

  // Visual-only easing for the ball's on-screen position. This is intentionally
  // separate from the pitch math above -- the NUMBER driving tuning decisions
  // (zone/color/note/chime) is exactly as accurate/responsive as before; only
  // the pixel position drawn on screen glides toward it instead of jumping,
  // which is what removes the shakiness without touching accuracy.
  var targetPx = 0;
  var currentPx = 0;
  var VISUAL_EASE = 0.15;
  var visualRafId = null;
  function visualLoop(){
    if(!listening) return;
    currentPx += (targetPx - currentPx) * VISUAL_EASE;
    ball.style.transform = 'translateX(' + currentPx + 'px)';
    visualRafId = requestAnimationFrame(visualLoop);
  }

  var inTuneSince = null;
  var chimeFiredForThisHold = false;
  var HOLD_MS = 2800;       // rest in the green zone for ~2.5-3s before the chime confirms
  var outOfGreenSince = null;
  var GRACE_MS = 250;       // a brief flicker out of the green zone doesn't reset the whole countdown

  // Target readout flashes a quick burst whenever a NEW string is acquired
  // (idle float animation runs continuously via CSS regardless)
  var lastTargetStrIdx = null;
  var pendingTargetSince = null;
  var TARGET_LOCK_MS = 1600; // must have been off the locked target continuously for this long before switching
  var flashTimeoutId = null;
  function flashTarget(){
    targetValueEl.classList.remove('flash');
    void targetValueEl.offsetWidth; // restart the CSS animation even if already mid-flash
    targetValueEl.classList.add('flash');
    if(flashTimeoutId) clearTimeout(flashTimeoutId);
    flashTimeoutId = setTimeout(function(){
      targetValueEl.classList.remove('flash');
    }, 1300);
  }

  // --- tone playback -- delegates to one shared AudioContext (window.__getSharedToneCtx),
  // used by both this script and the Chart mode module script, instead of
  // each maintaining its own separate persistent context for the same job ---
  function getToneCtx(){
    return window.__getSharedToneCtx();
  }
  function playReferenceTone(freq, pegEl){
    var ctx = getToneCtx();
    var now = ctx.currentTime;
    var dur = 1.4;
    var toneType = window.__toneType || 'triangle';

    if(window.__toneEngine.isInstrument(toneType)){
      var playIt = function(){
        window.__toneEngine.playNote(ctx, toneType, freq, ctx.currentTime, 0.55, dur);
      };
      if(toneType === 'piano' || toneType === 'brightpiano'){
        window.__toneEngine.ensurePianoLoaded(ctx).then(playIt);
      } else {
        playIt();
      }
    } else {
      // The lower the string, the harder a phone speaker struggles with the
      // fundamental -- so scale how present the octave-up companion tone is
      // based on how low this particular string sits. E2/A2/D3 get a much
      // stronger octave blend; G3/B3/E4 are already audible on their own.
      var octaveGain;
      if(freq < 100) octaveGain = 0.42;       // E2
      else if(freq < 130) octaveGain = 0.36;  // A2
      else if(freq < 170) octaveGain = 0.28;  // D3
      else octaveGain = 0.14;                 // G3, B3, E4

      var osc = ctx.createOscillator();
      var gain = ctx.createGain();
      osc.type = toneType;
      osc.frequency.value = freq;
      gain.gain.setValueAtTime(0, now);
      gain.gain.linearRampToValueAtTime(0.5, now + 0.04);
      gain.gain.linearRampToValueAtTime(0.5, now + dur - 0.15);
      gain.gain.linearRampToValueAtTime(0, now + dur);
      osc.connect(gain); gain.connect(window.__getMasterBus(ctx));
      osc.start(now); osc.stop(now + dur + 0.05);

      var osc2 = ctx.createOscillator();
      var gain2 = ctx.createGain();
      osc2.type = toneType;
      osc2.frequency.value = freq * 2;
      gain2.gain.setValueAtTime(0, now);
      gain2.gain.linearRampToValueAtTime(octaveGain, now + 0.04);
      gain2.gain.linearRampToValueAtTime(octaveGain, now + dur - 0.15);
      gain2.gain.linearRampToValueAtTime(0, now + dur);
      osc2.connect(gain2); gain2.connect(window.__getMasterBus(ctx));
      osc2.start(now); osc2.stop(now + dur + 0.05);
    }

    if(pegEl){
      pegEl.classList.add('playing');
      setTimeout(function(){ pegEl.classList.remove('playing'); }, dur*1000);
    }
  }
  function playInTuneChime(){
    var ctx = getToneCtx();
    var osc = ctx.createOscillator();
    var gain = ctx.createGain();
    osc.type = 'triangle';
    osc.frequency.value = 1046.5;
    var now = ctx.currentTime;
    gain.gain.setValueAtTime(0, now);
    gain.gain.linearRampToValueAtTime(0.32, now + 0.02);
    gain.gain.linearRampToValueAtTime(0, now + 0.24);
    osc.connect(gain); gain.connect(window.__getMasterBus(ctx));
    osc.start(now); osc.stop(now + 0.27);
  }

  function freqToNote(freq){
    var midi = 69 + 12 * Math.log2(freq/440);
    var rounded = Math.round(midi);
    var cents = Math.round((midi - rounded) * 100);
    var name = NOTE_NAMES[((rounded % 12)+12)%12];
    return {name:name, cents:cents};
  }
  function closestString(freq){
    var best = null, bestDiff = Infinity;
    STRINGS.forEach(function(s,i){
      var diff = Math.abs(freq - s.freq);
      if(diff < bestDiff){ bestDiff = diff; best = i; }
    });
    return best;
  }
  function getHalfRange(){
    return (ball.parentElement.clientWidth / 2) - 20;
  }

  // Grace period so a brief gap between quick successive plucks (or a noisy
  // pick-attack transient) doesn't flash the display back to "listening..."
  // Only a SUSTAINED silence longer than this actually clears the reading.
  var SILENCE_HOLD_MS = 800;
  var lastValidReadingAt = null;

  function updateDisplay(rawFreq, now){
    if(!rawFreq || rawFreq < 30 || rawFreq > 1200 || !isFinite(rawFreq)){
      if(lastValidReadingAt !== null && (now - lastValidReadingAt) < SILENCE_HOLD_MS){
        return; // keep showing the last good reading through this brief gap
      }
      // "Listening" itself lives only in the status-row below the button now --
      // this readout just clears back to placeholders, no duplicate wording.
      centsEl.textContent = 'play a string to begin';
      liveValueEl.textContent = '\u2013';
      freqHistory = [];
      rollingWindow = [];
      inTuneSince = null;
      chimeFiredForThisHold = false;
      outOfGreenSince = null;
      lastValidReadingAt = null;
      lastTargetStrIdx = null;
      pendingTargetSince = null;
      lastTrueFreq = null;
      return;
    }
    lastValidReadingAt = now;

    var correctedFreq = correctOctaveError(rawFreq, lastTrueFreq);
    var medianFreq = medianFilter(correctedFreq);
    pushRolling(medianFreq, now);
    var trueFreq = rollingAverage();
    if(trueFreq === null) return;
    lastTrueFreq = trueFreq;

    var r = freqToNote(trueFreq);
    var name = r.name, cents = r.cents;
    var strIdx = closestString(trueFreq);
    var absCents = Math.abs(cents);

    pegEls.forEach(function(p,i){
      p.classList.toggle('active', i===strIdx && absCents < 40);
      p.classList.toggle('locked', i===strIdx && absCents <= 5);
    });

    var zone = 'red';
    if(absCents <= 5) zone = 'green';
    else if(absCents <= 20) zone = 'yellow';

    if(strIdx !== null){
      if(strIdx === lastTargetStrIdx){
        pendingTargetSince = null; // back on the locked target -- cancel any pending switch
      } else {
        if(pendingTargetSince === null) pendingTargetSince = now; // just moved off the locked target -- start the clock
        if(now - pendingTargetSince >= TARGET_LOCK_MS){
          lastTargetStrIdx = strIdx; // been off the old target long enough -- commit to whatever we're reading now
          targetValueEl.textContent = STRINGS[strIdx].label + ' string \u00b7 ' + STRINGS[strIdx].freq.toFixed(2) + ' Hz';
          flashTarget();
          pendingTargetSince = null;
        }
      }
    }
    liveValueEl.textContent = trueFreq.toFixed(2) + ' Hz';

    ball.classList.remove('zone-yellow','zone-green');
    if(zone==='yellow') ball.classList.add('zone-yellow');
    if(zone==='green') ball.classList.add('zone-green');
    noteNameEl.classList.toggle('zone-green', zone==='green');

    // hold-timer with a short grace period: a brief blip out of the green zone
    // doesn't reset the whole 2.5-3s countdown, only a SUSTAINED exit does
    if(zone === 'green'){
      outOfGreenSince = null;
      if(inTuneSince === null){
        inTuneSince = now; chimeFiredForThisHold = false;
      } else if(!chimeFiredForThisHold && (now - inTuneSince) >= HOLD_MS){
        playInTuneChime(); chimeFiredForThisHold = true;
      }
    } else {
      if(outOfGreenSince === null) outOfGreenSince = now;
      if(now - outOfGreenSince > GRACE_MS){
        inTuneSince = null; chimeFiredForThisHold = false; outOfGreenSince = null;
      }
      // else: still within grace period, keep inTuneSince running
    }

    var clamped = Math.max(-50, Math.min(50, cents));
    targetPx = (clamped/50) * getHalfRange(); // visualLoop eases currentPx toward this every frame

    noteNameEl.textContent = name;
    centsEl.textContent = (cents>0?'+':'') + cents + ' cents';
  }

  function requestWakeLock(){
    if('wakeLock' in navigator){
      navigator.wakeLock.request('screen').then(function(lock){ wakeLock = lock; }).catch(function(){});
    }
  }
  function releaseWakeLock(){
    if(wakeLock){ wakeLock.release().catch(function(){}); wakeLock = null; }
  }
  document.addEventListener('visibilitychange', function(){
    if(document.visibilityState === 'hidden'){
      if(listening) stopListening();
    } else if(document.visibilityState === 'visible'){
      if(listening) requestWakeLock();
    }
  });

  // ============================================================
  // AudioWorklet-based YIN pitch detector -- runs on the browser's
  // dedicated real-time audio thread, completely separate from the
  // main UI thread. This is what fixes the "gets stuck" problem:
  // main-thread work (rendering, GC, etc.) can no longer stall
  // pitch detection, because detection isn't happening there anymore.
  // ============================================================
  var WORKLET_SRC = [
    "class PitchProcessor extends AudioWorkletProcessor {",
    "  constructor(){",
    "    super();",
    "    this.bufferSize = 2048;",
    "    this.ring = new Float32Array(this.bufferSize);",
    "    this.writeIdx = 0;",
    "    this.filled = 0;",
    "    this.samplesSinceRun = 0;",
    "    this.hop = 1024;", // run detection roughly every 1024 new samples
    "    this.minFreq = 70;",
    "    this.maxFreq = 450;",
    "  }",
    "  yinDetect(buf, sampleRate){",
    "    var n = buf.length;",
    "    var tauMax = Math.min(Math.ceil(sampleRate / this.minFreq), Math.floor(n/2) - 1);",
    "    var tauMin = Math.max(2, Math.floor(sampleRate / this.maxFreq));",
    "    if(tauMax <= tauMin) return -1;",
    "    var corrLen = n - tauMax;",
    "    if(corrLen < 32) return -1;",
    "    var rms = 0;",
    "    for(var i=0;i<corrLen;i++){ rms += buf[i]*buf[i]; }",
    "    rms = Math.sqrt(rms/corrLen);",
    "    if(rms < 0.006) return -1;",
    "    var d = new Float32Array(tauMax+1);",
    "    var runningSum = 0;",
    "    d[0] = 1;",
    "    for(var tau=1; tau<=tauMax; tau++){",
    "      var sum = 0;",
    "      for(var j=0; j<corrLen; j++){",
    "        var delta = buf[j] - buf[j+tau];",
    "        sum += delta*delta;",
    "      }",
    "      runningSum += sum;",
    "      d[tau] = (runningSum === 0) ? 1 : sum * tau / runningSum;",
    "    }",
    "    var threshold = 0.15;",
    "    var tau = tauMin;",
    "    var found = -1;",
    "    while(tau <= tauMax){",
    "      if(d[tau] < threshold){",
    "        while(tau+1 <= tauMax && d[tau+1] < d[tau]) tau++;",
    "        found = tau;",
    "        break;",
    "      }",
    "      tau++;",
    "    }",
    "    if(found === -1) return -1;",
    "    var x0 = (found > 1) ? d[found-1] : d[found];",
    "    var x1 = d[found];",
    "    var x2 = (found+1 <= tauMax) ? d[found+1] : d[found];",
    "    var a = (x0 + x2 - 2*x1) / 2;",
    "    var b = (x2 - x0) / 2;",
    "    var betterTau = found;",
    "    if(a !== 0) betterTau = found - b/(2*a);",
    "    if(betterTau <= 0) return -1;",
    "    return sampleRate / betterTau;",
    "  }",
    "  process(inputs){",
    "    var input = inputs[0];",
    "    if(!input || !input[0]) return true;",
    "    var chunk = input[0];",
    "    for(var i=0;i<chunk.length;i++){",
    "      this.ring[this.writeIdx] = chunk[i];",
    "      this.writeIdx = (this.writeIdx + 1) % this.bufferSize;",
    "      if(this.filled < this.bufferSize) this.filled++;",
    "    }",
    "    this.samplesSinceRun += chunk.length;",
    "    if(this.filled >= this.bufferSize && this.samplesSinceRun >= this.hop){",
    "      this.samplesSinceRun = 0;",
    "      var ordered = new Float32Array(this.bufferSize);",
    "      for(var k=0;k<this.bufferSize;k++){",
    "        ordered[k] = this.ring[(this.writeIdx + k) % this.bufferSize];",
    "      }",
    "      var freq = this.yinDetect(ordered, sampleRate);",
    "      this.port.postMessage(freq);",
    "    }",
    "    return true;",
    "  }",
    "}",
    "registerProcessor('pitch-processor', PitchProcessor);"
  ].join("\\n");

  function startWithWorklet(inputNode){
    return audioCtx.audioWorklet.addModule(
      URL.createObjectURL(new Blob([WORKLET_SRC], {type:'application/javascript'}))
    ).then(function(){
      workletNode = new AudioWorkletNode(audioCtx, 'pitch-processor');
      workletNode.port.onmessage = function(e){
        updateDisplay(e.data, performance.now());
      };
      // keep the node "live" in the graph (required for process() to keep firing)
      // without producing any audible output
      silentGain = audioCtx.createGain();
      silentGain.gain.value = 0;
      inputNode.connect(workletNode);
      workletNode.connect(silentGain);
      silentGain.connect(audioCtx.destination);
    });
  }

  // --- fallback path for browsers without AudioWorklet support: same idea,
  // polled via rAF on the main thread. Kept as a safety net only. ---
  function startWithFallback(inputNode){
    analyser = audioCtx.createAnalyser();
    analyser.fftSize = 2048;
    inputNode.connect(analyser);
    var buf = new Float32Array(analyser.fftSize);
    var lastDetectTime = 0;
    var DETECT_INTERVAL = 20;

    function autoCorrelate(b, sampleRate){
      var SIZE = b.length;
      var rms = 0;
      for(var i=0;i<SIZE;i+=2){ rms += b[i]*b[i]; }
      rms = Math.sqrt(rms/(SIZE/2));
      if(rms < 0.01) return -1;
      var minLag = Math.max(2, Math.floor(sampleRate/450));
      var maxLag = Math.min(SIZE-2, Math.ceil(sampleRate/70));
      if(maxLag <= minLag) return -1;
      var corrLen = Math.min(SIZE-maxLag, 1200);
      var bestLag=-1, bestCorr=-Infinity;
      var corrs = new Float32Array(maxLag-minLag+1);
      for(var lag=minLag; lag<=maxLag; lag++){
        var sum=0;
        for(var j=0;j<corrLen;j+=2){ sum += b[j]*b[j+lag]; }
        corrs[lag-minLag]=sum;
        if(sum>bestCorr){ bestCorr=sum; bestLag=lag; }
      }
      if(bestLag<0) return -1;
      var idx=bestLag-minLag;
      var x1=corrs[idx-1]||bestCorr, x2=corrs[idx], x3=corrs[idx+1]||bestCorr;
      var a=(x1+x3-2*x2)/2, bb=(x3-x1)/2;
      var shift = a ? -bb/(2*a) : 0;
      var T0 = bestLag+shift;
      return T0<=0 ? -1 : sampleRate/T0;
    }
    function loop(ts){
      if(!listening) return;
      if(ts - lastDetectTime >= DETECT_INTERVAL){
        lastDetectTime = ts;
        analyser.getFloatTimeDomainData(buf);
        updateDisplay(autoCorrelate(buf, audioCtx.sampleRate), ts);
      }
      rafId = requestAnimationFrame(loop);
    }
    rafId = requestAnimationFrame(loop);
  }

  // Boost the captured signal before it reaches analysis, since Web Audio has
  // no direct hardware mic-gain control -- a GainNode on the analysis path is
  // the practical equivalent. ~9dB by default; raise INPUT_BOOST_DB if quiet
  // plucks still aren't registering, but watch for distortion if pushed too far.
  var INPUT_BOOST_DB = 9;
  var INPUT_BOOST_FACTOR = Math.pow(10, INPUT_BOOST_DB / 20);
  var inputSource, inputGain;

  function startListening(){
    navigator.mediaDevices.getUserMedia({ audio: {
      echoCancellation:false, noiseSuppression:false, autoGainControl:false
    }}).then(function(stream){
      mediaStream = stream;
      audioCtx = new (window.AudioContext || window.webkitAudioContext)();
      return audioCtx.resume();
    }).then(function(){
      listening = true;
      freqHistory = [];
      rollingWindow = [];
      inTuneSince = null;
      chimeFiredForThisHold = false;
      outOfGreenSince = null;
      lastValidReadingAt = null;
      lastTargetStrIdx = null;
      pendingTargetSince = null;
      lastTrueFreq = null;
      targetPx = 0;
      currentPx = 0;
      statusDot.classList.add('live');
      statusText.textContent = 'listening';
      micBtn.classList.add('listening');
      micBtn.querySelector('span').textContent = 'Stop Tuning';
      requestWakeLock();

      inputSource = audioCtx.createMediaStreamSource(mediaStream);
      inputGain = audioCtx.createGain();
      inputGain.gain.value = INPUT_BOOST_FACTOR;
      inputSource.connect(inputGain);

      visualRafId = requestAnimationFrame(visualLoop);

      if(audioCtx.audioWorklet){
        startWithWorklet(inputGain).then(function(){
          engineNote.textContent = 'engine: audio-thread (YIN)';
        }).catch(function(err){
          engineNote.textContent = 'engine: fallback';
          startWithFallback(inputGain);
        });
      } else {
        engineNote.textContent = 'engine: fallback';
        startWithFallback(inputGain);
      }
    }).catch(function(){
      statusText.textContent = 'mic permission denied';
    });
  }

  function stopListening(){
    listening = false;
    if(rafId) cancelAnimationFrame(rafId);
    if(visualRafId) cancelAnimationFrame(visualRafId);
    if(workletNode){ try{ workletNode.disconnect(); }catch(e){} workletNode = null; }
    if(silentGain){ try{ silentGain.disconnect(); }catch(e){} silentGain = null; }
    if(analyser){ try{ analyser.disconnect(); }catch(e){} analyser = null; }
    if(inputGain){ try{ inputGain.disconnect(); }catch(e){} inputGain = null; }
    if(inputSource){ try{ inputSource.disconnect(); }catch(e){} inputSource = null; }
    if(mediaStream) mediaStream.getTracks().forEach(function(t){ t.stop(); });
    if(audioCtx) audioCtx.close();
    releaseWakeLock();
    freqHistory = [];
    rollingWindow = [];
    inTuneSince = null;
    chimeFiredForThisHold = false;
    outOfGreenSince = null;
    lastValidReadingAt = null;
    lastTargetStrIdx = null;
    pendingTargetSince = null;
    lastTrueFreq = null;
    if(flashTimeoutId){ clearTimeout(flashTimeoutId); flashTimeoutId = null; }
    targetValueEl.classList.remove('flash');
    targetPx = 0;
    currentPx = 0;
    statusDot.classList.remove('live');
    statusText.textContent = 'microphone off';
    micBtn.classList.remove('listening');
    micBtn.querySelector('span').textContent = 'Start Tuning';
    engineNote.textContent = '';
    noteNameEl.textContent = '-';
    noteNameEl.classList.remove('zone-green');
    centsEl.textContent = 'play a string to begin';
    targetValueEl.textContent = '\u2013';
    liveValueEl.textContent = '\u2013';
    ball.style.transform = 'translateX(0px)';
    ball.classList.remove('zone-yellow','zone-green');
    pegEls.forEach(function(p){ p.classList.remove('active'); p.classList.remove('locked'); });
  }

  micBtn.addEventListener('click', function(){
    if(listening) stopListening(); else startListening();
  });

  // Bridge for the mode toggle and keyboard shortcuts (a separate module
  // script) to control the tuner without a larger refactor.
  window.__tunerStop = function(){ if(listening) stopListening(); };
  window.__tunerToggle = function(){ if(listening) stopListening(); else startListening(); };
  window.__playPegByIndex = function(i){ if(pegEls[i]) pegEls[i].click(); };
  window.__cycleToneType = function(){
    var opts = toneTypeSelect.options;
    toneTypeSelect.selectedIndex = (toneTypeSelect.selectedIndex + 1) % opts.length;
    window.__toneType = toneTypeSelect.value;
    window.__toneEngine.ensureInstrumentPreloaded(window.__getSharedToneCtx(), toneTypeSelect.value);
  };
})();
