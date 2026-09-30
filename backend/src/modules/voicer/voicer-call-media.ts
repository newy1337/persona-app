import { fork, ChildProcess } from 'child_process';
import { EventEmitter } from 'events';
import { join } from 'path';

/** Native library faults end this call, not the application process. */
export class CallMedia extends EventEmitter {
  private child: ChildProcess;
  private sequence = 0;
  private waiting = new Map<
    number,
    {
      resolve: (v: any) => void;
      reject: (e: Error) => void;
      timer: NodeJS.Timeout;
    }
  >();
  private stopped = false;
  constructor() {
    super();
    this.child = fork(join(__dirname, 'voicer-call-native.js'), [], {
      serialization: 'advanced',
      stdio: ['ignore', 'ignore', 'ignore', 'ipc'],
      env: { PATH: process.env.PATH, LANG: 'C.UTF-8' },
      execArgv: [],
    });
    this.child.on('message', (m: any) => {
      if (m.request) {
        const pending = this.waiting.get(m.request);
        if (!pending) return;
        clearTimeout(pending.timer);
        this.waiting.delete(m.request);
        if (m.error) pending.reject(Error(m.error));
        else pending.resolve(m.result);
      } else if (m.event) this.emit(m.event, m.data ?? m.state);
    });
    const lost = () => {
      for (const p of this.waiting.values()) {
        clearTimeout(p.timer);
        p.reject(Error('Модуль звука остановился'));
      }
      this.waiting.clear();
      if (!this.stopped) this.emit('lost');
    };
    this.child.on('exit', lost);
    this.child.on('error', lost);
  }
  request(op: string, data?: unknown): Promise<any> {
    return new Promise((resolve, reject) => {
      const request = ++this.sequence;
      const timer = setTimeout(() => {
        this.waiting.delete(request);
        reject(Error('Модуль звука не ответил'));
      }, 15000);
      this.waiting.set(request, { resolve, reject, timer });
      if (!this.child.connected) {
        clearTimeout(timer);
        this.waiting.delete(request);
        reject(Error('Модуль звука недоступен'));
        return;
      }
      this.child.send({ op, data, request }, (e) => {
        if (e) {
          clearTimeout(timer);
          this.waiting.delete(request);
          reject(Error('Модуль звука недоступен'));
        }
      });
    });
  }
  audio(data: Buffer) {
    if (!this.stopped && this.child.connected)
      this.child.send({ op: 'audio', data }, () => {});
  }
  stop() {
    if (this.stopped) return;
    this.stopped = true;
    if (this.child.connected) this.child.send({ op: 'stop' }, () => {});
    const timer = setTimeout(() => this.child.kill('SIGKILL'), 1500);
    timer.unref();
  }
}
