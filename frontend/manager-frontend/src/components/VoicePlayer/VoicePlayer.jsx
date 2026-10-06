import { useEffect, useRef, useState } from 'react';
import { Pause, Play } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';
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
    <div
      className={cn('flex h-[42px] w-[260px] max-w-full items-center gap-2.5', failed && 'opacity-80')}
      data-testid="voice-player"
    >
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
      <Button
        type="button"
        size="icon"
        variant={failed ? 'secondary' : 'default'}
        className="rounded-full"
        onClick={toggle}
        aria-label={playing ? 'Пауза' : 'Слушать'}
        title={failed ? 'Файл не загрузился' : playing ? 'Пауза' : 'Слушать'}
      >
        {playing ? <Pause className="fill-current" /> : <Play className="fill-current" />}
      </Button>
      <div className="flex min-w-0 flex-1 flex-col gap-1">
        <div
          className="flex h-[22px] cursor-pointer items-center gap-0.5"
          ref={waveRef}
          onClick={seek}
          role="slider"
          aria-label="Перемотка"
          aria-valuemin={0}
          aria-valuemax={Math.round(duration)}
          aria-valuenow={Math.round(current)}
        >
          {peaks.map((h, i) => (
            <span
              key={i}
              className={cn(
                'min-h-[3px] min-w-[2px] flex-1 rounded-[2px] transition-colors',
                i < played ? 'bg-primary' : 'bg-foreground/20',
              )}
              style={{ height: `${Math.round(h * 100)}%` }}
            />
          ))}
        </div>
        <span
          className={cn(
            'min-w-[72px] font-mono text-[11px] leading-4 tabular-nums',
            failed ? 'text-destructive' : 'text-muted-foreground',
          )}
        >
          {timeLabel}
        </span>
      </div>
      <Button
        type="button"
        variant="outline"
        size="xs"
        className="min-w-[44px] font-mono tabular-nums"
        onClick={() => setSpeed((v) => SPEEDS[(SPEEDS.indexOf(v) + 1) % SPEEDS.length])}
        title="Скорость"
      >
        {speed}×
      </Button>
    </div>
  );
}
