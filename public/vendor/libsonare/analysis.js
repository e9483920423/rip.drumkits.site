// src/lifetime.ts
var symbolCtor = Symbol;
symbolCtor.dispose ?? (symbolCtor.dispose = /* @__PURE__ */ Symbol.for("Symbol.dispose"));

// src/abi.ts
var EXPECTED_ABI_VERSION = 84083207;

// src/errors.ts
var ErrorCode = /* @__PURE__ */ ((ErrorCode2) => {
  ErrorCode2[ErrorCode2["Ok"] = 0] = "Ok";
  ErrorCode2[ErrorCode2["FileNotFound"] = 1] = "FileNotFound";
  ErrorCode2[ErrorCode2["InvalidFormat"] = 2] = "InvalidFormat";
  ErrorCode2[ErrorCode2["DecodeFailed"] = 3] = "DecodeFailed";
  ErrorCode2[ErrorCode2["InvalidParameter"] = 4] = "InvalidParameter";
  ErrorCode2[ErrorCode2["OutOfMemory"] = 5] = "OutOfMemory";
  ErrorCode2[ErrorCode2["NotSupported"] = 6] = "NotSupported";
  ErrorCode2[ErrorCode2["InvalidState"] = 7] = "InvalidState";
  ErrorCode2[ErrorCode2["Cancelled"] = 8] = "Cancelled";
  ErrorCode2[ErrorCode2["EncodeFailed"] = 9] = "EncodeFailed";
  ErrorCode2[ErrorCode2["AbiMismatch"] = 10] = "AbiMismatch";
  ErrorCode2[ErrorCode2["Unknown"] = 99] = "Unknown";
  return ErrorCode2;
})(ErrorCode || {});
var SonareError = class extends Error {
  constructor(code, codeName, message) {
    super(message);
    this.name = "SonareError";
    this.code = code;
    this.codeName = codeName;
  }
  /**
   * Brand-based `instanceof`: an error that carries the shape narrows here even
   * when it is not literally an instance of this class. That is not a
   * hypothetical — an error posted from the analysis worker arrives as a
   * structured clone with its prototype gone, which a prototype-based
   * `instanceof` would silently miss. Delegates to {@link isSonareError} so the
   * two never disagree.
   */
  static [Symbol.hasInstance](value) {
    return isSonareError(value);
  }
};
function isSonareError(value) {
  return value instanceof Error && value.name === "SonareError" && typeof value.code === "number";
}

// src/module_state.ts
var wrappedModule = null;
var EMBIND_DELETED_PATTERN = / instance already deleted$|^Cannot pass deleted object as a pointer of type /;
function nativeExceptionPtr(error) {
  if (typeof error === "number") {
    return error;
  }
  if (error !== null && typeof error === "object") {
    const ptr = error.excPtr;
    if (typeof ptr === "number") {
      return ptr;
    }
  }
  return null;
}
function makeSonareError(raw, thrown) {
  let code = 99 /* Unknown */;
  let codeName = "Unknown";
  let kind;
  let message = `libsonare native exception (${thrown})`;
  try {
    const info = raw.sonareExceptionInfo?.(thrown);
    if (info) {
      code = info.code ?? code;
      codeName = info.codeName ?? codeName;
      message = info.message || message;
      kind = info.kind;
    }
  } catch {
  } finally {
    try {
      raw.sonareReleaseException(thrown);
    } catch {
    }
  }
  if (kind === "TypeError") {
    return new TypeError(message);
  }
  if (kind === "RangeError") {
    return new RangeError(message);
  }
  return new SonareError(code, codeName, message);
}
function wrapModuleErrors(raw) {
  const cache = /* @__PURE__ */ new Map();
  const objectCache = /* @__PURE__ */ new WeakMap();
  const convert = (error) => {
    const ptr = nativeExceptionPtr(error);
    if (ptr !== null) {
      throw makeSonareError(raw, ptr);
    }
    if (error instanceof Error && EMBIND_DELETED_PATTERN.test(error.message)) {
      throw new SonareError(7 /* InvalidState */, "InvalidState", error.message);
    }
    throw error;
  };
  const wrapNativeObject = (value) => {
    if (value === null || typeof value !== "object") {
      return value;
    }
    if (ArrayBuffer.isView(value) || value instanceof ArrayBuffer || value instanceof Promise) {
      return value;
    }
    const proto = Object.getPrototypeOf(value);
    if (Array.isArray(value) || proto === Object.prototype || proto === null) {
      return value;
    }
    const objectValue = value;
    const cached = objectCache.get(objectValue);
    if (cached) {
      return cached;
    }
    const methodCache = /* @__PURE__ */ new Map();
    const wrapped = new Proxy(objectValue, {
      get(target, prop, receiver) {
        const member = Reflect.get(target, prop, receiver);
        if (typeof member !== "function") {
          return member;
        }
        const cachedMethod = methodCache.get(prop);
        if (cachedMethod) {
          return cachedMethod;
        }
        const method = member;
        const wrappedMethod = (...args) => {
          try {
            return wrapNativeObject(Reflect.apply(method, target, args));
          } catch (error) {
            return convert(error);
          }
        };
        methodCache.set(prop, wrappedMethod);
        return wrappedMethod;
      }
    });
    objectCache.set(objectValue, wrapped);
    return wrapped;
  };
  const wrapFunction = (value) => {
    const fnCache = /* @__PURE__ */ new Map();
    return new Proxy(value, {
      get(target, prop, receiver) {
        const member = Reflect.get(target, prop, receiver);
        if (typeof member !== "function") {
          return member;
        }
        const cachedMember = fnCache.get(prop);
        if (cachedMember) {
          return cachedMember;
        }
        const fn = member;
        const wrappedMember = (...args) => {
          try {
            return wrapNativeObject(Reflect.apply(fn, target, args));
          } catch (error) {
            return convert(error);
          }
        };
        fnCache.set(prop, wrappedMember);
        return wrappedMember;
      },
      apply(t, thisArg, args) {
        try {
          return wrapNativeObject(Reflect.apply(t, thisArg, args));
        } catch (error) {
          return convert(error);
        }
      },
      construct(t, args, newTarget) {
        try {
          return wrapNativeObject(Reflect.construct(t, args, newTarget));
        } catch (error) {
          return convert(error);
        }
      }
    });
  };
  return new Proxy(raw, {
    get(target, prop, receiver) {
      const value = Reflect.get(target, prop, receiver);
      if (typeof value !== "function") {
        return value;
      }
      const cached = cache.get(prop);
      if (cached) {
        return cached;
      }
      const wrapped = wrapFunction(value);
      cache.set(prop, wrapped);
      return wrapped;
    }
  });
}
function notInitializedError() {
  return new SonareError(
    7 /* InvalidState */,
    "InvalidState",
    "Module not initialized. Call init() first."
  );
}
function hexAbi(version2) {
  return `0x${(version2 >>> 0).toString(16).padStart(8, "0")}`;
}
function assertAbiCompatible(created) {
  const actual = typeof created.abiVersion === "function" ? created.abiVersion() : void 0;
  if (actual === EXPECTED_ABI_VERSION) {
    return;
  }
  throw new SonareError(
    10 /* AbiMismatch */,
    "AbiMismatch",
    `libsonare ABI mismatch: wasm module reports ${actual === void 0 ? "no ABI version" : hexAbi(actual)}, this package expects ${hexAbi(EXPECTED_ABI_VERSION)}. The JS glue and the .wasm binary come from different builds; check the wasmBinary, locateFile and moduleFactory options and any cached copy of sonare.wasm.`
  );
}
function assertSameInitOptions(first, next) {
  if (next === void 0) {
    return;
  }
  const a = first ?? {};
  const b = next;
  const keys = /* @__PURE__ */ new Set([...Object.keys(a), ...Object.keys(b)]);
  for (const key of keys) {
    if (a[key] !== b[key]) {
      throw new SonareError(
        7 /* InvalidState */,
        "InvalidState",
        `init() options differ from the first call (${key}); options apply on the first call only.`
      );
    }
  }
}
function setSonareModule(module2) {
  wrappedModule = wrapModuleErrors(module2);
}
function getSonareModule() {
  if (!wrappedModule) {
    throw notInitializedError();
  }
  return wrappedModule;
}

