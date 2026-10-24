import { Outlet } from 'react-router-dom';

/**
 * «Настройки»: страница выбранной подвкладки. Сами подвкладки — в выпадающем
 * списке пункта «Настройки» в шапке (по наведению), отдельной полосы нет.
 */
export default function SettingsLayout() {
  return <Outlet />;
}
