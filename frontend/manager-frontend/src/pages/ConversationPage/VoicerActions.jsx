import { AudioLines, MicVocal } from 'lucide-react';
import { IconAction } from '@/components/IconAction/IconAction';

/**
 * «Задание войсеру» и «Голосовые этого чата» — внизу, рядом с полем ввода
 * (а пока ведёт бот — в нижней плашке): там же, где и остальная работа с ответом.
 */
export default function VoicerActions({ id, data, name, navigate }) {
  return (
    <>
      <IconAction
        icon={MicVocal}
        label="Задание войсеру"
        onClick={() => navigate('/voice?' + new URLSearchParams({ compose: '1', chat: id, contact: name, manager: String(data.manager_id || ''), persona: data.persona_id || '', ref: data.client_username ? '@' + data.client_username : '' }))}
      />
      <IconAction
        icon={AudioLines}
        label="Голосовые"
        hint="Голосовые этого чата в библиотеке"
        onClick={() => navigate('/voice?' + new URLSearchParams({ tab: 'library', chat: id, persona: data.persona_id || '' }))}
      />
    </>
  );
}