// src/request_keys.ts
var keysOf = () => (keys) => keys;
var AlignTakeToReferenceRequestKeys = keysOf()([
  "reference",
  "take",
  "sampleRate",
  "takeSampleRate",
  "hopLength",
  "binsPerOctave"
]);
var DbConversionRequestKeys = keysOf()(["values", "ref", "amin", "topDb"]);
var FramesToTimeRequestKeys = keysOf()(["frames", "sr", "hopLength"]);
var TimeToFramesRequestKeys = keysOf()(["time", "sr", "hopLength"]);
var FramesToSamplesRequestKeys = keysOf()([
  "frames",
  "hopLength",
  "nFft"
]);
var SamplesToFramesRequestKeys = keysOf()([
  "samples",
  "hopLength",
  "nFft"
]);
var MusicAnalyzeRequestKeys = keysOf()([
  "samples",
  "sampleRate",
  "validate",
  "nFft",
  "hopLength",
  "bpmMin",
  "bpmMax",
  "startBpm",
  "useTriadsOnly",
  "useHpss",
  "chromaHighpassHz",
  "useBassWeighted",
  "chromaHopMultiplier",
  "useChordHmm",
  "useChordKeyContext",
  "chordHmmBeamWidth",
  "detectChordInversions",
  "adaptiveTempo",
  "tempoUpdateIntervalBeats",
  "computeTempoCurve",
  "meterCandidateNumerators",
  "meterDenominator",
  "tuning"
]);
var AnalyzeBpmRequestKeys = keysOf()([
  "bpmMin",
  "bpmMax",
  "startBpm",
  "nFft",
  "hopLength",
  "maxCandidates",
  "validate",
  "samples",
  "sampleRate"
]);
var AnalyzeDynamicsRequestKeys = keysOf()([
  "windowSec",
  "hopLength",
  "compressionThreshold",
  "validate",
  "samples",
  "sampleRate"
]);
var AnalyzeImpulseResponseRequestKeys = keysOf()([
  "nOctaveBands",
  "minDecayDb",
  "samples",
  "sampleRate",
  "validate"
]);
var AnalyzeMelodyRequestKeys = keysOf()([
  "samples",
  "sampleRate",
  "fmin",
  "fmax",
  "frameLength",
  "hopLength",
  "threshold",
  "usePyin",
  "center",
  "validate"
]);
var AnalyzePolyphonicRequestKeys = keysOf()([
  "samples",
  "sampleRate",
  "nFft",
  "hopLength",
  "winLength",
  "centRefHz",
  "centsPerBin",
  "centMaxHz",
  "tonalityOff",
  "salienceHarmonics",
  "f0MinHz",
  "f0MaxHz",
  "salienceAlphaHz",
  "salienceBetaHz",
  "salienceInharmonicity",
  "maxPolyphony",
  "minFramePeakRatio",
  "minSeparationCents",
  "subtractionFactor",
  "maxJumpCents",
  "minRidgePeakRatio",
  "minRidgeDurationMs",
  "reattackRatio",
  "maskHarmonics",
  "claimLobes",
  "inharmonicity",
  "estimateInharmonicity",
  "inharmonicityMinPartials",
  "inharmonicityMaxResidualBins",
  "inharmonicityMaxStretch",
  "windowFrames",
  "minPartialSeparation",
  "maxFitResidual",
  "maxWeightModulus",
  "maxRefineHz",
  "f0ToleranceCents",
  "segmentationThresholdCents",
  "minNoteMs",
  "referenceHz",
  "validate"
]);
var AnalyzeRhythmRequestKeys = keysOf()([
  "bpmMin",
  "bpmMax",
  "startBpm",
  "nFft",
  "hopLength",
  "validate",
  "samples",
  "sampleRate"
]);
var AnalyzeSectionsRequestKeys = keysOf()([
  "samples",
  "sampleRate",
  "nFft",
  "hopLength",
  "minSectionSec",
  "validate"
]);
var AnalyzeTimbreRequestKeys = keysOf()([
  "nFft",
  "hopLength",
  "nMels",
  "nMfcc",
  "windowSec",
  "validate",
  "samples",
  "sampleRate"
]);
var AnalyzeWithProgressRequestKeys = keysOf()([
  "onProgress",
  "cancel",
  "options",
  "samples",
  "sampleRate",
  "validate",
  "nFft",
  "hopLength",
  "bpmMin",
  "bpmMax",
  "startBpm",
  "useTriadsOnly",
  "useHpss",
  "chromaHighpassHz",
  "useBassWeighted",
  "chromaHopMultiplier",
  "useChordHmm",
  "useChordKeyContext",
  "chordHmmBeamWidth",
  "detectChordInversions",
  "adaptiveTempo",
  "tempoUpdateIntervalBeats",
  "computeTempoCurve",
  "meterCandidateNumerators",
  "meterDenominator",
  "tuning"
]);
var MusicAnalyzeOptionsKeys = keysOf()([
  "nFft",
  "hopLength",
  "bpmMin",
  "bpmMax",
  "startBpm",
  "useTriadsOnly",
  "useHpss",
  "chromaHighpassHz",
  "useBassWeighted",
  "chromaHopMultiplier",
  "useChordHmm",
  "useChordKeyContext",
  "chordHmmBeamWidth",
  "detectChordInversions",
  "adaptiveTempo",
  "tempoUpdateIntervalBeats",
  "computeTempoCurve",
  "meterCandidateNumerators",
  "meterDenominator",
  "tuning"
]);
var AssignNoteTargetsRequestKeys = keysOf()([
  "notes",
  "sampleRate",
  "targets",
  "unmatchedPolicy",
  "minOverlapRatio",
  "maxCorrectionSemitones"
]);
var AutoTuneRequestKeys = keysOf()([
  "samples",
  "sampleRate",
  "key",
  "strength",
  "retuneSpeedMs",
  "vibratoThresholdCents",
  "maxCorrectionSemitones",
  "referenceMidi",
  "validate"
]);
var AutoTuneKeyKeys = keysOf()(["root", "mode"]);
var BassChromaSpectrogramRequestKeys = keysOf()([
  "samples",
  "sampleRate",
  "hopLength",
  "nChroma",
  "validate"
]);
var ChirpRequestKeys = keysOf()([
  "fmin",
  "fmax",
  "sampleRate",
  "duration",
  "linear"
]);
var ChordFunctionalAnalysisRequestKeys = keysOf()([
  "keyRoot",
  "keyMode",
  "minDuration",
  "smoothingWindow",
  "threshold",
  "useTriadsOnly",
  "nFft",
  "hopLength",
  "useBeatSync",
  "useHmm",
  "hmmBeamWidth",
  "useKeyContext",
  "detectInversions",
  "chromaMethod",
  "tuning",
  "validate",
  "samples",
  "sampleRate"
]);
var Anon19Keys = keysOf()(["chords", "key"]);
var SpectrogramRequestKeys = keysOf()([
  "samples",
  "sampleRate",
  "nFft",
  "hopLength",
  "validate"
]);
var ChromaSpectrogramRequestKeys = keysOf()([
  "samples",
  "sampleRate",
  "hopLength",
  "nChroma",
  "binsPerOctave",
  "validate"
]);
var ClicksRequestKeys = keysOf()([
  "times",
  "sampleRate",
  "length",
  "frequency",
  "clickDuration"
]);
var CqtRequestKeys = keysOf()([
  "samples",
  "sampleRate",
  "hopLength",
  "fmin",
  "nBins",
  "binsPerOctave",
  "validate"
]);
var CqtToAudioRequestKeys = keysOf()([
  "magnitude",
  "nBins",
  "nFrames",
  "sampleRate",
  "hopLength",
  "fmin",
  "binsPerOctave",
  "nIter",
  "validate"
]);
var VocalCreateRequestKeys = keysOf()([
  "samples",
  "sampleRate",
  "outputLengthSamples",
  "edgeFadeMs",
  "vibratoCutoffHz",
  "segmentationThresholdCents",
  "minNoteMs",
  "frameLengthSamples",
  "hopLengthSamples",
  "fminHz",
  "fmaxHz",
  "yinThreshold",
  "voicedThreshold",
  "centered",
  "referenceHz",
  "limits",
  "analysis"
]);
var VocalSessionLimitsKeys = keysOf()([
  "maxHistoryBytes",
  "maxCacheBytes",
  "maxUndoDepth",
  "maxRenderJobs"
]);
var VocalAnalysisInputKeys = keysOf()([
  "frameOriginSample",
  "samplesPerFrame",
  "frameLengthSamples",
  "f0Hz",
  "voiced",
  "algorithmId",
  "algorithmVersion",
  "fminHz",
  "fmaxHz",
  "yinThreshold",
  "voicedThreshold",
  "centered",
  "segmentationThresholdCents",
  "minNoteMs",
  "referenceHz"
]);
var CyclicTempogramRequestKeys = keysOf()([
  "onsetEnvelope",
  "sampleRate",
  "hopLength",
  "winLength",
  "bpmMin",
  "nBins"
]);
var DecomposeRequestKeys = keysOf()([
  "s",
  "nFeatures",
  "nFrames",
  "nComponents",
  "nIter",
  "beta"
]);
var DecomposeNotePitchRequestKeys = keysOf()([
  "f0Hz",
  "voiced",
  "frameRate",
  "medianHz",
  "vibratoCutoffHz"
]);
var DecomposeStemsRequestKeys = keysOf()([
  "samples",
  "sampleRate",
  "nComponents",
  "nFft",
  "hopLength",
  "nIter",
  "beta",
  "init",
  "maskPower"
]);
var DecomposeStemsLinkedRequestKeys = keysOf()([
  "channels",
  "sampleRate",
  "nComponents",
  "nFft",
  "hopLength",
  "nIter",
  "beta",
  "init",
  "maskPower"
]);
var DecomposeWithInitRequestKeys = keysOf()([
  "init",
  "s",
  "nFeatures",
  "nFrames",
  "nComponents",
  "nIter",
  "beta"
]);
var EmphasisRequestKeys = keysOf()(["samples", "coef", "zi"]);
var DetectAcousticRequestKeys = keysOf()([
  "nOctaveBands",
  "nThirdOctaveSubbands",
  "minDecayDb",
  "noiseFloorMarginDb",
  "validate",
  "samples",
  "sampleRate"
]);
var SamplesRequestKeys = keysOf()(["samples", "sampleRate", "validate"]);
var DetectBoundariesRequestKeys = keysOf()([
  "samples",
  "sampleRate",
  "nFft",
  "hopLength",
  "kernelSize",
  "threshold",
  "absoluteThreshold",
  "nMfcc",
  "nChroma",
  "peakDistance",
  "referenceWindow",
  "useMfcc",
  "useChroma",
  "validate"
]);
var DetectChordsRequestKeys = keysOf()([
  "minDuration",
  "smoothingWindow",
  "threshold",
  "useTriadsOnly",
  "nFft",
  "hopLength",
  "useBeatSync",
  "useHmm",
  "hmmBeamWidth",
  "useKeyContext",
  "keyRoot",
  "keyMode",
  "detectInversions",
  "chromaMethod",
  "tuning",
  "validate",
  "samples",
  "sampleRate"
]);
var DetectKeyRequestKeys = keysOf()([
  "tuning",
  "nFft",
  "hopLength",
  "useHpss",
  "loudnessWeighted",
  "highPassHz",
  "modes",
  "profile",
  "genreHint",
  "validate",
  "samples",
  "sampleRate"
]);
var DetectKeyCandidatesRequestKeys = keysOf()([
  "nFft",
  "hopLength",
  "useHpss",
  "loudnessWeighted",
  "highPassHz",
  "modes",
  "profile",
  "genreHint",
  "validate",
  "samples",
  "sampleRate"
]);
var DetectOnsetsRequestKeys = keysOf()([
  "samples",
  "sampleRate",
  "validate",
  "nFft",
  "hopLength",
  "threshold",
  "preMax",
  "postMax",
  "preAvg",
  "postAvg",
  "delta",
  "wait",
  "backtrack",
  "backtrackRange"
]);
var Ebur128LoudnessRangeRequestKeys = keysOf()([
  "samples",
  "sampleRate",
  "validate"
]);
var EstimateMeterRequestKeys = keysOf()([
  "beatTimes",
  "beatStrengths",
  "candidateNumerators",
  "denominator",
  "downbeatWeight",
  "measureWeight",
  "subdivisionWeight",
  "compoundSubdivisionThreshold"
]);
var EstimateRoomRequestKeys = keysOf()([
  "aspectHintLw",
  "aspectHintLh",
  "referenceAbsorption",
  "preferEyring",
  "nOctaveBands",
  "mode",
  "minDecayDb",
  "noiseFloorMarginDb",
  "samples",
  "sampleRate",
  "validate"
]);
var EstimateTuningRequestKeys = keysOf()([
  "resolution",
  "binsPerOctave",
  "samples",
  "sampleRate",
  "nFft",
  "hopLength"
]);
var ExtractNotesRequestKeys = keysOf()([
  "samples",
  "sampleRate",
  "f0Hz",
  "frameRate",
  "voiced",
  "voicedProb",
  "segmentationThresholdCents",
  "minNoteMs",
  "referenceHz",
  "voicedThreshold",
  "validate"
]);
var ExtractPercussiveEventsRequestKeys = keysOf()([
  "samples",
  "sampleRate",
  "onsetWait",
  "onsetDelta",
  "maxEventMs",
  "minPercussiveRatio",
  "nFft",
  "hopLength",
  "hpssKernelHarmonic",
  "hpssKernelPercussive",
  "validate"
]);
var FixFramesRequestKeys = keysOf()(["frames", "xMin", "xMax", "pad"]);
var FixLengthRequestKeys = keysOf()(["values", "targetSize", "padValue"]);
var FourierTempogramRequestKeys = keysOf()([
  "onsetEnvelope",
  "sampleRate",
  "hopLength",
  "winLength",
  "center",
  "norm",
  "validate"
]);
var FrameSignalRequestKeys = keysOf()([
  "samples",
  "frameLength",
  "hopLength"
]);
var GriffinLimRequestKeys = keysOf()([
  "magnitude",
  "nBins",
  "nFrames",
  "sampleRate",
  "nFft",
  "hopLength",
  "nIter",
  "momentum",
  "validate"
]);
var HarmonicRequestKeys = keysOf()(["samples", "sampleRate", "validate"]);
var HpssRequestKeys = keysOf()([
  "samples",
  "sampleRate",
  "kernelHarmonic",
  "kernelPercussive",
  "nFft",
  "hopLength",
  "hardMask"
]);
var HpssWithResidualRequestKeys = keysOf()([
  "samples",
  "sampleRate",
  "kernelHarmonic",
  "kernelPercussive",
  "nFft",
  "hopLength",
  "hardMask"
]);
var LufsRequestKeys = keysOf()(["samples", "sampleRate", "validate"]);
var LufsInterleavedRequestKeys = keysOf()([
  "samples",
  "channels",
  "sampleRate",
  "validate"
]);
var LufsSeriesInterleavedRequestKeys = keysOf()([
  "samples",
  "channels",
  "sampleRate",
  "validate"
]);
var MasterAudioRequestKeys = keysOf()([
  "samples",
  "sampleRate",
  "preset",
  "overrides",
  "onProgress",
  "cancel"
]);
var MasteringChainConfigKeys = keysOf()([
  "repair",
  "eq",
  "dynamics",
  "saturation",
  "spectral",
  "stereo",
  "maximizer",
  "loudness"
]);
var MasterAudioStereoRequestKeys = keysOf()([
  "left",
  "right",
  "sampleRate",
  "preset",
  "overrides",
  "onProgress",
  "cancel"
]);
var MasteringRequestKeys = keysOf()([
  "samples",
  "sampleRate",
  "targetLufs",
  "ceilingDb",
  "truePeakOversample",
  "releaseMs",
  "applyGainAtInputRate"
]);
var MasteringAbMatchLoudnessRequestKeys = keysOf()([
  "source",
  "reference",
  "sampleRate",
  "referenceSampleRate"
]);
var MasteringAbMatchLoudnessStereoRequestKeys = keysOf()([
  "sourceLeft",
  "sourceRight",
  "referenceLeft",
  "referenceRight",
  "sampleRate",
  "referenceSampleRate"
]);
var MasteringAssistantParamsRequestKeys = keysOf()([
  "samples",
  "sampleRate",
  "params"
]);
var MasteringAssistantStereoParamsRequestKeys = keysOf()([
  "left",
  "right",
  "sampleRate",
  "params"
]);
var MasteringSamplesParamsRequestKeys = keysOf()([
  "samples",
  "sampleRate",
  "params"
]);
var MasteringStereoParamsRequestKeys = keysOf()([
  "left",
  "right",
  "sampleRate",
  "params"
]);
var MasteringChainRequestKeys = keysOf()([
  "samples",
  "sampleRate",
  "config",
  "onProgress",
  "cancel"
]);
var MasteringChainStereoRequestKeys = keysOf()([
  "left",
  "right",
  "sampleRate",
  "config",
  "onProgress",
  "cancel"
]);
var MasteringDynamicsCompressorRequestKeys = keysOf()([
  "samples",
  "sampleRate",
  "thresholdDb",
  "ratio",
  "attackMs",
  "releaseMs",
  "kneeDb",
  "makeupGainDb",
  "autoMakeup",
  "detector",
  "sidechainHpfEnabled",
  "sidechainHpfHz",
  "pdrTimeMs",
  "pdrReleaseScale",
  "validate"
]);
var MasteringDynamicsGateRequestKeys = keysOf()([
  "samples",
  "sampleRate",
  "thresholdDb",
  "attackMs",
  "releaseMs",
  "rangeDb",
  "holdMs",
  "closeThresholdDb",
  "keyHpfHz",
  "validate"
]);
var MasteringDynamicsTransientShaperRequestKeys = keysOf()([
  "samples",
  "sampleRate",
  "attackGainDb",
  "sustainGainDb",
  "fastAttackMs",
  "fastReleaseMs",
  "slowAttackMs",
  "slowReleaseMs",
  "sensitivity",
  "maxGainDb",
  "gainSmoothingMs",
  "lookaheadMs",
  "validate"
]);
var Anon74Keys = keysOf()([
  "analysisName",
  "source",
  "reference",
  "sampleRate",
  "referenceSampleRate",
  "params"
]);
var MasteringPairProcessRequestKeys = keysOf()([
  "processorName",
  "source",
  "reference",
  "sampleRate",
  "referenceSampleRate",
  "params"
]);
var MasteringPairProcessStereoRequestKeys = keysOf()([
  "processorName",
  "sourceLeft",
  "sourceRight",
  "referenceLeft",
  "referenceRight",
  "sampleRate",
  "referenceSampleRate",
  "params"
]);
var MasteringProcessRequestKeys = keysOf()([
  "processorName",
  "samples",
  "sampleRate",
  "params"
]);
var MasteringProcessStereoRequestKeys = keysOf()([
  "processorName",
  "left",
  "right",
  "sampleRate",
  "params"
]);
var MasteringRepairAnalyzeRequestKeys = keysOf()([
  "channels",
  "sampleRate",
  "preferStreamingSafe"
]);
var MasteringRepairApplyRequestKeys = keysOf()([
  "channels",
  "sampleRate",
  "stages",
  "onProgress",
  "cancel"
]);
var MasteringRepairDeclickRequestKeys = keysOf()([
  "samples",
  "sampleRate",
  "threshold",
  "neighborRatio",
  "maxClickSamples",
  "lpcOrder",
  "residualRatio"
]);
var MasteringRepairDeclickStereoRequestKeys = keysOf()([
  "left",
  "right",
  "sampleRate",
  "threshold",
  "neighborRatio",
  "maxClickSamples",
  "lpcOrder",
  "residualRatio"
]);
var MasteringRepairDeclipRequestKeys = keysOf()([
  "samples",
  "sampleRate",
  "clipThreshold",
  "lpcOrder",
  "iterations",
  "lpcBlend"
]);
var MasteringRepairDeclipStereoRequestKeys = keysOf()([
  "left",
  "right",
  "sampleRate",
  "clipThreshold",
  "lpcOrder",
  "iterations",
  "lpcBlend"
]);
var MasteringRepairDecrackleRequestKeys = keysOf()([
  "samples",
  "sampleRate",
  "threshold",
  "mode",
  "levels"
]);
var MasteringRepairDecrackleStereoRequestKeys = keysOf()([
  "left",
  "right",
  "sampleRate",
  "threshold",
  "mode",
  "levels"
]);
var MasteringRepairDehumRequestKeys = keysOf()([
  "samples",
  "sampleRate",
  "fundamentalHz",
  "harmonics",
  "q",
  "adaptive",
  "searchRangeHz",
  "adaptation",
  "frameSize",
  "pllBandwidth",
  "mode"
]);
var MasteringRepairDehumStereoRequestKeys = keysOf()([
  "left",
  "right",
  "sampleRate",
  "fundamentalHz",
  "harmonics",
  "q",
  "adaptive",
  "searchRangeHz",
  "adaptation",
  "frameSize",
  "pllBandwidth",
  "mode"
]);
var MasteringRepairDenoiseClassicalRequestKeys = keysOf()(
  [
    "samples",
    "sampleRate",
    "mode",
    "noiseEstimator",
    "nFft",
    "hopLength",
    "ddAlpha",
    "reductionDb",
    "overSubtraction",
    "spectralFloor",
    "noiseEstimationQuantile",
    "speechPresenceGain",
    "gainSmoothing"
  ]
);
var MasteringRepairDenoiseClassicalLinkedRequestKeys = keysOf()([
  "channels",
  "sampleRate",
  "mode",
  "noiseEstimator",
  "nFft",
  "hopLength",
  "ddAlpha",
  "reductionDb",
  "overSubtraction",
  "spectralFloor",
  "noiseEstimationQuantile",
  "speechPresenceGain",
  "gainSmoothing"
]);
var MasteringRepairDenoiseClassicalStereoRequestKeys = keysOf()([
  "left",
  "right",
  "sampleRate",
  "mode",
  "noiseEstimator",
  "nFft",
  "hopLength",
  "ddAlpha",
  "reductionDb",
  "overSubtraction",
  "spectralFloor",
  "noiseEstimationQuantile",
  "speechPresenceGain",
  "gainSmoothing"
]);
var MasteringRepairDereverbClassicalRequestKeys = keysOf()([
  "samples",
  "sampleRate",
  "threshold",
  "attenuation",
  "nFft",
  "hopLength",
  "t60Sec",
  "lateDelayMs",
  "overSubtraction",
  "spectralFloor",
  "wpeEnabled",
  "wpeIterations",
  "wpeTaps",
  "wpeStrength"
]);
var MasteringRepairDereverbClassicalLinkedRequestKeys = keysOf()([
  "channels",
  "sampleRate",
  "threshold",
  "attenuation",
  "nFft",
  "hopLength",
  "t60Sec",
  "lateDelayMs",
  "overSubtraction",
  "spectralFloor",
  "wpeEnabled",
  "wpeIterations",
  "wpeTaps",
  "wpeStrength"
]);
var MasteringRepairDereverbClassicalStereoRequestKeys = keysOf()([
  "left",
  "right",
  "sampleRate",
  "threshold",
  "attenuation",
  "nFft",
  "hopLength",
  "t60Sec",
  "lateDelayMs",
  "overSubtraction",
  "spectralFloor",
  "wpeEnabled",
  "wpeIterations",
  "wpeTaps",
  "wpeStrength"
]);
var MasteringRepairDetectClicksRequestKeys = keysOf()([
  "samples",
  "sampleRate",
  "threshold",
  "neighborRatio",
  "maxClickSamples",
  "lpcOrder",
  "residualRatio"
]);
var MasteringRepairDetectClippingRequestKeys = keysOf()([
  "samples",
  "sampleRate",
  "clipThreshold",
  "lpcOrder",
  "iterations",
  "lpcBlend"
]);
var MasteringRepairDetectCrackleRequestKeys = keysOf()([
  "samples",
  "sampleRate",
  "threshold",
  "mode",
  "levels"
]);
var MasteringRepairDetectHumRequestKeys = keysOf()([
  "samples",
  "sampleRate",
  "fundamentalHz",
  "harmonics",
  "q",
  "adaptive",
  "searchRangeHz",
  "adaptation",
  "frameSize",
  "pllBandwidth",
  "mode"
]);
var MasteringRepairDetectNoiseFloorRequestKeys = keysOf()(
  [
    "samples",
    "sampleRate",
    "mode",
    "noiseEstimator",
    "nFft",
    "hopLength",
    "ddAlpha",
    "reductionDb",
    "overSubtraction",
    "spectralFloor",
    "noiseEstimationQuantile",
    "speechPresenceGain",
    "gainSmoothing"
  ]
);
var MasteringRepairDetectReverbRequestKeys = keysOf()([
  "samples",
  "sampleRate",
  "threshold",
  "attenuation",
  "nFft",
  "hopLength",
  "t60Sec",
  "lateDelayMs",
  "overSubtraction",
  "spectralFloor",
  "wpeEnabled",
  "wpeIterations",
  "wpeTaps",
  "wpeStrength"
]);
var MasteringRepairDetectTrimRangeRequestKeys = keysOf()([
  "samples",
  "sampleRate",
  "threshold",
  "paddingSamples",
  "paddingSec",
  "mode",
  "gateLufs",
  "windowMs"
]);
var MasteringRepairDetectTrimRangeStereoRequestKeys = keysOf()([
  "left",
  "right",
  "sampleRate",
  "threshold",
  "paddingSamples",
  "paddingSec",
  "mode",
  "gateLufs",
  "windowMs"
]);
var MasteringRepairTrimSilenceRequestKeys = keysOf()([
  "samples",
  "sampleRate",
  "threshold",
  "paddingSamples",
  "paddingSec",
  "mode",
  "gateLufs",
  "windowMs"
]);
var MasteringRepairTrimSilenceStereoRequestKeys = keysOf()([
  "left",
  "right",
  "sampleRate",
  "threshold",
  "paddingSamples",
  "paddingSec",
  "mode",
  "gateLufs",
  "windowMs"
]);
var Anon105Keys = keysOf()([
  "analysisName",
  "left",
  "right",
  "sampleRate",
  "params"
]);
var MasteringStreamingPreviewRequestKeys = keysOf()([
  "samples",
  "sampleRate",
  "platforms"
]);
var MasteringStreamingPreviewStereoRequestKeys = keysOf()(
  ["left", "right", "sampleRate", "platforms"]
);
var MelToStftRequestKeys = keysOf()([
  "power",
  "result",
  "nMels",
  "nFrames",
  "sampleRate",
  "nFft",
  "fmin",
  "fmax",
  "htk",
  "validate"
]);
var MelToAudioRequestKeys = keysOf()([
  "power",
  "result",
  "nMels",
  "nFrames",
  "sampleRate",
  "nFft",
  "hopLength",
  "fmin",
  "fmax",
  "htk",
  "nIter",
  "validate"
]);
var MfccToMelRequestKeys = keysOf()([
  "coefficients",
  "result",
  "nMfcc",
  "nFrames",
  "nMels",
  "lifter",
  "validate"
]);
var MfccToAudioRequestKeys = keysOf()([
  "coefficients",
  "result",
  "nMfcc",
  "nFrames",
  "nMels",
  "lifter",
  "sampleRate",
  "nFft",
  "hopLength",
  "fmin",
  "fmax",
  "htk",
  "nIter",
  "validate"
]);
var MasteringRepairDereverbConfigForRoomRequestKeys = keysOf()([
  "estimate",
  "threshold",
  "attenuation",
  "nFft",
  "hopLength",
  "t60Sec",
  "lateDelayMs",
  "overSubtraction",
  "spectralFloor",
  "wpeEnabled",
  "wpeIterations",
  "wpeTaps",
  "wpeStrength"
]);
var MasteringRepairNoiseBandBinsRequestKeys = keysOf()([
  "nFft",
  "sampleRate"
]);
var MelDeltaRequestKeys = keysOf()([
  "features",
  "nFeatures",
  "nFrames",
  "width",
  "validate"
]);
var MelSpectrogramRequestKeys = keysOf()([
  "nMels",
  "fmin",
  "fmax",
  "htk",
  "samples",
  "sampleRate",
  "nFft",
  "hopLength",
  "validate"
]);
var MergeNotesRequestKeys = keysOf()([
  "first",
  "last",
  "samples",
  "sampleRate",
  "f0Hz",
  "frameRate",
  "voiced",
  "voicedProb",
  "notes",
  "segmentationThresholdCents",
  "minNoteMs",
  "referenceHz",
  "voicedThreshold",
  "validate"
]);
var MeteringSamplesRequestKeys = keysOf()([
  "samples",
  "sampleRate",
  "validate"
]);
var MeteringStereoRequestKeys = keysOf()([
  "left",
  "right",
  "sampleRate",
  "validate"
]);
var MeteringDetectClippingRequestKeys = keysOf()([
  "samples",
  "sampleRate",
  "threshold",
  "minRegionSamples",
  "validate"
]);
var MeteringDynamicRangeRequestKeys = keysOf()([
  "samples",
  "sampleRate",
  "windowSec",
  "hopSec",
  "lowPercentile",
  "highPercentile",
  "validate"
]);
var MeteringStereoDecimatedRequestKeys = keysOf()([
  "maxPoints",
  "left",
  "right",
  "sampleRate",
  "validate"
]);
var MeteringSilenceRatioRequestKeys = keysOf()([
  "thresholdDb",
  "frameLength",
  "hopLength",
  "samples",
  "sampleRate",
  "validate"
]);
var MeteringSpectrumRequestKeys = keysOf()([
  "samples",
  "sampleRate",
  "nFft",
  "applyOctaveSmoothing",
  "octaveFraction",
  "dbRef",
  "dbAmin",
  "validate"
]);
var MeteringSpectrumFrameRequestKeys = keysOf()([
  "frameOffset",
  "samples",
  "sampleRate",
  "nFft",
  "applyOctaveSmoothing",
  "octaveFraction",
  "dbRef",
  "dbAmin",
  "validate"
]);
var MeteringTruePeakRequestKeys = keysOf()([
  "oversampleFactor",
  "samples",
  "sampleRate",
  "validate"
]);
var MfccRequestKeys = keysOf()([
  "nMfcc",
  "lifter",
  "nMels",
  "fmin",
  "fmax",
  "htk",
  "samples",
  "sampleRate",
  "nFft",
  "hopLength",
  "validate"
]);
var MixStereoRequestKeys = keysOf()([
  "leftChannels",
  "rightChannels",
  "sampleRate",
  "inputTrimDb",
  "faderDb",
  "pan",
  "panMode",
  "width",
  "muted"
]);
var NnFilterRequestKeys = keysOf()([
  "s",
  "nFeatures",
  "nFrames",
  "aggregate",
  "k",
  "width"
]);
var NnlsChromaRequestKeys = keysOf()([
  "samples",
  "sampleRate",
  "enableStftBlend",
  "stftBlendWeight",
  "stftBlendNFft",
  "hopLength",
  "validate"
]);
var NormalizeRequestKeys = keysOf()([
  "samples",
  "sampleRate",
  "targetDb",
  "mode",
  "validate"
]);
var NormalizeStereoRequestKeys = keysOf()([
  "left",
  "right",
  "sampleRate",
  "targetDb",
  "mode",
  "validate"
]);
var NoteMoveRequestKeys = keysOf()([
  "samples",
  "sampleRate",
  "onsetSample",
  "onsetSec",
  "offsetSample",
  "offsetSec",
  "targetOnsetSample",
  "targetOnsetSec",
  "validate"
]);
var NoteSegmentsRequestKeys = keysOf()([
  "f0Hz",
  "voicedProb",
  "frameRate",
  "segmentationThresholdCents",
  "minNoteMs",
  "referenceHz",
  "voicedThreshold"
]);
var NoteStretchRequestKeys = keysOf()([
  "samples",
  "sampleRate",
  "onsetSample",
  "onsetSec",
  "offsetSample",
  "offsetSec",
  "stretchRatio",
  "validate"
]);
var NoteTargetsFromSmfRequestKeys = keysOf()(["data", "trackIndex"]);
var OnsetBacktrackRequestKeys = keysOf()(["events", "energy"]);
var OnsetEnvelopeRequestKeys = keysOf()([
  "samples",
  "sampleRate",
  "nFft",
  "hopLength",
  "nMels",
  "validate"
]);
var OnsetStrengthMultiRequestKeys = keysOf()([
  "nBands",
  "samples",
  "sampleRate",
  "nFft",
  "hopLength",
  "nMels",
  "validate"
]);
var PadCenterRequestKeys = keysOf()(["values", "targetSize", "padValue"]);
var PcenRequestKeys = keysOf()([
  "values",
  "nBins",
  "nFrames",
  "sampleRate",
  "hopLength",
  "timeConstant",
  "gain",
  "bias",
  "power",
  "eps",
  "options"
]);
var PeakPickRequestKeys = keysOf()([
  "values",
  "preMax",
  "postMax",
  "preAvg",
  "postAvg",
  "delta",
  "wait"
]);
var PercussiveRequestKeys = keysOf()(["samples", "sampleRate", "validate"]);
var PhaseVocoderRequestKeys = keysOf()([
  "rate",
  "samples",
  "sampleRate",
  "nFft",
  "hopLength",
  "validate"
]);
var PiptrackRequestKeys = keysOf()([
  "samples",
  "sampleRate",
  "nFft",
  "hopLength",
  "fmin",
  "fmax",
  "threshold"
]);
var PitchCorrectTimevaryingRequestKeys = keysOf()([
  "samples",
  "f0Hz",
  "sampleRate",
  "hopLength",
  "mode",
  "targetMidi",
  "scaleRoot",
  "scaleModeMask",
  "referenceMidi",
  "retuneAmount",
  "maxCorrectionSemitones",
  "retuneSpeedMs",
  "vibratoThresholdCents",
  "voiced",
  "voicedProb",
  "validate"
]);
var PitchCorrectToMidiRequestKeys = keysOf()([
  "samples",
  "sampleRate",
  "currentMidi",
  "targetMidi",
  "validate"
]);
var PitchCorrectToMidiTimevaryingRequestKeys = keysOf()([
  "samples",
  "f0Hz",
  "targetMidi",
  "sampleRate",
  "hopLength",
  "voiced",
  "voicedProb",
  "validate"
]);
var PitchPyinRequestKeys = keysOf()([
  "samples",
  "sampleRate",
  "frameLength",
  "hopLength",
  "fmin",
  "fmax",
  "threshold",
  "fillNa"
]);
var PitchShiftRequestKeys = keysOf()([
  "samples",
  "sampleRate",
  "semitones",
  "nFft",
  "hopLength",
  "validate"
]);
var PitchTuningRequestKeys = keysOf()([
  "frequencies",
  "resolution",
  "binsPerOctave"
]);
var PitchYinRequestKeys = keysOf()([
  "samples",
  "sampleRate",
  "frameLength",
  "hopLength",
  "fmin",
  "fmax",
  "threshold",
  "fillNa"
]);
var PlpRequestKeys = keysOf()([
  "onsetEnvelope",
  "sampleRate",
  "hopLength",
  "tempoMin",
  "tempoMax",
  "winLength"
]);
var PolyFeaturesRequestKeys = keysOf()([
  "order",
  "samples",
  "sampleRate",
  "nFft",
  "hopLength"
]);
var ReassignedSpectrogramRequestKeys = keysOf()([
  "refPower",
  "fillNan",
  "samples",
  "sampleRate",
  "nFft",
  "hopLength",
  "validate"
]);
var RemixRequestKeys = keysOf()([
  "samples",
  "intervals",
  "sampleRate",
  "alignZeros"
]);
var RenderNotesRequestKeys = keysOf()([
  "samples",
  "sampleRate",
  "notes",
  "fadeMs",
  "f0Hz",
  "voiced",
  "frameRate",
  "vibratoCutoffHz",
  "validate"
]);
var RenderPercussiveEventsRequestKeys = keysOf()([
  "samples",
  "sampleRate",
  "events",
  "fadeMs",
  "nFft",
  "hopLength",
  "hpssKernelHarmonic",
  "hpssKernelPercussive",
  "validate"
]);
var RenderPlaybackRequestKeys = keysOf()([
  "samples",
  "channels",
  "sampleRate",
  "config",
  "hrtf"
]);
var PlaybackRendererConfigKeys = keysOf()([
  "input",
  "target",
  "lfe_mix_db",
  "upmix",
  "dialogue_level_db",
  "loudness",
  "night_mode",
  "room",
  "head_tracking",
  "output_limiter"
]);
var ResampleRequestKeys = keysOf()(["samples", "srcSr", "targetSr"]);
var VocalRestoreRequestKeys = keysOf()([
  "samples",
  "sampleRate",
  "state",
  "limits"
]);
var ZeroCrossingRateRequestKeys = keysOf()([
  "samples",
  "sampleRate",
  "frameLength",
  "hopLength"
]);
var RoomGeometryFromEstimateRequestKeys = keysOf()([
  "estimate",
  "source",
  "listener"
]);
var RoomPlacementKeys = keysOf()(["x", "y", "z"]);
var RoomMorphRequestKeys = keysOf()([
  "samples",
  "sampleRate",
  "wet",
  "sourceTailSuppression",
  "preferEyring",
  "mixingTimeMs",
  "crossfadeMs",
  "lengthM",
  "widthM",
  "heightM",
  "absorption",
  "bandAbsorption",
  "bandScattering",
  "materialPreset",
  "sourceX",
  "sourceY",
  "sourceZ",
  "listenerX",
  "listenerY",
  "listenerZ",
  "ismOrder",
  "seed",
  "maxSeconds",
  "airAbsorptionEnabled",
  "airTemperatureC",
  "airHumidityPercent",
  "validate"
]);
var RoomMorphStereoRequestKeys = keysOf()([
  "left",
  "right",
  "sampleRate",
  "receiverSpacingM",
  "wet",
  "sourceTailSuppression",
  "preferEyring",
  "mixingTimeMs",
  "crossfadeMs",
  "lengthM",
  "widthM",
  "heightM",
  "absorption",
  "bandAbsorption",
  "bandScattering",
  "materialPreset",
  "sourceX",
  "sourceY",
  "sourceZ",
  "listenerX",
  "listenerY",
  "listenerZ",
  "ismOrder",
  "seed",
  "maxSeconds",
  "airAbsorptionEnabled",
  "airTemperatureC",
  "airHumidityPercent",
  "validate"
]);
var SegmentAgglomerativeRequestKeys = keysOf()([
  "data",
  "rows",
  "cols",
  "k",
  "linkage"
]);
var SegmentCrossSimilarityRequestKeys = keysOf()([
  "x",
  "xRows",
  "xCols",
  "y",
  "yRows",
  "yCols",
  "k",
  "metric",
  "mode"
]);
var SegmentLagToRecurrenceRequestKeys = keysOf()([
  "lag",
  "rows",
  "lags"
]);
var SegmentPathEnhanceRequestKeys = keysOf()([
  "recurrence",
  "n",
  "win",
  "maxRatio",
  "minRatio",
  "nFilters"
]);
var SegmentRecurrenceMatrixRequestKeys = keysOf()([
  "data",
  "rows",
  "cols",
  "k",
  "width",
  "sym",
  "metric",
  "mode"
]);
var SegmentRecurrenceToLagRequestKeys = keysOf()([
  "recurrence",
  "n",
  "pad"
]);
var SegmentSubsegmentRequestKeys = keysOf()([
  "data",
  "rows",
  "cols",
  "boundaries",
  "nSegments"
]);
var Anon168Keys = keysOf()([
  "samples",
  "sampleRate",
  "nFft",
  "hopLength",
  "p"
]);
var SpectralFrameRequestKeys = keysOf()([
  "samples",
  "sampleRate",
  "nFft",
  "hopLength"
]);
var SpectralContrastRequestKeys = keysOf()([
  "nBands",
  "fmin",
  "quantile",
  "samples",
  "sampleRate",
  "nFft",
  "hopLength"
]);
var SpectralEditRequestKeys = keysOf()([
  "samples",
  "sampleRate",
  "ops",
  "nFft",
  "hopLength",
  "window",
  "healRadiusFrames",
  "validate"
]);
var Anon172Keys = keysOf()([
  "samples",
  "sampleRate",
  "nFft",
  "hopLength",
  "lag"
]);
var SpectralRolloffRequestKeys = keysOf()([
  "rollPercent",
  "samples",
  "sampleRate",
  "nFft",
  "hopLength"
]);
var SplitNoteRequestKeys = keysOf()([
  "index",
  "frame",
  "samples",
  "sampleRate",
  "f0Hz",
  "frameRate",
  "voiced",
  "voicedProb",
  "notes",
  "segmentationThresholdCents",
  "minNoteMs",
  "referenceHz",
  "voicedThreshold",
  "validate"
]);
var SilenceRequestKeys = keysOf()([
  "samples",
  "topDb",
  "frameLength",
  "hopLength"
]);
var SplitSilenceCommonRequestKeys = keysOf()([
  "signals",
  "topDb",
  "frameLength",
  "hopLength"
]);
var StreamingLoudnessGainRequestKeys = keysOf()([
  "samples",
  "sampleRate",
  "config"
]);
var StreamingLoudnessGainStereoRequestKeys = keysOf()([
  "left",
  "right",
  "sampleRate",
  "config"
]);
var SuggestMixSceneRequestKeys = keysOf()([
  "tracks",
  "sampleRate",
  "options"
]);
var MixAssistantOptionsKeys = keysOf()([
  "targetTrackLufs",
  "suggestionStrength",
  "eqMaxCutDb",
  "mixBusHeadroomDbtp",
  "tempoBpm",
  "enableStructure",
  "enableGain",
  "enableBalance",
  "enableEq",
  "enableDynamics",
  "enableImage",
  "enableHighPass",
  "nFft",
  "hopLength"
]);
var RirSynthOptionsKeys = keysOf()([
  "sampleRate",
  "preferEyring",
  "mixingTimeMs",
  "crossfadeMs",
  "lengthM",
  "widthM",
  "heightM",
  "absorption",
  "bandAbsorption",
  "bandScattering",
  "materialPreset",
  "sourceX",
  "sourceY",
  "sourceZ",
  "listenerX",
  "listenerY",
  "listenerZ",
  "ismOrder",
  "seed",
  "maxSeconds",
  "airAbsorptionEnabled",
  "airTemperatureC",
  "airHumidityPercent"
]);
var TempogramRequestKeys = keysOf()([
  "onsetEnvelope",
  "sampleRate",
  "hopLength",
  "winLength",
  "mode",
  "center",
  "norm"
]);
var TempogramRatioRequestKeys = keysOf()([
  "tempogramData",
  "winLength",
  "sampleRate",
  "hopLength",
  "factors",
  "validate"
]);
var TimeStretchRequestKeys = keysOf()([
  "samples",
  "sampleRate",
  "rate",
  "nFft",
  "hopLength",
  "validate"
]);
var ToneRequestKeys = keysOf()([
  "frequency",
  "sampleRate",
  "duration",
  "phase",
  "amplitude"
]);
var TonnetzRequestKeys = keysOf()(["chromagram", "nChroma", "nFrames"]);
var TranscribeRequestKeys = keysOf()([
  "samples",
  "sampleRate",
  "tempoBpm",
  "polyphonic",
  "referenceHz",
  "fmin",
  "fmax",
  "minNoteMs",
  "minNoteDivision",
  "segmentationThresholdCents",
  "velocityFloorDb",
  "fixedVelocity",
  "maxPolyphony",
  "minFramePeakRatio",
  "minRidgePeakRatio",
  "reattackRatio",
  "group",
  "channel"
]);
var TrimRequestKeys = keysOf()([
  "samples",
  "sampleRate",
  "thresholdDb",
  "frameLength",
  "hopLength",
  "validate"
]);
var VectorNormalizeRequestKeys = keysOf()([
  "values",
  "normType",
  "threshold"
]);
var VoiceChangeRequestKeys = keysOf()([
  "samples",
  "sampleRate",
  "pitchSemitones",
  "formantFactor",
  "formantMode",
  "validate"
]);
var VoiceChangeRealtimeRequestKeys = keysOf()([
  "samples",
  "sampleRate",
  "preset",
  "channels",
  "blockSize",
  "validate"
]);
var VqtRequestKeys = keysOf()([
  "gamma",
  "samples",
  "sampleRate",
  "hopLength",
  "fmin",
  "nBins",
  "binsPerOctave",
  "validate"
]);
var VqtToAudioRequestKeys = keysOf()([
  "gamma",
  "magnitude",
  "nBins",
  "nFrames",
  "sampleRate",
  "hopLength",
  "fmin",
  "binsPerOctave",
  "nIter",
  "validate"
]);
var WaveformPeakPyramidRequestKeys = keysOf()([
  "samples",
  "channels",
  "samplesPerBucketLevels",
  "validate"
]);
var WaveformPeaksRequestKeys = keysOf()([
  "samples",
  "channels",
  "samplesPerBucket",
  "validate"
]);
var ZeroCrossingsRequestKeys = keysOf()([
  "samples",
  "threshold",
  "refMagnitude",
  "pad",
  "zeroPos"
]);
var REQUEST_SHAPES = {
  alignTakeToReference: { keys: AlignTakeToReferenceRequestKeys },
  amplitudeToDb: { keys: DbConversionRequestKeys },
  analyze: { keys: MusicAnalyzeRequestKeys },
  analyzeBpm: { keys: AnalyzeBpmRequestKeys },
  analyzeDynamics: { keys: AnalyzeDynamicsRequestKeys },
  analyzeImpulseResponse: { keys: AnalyzeImpulseResponseRequestKeys },
  analyzeMelody: { keys: AnalyzeMelodyRequestKeys },
  analyzePolyphonic: { keys: AnalyzePolyphonicRequestKeys },
  analyzeRhythm: { keys: AnalyzeRhythmRequestKeys },
  analyzeSections: { keys: AnalyzeSectionsRequestKeys },
  analyzeTimbre: { keys: AnalyzeTimbreRequestKeys },
  analyzeWithProgress: {
    keys: AnalyzeWithProgressRequestKeys,
    nested: { options: MusicAnalyzeOptionsKeys }
  },
  assignNoteTargets: { keys: AssignNoteTargetsRequestKeys },
  autoTune: { keys: AutoTuneRequestKeys, hints: { key: AutoTuneKeyKeys } },
  bassChroma: { keys: BassChromaSpectrogramRequestKeys },
  chirp: { keys: ChirpRequestKeys },
  chordFunctionalAnalysis: { keys: ChordFunctionalAnalysisRequestKeys },
  chordFunctions: { keys: Anon19Keys },
  chroma: { keys: SpectrogramRequestKeys },
  chromaCens: { keys: ChromaSpectrogramRequestKeys },
  chromaCqt: { keys: ChromaSpectrogramRequestKeys },
  clicks: { keys: ClicksRequestKeys },
  cqt: { keys: CqtRequestKeys },
  cqtToAudio: { keys: CqtToAudioRequestKeys },
  createVocalEditSession: {
    keys: VocalCreateRequestKeys,
    nested: { limits: VocalSessionLimitsKeys },
    hints: { analysis: VocalAnalysisInputKeys }
  },
  cyclicTempogram: { keys: CyclicTempogramRequestKeys },
  decompose: { keys: DecomposeRequestKeys },
  decomposeNotePitch: { keys: DecomposeNotePitchRequestKeys },
  decomposeStems: { keys: DecomposeStemsRequestKeys },
  decomposeStemsLinked: { keys: DecomposeStemsLinkedRequestKeys },
  decomposeWithInit: { keys: DecomposeWithInitRequestKeys },
  deemphasis: { keys: EmphasisRequestKeys },
  detectAcoustic: { keys: DetectAcousticRequestKeys },
  detectBeats: { keys: SamplesRequestKeys },
  detectBoundaries: { keys: DetectBoundariesRequestKeys },
  detectBpm: { keys: SamplesRequestKeys },
  detectChords: { keys: DetectChordsRequestKeys },
  detectDownbeats: { keys: SamplesRequestKeys },
  detectKey: { keys: DetectKeyRequestKeys },
  detectKeyCandidates: { keys: DetectKeyCandidatesRequestKeys },
  detectOnsets: { keys: DetectOnsetsRequestKeys },
  ebur128LoudnessRange: { keys: Ebur128LoudnessRangeRequestKeys },
  estimateMeter: { keys: EstimateMeterRequestKeys },
  estimateRoom: { keys: EstimateRoomRequestKeys },
  estimateTuning: { keys: EstimateTuningRequestKeys },
  extractNotes: { keys: ExtractNotesRequestKeys },
  extractPercussiveEvents: { keys: ExtractPercussiveEventsRequestKeys },
  fixFrames: { keys: FixFramesRequestKeys },
  fixLength: { keys: FixLengthRequestKeys },
  fourierTempogram: { keys: FourierTempogramRequestKeys },
  frameSignal: { keys: FrameSignalRequestKeys },
  framesToSamples: { keys: FramesToSamplesRequestKeys },
  framesToTime: { keys: FramesToTimeRequestKeys },
  griffinLim: { keys: GriffinLimRequestKeys },
  harmonic: { keys: HarmonicRequestKeys },
  hpss: { keys: HpssRequestKeys },
  hpssWithResidual: { keys: HpssWithResidualRequestKeys },
  hybridCqt: { keys: CqtRequestKeys },
  lufs: { keys: LufsRequestKeys },
  lufsInterleaved: { keys: LufsInterleavedRequestKeys },
  lufsSeriesInterleaved: { keys: LufsSeriesInterleavedRequestKeys },
  masterAudio: { keys: MasterAudioRequestKeys, hints: { overrides: MasteringChainConfigKeys } },
  masterAudioStereo: {
    keys: MasterAudioStereoRequestKeys,
    hints: { overrides: MasteringChainConfigKeys }
  },
  masterAudioStereoWithProgress: {
    keys: MasterAudioStereoRequestKeys,
    hints: { overrides: MasteringChainConfigKeys }
  },
  masterAudioWithProgress: {
    keys: MasterAudioRequestKeys,
    hints: { overrides: MasteringChainConfigKeys }
  },
  mastering: { keys: MasteringRequestKeys },
  masteringAbMatchLoudness: { keys: MasteringAbMatchLoudnessRequestKeys },
  masteringAbMatchLoudnessStereo: { keys: MasteringAbMatchLoudnessStereoRequestKeys },
  masteringAssistantSuggest: { keys: MasteringAssistantParamsRequestKeys },
  masteringAssistantSuggestChain: { keys: MasteringAssistantParamsRequestKeys },
  masteringAssistantSuggestChainStereo: { keys: MasteringAssistantStereoParamsRequestKeys },
  masteringAssistantSuggestStereo: { keys: MasteringAssistantStereoParamsRequestKeys },
  masteringAudioProfile: { keys: MasteringSamplesParamsRequestKeys },
  masteringAudioProfileStereo: { keys: MasteringStereoParamsRequestKeys },
  masteringChain: { keys: MasteringChainRequestKeys, hints: { config: MasteringChainConfigKeys } },
  masteringChainStereo: {
    keys: MasteringChainStereoRequestKeys,
    hints: { config: MasteringChainConfigKeys }
  },
  masteringChainStereoWithProgress: {
    keys: MasteringChainStereoRequestKeys,
    hints: { config: MasteringChainConfigKeys }
  },
  masteringChainWithProgress: {
    keys: MasteringChainRequestKeys,
    hints: { config: MasteringChainConfigKeys }
  },
  masteringDynamicsCompressor: { keys: MasteringDynamicsCompressorRequestKeys },
  masteringDynamicsGate: { keys: MasteringDynamicsGateRequestKeys },
  masteringDynamicsTransientShaper: { keys: MasteringDynamicsTransientShaperRequestKeys },
  masteringPairAnalyze: { keys: Anon74Keys },
  masteringPairProcess: { keys: MasteringPairProcessRequestKeys },
  masteringPairProcessStereo: { keys: MasteringPairProcessStereoRequestKeys },
  masteringProcess: { keys: MasteringProcessRequestKeys },
  masteringProcessStereo: { keys: MasteringProcessStereoRequestKeys },
  masteringRepairAnalyze: { keys: MasteringRepairAnalyzeRequestKeys },
  masteringRepairApply: { keys: MasteringRepairApplyRequestKeys },
  masteringRepairDeclick: { keys: MasteringRepairDeclickRequestKeys },
  masteringRepairDeclickStereo: { keys: MasteringRepairDeclickStereoRequestKeys },
  masteringRepairDeclip: { keys: MasteringRepairDeclipRequestKeys },
  masteringRepairDeclipStereo: { keys: MasteringRepairDeclipStereoRequestKeys },
  masteringRepairDecrackle: { keys: MasteringRepairDecrackleRequestKeys },
  masteringRepairDecrackleStereo: { keys: MasteringRepairDecrackleStereoRequestKeys },
  masteringRepairDehum: { keys: MasteringRepairDehumRequestKeys },
  masteringRepairDehumStereo: { keys: MasteringRepairDehumStereoRequestKeys },
  masteringRepairDenoiseClassical: { keys: MasteringRepairDenoiseClassicalRequestKeys },
  masteringRepairDenoiseClassicalLinked: { keys: MasteringRepairDenoiseClassicalLinkedRequestKeys },
  masteringRepairDenoiseClassicalStereo: { keys: MasteringRepairDenoiseClassicalStereoRequestKeys },
  masteringRepairDereverbClassical: { keys: MasteringRepairDereverbClassicalRequestKeys },
  masteringRepairDereverbClassicalLinked: {
    keys: MasteringRepairDereverbClassicalLinkedRequestKeys
  },
  masteringRepairDereverbClassicalStereo: {
    keys: MasteringRepairDereverbClassicalStereoRequestKeys
  },
  masteringRepairDereverbConfigForRoom: {
    keys: MasteringRepairDereverbConfigForRoomRequestKeys
  },
  masteringRepairDetectClicks: { keys: MasteringRepairDetectClicksRequestKeys },
  masteringRepairDetectClipping: { keys: MasteringRepairDetectClippingRequestKeys },
  masteringRepairDetectCrackle: { keys: MasteringRepairDetectCrackleRequestKeys },
  masteringRepairDetectHum: { keys: MasteringRepairDetectHumRequestKeys },
  masteringRepairDetectNoiseFloor: { keys: MasteringRepairDetectNoiseFloorRequestKeys },
  masteringRepairDetectReverb: { keys: MasteringRepairDetectReverbRequestKeys },
  masteringRepairDetectTrimRange: { keys: MasteringRepairDetectTrimRangeRequestKeys },
  masteringRepairDetectTrimRangeStereo: { keys: MasteringRepairDetectTrimRangeStereoRequestKeys },
  masteringRepairNoiseBandBins: { keys: MasteringRepairNoiseBandBinsRequestKeys },
  masteringRepairTrimSilence: { keys: MasteringRepairTrimSilenceRequestKeys },
  masteringRepairTrimSilenceStereo: { keys: MasteringRepairTrimSilenceStereoRequestKeys },
  masteringStereoAnalyze: { keys: Anon105Keys },
  masteringStreamingPreview: { keys: MasteringStreamingPreviewRequestKeys },
  masteringStreamingPreviewStereo: { keys: MasteringStreamingPreviewStereoRequestKeys },
  melDelta: { keys: MelDeltaRequestKeys },
  melSpectrogram: { keys: MelSpectrogramRequestKeys },
  melToAudio: { keys: MelToAudioRequestKeys },
  melToStft: { keys: MelToStftRequestKeys },
  mergeNotes: { keys: MergeNotesRequestKeys },
  meteringCrestFactorDb: { keys: MeteringSamplesRequestKeys },
  meteringCrestFactorDbStereo: { keys: MeteringStereoRequestKeys },
  meteringDcOffset: { keys: MeteringSamplesRequestKeys },
  meteringDetectClipping: { keys: MeteringDetectClippingRequestKeys },
  meteringDynamicRange: { keys: MeteringDynamicRangeRequestKeys },
  meteringPeakDb: { keys: MeteringSamplesRequestKeys },
  meteringPhaseScope: { keys: MeteringStereoDecimatedRequestKeys },
  meteringPhaseScopeDecimated: { keys: MeteringStereoDecimatedRequestKeys },
  meteringRmsDb: { keys: MeteringSamplesRequestKeys },
  meteringSilenceRatio: { keys: MeteringSilenceRatioRequestKeys },
  meteringSpectrum: { keys: MeteringSpectrumRequestKeys },
  meteringSpectrumFrame: { keys: MeteringSpectrumFrameRequestKeys },
  meteringStereoCorrelation: { keys: MeteringStereoRequestKeys },
  meteringStereoWidth: { keys: MeteringStereoRequestKeys },
  meteringTruePeakDb: { keys: MeteringTruePeakRequestKeys },
  meteringVectorscope: { keys: MeteringStereoDecimatedRequestKeys },
  meteringVectorscopeDecimated: { keys: MeteringStereoDecimatedRequestKeys },
  mfcc: { keys: MfccRequestKeys },
  mfccToAudio: { keys: MfccToAudioRequestKeys },
  mfccToMel: { keys: MfccToMelRequestKeys },
  mixStereo: { keys: MixStereoRequestKeys },
  momentaryLufs: { keys: LufsRequestKeys },
  nnFilter: { keys: NnFilterRequestKeys },
  nnlsChroma: { keys: NnlsChromaRequestKeys },
  normalize: { keys: NormalizeRequestKeys },
  normalizeStereo: { keys: NormalizeStereoRequestKeys },
  noteMove: { keys: NoteMoveRequestKeys },
  noteSegments: { keys: NoteSegmentsRequestKeys },
  noteStretch: { keys: NoteStretchRequestKeys },
  noteTargetsFromSmf: { keys: NoteTargetsFromSmfRequestKeys },
  onsetBacktrack: { keys: OnsetBacktrackRequestKeys },
  onsetEnvelope: { keys: OnsetEnvelopeRequestKeys },
  onsetStrengthMulti: { keys: OnsetStrengthMultiRequestKeys },
  padCenter: { keys: PadCenterRequestKeys },
  pcen: { keys: PcenRequestKeys },
  peakPick: { keys: PeakPickRequestKeys },
  percussive: { keys: PercussiveRequestKeys },
  phaseVocoder: { keys: PhaseVocoderRequestKeys },
  piptrack: { keys: PiptrackRequestKeys },
  pitchCorrectTimevarying: { keys: PitchCorrectTimevaryingRequestKeys },
  pitchCorrectToMidi: { keys: PitchCorrectToMidiRequestKeys },
  pitchCorrectToMidiTimevarying: { keys: PitchCorrectToMidiTimevaryingRequestKeys },
  pitchPyin: { keys: PitchPyinRequestKeys },
  pitchShift: { keys: PitchShiftRequestKeys },
  pitchTuning: { keys: PitchTuningRequestKeys },
  pitchYin: { keys: PitchYinRequestKeys },
  plp: { keys: PlpRequestKeys },
  polyFeatures: { keys: PolyFeaturesRequestKeys },
  powerToDb: { keys: DbConversionRequestKeys },
  preemphasis: { keys: EmphasisRequestKeys },
  pseudoCqt: { keys: CqtRequestKeys },
  reassignedSpectrogram: { keys: ReassignedSpectrogramRequestKeys },
  remix: { keys: RemixRequestKeys },
  remixAlignedIntervals: { keys: RemixRequestKeys },
  renderNotes: { keys: RenderNotesRequestKeys },
  renderPercussiveEvents: { keys: RenderPercussiveEventsRequestKeys },
  renderPlayback: {
    keys: RenderPlaybackRequestKeys,
    nested: { config: PlaybackRendererConfigKeys }
  },
  resample: { keys: ResampleRequestKeys },
  restoreVocalEditSession: {
    keys: VocalRestoreRequestKeys,
    nested: { limits: VocalSessionLimitsKeys }
  },
  rmsEnergy: { keys: ZeroCrossingRateRequestKeys },
  roomGeometryFromEstimate: {
    keys: RoomGeometryFromEstimateRequestKeys,
    hints: { source: RoomPlacementKeys, listener: RoomPlacementKeys }
  },
  roomMorph: { keys: RoomMorphRequestKeys },
  roomMorphStereo: { keys: RoomMorphStereoRequestKeys },
  samplesToFrames: { keys: SamplesToFramesRequestKeys },
  segmentAgglomerative: { keys: SegmentAgglomerativeRequestKeys },
  segmentCrossSimilarity: { keys: SegmentCrossSimilarityRequestKeys },
  segmentLagToRecurrence: { keys: SegmentLagToRecurrenceRequestKeys },
  segmentPathEnhance: { keys: SegmentPathEnhanceRequestKeys },
  segmentRecurrenceMatrix: { keys: SegmentRecurrenceMatrixRequestKeys },
  segmentRecurrenceToLag: { keys: SegmentRecurrenceToLagRequestKeys },
  segmentSubsegment: { keys: SegmentSubsegmentRequestKeys },
  shortTermLufs: { keys: LufsRequestKeys },
  spectralBandwidth: { keys: Anon168Keys },
  spectralCentroid: { keys: SpectralFrameRequestKeys },
  spectralContrast: { keys: SpectralContrastRequestKeys },
  spectralEdit: { keys: SpectralEditRequestKeys },
  spectralFlatness: { keys: SpectralFrameRequestKeys },
  spectralFlux: { keys: Anon172Keys },
  spectralRolloff: { keys: SpectralRolloffRequestKeys },
  splitNote: { keys: SplitNoteRequestKeys },
  splitSilence: { keys: SilenceRequestKeys },
  splitSilenceCommon: { keys: SplitSilenceCommonRequestKeys },
  splitSilenceCommonWithReport: { keys: SplitSilenceCommonRequestKeys },
  stft: { keys: SpectrogramRequestKeys },
  stftDb: { keys: SpectrogramRequestKeys },
  streamingLoudnessGain: {
    keys: StreamingLoudnessGainRequestKeys,
    hints: { config: MasteringChainConfigKeys }
  },
  streamingLoudnessGainStereo: {
    keys: StreamingLoudnessGainStereoRequestKeys,
    hints: { config: MasteringChainConfigKeys }
  },
  suggestMixScene: {
    keys: SuggestMixSceneRequestKeys,
    hints: { options: MixAssistantOptionsKeys }
  },
  suggestMixSceneJson: {
    keys: SuggestMixSceneRequestKeys,
    hints: { options: MixAssistantOptionsKeys }
  },
  synthesizeRir: { keys: RirSynthOptionsKeys },
  tempogram: { keys: TempogramRequestKeys },
  tempogramRatio: { keys: TempogramRatioRequestKeys },
  timeToFrames: { keys: TimeToFramesRequestKeys },
  timeStretch: { keys: TimeStretchRequestKeys },
  tone: { keys: ToneRequestKeys },
  tonnetz: { keys: TonnetzRequestKeys },
  transcribe: { keys: TranscribeRequestKeys },
  trim: { keys: TrimRequestKeys },
  trimSilence: { keys: SilenceRequestKeys },
  vectorNormalize: { keys: VectorNormalizeRequestKeys },
  voiceChange: { keys: VoiceChangeRequestKeys },
  voiceChangeRealtime: { keys: VoiceChangeRealtimeRequestKeys },
  vqt: { keys: VqtRequestKeys },
  vqtToAudio: { keys: VqtToAudioRequestKeys },
  waveformPeakPyramid: { keys: WaveformPeakPyramidRequestKeys },
  waveformPeaks: { keys: WaveformPeaksRequestKeys },
  zeroCrossingRate: { keys: ZeroCrossingRateRequestKeys },
  zeroCrossings: { keys: ZeroCrossingsRequestKeys }
};
var MUSIC_ANALYZE_OPTION_KEYS = MusicAnalyzeOptionsKeys;

