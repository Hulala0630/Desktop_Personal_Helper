const TARGET_SAMPLE_RATE = 16_000;

const audioBufferToMono = (audioBuffer: AudioBuffer) => {
  if (audioBuffer.numberOfChannels === 1) {
    return new Float32Array(audioBuffer.getChannelData(0));
  }

  const channelData = Array.from({ length: audioBuffer.numberOfChannels }, (_, index) =>
    audioBuffer.getChannelData(index)
  );
  const mono = new Float32Array(audioBuffer.length);

  for (let sampleIndex = 0; sampleIndex < audioBuffer.length; sampleIndex += 1) {
    let total = 0;
    for (const channel of channelData) {
      total += channel[sampleIndex] ?? 0;
    }
    mono[sampleIndex] = total / channelData.length;
  }

  return mono;
};

const resampleTo16k = async (audioBuffer: AudioBuffer) => {
  if (audioBuffer.sampleRate === TARGET_SAMPLE_RATE) {
    return audioBufferToMono(audioBuffer);
  }

  const frameCount = Math.ceil((audioBuffer.duration || 0) * TARGET_SAMPLE_RATE);
  const offlineContext = new OfflineAudioContext(1, frameCount, TARGET_SAMPLE_RATE);
  const source = offlineContext.createBufferSource();
  source.buffer = audioBuffer;
  source.connect(offlineContext.destination);
  source.start(0);

  const renderedBuffer = await offlineContext.startRendering();
  return new Float32Array(renderedBuffer.getChannelData(0));
};

export const decodeBlobToPcm = async (audioBlob: Blob) => {
  const arrayBuffer = await audioBlob.arrayBuffer();
  const audioContext = new AudioContext();

  try {
    const decodedBuffer = await audioContext.decodeAudioData(arrayBuffer.slice(0));
    return await resampleTo16k(decodedBuffer);
  } finally {
    await audioContext.close();
  }
};
