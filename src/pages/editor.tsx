import { getCrossDesign } from 'api/crossDesign';
import { fixNodeDeserialization } from 'models/frontend/CrossDesign/fixNodeDeserialization';
import CrossDesign from 'models/frontend/CrossDesign/CrossDesign';
import { useLocation } from 'react-router-dom';
import Editor from 'components/Editor/Editor';
import { useEffect, useState } from 'react';
import Spinner from 'components/Spinner/Spinner';
import { ReactFlowProvider } from 'reactflow';

const EditorPage = (): React.JSX.Element => {
  const [crossDesign, setCrossDesign] = useState<CrossDesign>();
  const crossDesignId: string = useLocation().state.crossDesignId;

  useEffect(() => {
    getCrossDesign(crossDesignId)
      .then((dbCrossDesign) => {
        const crossDesign = CrossDesign.fromJSON(dbCrossDesign.data);
        fixNodeDeserialization(crossDesign);
        setCrossDesign(crossDesign);
      })
      .catch(console.error);
  }, []);

  if (crossDesign === undefined) {
    return <Spinner />;
  } else {
    return (
      <ReactFlowProvider>
        <Editor crossDesign={crossDesign} />
      </ReactFlowProvider>
    );
  }
};

export default EditorPage;
