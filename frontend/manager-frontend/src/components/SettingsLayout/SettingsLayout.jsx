import { NavLink, Outlet } from 'react-router-dom';
import { cn } from '@/lib/utils';
import { buttonVariants } from '@/components/ui/button';
import { useMe } from '../AppLayout/me';
import { menuFor } from '../../navigation';

const tabClass = ({ isActive }) =>
  cn(
    buttonVariants({ variant: 'ghost', size: 'sm' }),
    'text-muted-foreground hover:text-foreground',
    isActive && 'bg-accent text-foreground',
  );

/**
 * «Настройки»: полоса подвкладок своей роли и под ней выбранная страница.
 * Страницы те же, что раньше жили отдельными вкладками, — без изменений.
 */
export default function SettingsLayout() {
  const me = useMe();
  const tabs = menuFor(me?.role).settings;
  return (
    <>
      <div className="border-b">
        <nav
          aria-label="Разделы настроек"
          className="container flex min-h-11 items-center gap-0.5 overflow-x-auto py-1 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden"
        >
          {tabs.map((tab) => (
            <NavLink key={tab.key} to={tab.to} className={tabClass}>
              {tab.label}
            </NavLink>
          ))}
        </nav>
      </div>
      <Outlet />
    </>
  );
}
