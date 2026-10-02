import { Link } from 'react-router-dom';
import { BiCalendar, BiCog, BiData } from 'react-icons/bi';
import { TbBinaryTree } from 'react-icons/tb';
import { useEffect } from 'react';
import { themeChange } from 'theme-change';

interface LayoutProps {
  children: React.ReactNode;
}

interface NavItem {
  name: string;
  path: string;
  icon: React.JSX.Element;
}

const navItems: NavItem[] = [
  {
    name: 'Cross Designs',
    path: '/',
    icon: <TbBinaryTree className='text-2xl' />,
  },
  {
    name: 'Schedules',
    path: '/schedules/todo',
    icon: <BiCalendar className='text-2xl' />,
  },
  {
    name: 'Data Tables',
    path: '/data-tables/genes',
    icon: <BiData className='text-2xl' />,
  },
  {
    name: 'Settings',
    path: '/settings',
    icon: <BiCog className='text-2xl' />,
  },
];

const NavItems = (): React.JSX.Element => {
  return (
    <>
      {navItems.map((item) => (
        <li key={item.name}>
          <Link
            to={item.path}
            className='pl-5'
            onClick={() => document.getElementById('nav-drawer')?.click()}
          >
            {item.icon}
            {item.name}
          </Link>
        </li>
      ))}
    </>
  );
};

const allThemes = [
  'light',
  'cupcake',
  'bumblebee',
  'emerald',
  'corporate',
  'garden',
  'lofi',
  'night',
  'dracula',
];

// Theme daisyUI applies when the OS is in dark mode and no theme has been
// chosen - the `darkTheme` setting in tailwind.config.cjs.
const OS_DARK_THEME = 'night';
const OS_LIGHT_THEME = 'light';

const Layout = (props: LayoutProps): React.JSX.Element => {
  useEffect(() => {
    themeChange(false);
    // 👆 false parameter is required for react project

    // theme-change only points the dropdown at a *saved* choice. With none
    // saved the page follows the OS (see tailwind.config.cjs), but the
    // dropdown would still show its first option - so mirror the OS theme
    // there, and keep it in step if the OS setting changes meanwhile.
    const select = document.querySelector<HTMLSelectElement>(
      'select[data-choose-theme]'
    );
    if (select === null || typeof window.matchMedia !== 'function') return;
    const osDarkMode = window.matchMedia('(prefers-color-scheme: dark)');
    const syncDropdownToOs = (): void => {
      if (localStorage.getItem('theme') !== null) return;
      select.value = osDarkMode.matches ? OS_DARK_THEME : OS_LIGHT_THEME;
    };
    syncDropdownToOs();
    osDarkMode.addEventListener('change', syncDropdownToOs);
    return () => {
      osDarkMode.removeEventListener('change', syncDropdownToOs);
    };
  }, []);

  return (
    <div className='drawer h-screen w-screen'>
      <input id='nav-drawer' type='checkbox' className='drawer-toggle' />
      <div className='drawer-content h-full'>{props.children}</div>

      <div className='no-print drawer-side z-50' data-testid='side-drawer'>
        <label htmlFor='nav-drawer' className='drawer-overlay' />
        <div className='flex h-screen flex-col justify-between bg-base-300'>
          <ul className='menu p-4'>
            <li key='wormworld'>
              <Link
                to={'/'}
                onClick={() => document.getElementById('nav-drawer')?.click()}
              >
                <img
                  alt='WormWorld'
                  src='/wormworld_logo.svg'
                  className='w-56'
                />
              </Link>
            </li>
            <div className='divider' />
            <NavItems />
          </ul>
          <div className='p-4'>
            <label className='label'>Theme</label>
            <select className='select select-bordered' data-choose-theme>
              {allThemes.map((theme) => (
                <option key={theme} value={theme}>
                  {theme}
                </option>
              ))}
            </select>
            <div className='grid w-32 grid-cols-4 pt-2'>
              <div className='h-2 bg-primary'>&nbsp;</div>
              <div className='h-2 bg-secondary'>&nbsp;</div>
              <div className='h-2 bg-accent'>&nbsp;</div>
              <div className='h-2 bg-neutral'>&nbsp;</div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};

export default Layout;
