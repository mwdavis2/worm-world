import { open } from '@tauri-apps/api/dialog';
import { readTextFile } from '@tauri-apps/api/fs';
import { getFilteredCrossDesigns, insertCrossDesign } from 'api/crossDesign';
import { importDataTablesZip, readBundleDesign } from 'api/dataTablesZip';
import CrossDesignCard from 'components/CrossDesignCard/CrossDesignCard';
import { TopNav } from 'components/TopNav/TopNav';
import CrossDesign from 'models/frontend/CrossDesign/CrossDesign';
import { useEffect, useState } from 'react';
import { GiEarthWorm as WormIcon } from 'react-icons/gi';
import { toast } from 'react-toastify';
import { getErrorMessage } from 'utils/getErrorMessage';
import { beginImport, endImport } from 'utils/importGuard';
import { summarizeDataTablesImport } from 'utils/summarizeDataTablesImport';

const Index = (): React.JSX.Element => {
  const [newCrossDesignId, setNewCrossDesignId] = useState<string>();
  const [crossDesigns, setCrossDesigns] = useState<CrossDesign[]>([]);
  const [hasRefreshedOnce, setHasRefreshedOnce] = useState(false);

  const refreshCrossDesigns = async (): Promise<void> => {
    const crossDesigns = await getFilteredCrossDesigns({
      filters: [[['Editable', 'True']]],
      orderBy: [],
    });

    setCrossDesigns(
      crossDesigns.map((crossDesign) => CrossDesign.fromJSON(crossDesign.data))
    );
  };

  useEffect(() => {
    refreshCrossDesigns()
      .then(() => {
        setHasRefreshedOnce(true);
      })
      .catch(console.error);
  }, []);

  const newCrossDesignButton = (
    <button
      key='newCrossDesign'
      className='btn'
      onClick={() => {
        addCrossDesign()
          .then(setNewCrossDesignId)
          .then(refreshCrossDesigns)
          .catch(console.error);
      }}
    >
      New Design
    </button>
  );

  const importCrossDesignButton = (
    <button
      key='importCrossDesign'
      className='btn'
      onClick={() => {
        importCrossDesign().then(refreshCrossDesigns).catch(console.error);
      }}
    >
      Import
    </button>
  );

  return (
    <>
      <TopNav
        title={'Cross Designs'}
        buttons={[newCrossDesignButton, importCrossDesignButton]}
      />
      {hasRefreshedOnce && crossDesigns.length === 0 ? (
        <NoCrossDesignPlaceholder />
      ) : (
        <CrossDesignCards
          crossDesigns={crossDesigns}
          newCrossDesignId={newCrossDesignId}
          setNewCrossDesignId={setNewCrossDesignId}
          refreshCrossDesigns={refreshCrossDesigns}
        />
      )}
    </>
  );
};

const CrossDesignCards = (props: {
  crossDesigns: CrossDesign[];
  newCrossDesignId: string | undefined;
  setNewCrossDesignId: (id: string | undefined) => void;
  refreshCrossDesigns: () => Promise<void>;
}): React.JSX.Element => {
  return (
    <div className='mx-36 my-8 flex flex-wrap '>
      {props.crossDesigns?.map((crossDesign) => {
        const isNew = crossDesign.id === props.newCrossDesignId;
        const crossDesignCard = (
          <CrossDesignCard
            refreshCrossDesigns={() => {
              props.refreshCrossDesigns().catch(console.error);
            }}
            key={crossDesign.id}
            crossDesign={crossDesign}
            isNew={isNew}
          />
        );
        return crossDesignCard;
      })}
    </div>
  );
};

const NoCrossDesignPlaceholder = (): React.JSX.Element => {
  return (
    <div className='m-14 flex flex-col items-center justify-center'>
      <h2 className='text-2xl'>Cross designs can be found here.</h2>
      <h2 className='my-4 flex flex-row text-xl'>
        Click the &quot;new design&quot; button to start.
      </h2>
      <WormIcon className='my-8 text-9xl text-base-300' />
    </div>
  );
};

// Imports a design: a `.json` file (the design only) or a `.zip` design bundle
// (the design plus the data table rows it needs, loaded in one all-or-nothing
// step before the design is added).
const importCrossDesign = async (): Promise<void> => {
  if (!beginImport()) {
    toast.error('An import is already in progress');
    return;
  }
  try {
    const filepath: string | null = (await open({
      filters: [
        {
          name: 'WormWorld design or design with data tables',
          extensions: ['json', 'zip'],
        },
      ],
    })) as string | null;
    if (filepath === null) return;
    if (filepath.toLowerCase().endsWith('.zip')) {
      const designJson = await readBundleDesign(filepath);
      if (designJson === null)
        throw new Error(
          'That zip has no design in it (use Import Data Tables Zip File on the Data Tables page for a data tables zip)'
        );
      const clonedCrossDesign = CrossDesign.fromJSON(designJson).clone(true);
      const report = await importDataTablesZip(
        filepath,
        clonedCrossDesign.generateRecord()
      );
      toast.success(
        report.length === 0
          ? 'Imported the design'
          : `Imported the design\n${summarizeDataTablesImport(report)}`,
        { style: { whiteSpace: 'pre-line' } }
      );
      return;
    }
    const file = await readTextFile(filepath);
    const clonedCrossDesign = CrossDesign.fromJSON(file).clone(true);
    await insertCrossDesign(clonedCrossDesign.generateRecord());
    toast.success('Successfully imported cross design');
  } catch (err) {
    toast.error(`Error importing cross design: ${getErrorMessage(err)}`);
  } finally {
    endImport();
  }
};

const addCrossDesign = async (): Promise<string | undefined> => {
  try {
    const newCrossDesign = new CrossDesign({
      name: '',
      lastSaved: new Date(),
      nodes: [],
      edges: [],
      editable: true,
    });
    await insertCrossDesign(newCrossDesign.generateRecord());
    toast.success('Successfully added cross design');
    return newCrossDesign.id;
  } catch (err) {
    toast.error(`Error adding cross design: ${err}`);
    return undefined;
  }
};

export default Index;
