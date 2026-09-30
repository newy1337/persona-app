/* PCM16 mono at 48 kHz; 10 ms packets expected by the server call engine. */
class VoicerAudio extends AudioWorkletProcessor {
  constructor() {
    super(); this.capture = new Int16Array(480); this.index = 0;
    this.playback = []; this.offset = 0; this.queued = 0;
    this.port.onmessage = ({ data }) => {
      if (!(data instanceof ArrayBuffer) || data.byteLength % 2 || data.byteLength > 9600) return;
      if (this.queued > 14400) { this.playback = []; this.offset = 0; this.queued = 0; }
      const samples = new Int16Array(data); this.playback.push(samples); this.queued += samples.length;
    };
  }
  process(inputs, outputs) {
    const input = inputs[0]?.[0], output = outputs[0]?.[0];
    if (input) for (const value of input) {
      this.capture[this.index++] = Math.round(Math.max(-1, Math.min(1, value)) * 32767);
      if (this.index === 480) { const packet = this.capture.buffer; this.port.postMessage(packet, [packet]); this.capture = new Int16Array(480); this.index = 0; }
    }
    if (output) for (let i = 0; i < output.length; i++) {
      const frame = this.playback[0];
      if (!frame) { output[i] = 0; continue; }
      output[i] = frame[this.offset++] / 32768; this.queued--;
      if (this.offset >= frame.length) { this.playback.shift(); this.offset = 0; }
    }
    return true;
  }
}
registerProcessor('voicer-audio', VoicerAudio);
