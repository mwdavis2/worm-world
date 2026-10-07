import { open } from '@tauri-apps/api/dialog';
import { importDataTablesZip } from 'api/dataTablesZip';
import { TopNav } from 'components/TopNav/TopNav';
import { useState } from 'react';
import { Link, Outlet, useLocation } from 'react-router-dom';
import { toast } from 'react-toastify';
import { getErrorMessage } from 'utils/getErrorMessage';
import { beginImport, endImport } from 'utils/importGuard';
import { summarizeDataTablesImport } from 'utils/summarizeDataTablesImport';

// Route segments of the tabs below, in tab order.
const TAB_PATHS = [
  'genes',
  'variations',
  'alleles',
  'phenotypes',
  'conditions',
  'allele-expressions',
  'expression-relations',
  'strains',
  'strain-alleles',
];

// Loads every table in a zip archive in one transaction (all or nothing).
const importZip = async (): Promise<boolean> => {
  if (!beginImport()) {
    toast.error('An import is already in progress');
    return false;
  }
  try {
    const zipPath = (await open({
      filters: [{ name: 'Data tables zip file', extensions: ['zip'] }],
    })) as string | null;
    if (zipPath === null) return false;
    const report = await importDataTablesZip(zipPath);
    toast.success(summarizeDataTablesImport(report), {
      style: { whiteSpace: 'pre-line' },
    });
    return true;
  } catch (e) {
    toast.error('Nothing was imported: ' + getErrorMessage(e));
    return false;
  } finally {
    endImport();
  }
};

const DataTables = (): React.JSX.Element => {
  // Bumped after a zip import so the open table remounts and reloads its rows.
  const [reloadCount, setReloadCount] = useState(0);
  // The highlighted tab follows the URL, so it stays right when the page is
  // opened directly on a table (e.g. after a reload) and not only on clicks.
  const { pathname } = useLocation();
  const activeTab = TAB_PATHS.indexOf(
    pathname.split('/').filter(Boolean).pop() ?? ''
  );
  return (
    <>
      <TopNav
        title={'Data Tables'}
        tabIndex={Math.max(activeTab, 0)}
        buttons={[
          <button
            key='import-zip'
            className='btn'
            title='Load every table in a zip file (genes.csv, alleles.csv, ...) in one step; nothing is imported if any file has a problem'
            onClick={() => {
              importZip()
                .then((imported) => {
                  if (imported) setReloadCount((count) => count + 1);
                })
                .catch(console.error);
            }}
          >
            Import Data Tables Zip File
          </button>,
        ]}
      >
        <Link key='genes' to='genes' className='tab'>
          Genes
        </Link>
        <Link key='variations' to='variations' className='tab'>
          Variations
        </Link>
        <Link key='alleles' to='alleles' className='tab'>
          Alleles
        </Link>
        <Link key='phenotypes' to='phenotypes' className='tab'>
          Phenotypes
        </Link>
        <Link key='conditions' to='conditions' className='tab'>
          Conditions
        </Link>
        <Link key='allele-expressions' to='allele-expressions' className='tab'>
          Allele Phenotypes
        </Link>
        <Link
          key='expression-relations'
          to='expression-relations'
          className='tab'
        >
          Phenotype Relationships
        </Link>
        <Link key='strains' to='strains' className='tab'>
          Strains
        </Link>
        <Link key='strain-alleles' to='strain-alleles' className='tab'>
          Strain Alleles
        </Link>
      </TopNav>
      <Outlet key={reloadCount} />
    </>
  );
};

export default DataTables;
