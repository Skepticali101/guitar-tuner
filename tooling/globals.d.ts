// Ambient declarations for FTR's own custom window properties and one
// legacy vendor-prefixed API. Not shipped with the site -- dev-only,
// makes checkJs runs report genuinely new issues instead of the same
// expected noise every time. Left loosely typed (`any`/`unknown`)
// deliberately -- the goal is silencing known-safe patterns, not
// retrofitting full type safety onto an otherwise untyped codebase.
export {};

declare global {
  interface Window {
    __toneType?: string;
    __toneEngine?: any;
    __strumPattern?: string;
    __sharedToneCtx?: AudioContext;
    __getSharedToneCtx?: () => AudioContext;
    __getMasterBus?: (ctx: AudioContext) => AudioNode;
    __hardStopAllAudio?: (ctx: AudioContext) => void;
    __tunerStop?: () => void;
    __tunerToggle?: () => void;
    __playPegByIndex?: (idx: number) => void;
    __cycleToneType?: () => void;
    webkitAudioContext?: typeof AudioContext;
  }
  interface AudioContext {
    // cached on the context itself so the master bus / hard-stop mute
    // gain are built once per context and reused, not rebuilt per voice
    __masterBusInput?: AudioNode;
    __masterMuteGain?: GainNode;
  }
}
