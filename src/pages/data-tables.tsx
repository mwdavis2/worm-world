import { TopNav } from 'components/TopNav/TopNav';
import { Link, Outlet, useLocation } from 'react-router-dom';

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

const DataTables = (): React.JSX.Element => {
  // The highlighted tab follows the URL, so it stays right when the page is
  // opened directly on a table (e.g. after a reload) and not only on clicks.
  const { pathname } = useLocation();
  const activeTab = TAB_PATHS.indexOf(
    pathname.split('/').filter(Boolean).pop() ?? ''
  );
  return (
    <>
      <TopNav title={'Data Tables'} tabIndex={Math.max(activeTab, 0)}>
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
      <Outlet />
    </>
  );
};

export default DataTables;