// src/validation.ts
var MIN_AUDIO_SAMPLE_RATE = 8e3;
var MAX_AUDIO_SAMPLE_RATE = 384e3;
function assertNonEmptySamples(fnName, samples, argName = "samples") {
  if (samples.length === 0) {
    throw new RangeError(`${fnName}: ${argName} must not be empty`);
  }
}
function assertFiniteSamples(fnName, samples, validate, argName = "samples") {
  if (!validate) {
    return;
  }
  for (let i = 0; i < samples.length; i++) {
    const v = samples[i];
    if (!Number.isFinite(v)) {
      throw new RangeError(`${fnName}: ${argName} contains NaN or Inf at index ${i}`);
    }
  }
}
function assertSamples(fnName, samples, validate, argName = "samples") {
  assertNonEmptySamples(fnName, samples, argName);
  assertFiniteSamples(fnName, samples, validate, argName);
}
function assertSamplesInWindow(fnName, samples, validate, windowStart, windowLength, argName = "samples") {
  assertNonEmptySamples(fnName, samples, argName);
  if (!validate) {
    return;
  }
  const start = Math.min(Math.max(Math.floor(windowStart), 0), samples.length);
  const stop = Math.min(start + Math.max(Math.ceil(windowLength), 0), samples.length);
  for (let i = start; i < stop; i++) {
    const v = samples[i];
    if (!Number.isFinite(v)) {
      throw new RangeError(`${fnName}: ${argName} contains NaN or Inf at index ${i}`);
    }
  }
}
function assertFiniteScalar(fnName, value, argName) {
  if (!Number.isFinite(value)) {
    throw new RangeError(`${fnName}: ${argName} must be a finite number`);
  }
}
function assertNumber(fnName, value, argName) {
  if (typeof value !== "number") {
    throw new TypeError(`${fnName}: ${argName} must be a number`);
  }
}
function assertSampleRate(fnName, sampleRate, argName = "sampleRate") {
  if (typeof sampleRate !== "number") {
    throw new TypeError(`${fnName}: ${argName} must be a number`);
  }
  if (!Number.isInteger(sampleRate)) {
    throw new RangeError(`${fnName}: ${argName} must be an integer`);
  }
  if (sampleRate < MIN_AUDIO_SAMPLE_RATE || sampleRate > MAX_AUDIO_SAMPLE_RATE) {
    throw new RangeError(
      `${fnName}: ${argName} out of supported range [${MIN_AUDIO_SAMPLE_RATE}, ${MAX_AUDIO_SAMPLE_RATE}]`
    );
  }
}
function assertAudioInput(fnName, samples, sampleRate, options = {}, argName = "samples") {
  assertFloat32Array(fnName, samples, argName);
  assertSampleRate(fnName, sampleRate);
  assertSamples(fnName, samples, options.validate !== false, argName);
}
function assertAudioSamples(fnName, samples, options = {}, argName = "samples") {
  assertFloat32Array(fnName, samples, argName);
  assertSamples(fnName, samples, options.validate !== false, argName);
}
function assertFloat32Array(fnName, value, argName) {
  if (!(value instanceof Float32Array)) {
    throw new TypeError(`${fnName}: ${argName} must be a Float32Array`);
  }
}
function assertString(fnName, value, argName) {
  if (typeof value !== "string") {
    throw new TypeError(`${fnName}: ${argName} must be a string`);
  }
}
var C_INT_MAX = 2147483647;
function assertNonNegativeInteger(fnName, value, argName) {
  if (!Number.isInteger(value) || value < 0) {
    throw new RangeError(`${fnName}: ${argName} must be a non-negative integer`);
  }
}
function assertPositiveInteger(fnName, value, argName) {
  if (!Number.isInteger(value)) {
    throw new RangeError(`${fnName}: ${argName} must be an integer`);
  }
  if (value <= 0 || value > C_INT_MAX) {
    throw new RangeError(`${fnName}: ${argName} must be a positive integer`);
  }
}
function assertIntegerValue(fnName, value, argName) {
  if (typeof value !== "number") {
    throw new TypeError(`${fnName}: ${argName} must be an integer`);
  }
  if (!Number.isInteger(value)) {
    throw new RangeError(`${fnName}: ${argName} must be an integer`);
  }
}
function assertEvenIntegerAtLeast(fnName, value, argName, min, max) {
  if (!Number.isInteger(value) || value < min || value > max) {
    throw new RangeError(`${fnName}: ${argName} must be an integer in [${min}, ${max}]`);
  }
  if (value % 2 !== 0) {
    throw new RangeError(`${fnName}: ${argName} must be an even integer >= ${min}`);
  }
}
function assertInterleavedSamples(fnName, samples, channels, validate) {
  assertAudioSamples(fnName, samples, { validate });
  assertPositiveInteger(fnName, channels, "channels");
  if (samples.length % channels !== 0) {
    throw new RangeError(`${fnName}: samples length must be a multiple of channels`);
  }
}
var C_ABSENT = -1;
function resolveOptionalNonNegative(fnName, value, argName) {
  if (value === void 0 || value === null) {
    return C_ABSENT;
  }
  if (typeof value !== "number") {
    throw new TypeError(`${fnName}: ${argName} must be a number`);
  }
  assertFiniteScalar(fnName, value, argName);
  if (value < 0) {
    throw new RangeError(`${fnName}: ${argName} must not be negative (omit it for the default)`);
  }
  return value;
}
function assertKnownRequestKeys(fnName, request) {
  const shape = REQUEST_SHAPES[fnName];
  if (shape === void 0) {
    throw new Error(`${fnName}: no request shape is declared`);
  }
  for (const key of Object.keys(request)) {
    if (shape.keys.includes(key)) {
      continue;
    }
    const owner = Object.entries({ ...shape.nested, ...shape.hints }).find(
      ([, keys]) => keys.includes(key)
    );
    const hint = owner === void 0 ? "" : ` ('${key}' belongs under '${owner[0]}')`;
    throw new TypeError(`${fnName}: unknown request key '${key}'${hint}`);
  }
  for (const [field, keys] of Object.entries(shape.nested ?? {})) {
    const value = request[field];
    if (typeof value !== "object" || value === null || Array.isArray(value)) {
      continue;
    }
    for (const key of Object.keys(value)) {
      if (!keys.includes(key)) {
        throw new TypeError(`${fnName}: unknown option '${key}' in '${field}'`);
      }
    }
  }
}
function optionsBag(fnName, options) {
  const shape = REQUEST_SHAPES[fnName];
  if (shape === void 0) {
    throw new Error(`${fnName}: no request shape is declared`);
  }
  for (const key of Object.keys(options ?? {})) {
    if (!shape.keys.includes(key)) {
      throw new TypeError(`${fnName}: unknown option '${key}'`);
    }
  }
  return options;
}
function requestObject(fnName, value, argName = "samples", requestOnly = false) {
  if (typeof value !== "object" || value === null || Array.isArray(value) || ArrayBuffer.isView(value)) {
    if (requestOnly) {
      throw new TypeError(`${fnName}: request must be an object`);
    }
    assertAudioSamples(fnName, value, {}, argName);
    return value;
  }
  assertKnownRequestKeys(fnName, value);
  return value;
}

