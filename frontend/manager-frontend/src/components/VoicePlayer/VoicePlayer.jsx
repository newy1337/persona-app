import { useEffect, useRef, useState } from 'react';
import styles from './VoicePlayer.module.scss';
import { BARS, fallbackPeaks, fmtClock, peaksFromSamples, seekRatio } from './voiceWave';

const SPEEDS = [1, 1.5, 2];

export default function VoicePlayer({ src, onListened = null }) {
  const audioRef = useRef(null);
  const waveRef = useRef(null);
  const [playing, setPlaying] = useState(false);
  const [current, setCurrent] = useState(0);
  const [duration, setDuration] = useState(0);
  const [peaks, setPeaks] = useState(() => fallbackPeaks(src, BARS));
  const [speed, setSpeed] = useState(1);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    let cancelled = false;
    setPeaks(fallbackPeaks(src, BARS));
    const Ctx = typeof window !== 'undefined' && (window.AudioContext || window.webkitAudioContext);
    if (!src || !Ctx || typeof fetch !== 'function') return undefined;
    (async () => {
      try {
        const res = await fetch(src);
        if (!res.ok) return;
        const data = await res.arrayBuffer();
        const ctx = new Ctx();
        const buffer = await ctx.decodeAudioData(data);
        if (ctx.close) ctx.close();
        if (cancelled) return;
        setPeaks(peaksFromSamples(buffer.getChannelData(0), BARS));
        setDuration((d) => (Number.isFinite(d) && d > 0 ? d : buffer.duration));
      } catch {
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [src]);

  useEffect(() => {
    if (audioRef.current) audioRef.current.playbackRate = speed;
  }, [speed]);

  async function toggle() {
    const audio = audioRef.current;
    if (!audio) return;
    if (audio.paused) {
      try {
        await audio.play();
      } catch {
        setFailed(true);
      }
    } else {
      audio.pause();
    }
  }

  function seek(e) {
    const audio = audioRef.current;
    const total = duration || (audio ? audio.duration : 0);
    if (!audio || !Number.isFinite(total) || total <= 0) return;
    audio.currentTime = seekRatio(e.clientX, waveRef.current ? waveRef.current.getBoundingClientRect() : null) * total;
    setCurrent(audio.currentTime);
  }

  const readDuration = (e) => {
    const d = e.currentTarget.duration;
    if (Number.isFinite(d) && d > 0) setDuration(d);
  };

  const progress = duration > 0 ? Math.min(1, current / duration) : 0;
  const played = Math.round(progress * peaks.length);
  const timeLabel = failed
    ? 'не загрузилось'
    : playing || current > 0
      ? `${fmtClock(current)} / ${fmtClock(duration)}`
      : fmtClock(duration);

  return (
    <div className={`${styles.player} ${failed ? styles.failed : ''}`} data-testid="voice-player">
      <audio
        ref={audioRef}
        src={src}
        preload="metadata"
        onLoadedMetadata={readDuration}
        onDurationChange={readDuration}
        onTimeUpdate={(e) => setCurrent(e.currentTarget.currentTime)}
        onPlay={() => {
          setPlaying(true);
          onListened?.();
        }}
        onPause={() => setPlaying(false)}
        onEnded={() => {
          setPlaying(false);
          setCurrent(0);
        }}
        onError={() => setFailed(true)}
      />
      <button
        type="button"
        className={styles.play}
        onClick={toggle}
        aria-label={playing ? 'Пауза' : 'Слушать'}
        title={failed ? 'Файл не загрузился' : playing ? 'Пауза' : 'Слушать'}
      >
        {playing ? (
          <svg viewBox="0 0 24 24" width="16" height="16" aria-hidden="true">
            <rect x="6" y="5" width="4" height="14" rx="1.2" />
            <rect x="14" y="5" width="4" height="14" rx="1.2" />
          </svg>
        ) : (
          <svg viewBox="0 0 24 24" width="16" height="16" aria-hidden="true">
            <path d="M8 5.5v13a1 1 0 0 0 1.5.86l10.4-6.5a1 1 0 0 0 0-1.72L9.5 4.64A1 1 0 0 0 8 5.5z" />
          </svg>
        )}
      </button>
      <div className={styles.body}>
        <div
          className={styles.wave}
          ref={waveRef}
          onClick={seek}
          role="slider"
          aria-label="Перемотка"
          aria-valuemin={0}
          aria-valuemax={Math.round(duration)}
          aria-valuenow={Math.round(current)}
        >
          {peaks.map((h, i) => (
            <span key={i} className={i < played ? styles.barPlayed : styles.bar} style={{ height: `${Math.round(h * 100)}%` }} />
          ))}
        </div>
        <div className={styles.meta}>
          <span className={styles.time}>{timeLabel}</span>
          <button
            type="button"
            className={styles.speed}
            onClick={() => setSpeed((v) => SPEEDS[(SPEEDS.indexOf(v) + 1) % SPEEDS.length])}
            title="Скорость"
          >
            {speed}×
          </button>
        </div>
      </div>
    </div>
  );
}
