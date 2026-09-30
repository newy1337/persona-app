/** Isolated native media process. No Telegram session or API credentials are passed here. */
import {
  NTgCalls,
  MediaSource,
  StreamMode,
  StreamDevice,
  ConnectionState,
  LogLevel,
  setLogLevel,
} from 'ntgcalls';
setLogLevel(LogLevel.SILENT);
const rtc = new NTgCalls();
const id = 1n;
const send = (data: unknown) => {
  if (process.connected) process.send?.(data);
};
rtc.onSignalingData((_id, data) =>
  send({ event: 'signal', data: Buffer.from(data) }),
);
rtc.onConnectionChange((_id, state) =>
  send({
    event: 'state',
    state: Object.entries(ConnectionState).find(
      ([, value]) => value === state.state,
    )?.[0],
  }),
);
rtc.onFrames((_id, mode, device, frames) => {
  if (mode !== StreamMode.PLAYBACK || device !== StreamDevice.MICROPHONE)
    return;
  for (const frame of frames)
    send({ event: 'audio', data: Buffer.from(frame.data) });
});
const bytes = (v: Buffer) => Array.from(v) as unknown as Buffer;
const audio = {
  mediaSource: MediaSource.EXTERNAL,
  sampleRate: 48000,
  channelCount: 1,
  input: '',
  keepOpen: true,
};
let initialized = false;
process.on('message', async (m: any) => {
  try {
    let result: any;
    switch (m.op) {
      case 'init':
        await rtc.createP2pCall(id);
        initialized = true;
        await rtc.setStreamSources(id, StreamMode.CAPTURE, {
          microphone: audio,
        });
        await rtc.setStreamSources(id, StreamMode.PLAYBACK, {
          microphone: audio,
        });
        result = {
          hash: Buffer.from(
            await rtc.initExchange(
              id,
              { ...m.data, p: bytes(m.data.p), random: bytes(m.data.random) },
              null as any,
            ),
          ),
          protocol: { ...NTgCalls.getProtocol(), libraryVersions: ['9.0.0'] },
        };
        break;
      case 'exchange':
        result = await rtc.exchangeKeys(id, bytes(m.data), 0n);
        result.gAOrB = Buffer.from(result.gAOrB);
        break;
      case 'connect':
        await rtc.connectP2p(
          id,
          m.data.servers.map((s) => ({
            ...s,
            ...(s.peerTag ? { peerTag: bytes(s.peerTag) } : {}),
          })),
          m.data.versions.filter((v) => v === '9.0.0'),
          false,
          m.data.params || '{}',
        );
        break;
      case 'signal':
        await rtc.sendSignalingData(id, bytes(m.data));
        break;
      case 'audio':
        if (initialized && Buffer.isBuffer(m.data) && m.data.length === 960)
          await rtc.sendExternalFrame(
            id,
            StreamDevice.MICROPHONE,
            bytes(m.data),
            {
              absoluteCaptureTimestampMs: BigInt(Date.now()),
              rotation: 0,
              width: 0,
              height: 0,
            },
          );
        break;
      case 'stop':
        if (initialized) await rtc.stop(id);
        process.exit(0);
      default:
        throw Error('Unknown media operation');
    }
    if (m.request) send({ request: m.request, result });
  } catch (e) {
    if (m.request)
      send({
        request: m.request,
        error: String(e?.message || 'Media error').slice(0, 200),
      });
  }
});
process.on('disconnect', () => process.exit(0));
send({ event: 'ready' });