// src/feature_core.ts
function requireModule() {
  return getSonareModule();
}
function tone(frequency = 440, sampleRate = 22050, duration = 1, phase = 0, amplitude = 1) {
  const request = typeof frequency === "number" ? { frequency, sampleRate, duration, phase, amplitude } : requestObject("tone", frequency, "request", true);
  return requireModule().tone(
    request.frequency ?? 440,
    request.sampleRate ?? 22050,
    request.duration ?? 1,
    request.phase ?? 0,
    request.amplitude ?? 1
  );
}
function chirp(fmin = 440, fmax = 880, sampleRate = 22050, duration = 1, linear = true) {
  const request = typeof fmin === "number" ? { fmin, fmax, sampleRate, duration, linear } : requestObject("chirp", fmin, "request", true);
  return requireModule().chirp(
    request.fmin ?? 440,
    request.fmax ?? 880,
    request.sampleRate ?? 22050,
    request.duration ?? 1,
    request.linear ?? true
  );
}
function clicks(times, sampleRate = 22050, length = 0, frequency = 1e3, clickDuration = 0.1) {
  const request = times instanceof Float32Array ? { times, sampleRate, length, frequency, clickDuration } : requestObject("clicks", times, "times");
  return requireModule().clicks(
    request.times,
    request.sampleRate ?? 22050,
    request.length ?? 0,
    request.frequency ?? 1e3,
    request.clickDuration ?? 0.1
  );
}
function hzToMel(hz) {
  assertNumber("hzToMel", hz, "hz");
  return requireModule().hzToMel(hz);
}
function melToHz(mel) {
  assertNumber("melToHz", mel, "mel");
  return requireModule().melToHz(mel);
}
function hzToMidi(hz) {
  assertNumber("hzToMidi", hz, "hz");
  return requireModule().hzToMidi(hz);
}
function midiToHz(midi) {
  assertNumber("midiToHz", midi, "midi");
  return requireModule().midiToHz(midi);
}
function hzToNote(hz) {
  assertNumber("hzToNote", hz, "hz");
  return requireModule().hzToNote(hz);
}
function noteToHz(note) {
  assertString("noteToHz", note, "note");
  return requireModule().noteToHz(note);
}
function framesToTime(frames, sr = 22050, hopLength = 512) {
  if (typeof frames === "object" && frames !== null) {
    requestObject("framesToTime", frames, "request", true);
    return framesToTime(frames.frames, frames.sr, frames.hopLength);
  }
  assertNumber("framesToTime", frames, "frames");
  assertNumber("framesToTime", sr, "sr");
  assertPositiveInteger("framesToTime", hopLength, "hopLength");
  return requireModule().framesToTime(frames, sr, hopLength);
}
function timeToFrames(time, sr = 22050, hopLength = 512) {
  if (typeof time === "object" && time !== null) {
    requestObject("timeToFrames", time, "request", true);
    return timeToFrames(time.time, time.sr, time.hopLength);
  }
  assertNumber("timeToFrames", time, "time");
  assertNumber("timeToFrames", sr, "sr");
  assertPositiveInteger("timeToFrames", hopLength, "hopLength");
  return requireModule().timeToFrames(time, sr, hopLength);
}
function framesToSamples(frames, hopLength = 512, nFft = 0) {
  if (typeof frames === "object" && frames !== null) {
    requestObject("framesToSamples", frames, "request", true);
    return framesToSamples(frames.frames, frames.hopLength, frames.nFft);
  }
  assertNumber("framesToSamples", frames, "frames");
  assertNumber("framesToSamples", hopLength, "hopLength");
  assertNumber("framesToSamples", nFft, "nFft");
  return requireModule().framesToSamples(frames, hopLength, nFft);
}
function samplesToFrames(samples, hopLength = 512, nFft = 0) {
  if (typeof samples === "object" && samples !== null) {
    requestObject("samplesToFrames", samples, "request", true);
    return samplesToFrames(samples.samples, samples.hopLength, samples.nFft);
  }
  assertNumber("samplesToFrames", samples, "samples");
  assertNumber("samplesToFrames", hopLength, "hopLength");
  assertNumber("samplesToFrames", nFft, "nFft");
  return requireModule().samplesToFrames(samples, hopLength, nFft);
}
function powerToDb(values, ref = 1, amin = 1e-10, topDb = 80) {
  if (!(values instanceof Float32Array)) {
    requestObject("powerToDb", values, "values");
    return powerToDb(values.values, values.ref, values.amin, values.topDb);
  }
  return requireModule().powerToDb(values, ref, amin, topDb);
}
function amplitudeToDb(values, ref = 1, amin = 1e-5, topDb = 80) {
  if (!(values instanceof Float32Array)) {
    requestObject("amplitudeToDb", values, "values");
    return amplitudeToDb(values.values, values.ref, values.amin, values.topDb);
  }
  return requireModule().amplitudeToDb(values, ref, amin, topDb);
}
function dbToPower(values, ref = 1) {
  assertNumber("dbToPower", ref, "ref");
  return requireModule().dbToPower(values, ref);
}
function dbToAmplitude(values, ref = 1) {
  assertNumber("dbToAmplitude", ref, "ref");
  return requireModule().dbToAmplitude(values, ref);
}
function preemphasis(samples, coef = 0.97, zi) {
  if (!(samples instanceof Float32Array)) {
    requestObject("preemphasis", samples);
    return preemphasis(samples.samples, samples.coef, samples.zi);
  }
  return requireModule().preemphasis(samples, coef, zi ?? null);
}
function deemphasis(samples, coef = 0.97, zi) {
  if (!(samples instanceof Float32Array)) {
    requestObject("deemphasis", samples);
    return deemphasis(samples.samples, samples.coef, samples.zi);
  }
  return requireModule().deemphasis(samples, coef, zi ?? null);
}
function trimSilence(samples, topDb = 60, frameLength = 2048, hopLength = 512) {
  if (!(samples instanceof Float32Array)) {
    requestObject("trimSilence", samples);
    return trimSilence(samples.samples, samples.topDb, samples.frameLength, samples.hopLength);
  }
  assertAudioSamples("trimSilence", samples);
  return requireModule().trimSilence(samples, topDb, frameLength, hopLength);
}
function splitSilence(samples, topDb = 60, frameLength = 2048, hopLength = 512) {
  if (!(samples instanceof Float32Array)) {
    requestObject("splitSilence", samples);
    return splitSilence(samples.samples, samples.topDb, samples.frameLength, samples.hopLength);
  }
  assertAudioSamples("splitSilence", samples);
  return requireModule().splitSilence(samples, topDb, frameLength, hopLength);
}
function assertCommonSignals(fnName, signals) {
  if (Array.isArray(signals)) {
    signals.forEach((signal, i) => {
      assertAudioSamples(fnName, signal, {}, `signals[${i}]`);
    });
  }
}
function splitSilenceCommon(request) {
  requestObject("splitSilenceCommon", request, "request", true);
  assertCommonSignals("splitSilenceCommon", request.signals);
  return requireModule().splitSilenceCommon(
    request.signals,
    request.topDb ?? 60,
    request.frameLength ?? 2048,
    request.hopLength ?? 512
  );
}
function splitSilenceCommonWithReport(request) {
  requestObject("splitSilenceCommonWithReport", request, "request", true);
  assertCommonSignals("splitSilenceCommonWithReport", request.signals);
  return requireModule().splitSilenceCommonWithReport(
    request.signals,
    request.topDb ?? 60,
    request.frameLength ?? 2048,
    request.hopLength ?? 512
  );
}
function frameSignal(samples, frameLength, hopLength) {
  if (!(samples instanceof Float32Array)) {
    requestObject("frameSignal", samples);
    return frameSignal(samples.samples, samples.frameLength, samples.hopLength);
  }
  return requireModule().frameSignal(samples, frameLength, hopLength);
}
function padCenter(values, targetSize, padValue = 0) {
  if (!(values instanceof Float32Array)) {
    requestObject("padCenter", values, "values");
    return padCenter(values.values, values.targetSize, values.padValue);
  }
  return requireModule().padCenter(values, targetSize, padValue);
}
function fixLength(values, targetSize, padValue = 0) {
  if (!(values instanceof Float32Array)) {
    requestObject("fixLength", values, "values");
    return fixLength(values.values, values.targetSize, values.padValue);
  }
  return requireModule().fixLength(values, targetSize, padValue);
}
function fixFrames(frames, xMin = 0, xMax, pad = true) {
  if (!(frames instanceof Int32Array)) {
    requestObject("fixFrames", frames, "request", true);
    return fixFrames(frames.frames, frames.xMin, frames.xMax, frames.pad);
  }
  return requireModule().fixFrames(
    frames,
    xMin,
    resolveOptionalNonNegative("fixFrames", xMax, "xMax"),
    pad
  );
}
function onsetBacktrack(events, energy) {
  if (!(events instanceof Int32Array)) {
    requestObject("onsetBacktrack", events, "request", true);
    return onsetBacktrack(events.events, events.energy);
  }
  return requireModule().onsetBacktrack(events, energy);
}
function peakPick(values, preMax, postMax, preAvg, postAvg, delta, wait) {
  if (!(values instanceof Float32Array)) {
    requestObject("peakPick", values, "values");
    const r = values;
    return peakPick(r.values, r.preMax, r.postMax, r.preAvg, r.postAvg, r.delta, r.wait);
  }
  return requireModule().peakPick(
    values,
    preMax,
    postMax,
    preAvg,
    postAvg,
    delta,
    wait
  );
}
function vectorNormalize(values, normType = 0, threshold = 0) {
  if (!(values instanceof Float32Array)) {
    requestObject("vectorNormalize", values, "values");
    return vectorNormalize(values.values, values.normType, values.threshold);
  }
  return requireModule().vectorNormalize(values, normType, threshold);
}
function pcen(values, nBins = 0, nFrames = 0, options = {}) {
  if (!(values instanceof Float32Array)) {
    requestObject("pcen", values, "values");
    const r = values;
    const {
      values: requestValues,
      nBins: requestBins,
      nFrames: requestFrames,
      options: legacyOptions,
      ...flatOptions
    } = r;
    return pcen(requestValues, requestBins, requestFrames, {
      ...legacyOptions,
      ...flatOptions
    });
  }
  return requireModule().pcen(values, nBins, nFrames, options);
}
function tonnetz(chromagram, nChroma, nFrames) {
  if (!(chromagram instanceof Float32Array)) {
    requestObject("tonnetz", chromagram, "chromagram");
    return tonnetz(chromagram.chromagram, chromagram.nChroma, chromagram.nFrames);
  }
  return requireModule().tonnetz(chromagram, nChroma, nFrames);
}
function tempogram(onsetEnvelope2, sampleRate = 22050, hopLength = 512, winLength = 384, mode = "autocorrelation", center = true, norm = true) {
  if (!(onsetEnvelope2 instanceof Float32Array)) {
    requestObject("tempogram", onsetEnvelope2, "onsetEnvelope");
    const r = onsetEnvelope2;
    return tempogram(
      r.onsetEnvelope,
      r.sampleRate,
      r.hopLength,
      r.winLength,
      r.mode,
      r.center,
      r.norm
    );
  }
  return requireModule().tempogram(
    onsetEnvelope2,
    sampleRate,
    hopLength,
    winLength,
    mode,
    center,
    norm
  );
}
function cyclicTempogram(onsetEnvelope2, sampleRate = 22050, hopLength = 512, winLength = 384, bpmMin = 60, nBins = 60) {
  if (!(onsetEnvelope2 instanceof Float32Array)) {
    requestObject("cyclicTempogram", onsetEnvelope2, "onsetEnvelope");
    const r = onsetEnvelope2;
    return cyclicTempogram(
      r.onsetEnvelope,
      r.sampleRate,
      r.hopLength,
      r.winLength,
      r.bpmMin,
      r.nBins
    );
  }
  return requireModule().cyclicTempogram(
    onsetEnvelope2,
    sampleRate,
    hopLength,
    winLength,
    bpmMin,
    nBins
  );
}
function plp(onsetEnvelope2, sampleRate = 22050, hopLength = 512, tempoMin = 30, tempoMax = 300, winLength = 384) {
  if (!(onsetEnvelope2 instanceof Float32Array)) {
    requestObject("plp", onsetEnvelope2, "onsetEnvelope");
    const r = onsetEnvelope2;
    return plp(r.onsetEnvelope, r.sampleRate, r.hopLength, r.tempoMin, r.tempoMax, r.winLength);
  }
  return requireModule().plp(onsetEnvelope2, sampleRate, hopLength, tempoMin, tempoMax, winLength);
}

