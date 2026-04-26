let transcriberPromise: Promise<(audio: Float32Array, options?: Record<string, unknown>) => Promise<{ text: string }>> | null =
  null;

const getTranscriber = async () => {
  if (!transcriberPromise) {
    transcriberPromise = (async () => {
      const { env, pipeline } = await import('@xenova/transformers');
      env.allowLocalModels = true;
      env.allowRemoteModels = true;
      env.useBrowserCache = false;

      const transcriber = await pipeline('automatic-speech-recognition', 'Xenova/whisper-tiny');
      return transcriber as (audio: Float32Array, options?: Record<string, unknown>) => Promise<{ text: string }>;
    })();
  }

  return transcriberPromise;
};

export const transcribePcm = async (pcmSamples: Float32Array) => {
  const transcriber = await getTranscriber();
  const result = await transcriber(pcmSamples, {
    language: 'zh',
    task: 'transcribe',
    return_timestamps: false,
    chunk_length_s: 20,
    stride_length_s: 5
  });

  return result.text.trim();
};
