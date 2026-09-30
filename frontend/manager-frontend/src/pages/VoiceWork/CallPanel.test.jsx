// @vitest-environment jsdom
import React, { act } from 'react';
import { createRoot } from 'react-dom/client';
import { beforeEach, afterEach, test, expect, vi } from 'vitest';
import { CallPanel } from './CallPanel';
import { api } from '../../api/client';
globalThis.IS_REACT_ACT_ENVIRONMENT = true;
let root, host, tracks, socket, onActive, activeTask;
const button = name => [...host.querySelectorAll('button')].find(x => x.textContent === name);
beforeEach(() => {
 host=document.createElement('div'); document.body.append(host); root=createRoot(host); onActive=vi.fn();
 activeTask={id:7,chatId:'444',status:'in_progress'};
 vi.spyOn(api,'get').mockResolvedValue(null); vi.spyOn(api,'post').mockResolvedValue({ticket:'scoped-single-use'});
 tracks=[{enabled:true,stop:vi.fn()}];
 Object.defineProperty(window,'isSecureContext',{value:true,configurable:true});
 Object.defineProperty(navigator,'mediaDevices',{value:{getUserMedia:vi.fn(async()=>({getTracks:()=>tracks,getAudioTracks:()=>tracks}))},configurable:true});
 vi.stubGlobal('AudioContext',class {sampleRate=48000;audioWorklet={addModule:vi.fn()};destination={};resume=vi.fn();close=vi.fn(async()=>{});createMediaStreamSource=()=>({connect:vi.fn()});});
 vi.stubGlobal('AudioWorkletNode',class {port={postMessage:vi.fn()};connect=vi.fn();disconnect=vi.fn();});
 vi.stubGlobal('WebSocket',class {static OPEN=1;static CLOSING=2;readyState=1;bufferedAmount=0;send=vi.fn();close=vi.fn();constructor(url){this.url=String(url);socket=this;}});
});
afterEach(()=>{act(()=>root.unmount());host.remove();vi.restoreAllMocks();vi.unstubAllGlobals();});
const render=()=>act(async()=>root.render(<CallPanel task={activeTask} onActive={onActive}/>));
test('asks for microphone before reserving a call and scopes the request to the task',async()=>{
 await render();await act(async()=>button('Позвонить с сайта').click());
 expect(navigator.mediaDevices.getUserMedia).toHaveBeenCalled();expect(api.post).toHaveBeenCalledWith('/api/voicer/tasks/7/call/ticket',{});
 socket.onopen();expect(socket.send).toHaveBeenCalledWith(JSON.stringify({ticket:'scoped-single-use'}));
 await act(async()=>socket.onmessage({data:JSON.stringify({status:'connected',connected_at:Math.floor(Date.now()/1000)})}));
 expect(host.textContent).toContain('Разговор идёт');
 await act(async()=>button('Выключить микрофон').click());expect(tracks[0].enabled).toBe(false);
 await act(async()=>button('Завершить вызов').click());expect(tracks[0].stop).toHaveBeenCalled();expect(socket.close).toHaveBeenCalled();expect(onActive).toHaveBeenLastCalledWith(false);
});
test('does not contact Telegram if microphone permission is denied',async()=>{
 navigator.mediaDevices.getUserMedia.mockRejectedValue(Object.assign(Error('denied'),{name:'NotAllowedError'}));
 await render();await act(async()=>button('Позвонить с сайта').click());
 expect(api.post).not.toHaveBeenCalled();expect(host.textContent).toContain('Разрешите доступ к микрофону');
});
test('closing the task releases the microphone and closes the call socket',async()=>{
 await render();await act(async()=>button('Позвонить с сайта').click());await act(async()=>root.render(null));
 expect(tracks[0].stop).toHaveBeenCalledTimes(1);expect(socket.send).toHaveBeenCalledWith(JSON.stringify({action:'hangup'}));
});
test('an unlinked task cannot start a call',async()=>{activeTask.chatId=null;await render();expect(button('Позвонить с сайта').disabled).toBe(true);});