// src/_fft_options.ts
function resolveFftOptions(fnName, nFft, hopLength) {
  return resolveWithMinimum(fnName, nFft, hopLength, 2);
}
function resolveWithMinimum(fnName, nFft, hopLength, minNFft) {
  const resolvedNFft = nFft === void 0 ? 2048 : nFft;
  const resolvedHopLength = hopLength === void 0 ? 512 : hopLength;
  assertIntegerValue(fnName, resolvedNFft, "nFft");
  assertEvenIntegerAtLeast(fnName, resolvedNFft, "nFft", minNFft, 2 ** 30);
  assertIntegerValue(fnName, resolvedHopLength, "hopLength");
  assertPositiveInteger(fnName, resolvedHopLength, "hopLength");
  return { nFft: resolvedNFft, hopLength: resolvedHopLength };
}

// src/feature_decompose.ts
function requireModule2() {
  return getSonareModule();
}
function validateSegmentMatrix(fnName, data, rows, cols, dataName) {
  assertPositiveInteger(fnName, rows, "rows");
  assertPositiveInteger(fnName, cols, "cols");
  assertSamples(fnName, data, true, dataName);
  const expected = rows * cols;
  if (!Number.isSafeInteger(expected) || data.length !== expected) {
    throw new RangeError(`${fnName}: ${dataName} length must equal rows * cols`);
  }
}
function segmentCrossSimilarity(request) {
  requestObject("segmentCrossSimilarity", request, "request", true);
  validateSegmentMatrix("segmentCrossSimilarity", request.x, request.xRows, request.xCols, "x");
  validateSegmentMatrix("segmentCrossSimilarity", request.y, request.yRows, request.yCols, "y");
  if (request.xRows !== request.yRows) {
    throw new RangeError("segmentCrossSimilarity: feature dimensions must match");
  }
  assertNonNegativeInteger("segmentCrossSimilarity", request.k ?? 0, "k");
  return requireModule2().segmentCrossSimilarity(
    request.x,
    request.xRows,
    request.xCols,
    request.y,
    request.yRows,
    request.yCols,
    request.k ?? 0,
    request.metric ?? "cosine",
    request.mode ?? "connectivity"
  );
}
function segmentRecurrenceMatrix(request) {
  requestObject("segmentRecurrenceMatrix", request, "request", true);
  validateSegmentMatrix(
    "segmentRecurrenceMatrix",
    request.data,
    request.rows,
    request.cols,
    "data"
  );
  assertNonNegativeInteger("segmentRecurrenceMatrix", request.k ?? 0, "k");
  assertNonNegativeInteger("segmentRecurrenceMatrix", request.width ?? 1, "width");
  return requireModule2().segmentRecurrenceMatrix(
    request.data,
    request.rows,
    request.cols,
    request.k ?? 0,
    request.width ?? 1,
    request.sym ?? false,
    request.metric ?? "euclidean",
    request.mode ?? "connectivity"
  );
}
function segmentRecurrenceToLag(request) {
  requestObject("segmentRecurrenceToLag", request, "request", true);
  validateSegmentMatrix(
    "segmentRecurrenceToLag",
    request.recurrence,
    request.n,
    request.n,
    "recurrence"
  );
  return requireModule2().segmentRecurrenceToLag(request.recurrence, request.n, request.pad ?? true);
}
function segmentLagToRecurrence(request) {
  requestObject("segmentLagToRecurrence", request, "request", true);
  validateSegmentMatrix("segmentLagToRecurrence", request.lag, request.lags, request.rows, "lag");
  return requireModule2().segmentLagToRecurrence(request.lag, request.rows, request.lags);
}
function segmentSubsegment(request) {
  requestObject("segmentSubsegment", request, "request", true);
  validateSegmentMatrix("segmentSubsegment", request.data, request.rows, request.cols, "data");
  assertPositiveInteger("segmentSubsegment", request.nSegments ?? 4, "nSegments");
  return requireModule2().segmentSubsegment(
    request.data,
    request.rows,
    request.cols,
    request.boundaries,
    request.nSegments ?? 4
  );
}
function segmentAgglomerative(request) {
  requestObject("segmentAgglomerative", request, "request", true);
  validateSegmentMatrix("segmentAgglomerative", request.data, request.rows, request.cols, "data");
  assertPositiveInteger("segmentAgglomerative", request.k, "k");
  return requireModule2().segmentAgglomerative(
    request.data,
    request.rows,
    request.cols,
    request.k,
    request.linkage ?? "average"
  );
}
function segmentPathEnhance(request) {
  requestObject("segmentPathEnhance", request, "request", true);
  validateSegmentMatrix(
    "segmentPathEnhance",
    request.recurrence,
    request.n,
    request.n,
    "recurrence"
  );
  assertPositiveInteger("segmentPathEnhance", request.win, "win");
  assertPositiveInteger("segmentPathEnhance", request.maxRatio ?? 2, "maxRatio");
  assertNonNegativeInteger("segmentPathEnhance", request.minRatio ?? 0, "minRatio");
  assertPositiveInteger("segmentPathEnhance", request.nFilters ?? 7, "nFilters");
  return requireModule2().segmentPathEnhance(
    request.recurrence,
    request.n,
    request.win,
    request.maxRatio ?? 2,
    request.minRatio ?? 0,
    request.nFilters ?? 7
  );
}

// src/_feature_validation.ts
function validatePositiveIntegers(fnName, values) {
  for (const [name, value] of Object.entries(values)) {
    assertPositiveInteger(fnName, value, name);
  }
}
function validateMelFrequencyRange(fnName, fmin, fmax, sampleRate) {
  assertFiniteScalar(fnName, fmin, "fmin");
  assertFiniteScalar(fnName, fmax, "fmax");
  if (fmin < 0) {
    throw new RangeError(`${fnName}: fmin must be non-negative`);
  }
  if (fmax < 0) {
    throw new RangeError(`${fnName}: fmax must be non-negative`);
  }
  const effectiveFmax = fmax === 0 ? sampleRate / 2 : fmax;
  if (effectiveFmax <= fmin) {
    throw new RangeError(`${fnName}: fmax must be greater than fmin`);
  }
}

// src/feature_inverse.ts
function requireModule3() {
  return getSonareModule();
}
function isResultRequest(fn, request, field) {
  if (typeof request !== "object" || request === null) {
    throw new TypeError(`${fn}: expected a Float32Array or a request object`);
  }
  requestObject(fn, request, field, true);
  if ("result" in request) {
    return true;
  }
  if (request[field] === void 0) {
    throw new TypeError(`${fn}: ${field} is required (or pass result)`);
  }
  return false;
}
function requireAgreesWithResult(fnName, request, result, keys) {
  const given = request;
  const carried = result;
  for (const key of keys) {
    const value = given[key];
    if (value === void 0) {
      continue;
    }
    const comparable = key === "fmax" && value === 0 ? carried.sampleRate / 2 : value;
    if (comparable !== carried[key]) {
      throw new RangeError(
        `${fnName}: ${key} ${String(value)} disagrees with the result's ${String(carried[key])}`
      );
    }
  }
}
function requireResultFields(fnName, result, keys) {
  const carried = result;
  for (const key of keys) {
    if (carried[key] === void 0) {
      throw new TypeError(`${fnName}: result.${key} is missing`);
    }
  }
}
var MEL_RESULT_FIELDS = [
  "nMels",
  "nFrames",
  "sampleRate",
  "hopLength",
  "nFft",
  "fmin",
  "fmax",
  "htk",
  "power"
];
var MFCC_RESULT_FIELDS = [
  "nMfcc",
  "nFrames",
  "sampleRate",
  "hopLength",
  "nFft",
  "nMels",
  "fmin",
  "fmax",
  "htk",
  "lifter",
  "coefficients"
];
var MEL_TO_STFT_CARRIED = ["nMels", "nFrames", "sampleRate", "nFft", "fmin", "fmax", "htk"];
var MEL_TO_AUDIO_CARRIED = [...MEL_TO_STFT_CARRIED, "hopLength"];
var MFCC_TO_MEL_CARRIED = ["nMfcc", "nFrames", "nMels", "lifter"];
var MFCC_TO_AUDIO_CARRIED = [
  ...MFCC_TO_MEL_CARRIED,
  "sampleRate",
  "nFft",
  "hopLength",
  "fmin",
  "fmax",
  "htk"
];
function melRequestFromResult(fnName, request, carriedKeys) {
  const { result } = request;
  if (result === null || typeof result !== "object") {
    throw new TypeError(`${fnName}: result must be a Mel spectrogram result`);
  }
  if (result.isDb === true) {
    throw new RangeError(
      `${fnName}: result is in dB; convert it to power with dbToPower before inverting it`
    );
  }
  requireResultFields(fnName, result, MEL_RESULT_FIELDS);
  requireAgreesWithResult(fnName, request, result, carriedKeys);
  return {
    power: result.power,
    nMels: result.nMels,
    nFrames: result.nFrames,
    sampleRate: result.sampleRate,
    nFft: result.nFft,
    hopLength: result.hopLength,
    fmin: result.fmin,
    fmax: result.fmax,
    htk: result.htk,
    nIter: request.nIter,
    validate: request.validate
  };
}
function mfccRequestFromResult(fnName, request, carriedKeys) {
  const { result } = request;
  if (result === null || typeof result !== "object") {
    throw new TypeError(`${fnName}: result must be an MFCC result`);
  }
  requireResultFields(fnName, result, MFCC_RESULT_FIELDS);
  requireAgreesWithResult(fnName, request, result, carriedKeys);
  return {
    coefficients: result.coefficients,
    nMfcc: result.nMfcc,
    nFrames: result.nFrames,
    nMels: result.nMels,
    lifter: result.lifter,
    sampleRate: result.sampleRate,
    nFft: result.nFft,
    hopLength: result.hopLength,
    fmin: result.fmin,
    fmax: result.fmax,
    htk: result.htk,
    nIter: request.nIter,
    validate: request.validate
  };
}
function validateMatrix(fnName, data, rows, frames, dataName, rowName, options = {}) {
  validatePositiveIntegers(fnName, { [rowName]: rows, nFrames: frames });
  assertSamples(fnName, data, options.validate !== false, dataName);
  const expectedLength = rows * frames;
  if (!Number.isSafeInteger(expectedLength) || data.length !== expectedLength) {
    throw new RangeError(`${fnName}: ${dataName} length must equal ${rowName} * nFrames`);
  }
}
function melToStft(power, nMels = 0, nFrames = 0, sampleRate = 22050, nFft = 2048, fmin = 0, fmax = 0, htk = false, options = {}) {
  optionsBag("melToStft", options);
  if (!(power instanceof Float32Array)) {
    const request = isResultRequest("melToStft", power, "power") ? melRequestFromResult("melToStft", power, MEL_TO_STFT_CARRIED) : power;
    return melToStft(
      request.power,
      request.nMels,
      request.nFrames,
      request.sampleRate,
      request.nFft,
      request.fmin,
      request.fmax,
      request.htk,
      { validate: request.validate }
    );
  }
  assertSampleRate("melToStft", sampleRate);
  validateMatrix("melToStft", power, nMels, nFrames, "power", "nMels", options);
  validatePositiveIntegers("melToStft", { nFft });
  validateMelFrequencyRange("melToStft", fmin, fmax, sampleRate);
  return requireModule3().melToStft(power, nMels, nFrames, sampleRate, nFft, fmin, fmax, htk);
}
function melToAudio(power, nMels = 0, nFrames = 0, sampleRate = 22050, nFft = 2048, hopLength = 512, fmin = 0, fmax = 0, nIter = 32, htk = false, options = {}) {
  optionsBag("melToAudio", options);
  if (!(power instanceof Float32Array)) {
    const request = isResultRequest("melToAudio", power, "power") ? melRequestFromResult("melToAudio", power, MEL_TO_AUDIO_CARRIED) : power;
    return melToAudio(
      request.power,
      request.nMels,
      request.nFrames,
      request.sampleRate,
      request.nFft,
      request.hopLength,
      request.fmin,
      request.fmax,
      request.nIter,
      request.htk,
      { validate: request.validate }
    );
  }
  assertSampleRate("melToAudio", sampleRate);
  validateMatrix("melToAudio", power, nMels, nFrames, "power", "nMels", options);
  const fft = resolveFftOptions("melToAudio", nFft, hopLength);
  validatePositiveIntegers("melToAudio", { nIter });
  validateMelFrequencyRange("melToAudio", fmin, fmax, sampleRate);
  return requireModule3().melToAudio(
    power,
    nMels,
    nFrames,
    sampleRate,
    fft.nFft,
    fft.hopLength,
    fmin,
    fmax,
    nIter,
    htk
  );
}
function griffinLim(magnitude, nBins = 0, nFrames = 0, sampleRate = 22050, nFft = 2048, hopLength = 512, nIter = 32, momentum = 0.99, options = {}) {
  optionsBag("griffinLim", options);
  if (!(magnitude instanceof Float32Array)) {
    requestObject("griffinLim", magnitude, "magnitude");
    const request = magnitude;
    return griffinLim(
      request.magnitude,
      request.nBins,
      request.nFrames,
      request.sampleRate,
      request.nFft,
      request.hopLength,
      request.nIter,
      request.momentum,
      request
    );
  }
  assertSampleRate("griffinLim", sampleRate);
  validateMatrix("griffinLim", magnitude, nBins, nFrames, "magnitude", "nBins", options);
  const fft = resolveFftOptions("griffinLim", nFft, hopLength);
  validatePositiveIntegers("griffinLim", { nIter });
  return requireModule3().griffinLim(
    magnitude,
    nBins,
    nFrames,
    sampleRate,
    fft.nFft,
    fft.hopLength,
    nIter,
    momentum
  );
}
function mfccToMel(coefficients, nMfcc = 0, nFrames = 0, nMels = 128, lifter = 0, options = {}) {
  optionsBag("mfccToMel", options);
  if (!(coefficients instanceof Float32Array)) {
    const request = isResultRequest("mfccToMel", coefficients, "coefficients") ? mfccRequestFromResult("mfccToMel", coefficients, MFCC_TO_MEL_CARRIED) : coefficients;
    return mfccToMel(
      request.coefficients,
      request.nMfcc,
      request.nFrames,
      request.nMels,
      request.lifter,
      { validate: request.validate }
    );
  }
  validateMatrix("mfccToMel", coefficients, nMfcc, nFrames, "coefficients", "nMfcc", options);
  validatePositiveIntegers("mfccToMel", { nMels });
  return requireModule3().mfccToMel(coefficients, nMfcc, nFrames, nMels, lifter);
}
function mfccToAudio(coefficients, nMfcc = 0, nFrames = 0, nMels = 128, sampleRate = 22050, nFft = 2048, hopLength = 512, fmin = 0, fmax = 0, nIter = 32, htk = false, lifter = 0, options = {}) {
  optionsBag("mfccToAudio", options);
  if (!(coefficients instanceof Float32Array)) {
    const request = isResultRequest("mfccToAudio", coefficients, "coefficients") ? mfccRequestFromResult("mfccToAudio", coefficients, MFCC_TO_AUDIO_CARRIED) : coefficients;
    return mfccToAudio(
      request.coefficients,
      request.nMfcc,
      request.nFrames,
      request.nMels,
      request.sampleRate,
      request.nFft,
      request.hopLength,
      request.fmin,
      request.fmax,
      request.nIter,
      request.htk,
      request.lifter,
      { validate: request.validate }
    );
  }
  assertSampleRate("mfccToAudio", sampleRate);
  validateMatrix("mfccToAudio", coefficients, nMfcc, nFrames, "coefficients", "nMfcc", options);
  const fft = resolveFftOptions("mfccToAudio", nFft, hopLength);
  validatePositiveIntegers("mfccToAudio", { nMels, nIter });
  validateMelFrequencyRange("mfccToAudio", fmin, fmax, sampleRate);
  return requireModule3().mfccToAudio(
    coefficients,
    nMfcc,
    nFrames,
    nMels,
    sampleRate,
    fft.nFft,
    fft.hopLength,
    fmin,
    fmax,
    nIter,
    htk,
    lifter
  );
}

// src/feature_loudness.ts
function requireModule4() {
  return getSonareModule();
}
function lufsInterleaved(samples, channels = 0, sampleRate = 22050, options = {}) {
  optionsBag("lufsInterleaved", options);
  if (!(samples instanceof Float32Array)) {
    requestObject("lufsInterleaved", samples);
    const r = samples;
    return lufsInterleaved(r.samples, r.channels, r.sampleRate, r);
  }
  assertAudioInput("lufsInterleaved", samples, sampleRate, options);
  assertInterleavedSamples("lufsInterleaved", samples, channels, false);
  return requireModule4().lufsInterleaved(samples, channels, sampleRate);
}
function lufsSeriesInterleaved(samples, channels = 0, sampleRate = 22050, options = {}) {
  optionsBag("lufsSeriesInterleaved", options);
  if (!(samples instanceof Float32Array)) {
    requestObject("lufsSeriesInterleaved", samples);
    const r = samples;
    return lufsSeriesInterleaved(r.samples, r.channels, r.sampleRate, r);
  }
  assertAudioInput("lufsSeriesInterleaved", samples, sampleRate, options);
  assertInterleavedSamples("lufsSeriesInterleaved", samples, channels, false);
  return requireModule4().lufsSeriesInterleaved(samples, channels, sampleRate);
}
function ebur128LoudnessRange(samples, sampleRate = 22050) {
  if (!(samples instanceof Float32Array)) {
    requestObject("ebur128LoudnessRange", samples);
    return ebur128LoudnessRange(samples.samples, samples.sampleRate);
  }
  assertAudioInput("ebur128LoudnessRange", samples, sampleRate);
  return requireModule4().ebur128LoudnessRange(samples, sampleRate);
}

