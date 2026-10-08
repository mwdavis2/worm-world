import 'reflect-metadata';
import React, { Suspense } from 'react';
import ReactDOM from 'react-dom/client';
import '@fontsource/lato/300.css';
import '@fontsource/lato/400.css';
import '@fontsource/lato/700.css';
import 'styles/global.css';
import { ToastContainer } from 'react-toastify';
import 'react-toastify/dist/ReactToastify.css';
import { BrowserRouter as Router, useRoutes } from 'react-router-dom';
import routes from '~react-pages';
import Spinner from 'components/Spinner/Spinner';
import Layout from 'components/Layout/Layout';
import { disableTextAssist } from 'utils/disableTextAssist';

// The release app shows no browser menu (Back, Reload, Inspect Element...).
// The app's own menus handle their right-clicks themselves; text fields keep
// the normal Cut/Copy/Paste menu.
if (import.meta.env.PROD) {
  document.addEventListener('contextmenu', (e) => {
    const target = e.target as HTMLElement | null;
    if (target?.closest('input, textarea, [contenteditable="true"]') != null)
      return;
    e.preventDefault();
  });

  // Browser shortcuts with no use in the app: reload, print, back/forward and
  // the developer tools, and select-all outside text fields. Copy and paste
  // (Cmd/Ctrl-C and V) are left alone.
  document.addEventListener(
    'keydown',
    (e) => {
      const mod = e.metaKey || e.ctrlKey;
      const key = e.key.toLowerCase();
      const blocked =
        e.key === 'F5' ||
        e.key === 'F12' ||
        (mod && ['r', 'p', 'u', '[', ']'].includes(key)) ||
        (mod && (e.shiftKey || e.altKey) && ['i', 'j'].includes(key)) ||
        (mod && e.altKey && key === 'c') ||
        (e.altKey && !mod && ['arrowleft', 'arrowright'].includes(key));
      // Select-all only selects page text, but is kept inside text fields
      const selectAllOutsideFields =
        mod &&
        !e.shiftKey &&
        !e.altKey &&
        key === 'a' &&
        (e.target as HTMLElement | null)?.closest(
          'input, textarea, [contenteditable="true"]'
        ) == null;
      if (blocked || selectAllOutsideFields) e.preventDefault();
    },
    true
  );
}

const App = (): React.JSX.Element => {
  return (
    <>
      <Suspense fallback={<Spinner />}>
        <Layout>{useRoutes(routes)}</Layout>
      </Suspense>
      <ToastContainer
        autoClose={3000}
        hideProgressBar
        position='bottom-right'
        closeOnClick={false}
      />
    </>
  );
};

disableTextAssist();

ReactDOM.createRoot(document.getElementById('root') as HTMLElement).render(
  <React.StrictMode>
    <Router>
      <App />
    </Router>
  </React.StrictMode>
);