// src/feature_music.ts
function requireModule5() {
  return getSonareModule();
}
function validateFrequencyBounds(fnName, fmin, fmax) {
  assertFiniteScalar(fnName, fmin, "fmin");
  if (fmin < 0) {
    throw new RangeError(`${fnName}: fmin must be non-negative`);
  }
  if (fmax !== void 0) {
    assertFiniteScalar(fnName, fmax, "fmax");
    if (fmax <= fmin) {
      throw new RangeError(`${fnName}: fmax must be greater than fmin`);
    }
  }
}
function nnlsChroma(samples, sampleRate = 22050, options = {}) {
  if (!(samples instanceof Float32Array)) {
    requestObject("nnlsChroma", samples);
    return nnlsChroma(samples.samples, samples.sampleRate, samples);
  }
  assertAudioInput("nnlsChroma", samples, sampleRate, options);
  const hopLength = options.hopLength === void 0 ? 512 : options.hopLength;
  assertPositiveInteger("nnlsChroma", hopLength, "hopLength");
  if (hopLength > 2 ** 31 - 1) {
    throw new RangeError("nnlsChroma: hopLength must fit in a signed 32-bit integer");
  }
  return requireModule5().nnlsChromaEx(
    samples,
    sampleRate,
    options.enableStftBlend ?? true,
    options.stftBlendWeight ?? 0.55,
    options.stftBlendNFft ?? 4096,
    hopLength
  );
}
function cqt(samples, sampleRate = 22050, hopLength = 512, fmin = 32.70319566257483, nBins = 84, binsPerOctave = 12, options = {}) {
  optionsBag("cqt", options);
  if (!(samples instanceof Float32Array)) {
    requestObject("cqt", samples);
    const request = samples;
    return cqt(
      request.samples,
      request.sampleRate,
      request.hopLength,
      request.fmin,
      request.nBins,
      request.binsPerOctave,
      request
    );
  }
  assertAudioInput("cqt", samples, sampleRate, options);
  validatePositiveIntegers("cqt", { hopLength, nBins, binsPerOctave });
  validateFrequencyBounds("cqt", fmin);
  return requireModule5().cqt(samples, sampleRate, hopLength, fmin, nBins, binsPerOctave);
}
function pseudoCqt(samples, sampleRate = 22050, hopLength = 512, fmin = 32.70319566257483, nBins = 84, binsPerOctave = 12, options = {}) {
  optionsBag("pseudoCqt", options);
  if (!(samples instanceof Float32Array)) {
    requestObject("pseudoCqt", samples);
    const request = samples;
    return pseudoCqt(
      request.samples,
      request.sampleRate,
      request.hopLength,
      request.fmin,
      request.nBins,
      request.binsPerOctave,
      request
    );
  }
  assertAudioInput("pseudoCqt", samples, sampleRate, options);
  validatePositiveIntegers("pseudoCqt", { hopLength, nBins, binsPerOctave });
  validateFrequencyBounds("pseudoCqt", fmin);
  return requireModule5().pseudoCqt(samples, sampleRate, hopLength, fmin, nBins, binsPerOctave);
}
function hybridCqt(samples, sampleRate = 22050, hopLength = 512, fmin = 32.70319566257483, nBins = 84, binsPerOctave = 12, options = {}) {
  optionsBag("hybridCqt", options);
  if (!(samples instanceof Float32Array)) {
    requestObject("hybridCqt", samples);
    const request = samples;
    return hybridCqt(
      request.samples,
      request.sampleRate,
      request.hopLength,
      request.fmin,
      request.nBins,
      request.binsPerOctave,
      request
    );
  }
  assertAudioInput("hybridCqt", samples, sampleRate, options);
  validatePositiveIntegers("hybridCqt", { hopLength, nBins, binsPerOctave });
  validateFrequencyBounds("hybridCqt", fmin);
  return requireModule5().hybridCqt(samples, sampleRate, hopLength, fmin, nBins, binsPerOctave);
}
function vqt(samples, sampleRate = 22050, hopLength = 512, fmin = 32.70319566257483, nBins = 84, binsPerOctave = 12, gamma, options = {}) {
  optionsBag("vqt", options);
  if (!(samples instanceof Float32Array)) {
    requestObject("vqt", samples);
    const request = samples;
    return vqt(
      request.samples,
      request.sampleRate,
      request.hopLength,
      request.fmin,
      request.nBins,
      request.binsPerOctave,
      request.gamma,
      request
    );
  }
  assertAudioInput("vqt", samples, sampleRate, options);
  validatePositiveIntegers("vqt", { hopLength, nBins, binsPerOctave });
  validateFrequencyBounds("vqt", fmin);
  return requireModule5().vqt(
    samples,
    sampleRate,
    hopLength,
    fmin,
    nBins,
    binsPerOctave,
    resolveOptionalNonNegative("vqt", gamma, "gamma")
  );
}
function validateCqtInverse(fnName, magnitude, nBins, nFrames, sampleRate, hopLength, fmin, binsPerOctave, nIter, options) {
  assertSampleRate(fnName, sampleRate);
  validatePositiveIntegers(fnName, { nBins, nFrames, hopLength, binsPerOctave, nIter });
  if (nIter > 256) {
    throw new RangeError(`${fnName}: nIter must be at most 256`);
  }
  validateFrequencyBounds(fnName, fmin);
  if (fmin === 0) {
    throw new RangeError(`${fnName}: fmin must be positive`);
  }
  if (magnitude.length !== nBins * nFrames) {
    throw new RangeError(`${fnName}: magnitude length must equal nBins * nFrames`);
  }
  assertSamples(fnName, magnitude, options.validate !== false);
}
function cqtToAudio(magnitude, nBins = 0, nFrames = 0, sampleRate = 22050, hopLength = 512, fmin = 32.70319566257483, binsPerOctave = 12, nIter = 32, options = {}) {
  optionsBag("cqtToAudio", options);
  if (!(magnitude instanceof Float32Array)) {
    requestObject("cqtToAudio", magnitude, "magnitude");
    const request = magnitude;
    return cqtToAudio(
      request.magnitude,
      request.nBins,
      request.nFrames,
      request.sampleRate,
      request.hopLength,
      request.fmin,
      request.binsPerOctave,
      request.nIter,
      request
    );
  }
  validateCqtInverse(
    "cqtToAudio",
    magnitude,
    nBins,
    nFrames,
    sampleRate,
    hopLength,
    fmin,
    binsPerOctave,
    nIter,
    options
  );
  return requireModule5().cqtToAudio(
    magnitude,
    nBins,
    nFrames,
    sampleRate,
    hopLength,
    fmin,
    binsPerOctave,
    nIter
  );
}
function vqtToAudio(magnitude, nBins = 0, nFrames = 0, sampleRate = 22050, hopLength = 512, fmin = 32.70319566257483, binsPerOctave = 12, gamma, nIter = 32, options = {}) {
  optionsBag("vqtToAudio", options);
  if (!(magnitude instanceof Float32Array)) {
    requestObject("vqtToAudio", magnitude, "magnitude");
    const request = magnitude;
    return vqtToAudio(
      request.magnitude,
      request.nBins,
      request.nFrames,
      request.sampleRate,
      request.hopLength,
      request.fmin,
      request.binsPerOctave,
      request.gamma,
      request.nIter,
      request
    );
  }
  validateCqtInverse(
    "vqtToAudio",
    magnitude,
    nBins,
    nFrames,
    sampleRate,
    hopLength,
    fmin,
    binsPerOctave,
    nIter,
    options
  );
  return requireModule5().vqtToAudio(
    magnitude,
    nBins,
    nFrames,
    sampleRate,
    hopLength,
    fmin,
    binsPerOctave,
    resolveOptionalNonNegative("vqtToAudio", gamma, "gamma"),
    nIter
  );
}
function analyzeSections(samples, sampleRate = 22050, options = {}) {
  optionsBag("analyzeSections", options);
  if (!(samples instanceof Float32Array)) {
    requestObject("analyzeSections", samples);
    const r = samples;
    return analyzeSections(r.samples, r.sampleRate, r);
  }
  assertAudioInput("analyzeSections", samples, sampleRate, options);
  validatePositiveIntegers("analyzeSections", {
    nFft: options.nFft ?? 2048,
    hopLength: options.hopLength ?? 512
  });
  assertFiniteScalar("analyzeSections", options.minSectionSec ?? 4, "minSectionSec");
  if ((options.minSectionSec ?? 4) < 0) {
    throw new RangeError("analyzeSections: minSectionSec must be non-negative");
  }
  const sections = requireModule5().analyzeSections(
    samples,
    sampleRate,
    options.nFft ?? 2048,
    options.hopLength ?? 512,
    options.minSectionSec ?? 4
  );
  return Array.from(sections, (s) => ({ ...s, type: s.type }));
}
function detectBoundaries(request) {
  requestObject("detectBoundaries", request, "request", true);
  const { samples, sampleRate = 22050 } = request;
  assertAudioInput("detectBoundaries", samples, sampleRate, request);
  const sizes = {};
  for (const name of ["nFft", "hopLength", "kernelSize", "nMfcc", "nChroma"]) {
    const value = request[name];
    if (value != null) {
      sizes[name] = value;
    }
  }
  validatePositiveIntegers("detectBoundaries", sizes);
  for (const name of [
    "threshold",
    "absoluteThreshold",
    "peakDistance",
    "referenceWindow"
  ]) {
    const value = request[name];
    if (value == null) {
      continue;
    }
    assertFiniteScalar("detectBoundaries", value, name);
    if (value < 0) {
      throw new RangeError(`detectBoundaries: ${name} must be non-negative`);
    }
  }
  if (request.useMfcc === false && request.useChroma === false) {
    throw new SonareError(
      4 /* InvalidParameter */,
      "InvalidParameter",
      "detectBoundaries: require useMfcc or useChroma"
    );
  }
  const result = requireModule5().detectBoundaries(samples, sampleRate, request);
  return {
    boundaries: Array.from(result.boundaries, (b) => ({
      time: b.time,
      frame: b.frame,
      strength: b.strength
    })),
    noveltyCurve: result.noveltyCurve,
    noveltyPeak: result.noveltyPeak,
    sampleRate: result.sampleRate,
    hopLength: result.hopLength,
    nFrames: result.nFrames,
    frameStride: result.frameStride
  };
}
function analyzeMelody(samples, sampleRate = 22050, options = {}) {
  optionsBag("analyzeMelody", options);
  if (!(samples instanceof Float32Array)) {
    requestObject("analyzeMelody", samples);
    const r = samples;
    return analyzeMelody(r.samples, r.sampleRate, r);
  }
  assertAudioInput("analyzeMelody", samples, sampleRate, options);
  const fmin = options.fmin ?? 65;
  const fmax = options.fmax ?? 2093;
  validateFrequencyBounds("analyzeMelody", fmin, fmax);
  if (fmin <= 0) {
    throw new SonareError(
      4 /* InvalidParameter */,
      "InvalidParameter",
      "analyzeMelody: fmin must be positive"
    );
  }
  validatePositiveIntegers("analyzeMelody", {
    frameLength: options.frameLength ?? 2048,
    hopLength: options.hopLength ?? 256
  });
  const threshold = options.threshold ?? 0.1;
  assertFiniteScalar("analyzeMelody", threshold, "threshold");
  if (threshold <= 0) {
    throw new SonareError(
      4 /* InvalidParameter */,
      "InvalidParameter",
      "analyzeMelody: threshold must be positive"
    );
  }
  return requireModule5().analyzeMelody(
    samples,
    sampleRate,
    options.fmin ?? 65,
    options.fmax ?? 2093,
    options.frameLength ?? 2048,
    options.hopLength ?? 256,
    options.threshold ?? 0.1,
    options.usePyin ?? false,
    options.center ?? true
  );
}
function onsetEnvelope(samples, sampleRate = 22050, nFft = 2048, hopLength = 512, nMels = 128, options = {}) {
  optionsBag("onsetEnvelope", options);
  if (!(samples instanceof Float32Array)) {
    requestObject("onsetEnvelope", samples);
    const request = samples;
    return onsetEnvelope(
      request.samples,
      request.sampleRate,
      request.nFft,
      request.hopLength,
      request.nMels,
      request
    );
  }
  assertAudioInput("onsetEnvelope", samples, sampleRate, options);
  const fft = resolveFftOptions("onsetEnvelope", nFft, hopLength);
  validatePositiveIntegers("onsetEnvelope", { nMels });
  return requireModule5().onsetEnvelope(samples, sampleRate, fft.nFft, fft.hopLength, nMels);
}
function onsetStrengthMulti(samples, sampleRate = 22050, nFft = 2048, hopLength = 512, nMels = 128, nBands = 3, options = {}) {
  optionsBag("onsetStrengthMulti", options);
  if (!(samples instanceof Float32Array)) {
    requestObject("onsetStrengthMulti", samples);
    const request = samples;
    return onsetStrengthMulti(
      request.samples,
      request.sampleRate,
      request.nFft,
      request.hopLength,
      request.nMels,
      request.nBands,
      request
    );
  }
  assertAudioInput("onsetStrengthMulti", samples, sampleRate, options);
  const fft = resolveFftOptions("onsetStrengthMulti", nFft, hopLength);
  validatePositiveIntegers("onsetStrengthMulti", { nMels, nBands });
  return requireModule5().onsetStrengthMulti(
    samples,
    sampleRate,
    fft.nFft,
    fft.hopLength,
    nMels,
    nBands
  );
}
function fourierTempogram(onsetEnvelope2, sampleRate = 22050, hopLength = 512, winLength = 384, center = true, norm = true, options = {}) {
  optionsBag("fourierTempogram", options);
  if (!(onsetEnvelope2 instanceof Float32Array)) {
    requestObject("fourierTempogram", onsetEnvelope2, "onsetEnvelope");
    const request = onsetEnvelope2;
    return fourierTempogram(
      request.onsetEnvelope,
      request.sampleRate,
      request.hopLength,
      request.winLength,
      request.center,
      request.norm,
      request
    );
  }
  assertSampleRate("fourierTempogram", sampleRate);
  assertSamples("fourierTempogram", onsetEnvelope2, options.validate !== false, "onsetEnvelope");
  validatePositiveIntegers("fourierTempogram", { hopLength, winLength });
  return requireModule5().fourierTempogram(
    onsetEnvelope2,
    sampleRate,
    hopLength,
    winLength,
    center,
    norm
  );
}
function tempogramRatio(tempogramData, winLength = 384, sampleRate = 22050, hopLength = 512, factors, options = {}) {
  optionsBag("tempogramRatio", options);
  if (!(tempogramData instanceof Float32Array)) {
    requestObject("tempogramRatio", tempogramData, "tempogramData");
    const request = tempogramData;
    return tempogramRatio(
      request.tempogramData,
      request.winLength,
      request.sampleRate,
      request.hopLength,
      request.factors,
      request
    );
  }
  assertSampleRate("tempogramRatio", sampleRate);
  assertSamples("tempogramRatio", tempogramData, options.validate !== false, "tempogramData");
  validatePositiveIntegers("tempogramRatio", { winLength, hopLength });
  return requireModule5().tempogramRatio(tempogramData, winLength, sampleRate, hopLength, factors);
}
function lufs(samples, sampleRate = 22050, options = {}) {
  optionsBag("lufs", options);
  if (!(samples instanceof Float32Array)) {
    requestObject("lufs", samples);
    const r = samples;
    return lufs(r.samples, r.sampleRate, r);
  }
  assertAudioInput("lufs", samples, sampleRate, options);
  return requireModule5().lufs(samples, sampleRate);
}
function momentaryLufs(samples, sampleRate = 22050, options = {}) {
  optionsBag("momentaryLufs", options);
  if (!(samples instanceof Float32Array)) {
    requestObject("momentaryLufs", samples);
    const r = samples;
    return momentaryLufs(r.samples, r.sampleRate, r);
  }
  assertAudioInput("momentaryLufs", samples, sampleRate, options);
  return requireModule5().momentaryLufs(samples, sampleRate);
}
function shortTermLufs(samples, sampleRate = 22050, options = {}) {
  optionsBag("shortTermLufs", options);
  if (!(samples instanceof Float32Array)) {
    requestObject("shortTermLufs", samples);
    const r = samples;
    return shortTermLufs(r.samples, r.sampleRate, r);
  }
  assertAudioInput("shortTermLufs", samples, sampleRate, options);
  return requireModule5().shortTermLufs(samples, sampleRate);
}

// src/feature_pitch.ts
function requireModule6() {
  return getSonareModule();
}
function piptrack(samples, sampleRate = 22050, nFft = 2048, hopLength = 512, fmin = 150, fmax = 4e3, threshold = 0.1) {
  if (!(samples instanceof Float32Array)) {
    requestObject("piptrack", samples);
    const request = samples;
    return piptrack(
      request.samples,
      request.sampleRate,
      request.nFft,
      request.hopLength,
      request.fmin,
      request.fmax,
      request.threshold
    );
  }
  assertAudioInput("piptrack", samples, sampleRate);
  return requireModule6().piptrack(samples, sampleRate, nFft, hopLength, fmin, fmax, threshold);
}
function pitchYin(samples, sampleRate = 22050, frameLength = 2048, hopLength = 512, fmin = 65, fmax = 2093, threshold = 0.1, fillNa = false) {
  if (!(samples instanceof Float32Array)) {
    requestObject("pitchYin", samples);
    const request = samples;
    return pitchYin(
      request.samples,
      request.sampleRate,
      request.frameLength,
      request.hopLength,
      request.fmin,
      request.fmax,
      request.threshold,
      request.fillNa
    );
  }
  assertAudioInput("pitchYin", samples, sampleRate);
  return requireModule6().pitchYin(
    samples,
    sampleRate,
    frameLength,
    hopLength,
    fmin,
    fmax,
    threshold,
    fillNa
  );
}
function pitchPyin(samples, sampleRate = 22050, frameLength = 2048, hopLength = 512, fmin = 65, fmax = 2093, threshold = 0.1, fillNa = false) {
  if (!(samples instanceof Float32Array)) {
    requestObject("pitchPyin", samples);
    const request = samples;
    return pitchPyin(
      request.samples,
      request.sampleRate,
      request.frameLength,
      request.hopLength,
      request.fmin,
      request.fmax,
      request.threshold,
      request.fillNa
    );
  }
  assertAudioInput("pitchPyin", samples, sampleRate);
  return requireModule6().pitchPyin(
    samples,
    sampleRate,
    frameLength,
    hopLength,
    fmin,
    fmax,
    threshold,
    fillNa
  );
}
function noteSegments(request) {
  requestObject("noteSegments", request, "request", true);
  return requireModule6().noteSegments(request.f0Hz, request.voicedProb, request.frameRate, {
    segmentationThresholdCents: request.segmentationThresholdCents,
    minNoteMs: request.minNoteMs,
    referenceHz: request.referenceHz,
    voicedThreshold: request.voicedThreshold
  });
}
function pitchTuning(frequencies, resolution = 0.01, binsPerOctave = 12) {
  if (!(frequencies instanceof Float32Array)) {
    requestObject("pitchTuning", frequencies, "frequencies");
    const r = frequencies;
    return pitchTuning(r.frequencies, r.resolution, r.binsPerOctave);
  }
  return requireModule6().pitchTuning(frequencies, resolution, binsPerOctave);
}
function tuningToReferenceHz(tuning, a4 = 440) {
  return requireModule6().tuningToReferenceHz(tuning, a4);
}
function referenceHzToTuning(hz, a4 = 440) {
  return requireModule6().referenceHzToTuning(hz, a4);
}
function estimateTuning(samples, sampleRate = 22050, nFft = 2048, hopLength = 512, resolution = 0.01, binsPerOctave = 12) {
  if (!(samples instanceof Float32Array)) {
    requestObject("estimateTuning", samples);
    const r = samples;
    return estimateTuning(
      r.samples,
      r.sampleRate,
      r.nFft,
      r.hopLength,
      r.resolution,
      r.binsPerOctave
    );
  }
  assertAudioInput("estimateTuning", samples, sampleRate);
  return requireModule6().estimateTuning(
    samples,
    sampleRate,
    nFft,
    hopLength,
    resolution,
    binsPerOctave
  );
}

// src/feature_spectral.ts
function requireModule7() {
  return getSonareModule();
}
function spectralCentroid(samples, sampleRate = 22050, nFft = 2048, hopLength = 512) {
  if (!(samples instanceof Float32Array)) {
    requestObject("spectralCentroid", samples);
    return spectralCentroid(samples.samples, samples.sampleRate, samples.nFft, samples.hopLength);
  }
  assertAudioInput("spectralCentroid", samples, sampleRate);
  return requireModule7().spectralCentroid(samples, sampleRate, nFft, hopLength);
}
function spectralContrast(samples, sampleRate = 22050, nFft = 2048, hopLength = 512, nBands = 6, fmin = 200, quantile = 0.02) {
  if (!(samples instanceof Float32Array)) {
    requestObject("spectralContrast", samples);
    const r = samples;
    return spectralContrast(
      r.samples,
      r.sampleRate,
      r.nFft,
      r.hopLength,
      r.nBands,
      r.fmin,
      r.quantile
    );
  }
  assertAudioInput("spectralContrast", samples, sampleRate);
  return requireModule7().spectralContrast(
    samples,
    sampleRate,
    nFft,
    hopLength,
    nBands,
    fmin,
    quantile
  );
}
function polyFeatures(samples, sampleRate = 22050, nFft = 2048, hopLength = 512, order = 1) {
  if (!(samples instanceof Float32Array)) {
    requestObject("polyFeatures", samples);
    const r = samples;
    return polyFeatures(r.samples, r.sampleRate, r.nFft, r.hopLength, r.order);
  }
  assertAudioInput("polyFeatures", samples, sampleRate);
  return requireModule7().polyFeatures(samples, sampleRate, nFft, hopLength, order);
}
function zeroCrossings(samples, threshold = 1e-10, refMagnitude = false, pad = true, zeroPos = true) {
  if (!(samples instanceof Float32Array)) {
    requestObject("zeroCrossings", samples);
    const r = samples;
    return zeroCrossings(r.samples, r.threshold, r.refMagnitude, r.pad, r.zeroPos);
  }
  return requireModule7().zeroCrossings(samples, threshold, refMagnitude, pad, zeroPos);
}
function spectralBandwidth(samples, sampleRate = 22050, nFft = 2048, hopLength = 512, p = 2) {
  if (!(samples instanceof Float32Array)) {
    requestObject("spectralBandwidth", samples);
    return spectralBandwidth(
      samples.samples,
      samples.sampleRate,
      samples.nFft,
      samples.hopLength,
      samples.p
    );
  }
  assertAudioInput("spectralBandwidth", samples, sampleRate);
  return requireModule7().spectralBandwidth(samples, sampleRate, nFft, hopLength, p);
}
function spectralRolloff(samples, sampleRate = 22050, nFft = 2048, hopLength = 512, rollPercent = 0.85) {
  if (!(samples instanceof Float32Array)) {
    requestObject("spectralRolloff", samples);
    return spectralRolloff(
      samples.samples,
      samples.sampleRate,
      samples.nFft,
      samples.hopLength,
      samples.rollPercent
    );
  }
  assertAudioInput("spectralRolloff", samples, sampleRate);
  return requireModule7().spectralRolloff(samples, sampleRate, nFft, hopLength, rollPercent);
}
function spectralFlatness(samples, sampleRate = 22050, nFft = 2048, hopLength = 512) {
  if (!(samples instanceof Float32Array)) {
    requestObject("spectralFlatness", samples);
    return spectralFlatness(samples.samples, samples.sampleRate, samples.nFft, samples.hopLength);
  }
  assertAudioInput("spectralFlatness", samples, sampleRate);
  return requireModule7().spectralFlatness(samples, sampleRate, nFft, hopLength);
}
function spectralFlux(samples, sampleRate = 22050, nFft = 2048, hopLength = 512, lag = 1) {
  if (!(samples instanceof Float32Array)) {
    requestObject("spectralFlux", samples);
    return spectralFlux(
      samples.samples,
      samples.sampleRate,
      samples.nFft,
      samples.hopLength,
      samples.lag
    );
  }
  assertAudioInput("spectralFlux", samples, sampleRate);
  return requireModule7().spectralFlux(samples, sampleRate, nFft, hopLength, lag);
}
function zeroCrossingRate(samples, sampleRate = 22050, frameLength = 2048, hopLength = 512) {
  if (!(samples instanceof Float32Array)) {
    requestObject("zeroCrossingRate", samples);
    return zeroCrossingRate(
      samples.samples,
      samples.sampleRate,
      samples.frameLength,
      samples.hopLength
    );
  }
  assertAudioInput("zeroCrossingRate", samples, sampleRate);
  return requireModule7().zeroCrossingRate(samples, sampleRate, frameLength, hopLength);
}
function rmsEnergy(samples, sampleRate = 22050, frameLength = 2048, hopLength = 512) {
  if (!(samples instanceof Float32Array)) {
    requestObject("rmsEnergy", samples);
    return rmsEnergy(samples.samples, samples.sampleRate, samples.frameLength, samples.hopLength);
  }
  assertAudioInput("rmsEnergy", samples, sampleRate);
  return requireModule7().rmsEnergy(samples, sampleRate, frameLength, hopLength);
}

// src/feature_spectrogram.ts
function requireModule8() {
  return getSonareModule();
}
function stft(samples, sampleRate = 22050, nFft = 2048, hopLength = 512, options = {}) {
  optionsBag("stft", options);
  if (!(samples instanceof Float32Array)) {
    requestObject("stft", samples);
    const request = samples;
    return stft(request.samples, request.sampleRate, request.nFft, request.hopLength, request);
  }
  assertAudioInput("stft", samples, sampleRate, options);
  const fft = resolveFftOptions("stft", nFft, hopLength);
  return requireModule8().stft(samples, sampleRate, fft.nFft, fft.hopLength);
}
function stftDb(samples, sampleRate = 22050, nFft = 2048, hopLength = 512, options = {}) {
  optionsBag("stftDb", options);
  if (!(samples instanceof Float32Array)) {
    requestObject("stftDb", samples);
    const request = samples;
    return stftDb(request.samples, request.sampleRate, request.nFft, request.hopLength, request);
  }
  assertAudioInput("stftDb", samples, sampleRate, options);
  const fft = resolveFftOptions("stftDb", nFft, hopLength);
  return requireModule8().stftDb(samples, sampleRate, fft.nFft, fft.hopLength);
}
function chromaCens(samples, sampleRate = 22050, hopLength = 512, nChroma = 12, binsPerOctave = 36, options = {}) {
  optionsBag("chromaCens", options);
  if (!(samples instanceof Float32Array)) {
    requestObject("chromaCens", samples);
    const request = samples;
    return chromaCens(
      request.samples,
      request.sampleRate,
      request.hopLength,
      request.nChroma,
      request.binsPerOctave,
      request
    );
  }
  assertAudioInput("chromaCens", samples, sampleRate, options);
  validatePositiveIntegers("chromaCens", { hopLength, nChroma, binsPerOctave });
  if (binsPerOctave % nChroma !== 0) {
    throw new RangeError("chromaCens: binsPerOctave must be a multiple of nChroma");
  }
  return requireModule8().chromaCens(samples, sampleRate, hopLength, nChroma, binsPerOctave);
}
function chromaCqt(samples, sampleRate = 22050, hopLength = 512, nChroma = 12, binsPerOctave = 36, options = {}) {
  optionsBag("chromaCqt", options);
  if (!(samples instanceof Float32Array)) {
    requestObject("chromaCqt", samples);
    const request = samples;
    return chromaCqt(
      request.samples,
      request.sampleRate,
      request.hopLength,
      request.nChroma,
      request.binsPerOctave,
      request
    );
  }
  assertAudioInput("chromaCqt", samples, sampleRate, options);
  validatePositiveIntegers("chromaCqt", { hopLength, nChroma, binsPerOctave });
  if (binsPerOctave % nChroma !== 0) {
    throw new RangeError("chromaCqt: binsPerOctave must be a multiple of nChroma");
  }
  return requireModule8().chromaCqt(samples, sampleRate, hopLength, nChroma, binsPerOctave);
}
function bassChroma(samples, sampleRate = 22050, hopLength = 512, nChroma = 12, options = {}) {
  optionsBag("bassChroma", options);
  if (!(samples instanceof Float32Array)) {
    requestObject("bassChroma", samples);
    const request = samples;
    return bassChroma(
      request.samples,
      request.sampleRate,
      request.hopLength,
      request.nChroma,
      request
    );
  }
  assertAudioInput("bassChroma", samples, sampleRate, options);
  validatePositiveIntegers("bassChroma", { hopLength, nChroma });
  return requireModule8().bassChroma(samples, sampleRate, hopLength, nChroma);
}
function melSpectrogram(samples, sampleRate = 22050, nFft = 2048, hopLength = 512, nMels = 128, fmin = 0, fmax = 0, htk = false, options = {}) {
  optionsBag("melSpectrogram", options);
  if (!(samples instanceof Float32Array)) {
    requestObject("melSpectrogram", samples);
    const request = samples;
    return melSpectrogram(
      request.samples,
      request.sampleRate,
      request.nFft,
      request.hopLength,
      request.nMels,
      request.fmin,
      request.fmax,
      request.htk,
      request
    );
  }
  assertAudioInput("melSpectrogram", samples, sampleRate, options);
  const fft = resolveFftOptions("melSpectrogram", nFft, hopLength);
  validatePositiveIntegers("melSpectrogram", { nMels });
  validateMelFrequencyRange("melSpectrogram", fmin, fmax, sampleRate);
  return requireModule8().melSpectrogram(
    samples,
    sampleRate,
    fft.nFft,
    fft.hopLength,
    nMels,
    fmin,
    fmax,
    htk
  );
}
function mfcc(samples, sampleRate = 22050, nFft = 2048, hopLength = 512, nMels = 128, nMfcc = 20, fmin = 0, fmax = 0, htk = false, lifter = 0, options = {}) {
  optionsBag("mfcc", options);
  if (!(samples instanceof Float32Array)) {
    requestObject("mfcc", samples);
    const request = samples;
    return mfcc(
      request.samples,
      request.sampleRate,
      request.nFft,
      request.hopLength,
      request.nMels,
      request.nMfcc,
      request.fmin,
      request.fmax,
      request.htk,
      request.lifter,
      request
    );
  }
  assertAudioInput("mfcc", samples, sampleRate, options);
  const fft = resolveFftOptions("mfcc", nFft, hopLength);
  validatePositiveIntegers("mfcc", { nMels, nMfcc });
  validateMelFrequencyRange("mfcc", fmin, fmax, sampleRate);
  return requireModule8().mfcc(
    samples,
    sampleRate,
    fft.nFft,
    fft.hopLength,
    nMels,
    nMfcc,
    fmin,
    fmax,
    htk,
    lifter
  );
}
function melDelta(features, nFeatures, nFrames, width = 9) {
  const request = features instanceof Float32Array ? { features, nFeatures: nFeatures ?? 0, nFrames: nFrames ?? 0, width } : requestObject("melDelta", features, "features");
  assertPositiveInteger("melDelta", request.nFeatures, "nFeatures");
  assertPositiveInteger("melDelta", request.nFrames, "nFrames");
  assertPositiveInteger("melDelta", request.width ?? 9, "width");
  if ((request.width ?? 9) < 3 || (request.width ?? 9) % 2 === 0) {
    throw new RangeError("melDelta: width must be an odd integer of at least 3");
  }
  if (request.features.length !== request.nFeatures * request.nFrames) {
    throw new RangeError("melDelta: feature matrix length must equal nFeatures * nFrames");
  }
  return requireModule8().melDelta(
    request.features,
    request.nFeatures,
    request.nFrames,
    request.width ?? 9
  );
}
function reassignedSpectrogram(samples, sampleRate = 22050, nFft = 2048, hopLength = 512, refPower = 1e-6, fillNan = false) {
  if (!(samples instanceof Float32Array)) {
    requestObject("reassignedSpectrogram", samples);
    const request = samples;
    return reassignedSpectrogram(
      request.samples,
      request.sampleRate,
      request.nFft,
      request.hopLength,
      request.refPower,
      request.fillNan
    );
  }
  assertAudioInput("reassignedSpectrogram", samples, sampleRate);
  assertPositiveInteger("reassignedSpectrogram", nFft, "nFft");
  assertPositiveInteger("reassignedSpectrogram", hopLength, "hopLength");
  assertFiniteScalar("reassignedSpectrogram", refPower, "refPower");
  if (refPower < 0) {
    throw new RangeError("reassignedSpectrogram: refPower must be non-negative");
  }
  return requireModule8().reassignedSpectrogram(
    samples,
    sampleRate,
    nFft,
    hopLength,
    refPower,
    fillNan
  );
}
function chroma(samples, sampleRate = 22050, nFft = 2048, hopLength = 512, options = {}) {
  optionsBag("chroma", options);
  if (!(samples instanceof Float32Array)) {
    requestObject("chroma", samples);
    const request = samples;
    return chroma(request.samples, request.sampleRate, request.nFft, request.hopLength, request);
  }
  assertAudioInput("chroma", samples, sampleRate, options);
  const fft = resolveFftOptions("chroma", nFft, hopLength);
  return requireModule8().chroma(samples, sampleRate, fft.nFft, fft.hopLength);
}

// src/metering.ts
var DEFAULT_SPECTRUM_N_FFT = 2048;
function assertOversampleFactor(fnName, factor) {
  const normalized = factor === 0 ? 4 : factor;
  if (!Number.isInteger(normalized) || normalized < 1 || normalized > 16 || (normalized & normalized - 1) !== 0) {
    throw new SonareError(
      4 /* InvalidParameter */,
      "InvalidParameter",
      `${fnName}: oversampleFactor must be 0 or a power of two from 1 to 16`
    );
  }
}
function requireModule9() {
  return getSonareModule();
}
function meteringPeakDb(samples, sampleRate = 22050, options = {}) {
  const request = samples instanceof Float32Array ? { samples, sampleRate, ...optionsBag("meteringPeakDb", options) } : requestObject("meteringPeakDb", samples);
  assertAudioInput("meteringPeakDb", request.samples, request.sampleRate ?? 22050, request);
  return requireModule9().meteringPeakDb(request.samples, request.sampleRate ?? 22050);
}
function meteringRmsDb(samples, sampleRate = 22050, options = {}) {
  const request = samples instanceof Float32Array ? { samples, sampleRate, ...optionsBag("meteringRmsDb", options) } : requestObject("meteringRmsDb", samples);
  assertAudioInput("meteringRmsDb", request.samples, request.sampleRate ?? 22050, request);
  return requireModule9().meteringRmsDb(request.samples, request.sampleRate ?? 22050);
}
function meteringSilenceRatio(samples, sampleRate = 22050, thresholdDb = -45, frameLength = 1024, hopLength = 256, options = {}) {
  const request = samples instanceof Float32Array ? {
    samples,
    sampleRate,
    thresholdDb,
    frameLength,
    hopLength,
    ...optionsBag("meteringSilenceRatio", options)
  } : requestObject("meteringSilenceRatio", samples);
  assertAudioInput("meteringSilenceRatio", request.samples, request.sampleRate ?? 22050, request);
  return requireModule9().meteringSilenceRatio(
    request.samples,
    request.sampleRate ?? 22050,
    request.thresholdDb ?? -45,
    request.frameLength ?? 1024,
    request.hopLength ?? 256
  );
}
function meteringCrestFactorDb(samples, sampleRate = 22050, options = {}) {
  const request = samples instanceof Float32Array ? { samples, sampleRate, ...optionsBag("meteringCrestFactorDb", options) } : requestObject("meteringCrestFactorDb", samples);
  assertAudioInput("meteringCrestFactorDb", request.samples, request.sampleRate ?? 22050, request);
  return requireModule9().meteringCrestFactorDb(request.samples, request.sampleRate ?? 22050);
}
function meteringCrestFactorDbStereo(request) {
  requestObject("meteringCrestFactorDbStereo", request, "request", true);
  assertAudioInput(
    "meteringCrestFactorDbStereo",
    request.left,
    request.sampleRate ?? 22050,
    request,
    "left"
  );
  assertAudioInput(
    "meteringCrestFactorDbStereo",
    request.right,
    request.sampleRate ?? 22050,
    request,
    "right"
  );
  return requireModule9().meteringCrestFactorDbStereo(
    request.left,
    request.right,
    request.sampleRate ?? 22050
  );
}
function meteringDcOffset(samples, sampleRate = 22050, options = {}) {
  const request = samples instanceof Float32Array ? { samples, sampleRate, ...optionsBag("meteringDcOffset", options) } : requestObject("meteringDcOffset", samples);
  assertAudioInput("meteringDcOffset", request.samples, request.sampleRate ?? 22050, request);
  return requireModule9().meteringDcOffset(request.samples, request.sampleRate ?? 22050);
}
function meteringTruePeakDb(samples, sampleRate = 22050, oversampleFactor = 4, options = {}) {
  const request = samples instanceof Float32Array ? { samples, sampleRate, oversampleFactor, ...optionsBag("meteringTruePeakDb", options) } : requestObject("meteringTruePeakDb", samples);
  assertAudioInput("meteringTruePeakDb", request.samples, request.sampleRate ?? 22050, request);
  const factor = request.oversampleFactor ?? 4;
  assertOversampleFactor("meteringTruePeakDb", factor);
  return requireModule9().meteringTruePeakDb(request.samples, request.sampleRate ?? 22050, factor);
}
function meteringDetectClipping(samples, sampleRate = 22050, options = {}) {
  const request = samples instanceof Float32Array ? { samples, sampleRate, ...optionsBag("meteringDetectClipping", options) } : requestObject("meteringDetectClipping", samples);
  assertAudioInput("meteringDetectClipping", request.samples, request.sampleRate ?? 22050, request);
  const minRegionSamples = request.minRegionSamples ?? 1;
  assertNonNegativeInteger("meteringDetectClipping", minRegionSamples, "minRegionSamples");
  return requireModule9().meteringDetectClipping(
    request.samples,
    request.sampleRate ?? 22050,
    request.threshold ?? 0.999,
    minRegionSamples
  );
}
function meteringDynamicRange(samples, sampleRate = 22050, options = {}) {
  const request = samples instanceof Float32Array ? { samples, sampleRate, ...optionsBag("meteringDynamicRange", options) } : requestObject("meteringDynamicRange", samples);
  assertAudioInput("meteringDynamicRange", request.samples, request.sampleRate ?? 22050, request);
  return requireModule9().meteringDynamicRange(
    request.samples,
    request.sampleRate ?? 22050,
    request.windowSec ?? 0,
    request.hopSec ?? 0,
    resolveOptionalNonNegative("meteringDynamicRange", request.lowPercentile, "lowPercentile"),
    resolveOptionalNonNegative("meteringDynamicRange", request.highPercentile, "highPercentile")
  );
}
function meteringStereoCorrelation(left, right, sampleRate = 22050, options = {}) {
  const request = left instanceof Float32Array ? {
    left,
    right,
    sampleRate,
    ...optionsBag("meteringStereoCorrelation", options)
  } : requestObject("meteringStereoCorrelation", left, "left");
  assertAudioInput(
    "meteringStereoCorrelation",
    request.left,
    request.sampleRate ?? 22050,
    request,
    "left"
  );
  assertAudioInput(
    "meteringStereoCorrelation",
    request.right,
    request.sampleRate ?? 22050,
    request,
    "right"
  );
  return requireModule9().meteringStereoCorrelation(
    request.left,
    request.right,
    request.sampleRate ?? 22050
  );
}
function meteringStereoWidth(left, right, sampleRate = 22050, options = {}) {
  const request = left instanceof Float32Array ? {
    left,
    right,
    sampleRate,
    ...optionsBag("meteringStereoWidth", options)
  } : requestObject("meteringStereoWidth", left, "left");
  assertAudioInput(
    "meteringStereoWidth",
    request.left,
    request.sampleRate ?? 22050,
    request,
    "left"
  );
  assertAudioInput(
    "meteringStereoWidth",
    request.right,
    request.sampleRate ?? 22050,
    request,
    "right"
  );
  return requireModule9().meteringStereoWidth(
    request.left,
    request.right,
    request.sampleRate ?? 22050
  );
}
function meteringVectorscope(left, right, sampleRate = 22050, options = {}) {
  const request = left instanceof Float32Array ? {
    left,
    right,
    sampleRate,
    ...optionsBag("meteringVectorscope", options)
  } : requestObject("meteringVectorscope", left, "left");
  assertAudioInput(
    "meteringVectorscope",
    request.left,
    request.sampleRate ?? 22050,
    request,
    "left"
  );
  assertAudioInput(
    "meteringVectorscope",
    request.right,
    request.sampleRate ?? 22050,
    request,
    "right"
  );
  return requireModule9().meteringVectorscopeDecimated(
    request.left,
    request.right,
    request.sampleRate ?? 22050,
    request.maxPoints ?? 0
  );
}
function meteringVectorscopeDecimated(left, right, sampleRate = 22050, maxPoints = 0, options = {}) {
  const request = left instanceof Float32Array ? {
    left,
    right,
    sampleRate,
    maxPoints,
    ...optionsBag("meteringVectorscopeDecimated", options)
  } : requestObject("meteringVectorscopeDecimated", left, "left");
  assertAudioInput(
    "meteringVectorscopeDecimated",
    request.left,
    request.sampleRate ?? 22050,
    request,
    "left"
  );
  assertAudioInput(
    "meteringVectorscopeDecimated",
    request.right,
    request.sampleRate ?? 22050,
    request,
    "right"
  );
  return requireModule9().meteringVectorscopeDecimated(
    request.left,
    request.right,
    request.sampleRate ?? 22050,
    request.maxPoints ?? 0
  );
}
function meteringPhaseScope(left, right, sampleRate = 22050, options = {}) {
  const request = left instanceof Float32Array ? {
    left,
    right,
    sampleRate,
    ...optionsBag("meteringPhaseScope", options)
  } : requestObject("meteringPhaseScope", left, "left");
  assertAudioInput(
    "meteringPhaseScope",
    request.left,
    request.sampleRate ?? 22050,
    request,
    "left"
  );
  assertAudioInput(
    "meteringPhaseScope",
    request.right,
    request.sampleRate ?? 22050,
    request,
    "right"
  );
  return requireModule9().meteringPhaseScopeDecimated(
    request.left,
    request.right,
    request.sampleRate ?? 22050,
    request.maxPoints ?? 0
  );
}
function meteringPhaseScopeDecimated(left, right, sampleRate = 22050, maxPoints = 0, options = {}) {
  const request = left instanceof Float32Array ? {
    left,
    right,
    sampleRate,
    maxPoints,
    ...optionsBag("meteringPhaseScopeDecimated", options)
  } : requestObject("meteringPhaseScopeDecimated", left, "left");
  assertAudioInput(
    "meteringPhaseScopeDecimated",
    request.left,
    request.sampleRate ?? 22050,
    request,
    "left"
  );
  assertAudioInput(
    "meteringPhaseScopeDecimated",
    request.right,
    request.sampleRate ?? 22050,
    request,
    "right"
  );
  return requireModule9().meteringPhaseScopeDecimated(
    request.left,
    request.right,
    request.sampleRate ?? 22050,
    request.maxPoints ?? 0
  );
}
function meteringSpectrum(samples, sampleRate = 22050, options = {}) {
  const request = samples instanceof Float32Array ? { samples, sampleRate, ...optionsBag("meteringSpectrum", options) } : requestObject("meteringSpectrum", samples);
  assertAudioInput("meteringSpectrum", request.samples, request.sampleRate ?? 22050, request);
  return requireModule9().meteringSpectrum(request.samples, request.sampleRate ?? 22050, request);
}
function meteringSpectrumFrame(samples, sampleRate = 22050, frameOffset = 0, options = {}) {
  const request = samples instanceof Float32Array ? { samples, sampleRate, frameOffset, ...optionsBag("meteringSpectrumFrame", options) } : requestObject("meteringSpectrumFrame", samples);
  assertAudioInput("meteringSpectrumFrame", request.samples, request.sampleRate ?? 22050, {
    validate: false
  });
  const nFft = request.nFft ?? 0;
  assertSamplesInWindow(
    "meteringSpectrumFrame",
    request.samples,
    request.validate !== false,
    request.frameOffset ?? 0,
    nFft > 0 ? nFft : DEFAULT_SPECTRUM_N_FFT
  );
  return requireModule9().meteringSpectrumFrame(
    request.samples,
    request.sampleRate ?? 22050,
    request.frameOffset ?? 0,
    request
  );
}
function waveformPeaks(samples, channels, options = {}) {
  const request = samples instanceof Float32Array ? { samples, channels, ...optionsBag("waveformPeaks", options) } : requestObject("waveformPeaks", samples);
  assertAudioSamples("waveformPeaks", request.samples, request);
  assertInterleavedSamples("waveformPeaks", request.samples, request.channels, false);
  const samplesPerBucket = request.samplesPerBucket ?? 512;
  assertPositiveInteger("waveformPeaks", samplesPerBucket, "samplesPerBucket");
  return requireModule9().waveformPeaks(request.samples, request.channels, samplesPerBucket);
}
function waveformPeakPyramid(samples, channels, options = {}) {
  const request = samples instanceof Float32Array ? { samples, channels, ...optionsBag("waveformPeakPyramid", options) } : requestObject("waveformPeakPyramid", samples);
  assertAudioSamples("waveformPeakPyramid", request.samples, request);
  assertInterleavedSamples("waveformPeakPyramid", request.samples, request.channels, false);
  const levels = request.samplesPerBucketLevels ?? [512, 1024, 2048, 4096];
  if (levels.length === 0) {
    throw new RangeError("waveformPeakPyramid: samplesPerBucketLevels must not be empty");
  }
  levels.forEach((level, index) => {
    assertPositiveInteger("waveformPeakPyramid", level, `samplesPerBucketLevels[${index}]`);
  });
  return requireModule9().waveformPeakPyramid(request.samples, request.channels, levels);
}

// src/public_types_mastering.ts
var SOLO_PROCESSORS = [
  "dynamics.brickwallLimiter",
  "dynamics.compressor",
  "dynamics.deesser",
  "dynamics.duckingProcessor",
  "dynamics.expander",
  "dynamics.gate",
  "dynamics.limiter",
  "dynamics.parallelComp",
  "dynamics.sidechainRouter",
  "dynamics.transientShaper",
  "dynamics.upwardCompressor",
  "dynamics.upwardExpander",
  "dynamics.vocalRider",
  "effects.acoustic.roomMorph",
  "effects.delay.stereo",
  "effects.filter.vowel",
  "effects.gsEfx",
  "effects.modulation.autoWah",
  "effects.modulation.chorus",
  "effects.modulation.ensemble",
  "effects.modulation.flanger",
  "effects.modulation.phaser",
  "effects.modulation.pitchShifter",
  "effects.modulation.ringModulator",
  "effects.modulation.rotary",
  "effects.modulation.wah",
  "effects.reverb.convolution",
  "effects.reverb.dattorro",
  "effects.reverb.fdn",
  "effects.reverb.plate",
  "effects.reverb.room",
  "effects.reverb.velvet",
  "eq.bandPass",
  "eq.cutFilter",
  "eq.dynamic",
  "eq.equalizer",
  "eq.graphic",
  "eq.linearPhase",
  "eq.midSide",
  "eq.minimumPhase",
  "eq.parametric",
  "eq.passiveTube",
  "eq.shelving",
  "eq.steppedProportionalQ",
  "eq.tilt",
  "final.bitDepth",
  "final.dither",
  "final.outputChain",
  "maximizer.adaptiveRelease",
  "maximizer.loudnessOptimize",
  "maximizer.maximizer",
  "maximizer.softKneeMax",
  "maximizer.truePeakLimiter",
  "multiband.compressor",
  "multiband.dynamicEq",
  "multiband.expander",
  "multiband.imager",
  "multiband.limiter",
  "multiband.saturation",
  "repair.declick",
  "repair.declip",
  "repair.decrackle",
  "repair.dehum",
  "repair.denoiseClassical",
  "repair.dereverbClassical",
  "repair.trimSilence",
  "saturation.ampSim",
  "saturation.bitcrusher",
  "saturation.distortion",
  "saturation.exciter",
  "saturation.hardClipper",
  "saturation.multibandExciter",
  "saturation.overdrive",
  "saturation.softClipper",
  "saturation.tape",
  "saturation.transformer",
  "saturation.tube",
  "saturation.waveshaper",
  "spectral.airBand",
  "spectral.lowEndFocus",
  "spectral.presenceEnhancer",
  "spectral.spectralShaper",
  "stereo.autoPan",
  "stereo.binaural",
  "stereo.haasEnhancer",
  "stereo.imager",
  "stereo.monoMaker",
  "stereo.phaseAlign",
  "stereo.stereoBalance",
  "utility.gain",
  "voice.changer"
];

// src/public_types_music.ts
var PitchClass = {
  C: 0,
  Cs: 1,
  D: 2,
  Ds: 3,
  E: 4,
  F: 5,
  Fs: 6,
  G: 7,
  Gs: 8,
  A: 9,
  As: 10,
  B: 11
};
var Mode = {
  Major: 0,
  Minor: 1,
  Dorian: 2,
  Phrygian: 3,
  Lydian: 4,
  Mixolydian: 5,
  Locrian: 6
};
var KeyProfile = {
  KrumhanslSchmuckler: 0,
  Temperley: 1,
  Shaath: 2,
  FaraldoEDMT: 3,
  FaraldoEDMA: 4,
  FaraldoEDMM: 5,
  BellmanBudge: 6
};
var ChordQuality = {
  Major: 0,
  Minor: 1,
  Diminished: 2,
  Augmented: 3,
  Dominant7: 4,
  Major7: 5,
  Minor7: 6,
  Sus2: 7,
  Sus4: 8,
  Unknown: 9,
  Add9: 10,
  MinorAdd9: 11,
  Dim7: 12,
  HalfDim7: 13,
  Major9: 14,
  Dominant9: 15,
  Sus2Add4: 16,
  Major6: 17,
  Minor6: 18,
  MinorMajor7: 19,
  Dominant7Sus4: 20,
  Dominant11: 21,
  Dominant13: 22,
  Dominant7Flat9: 23,
  Dominant7Sharp9: 24
};
var SectionType = {
  Intro: 0,
  Verse: 1,
  PreChorus: 2,
  Chorus: 3,
  Bridge: 4,
  Instrumental: 5,
  Outro: 6,
  Unknown: 7
};

// src/codes.ts
function resolveOrdinalInRange(value, min, max, enumName) {
  if (typeof value !== "number" || !Number.isSafeInteger(value) || value < min || value > max) {
    throw new RangeError(`Invalid ${enumName}: ${String(value)}`);
  }
  return value;
}
function resolveEnumOrdinal(value, values, enumName) {
  if (typeof value === "number") {
    const ordinals = Object.values(values);
    const ordinal = resolveOrdinalInRange(
      value,
      Math.min(...ordinals),
      Math.max(...ordinals),
      enumName
    );
    if (!ordinals.includes(ordinal)) {
      throw new RangeError(`Invalid ${enumName}: ${String(value)}`);
    }
    return ordinal;
  }
  if (typeof value === "string") {
    const ordinal = values[value];
    if (ordinal !== void 0) {
      return ordinal;
    }
  }
  throw new RangeError(`Invalid ${enumName}: ${String(value)}`);
}
var AUTOMATION_CURVE_VALUES = {
  linear: 0,
  exponential: 1,
  hold: 2,
  "s-curve": 3
};
var PROJECT_AUTOMATION_CURVE_VALUES = {
  ...AUTOMATION_CURVE_VALUES,
  scurve: 3
};

// src/analysis_helpers.ts
var PITCH_CLASS_NAMES = [
  "C",
  "C#",
  "D",
  "D#",
  "E",
  "F",
  "F#",
  "G",
  "G#",
  "A",
  "A#",
  "B"
];
function pitchClassName(value) {
  return PITCH_CLASS_NAMES[value] ?? "C";
}
var KEY_MODE_NAMES = [
  "major",
  "minor",
  "dorian",
  "phrygian",
  "lydian",
  "mixolydian",
  "locrian"
];
function keyModeName(ordinal) {
  const name = KEY_MODE_NAMES[ordinal];
  if (name === void 0) {
    throw new RangeError(`Invalid key mode: ${String(ordinal)}`);
  }
  return name;
}
function convertKeyCandidate(wasm) {
  return {
    key: {
      root: wasm.key.root,
      mode: keyModeName(wasm.key.mode),
      confidence: wasm.key.confidence,
      name: wasm.key.name,
      shortName: wasm.key.shortName
    },
    correlation: wasm.correlation
  };
}
var KEY_MODE_VALUES = {
  major: Mode.Major,
  minor: Mode.Minor,
  dorian: Mode.Dorian,
  phrygian: Mode.Phrygian,
  lydian: Mode.Lydian,
  mixolydian: Mode.Mixolydian,
  locrian: Mode.Locrian
};
var KEY_PROFILE_VALUES = {
  ks: KeyProfile.KrumhanslSchmuckler,
  krumhansl: KeyProfile.KrumhanslSchmuckler,
  temperley: KeyProfile.Temperley,
  shaath: KeyProfile.Shaath,
  keyfinder: KeyProfile.Shaath,
  "faraldo-edmt": KeyProfile.FaraldoEDMT,
  edmt: KeyProfile.FaraldoEDMT,
  "faraldo-edma": KeyProfile.FaraldoEDMA,
  edma: KeyProfile.FaraldoEDMA,
  "faraldo-edmm": KeyProfile.FaraldoEDMM,
  edmm: KeyProfile.FaraldoEDMM,
  "bellman-budge": KeyProfile.BellmanBudge,
  bellman: KeyProfile.BellmanBudge
};
var PITCH_CLASS_VALUES = Object.fromEntries(
  PITCH_CLASS_NAMES.map((name, ordinal) => [name, ordinal])
);
function assertNameOrOrdinal(value, field, what) {
  if (typeof value !== "number" && typeof value !== "string") {
    throw new TypeError(`${field} must be ${what} name or ordinal`);
  }
}
function keyModeOrdinal(mode, field = "key mode") {
  assertNameOrOrdinal(mode, field, "a mode");
  return resolveEnumOrdinal(mode, KEY_MODE_VALUES, field);
}
function pitchClassOrdinal(root, field = "pitch class") {
  assertNameOrOrdinal(root, field, "a pitch class");
  return resolveEnumOrdinal(root, PITCH_CLASS_VALUES, field);
}
function keyModeValues(modes) {
  if (!modes) {
    return [];
  }
  if (modes === "major-minor") {
    return [Mode.Major, Mode.Minor];
  }
  if (modes === "all" || modes === "modal") {
    return [
      Mode.Major,
      Mode.Minor,
      Mode.Dorian,
      Mode.Phrygian,
      Mode.Lydian,
      Mode.Mixolydian,
      Mode.Locrian
    ];
  }
  return modes.map((mode) => resolveEnumOrdinal(mode, KEY_MODE_VALUES, "key mode"));
}
function keyProfileValue(profile) {
  if (profile === void 0) {
    return -1;
  }
  return resolveEnumOrdinal(profile, KEY_PROFILE_VALUES, "key profile");
}
function convertChordAnalysisResult(wasm) {
  return {
    chords: wasm.chords.map((c) => ({
      root: c.root,
      bass: c.bass,
      rootName: pitchClassName(c.root),
      bassName: pitchClassName(c.bass),
      quality: c.quality,
      start: c.start,
      end: c.end,
      duration: c.end - c.start,
      confidence: c.confidence,
      name: c.name
    })),
    tuning: wasm.tuning
  };
}
function chordChromaMethodValue(method) {
  if (method === "stft") {
    return 0;
  }
  if (method === "nnls") {
    return 1;
  }
  throw new RangeError(`Invalid chord chroma method: ${method}`);
}
function convertAnalysisResult(wasm) {
  const beatTimes = new Float32Array(wasm.beats.length);
  for (let i = 0; i < wasm.beats.length; i++) {
    beatTimes[i] = wasm.beats[i].time;
  }
  return {
    bpm: wasm.bpm,
    bpmConfidence: wasm.bpmConfidence,
    bpmCandidates: wasm.bpmCandidates.map((candidate) => ({
      value: candidate.value,
      confidence: candidate.confidence,
      relation: candidate.relation
    })),
    key: {
      root: wasm.key.root,
      mode: keyModeName(wasm.key.mode),
      confidence: wasm.key.confidence,
      name: wasm.key.name,
      shortName: wasm.key.shortName
    },
    timeSignature: wasm.timeSignature,
    timeSignatureCandidates: wasm.timeSignatureCandidates,
    beatTimes,
    beats: wasm.beats,
    downbeatIndices: wasm.downbeatIndices,
    downbeatPhase: wasm.downbeatPhase,
    beatObservations: wasm.beatObservations,
    beatLocalBpm: wasm.beatLocalBpm,
    chords: wasm.chords.map((c) => ({
      root: c.root,
      bass: c.bass,
      rootName: pitchClassName(c.root),
      bassName: pitchClassName(c.bass),
      quality: c.quality,
      start: c.start,
      end: c.end,
      duration: c.end - c.start,
      confidence: c.confidence,
      name: c.name,
      romanNumeral: c.romanNumeral
    })),
    sections: wasm.sections.map((s) => ({
      type: s.type,
      start: s.start,
      end: s.end,
      energyLevel: s.energyLevel,
      confidence: s.confidence,
      name: s.name
    })),
    timbre: wasm.timbre,
    dynamics: wasm.dynamics,
    rhythm: wasm.rhythm,
    melody: wasm.melody,
    form: wasm.form,
    tuning: wasm.tuning
  };
}

// src/quick_analysis.ts
function requireModule10() {
  return getSonareModule();
}
function detectBpm(samples, sampleRate = 22050, options = {}) {
  const request = samples instanceof Float32Array ? { samples, sampleRate, ...optionsBag("detectBpm", options) } : requestObject("detectBpm", samples);
  assertAudioInput("detectBpm", request.samples, request.sampleRate ?? 22050, request);
  return requireModule10().detectBpm(request.samples, request.sampleRate ?? 22050);
}
function detectKey(samples, sampleRate = 22050, options = {}) {
  const request = samples instanceof Float32Array ? { samples, sampleRate, ...optionsBag("detectKey", options) } : requestObject("detectKey", samples);
  assertAudioInput("detectKey", request.samples, request.sampleRate ?? 22050, request);
  const result = requireModule10()._detectKeyWithOptions(
    request.samples,
    request.sampleRate ?? 22050,
    request.nFft ?? 4096,
    request.hopLength ?? 512,
    request.useHpss ?? false,
    request.loudnessWeighted ?? false,
    request.highPassHz ?? 0,
    keyModeValues(request.modes),
    keyProfileValue(request.profile),
    request.genreHint ?? "",
    request.tuning ?? 0
  );
  return {
    root: result.root,
    mode: keyModeName(result.mode),
    confidence: result.confidence,
    name: result.name,
    shortName: result.shortName,
    tuning: result.tuning
  };
}
function detectKeyCandidates(samples, sampleRate = 22050, options = {}) {
  const request = samples instanceof Float32Array ? { samples, sampleRate, ...optionsBag("detectKeyCandidates", options) } : requestObject("detectKeyCandidates", samples);
  assertAudioInput("detectKeyCandidates", request.samples, request.sampleRate ?? 22050, request);
  const candidates = requireModule10()._detectKeyCandidates(
    request.samples,
    request.sampleRate ?? 22050,
    request.nFft ?? 4096,
    request.hopLength ?? 512,
    request.useHpss ?? false,
    request.loudnessWeighted ?? false,
    request.highPassHz ?? 0,
    keyModeValues(request.modes),
    keyProfileValue(request.profile),
    request.genreHint ?? ""
  );
  return Array.from(candidates, convertKeyCandidate);
}
function detectOnsets(samples, sampleRate = 22050, options = {}) {
  const request = samples instanceof Float32Array ? { samples, sampleRate, ...optionsBag("detectOnsets", options) } : requestObject("detectOnsets", samples);
  assertAudioInput("detectOnsets", request.samples, request.sampleRate ?? 22050, request);
  return requireModule10().detectOnsets(request.samples, request.sampleRate ?? 22050, request);
}
function detectBeats(samples, sampleRate = 22050, options = {}) {
  const request = samples instanceof Float32Array ? { samples, sampleRate, ...optionsBag("detectBeats", options) } : requestObject("detectBeats", samples);
  assertAudioInput("detectBeats", request.samples, request.sampleRate ?? 22050, request);
  return requireModule10().detectBeats(request.samples, request.sampleRate ?? 22050);
}
function detectDownbeats(samples, sampleRate = 22050, options = {}) {
  const request = samples instanceof Float32Array ? { samples, sampleRate, ...optionsBag("detectDownbeats", options) } : requestObject("detectDownbeats", samples);
  assertAudioInput("detectDownbeats", request.samples, request.sampleRate ?? 22050, request);
  return requireModule10().detectDownbeats(request.samples, request.sampleRate ?? 22050);
}
function detectChords(samples, sampleRate = 22050, options = {}) {
  const request = samples instanceof Float32Array ? { samples, sampleRate, ...optionsBag("detectChords", options) } : requestObject("detectChords", samples);
  assertAudioInput("detectChords", request.samples, request.sampleRate ?? 22050, request);
  const result = requireModule10().detectChords(
    request.samples,
    request.sampleRate ?? 22050,
    request.minDuration ?? 0.3,
    request.smoothingWindow ?? 2,
    request.threshold ?? 0.5,
    request.useTriadsOnly ?? false,
    request.nFft ?? 2048,
    request.hopLength ?? 512,
    request.useBeatSync ?? true,
    request.useHmm ?? false,
    request.hmmBeamWidth ?? 24,
    request.useKeyContext ?? false,
    pitchClassOrdinal(request.keyRoot ?? PitchClass.C, "keyRoot"),
    keyModeOrdinal(request.keyMode ?? Mode.Major, "keyMode"),
    request.detectInversions ?? false,
    chordChromaMethodValue(request.chromaMethod ?? "stft"),
    request.tuning ?? 0
  );
  return convertChordAnalysisResult(result);
}
function chordFunctionalAnalysis(samples, keyRoot, keyMode, sampleRate = 22050, options = {}) {
  const request = samples instanceof Float32Array ? { samples, keyRoot, keyMode, sampleRate, ...optionsBag("chordFunctionalAnalysis", options) } : requestObject("chordFunctionalAnalysis", samples);
  assertAudioInput(
    "chordFunctionalAnalysis",
    request.samples,
    request.sampleRate ?? 22050,
    request
  );
  const analysed = requireModule10().chordFunctionalAnalysis(
    request.samples,
    pitchClassOrdinal(request.keyRoot, "keyRoot"),
    keyModeOrdinal(request.keyMode ?? Mode.Major, "keyMode"),
    request.sampleRate ?? 22050,
    request.minDuration ?? 0.3,
    request.smoothingWindow ?? 2,
    request.threshold ?? 0.5,
    request.useTriadsOnly ?? false,
    request.nFft ?? 2048,
    request.hopLength ?? 512,
    request.useBeatSync ?? true,
    request.useHmm ?? false,
    request.hmmBeamWidth ?? 24,
    request.useKeyContext ?? false,
    request.detectInversions ?? false,
    chordChromaMethodValue(request.chromaMethod ?? "stft"),
    request.tuning ?? 0
  );
  return convertChordAnalysisResult(analysed).chords.map((chord, i) => ({
    ...chord,
    roman: analysed.roman[i],
    function: analysed.functions[i]
  }));
}
function analyze(samples, sampleRate = 22050, options = {}) {
  const request = samples instanceof Float32Array ? { samples, sampleRate, ...optionsBag("analyze", options) } : requestObject("analyze", samples);
  assertAudioInput("analyze", request.samples, request.sampleRate ?? 22050, request);
  const result = requireModule10().analyze(request.samples, request.sampleRate ?? 22050, request);
  return convertAnalysisResult(result);
}
function estimateMeter(request) {
  requestObject("estimateMeter", request, "request", true);
  return requireModule10().estimateMeter(request.beatTimes, request.beatStrengths, request);
}
function analyzeImpulseResponse(samples, sampleRate = 48e3, nOctaveBands = 6, minDecayDb) {
  const request = samples instanceof Float32Array ? { samples, sampleRate, nOctaveBands, minDecayDb } : requestObject("analyzeImpulseResponse", samples);
  const resolvedMinDecayDb = request.minDecayDb === void 0 ? 30 : request.minDecayDb;
  assertFiniteScalar("analyzeImpulseResponse", resolvedMinDecayDb, "minDecayDb");
  if (resolvedMinDecayDb <= 0) {
    throw new RangeError("analyzeImpulseResponse: minDecayDb must be greater than zero");
  }
  assertAudioInput("analyzeImpulseResponse", request.samples, request.sampleRate ?? 48e3, request);
  const result = requireModule10().analyzeImpulseResponseEx(
    request.samples,
    request.sampleRate ?? 48e3,
    request.nOctaveBands ?? 6,
    resolvedMinDecayDb
  );
  return result;
}
function detectAcoustic(samples, sampleRate = 48e3, options = {}) {
  const request = samples instanceof Float32Array ? { samples, sampleRate, ...optionsBag("detectAcoustic", options) } : requestObject("detectAcoustic", samples);
  assertAudioInput("detectAcoustic", request.samples, request.sampleRate ?? 48e3, request);
  const result = requireModule10().detectAcoustic(
    request.samples,
    request.sampleRate ?? 48e3,
    request.nOctaveBands ?? 6,
    request.nThirdOctaveSubbands ?? 24,
    request.minDecayDb ?? 30,
    request.noiseFloorMarginDb ?? 10
  );
  return result;
}
function analyzeWithProgress(samples, sampleRate = 22050, onProgress, options) {
  const request = requestObject(
    "analyzeWithProgress",
    samples instanceof Float32Array ? { samples, sampleRate, onProgress, options } : samples
  );
  assertAudioInput("analyzeWithProgress", request.samples, request.sampleRate ?? 22050, request);
  const flat = {};
  for (const key of MUSIC_ANALYZE_OPTION_KEYS) {
    const value = request[key];
    if (value !== void 0) {
      flat[key] = value;
    }
  }
  const result = requireModule10().analyzeWithProgress(
    request.samples,
    request.sampleRate ?? 22050,
    { ...flat, ...request.options },
    request.onProgress ?? (() => {
    }),
    request.cancel ?? (() => false)
  );
  return convertAnalysisResult(result);
}
function analyzeBpm(samples, sampleRate = 22050, options = {}) {
  const request = samples instanceof Float32Array ? { samples, sampleRate, ...optionsBag("analyzeBpm", options) } : requestObject("analyzeBpm", samples);
  assertAudioInput("analyzeBpm", request.samples, request.sampleRate ?? 22050, request);
  assertNonNegativeInteger("analyzeBpm", request.maxCandidates ?? 5, "maxCandidates");
  return requireModule10().analyzeBpm(
    request.samples,
    request.sampleRate ?? 22050,
    request.bpmMin ?? 30,
    request.bpmMax ?? 300,
    request.startBpm ?? 120,
    request.nFft ?? 2048,
    request.hopLength ?? 512,
    request.maxCandidates ?? 5
  );
}
function analyzeRhythm(samples, sampleRate = 22050, options = {}) {
  const request = samples instanceof Float32Array ? { samples, sampleRate, ...optionsBag("analyzeRhythm", options) } : requestObject("analyzeRhythm", samples);
  assertAudioInput("analyzeRhythm", request.samples, request.sampleRate ?? 22050, request);
  return requireModule10().analyzeRhythm(
    request.samples,
    request.sampleRate ?? 22050,
    request.bpmMin ?? 60,
    request.bpmMax ?? 200,
    request.startBpm ?? 120,
    request.nFft ?? 2048,
    request.hopLength ?? 512
  );
}
function analyzeDynamics(samples, sampleRate = 22050, options = {}) {
  const request = samples instanceof Float32Array ? { samples, sampleRate, ...optionsBag("analyzeDynamics", options) } : requestObject("analyzeDynamics", samples);
  assertAudioInput("analyzeDynamics", request.samples, request.sampleRate ?? 22050, request);
  return requireModule10().analyzeDynamics(
    request.samples,
    request.sampleRate ?? 22050,
    request.windowSec ?? 0.4,
    request.hopLength ?? 512,
    request.compressionThreshold ?? 6
  );
}
function analyzeTimbre(samples, sampleRate = 22050, options = {}) {
  const request = samples instanceof Float32Array ? { samples, sampleRate, ...optionsBag("analyzeTimbre", options) } : requestObject("analyzeTimbre", samples);
  assertAudioInput("analyzeTimbre", request.samples, request.sampleRate ?? 22050, request);
  return requireModule10().analyzeTimbre(
    request.samples,
    request.sampleRate ?? 22050,
    request.nFft ?? 2048,
    request.hopLength ?? 512,
    request.nMels ?? 128,
    request.nMfcc ?? 13,
    request.windowSec ?? 0.5
  );
}
function hasFfmpegSupport() {
  return requireModule10().hasFfmpegSupport();
}

// src/analysis.ts
var module = null;
var initPromise = null;
var firstInitOptions;
async function init(options) {
  if (module) {
    assertSameInitOptions(firstInitOptions, options);
    return;
  }
  if (initPromise) {
    assertSameInitOptions(firstInitOptions, options);
    return initPromise;
  }
  firstInitOptions = options && { ...options };
  initPromise = (async () => {
    try {
      const createModule = options?.moduleFactory ?? (await import("./sonare-analysis.js")).default;
      const created = await createModule(options);
      assertAbiCompatible(created);
      module = created;
      setSonareModule(module);
    } catch (error) {
      initPromise = null;
      firstInitOptions = void 0;
      throw error;
    }
  })();
  return initPromise;
}
function isInitialized() {
  return module !== null;
}
function version() {
  if (!module) {
    throw notInitializedError();
  }
  return module.version();
}
function capabilities() {
  if (!module) {
    throw notInitializedError();
  }
  return module.capabilities();
}
function abiVersion() {
  if (!module) {
    throw notInitializedError();
  }
  return module.abiVersion();
}
function engineAbiVersion() {
  if (!module) {
    throw notInitializedError();
  }
  return module.engineAbiVersion();
}
function voiceChangerAbiVersion() {
  if (!module) {
    throw notInitializedError();
  }
  return module.voiceChangerAbiVersion();
}
export {
  ChordQuality,
  EXPECTED_ABI_VERSION,
  ErrorCode,
  KeyProfile,
  Mode,
  PitchClass,
  SOLO_PROCESSORS,
  SectionType,
  SonareError,
  abiVersion,
  amplitudeToDb,
  analyze,
  analyzeBpm,
  analyzeDynamics,
  analyzeImpulseResponse,
  analyzeMelody,
  analyzeRhythm,
  analyzeSections,
  analyzeTimbre,
  analyzeWithProgress,
  bassChroma,
  capabilities,
  chirp,
  chordFunctionalAnalysis,
  chroma,
  chromaCens,
  chromaCqt,
  clicks,
  cqt,
  cqtToAudio,
  cyclicTempogram,
  dbToAmplitude,
  dbToPower,
  deemphasis,
  detectAcoustic,
  detectBeats,
  detectBoundaries,
  detectBpm,
  detectChords,
  detectDownbeats,
  detectKey,
  detectKeyCandidates,
  detectOnsets,
  ebur128LoudnessRange,
  engineAbiVersion,
  estimateMeter,
  estimateTuning,
  fixFrames,
  fixLength,
  fourierTempogram,
  frameSignal,
  framesToSamples,
  framesToTime,
  griffinLim,
  hasFfmpegSupport,
  hybridCqt,
  hzToMel,
  hzToMidi,
  hzToNote,
  init,
  isInitialized,
  isSonareError,
  lufs,
  lufsInterleaved,
  lufsSeriesInterleaved,
  melDelta,
  melSpectrogram,
  melToAudio,
  melToHz,
  melToStft,
  meteringCrestFactorDb,
  meteringCrestFactorDbStereo,
  meteringDcOffset,
  meteringDetectClipping,
  meteringDynamicRange,
  meteringPeakDb,
  meteringPhaseScope,
  meteringPhaseScopeDecimated,
  meteringRmsDb,
  meteringSilenceRatio,
  meteringSpectrum,
  meteringSpectrumFrame,
  meteringStereoCorrelation,
  meteringStereoWidth,
  meteringTruePeakDb,
  meteringVectorscope,
  meteringVectorscopeDecimated,
  mfcc,
  mfccToAudio,
  mfccToMel,
  midiToHz,
  momentaryLufs,
  nnlsChroma,
  noteSegments,
  noteToHz,
  onsetBacktrack,
  onsetEnvelope,
  onsetStrengthMulti,
  padCenter,
  pcen,
  peakPick,
  piptrack,
  pitchPyin,
  pitchTuning,
  pitchYin,
  plp,
  polyFeatures,
  powerToDb,
  preemphasis,
  pseudoCqt,
  reassignedSpectrogram,
  referenceHzToTuning,
  rmsEnergy,
  samplesToFrames,
  segmentAgglomerative,
  segmentCrossSimilarity,
  segmentLagToRecurrence,
  segmentPathEnhance,
  segmentRecurrenceMatrix,
  segmentRecurrenceToLag,
  segmentSubsegment,
  shortTermLufs,
  spectralBandwidth,
  spectralCentroid,
  spectralContrast,
  spectralFlatness,
  spectralFlux,
  spectralRolloff,
  splitSilence,
  splitSilenceCommon,
  splitSilenceCommonWithReport,
  stft,
  stftDb,
  tempogram,
  tempogramRatio,
  timeToFrames,
  tone,
  tonnetz,
  trimSilence,
  tuningToReferenceHz,
  vectorNormalize,
  version,
  voiceChangerAbiVersion,
  vqt,
  vqtToAudio,
  waveformPeakPyramid,
  waveformPeaks,
  zeroCrossingRate,
  zeroCrossings
};
//# sourceMappingURL=analysis.js.map