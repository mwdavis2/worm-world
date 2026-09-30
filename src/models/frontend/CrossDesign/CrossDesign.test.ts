import { StrainFilter } from 'models/frontend/StrainFilter/StrainFilter';
import { NodeType, Sex } from 'models/enums';
import CrossDesign, {
  addToArray,
  type ICrossDesign,
} from 'models/frontend/CrossDesign/CrossDesign';
import { AllelePair } from 'models/frontend/AllelePair/AllelePair';
import { Strain } from 'models/frontend/Strain/Strain';
import { type XYPosition, type Node, type Edge } from 'reactflow';
import { expect, test, describe } from 'vitest';
import { ed3, n765, ox1059 } from 'models/frontend/Allele/Allele.mock';
import moment from 'moment';

describe('cross crossDesign', () => {
  // #region generator functions
  const generateTree = ({
    name = '',
    nodes = [],
    edges = [],
    lastSaved = new Date(),
    editable = true,
  }: Partial<ICrossDesign>): CrossDesign => {
    return new CrossDesign({
      name,
      nodes,
      edges,
      lastSaved,
      editable,
    });
  };

  const generateNode = ({
    id = 0,
    type = NodeType.Strain,
    position = { x: 0, y: 0 },
    // Middle (Self/X) nodes carry a StrainFilter in real app usage, never a
    // Strain - matching that here is what lets deserialize round-trip tests
    // actually exercise CrossDesign's middle-node rehydration path.
    strain = type === NodeType.Strain ? new Strain() : new StrainFilter(),
    parentNode = undefined,
  }: {
    id?: number;
    type?: NodeType;
    position?: XYPosition;
    strain?: unknown;
    parentNode?: string;
  }): Node => {
    return {
      id: id.toString(),
      type,
      position,
      data: strain,
    };
  };

  const generateEdge = ({
    source,
    target,
    id = 0,
    sourceHandle,
    targetHandle,
  }: {
    source: string;
    target: string;
    id?: number;
    sourceHandle?: string;
    targetHandle?: string;
  }): Edge => {
    return {
      id: id.toString(),
      source,
      target,
      sourceHandle,
      targetHandle,
    };
  };
  // #endregion generator functions

  // #region testing functions
  const testTreeNodesAndEdges = (
    crossDesign: CrossDesign,
    nodes: Node[] = [],
    edges: Edge[] = []
  ): void => {
    // test nodes
    expect(crossDesign.nodes).toHaveLength(nodes.length);
    crossDesign.nodes.forEach((node, idx) => {
      expect(node.id).toBe(nodes[idx].id);
      expect(node.type).toBe(nodes[idx].type);
      expect(node.data).toBe(nodes[idx].data);
    });

    // test edges
    expect(crossDesign.edges).toHaveLength(edges.length);
    crossDesign.edges.forEach((edge, idx) => {
      expect(edge.id).toBe(edges[idx].id);
      expect(edge.source).toBe(edges[idx].source);
      expect(edge.target).toBe(edges[idx].target);
      expect(edge.sourceHandle).toBe(edges[idx].sourceHandle);
      expect(edge.targetHandle).toBe(edges[idx].targetHandle);
    });
  };
  // #endregion testing functions

  // #region tests
  test('constructs an empty crossDesign', () => {
    const name = 'empty crossDesign';
    const lastSaved = new Date();

    const crossDesign = generateTree({ name, lastSaved });
    expect(crossDesign.nodes).toHaveLength(0);
    expect(crossDesign.edges).toHaveLength(0);
    expect(crossDesign.name).toBe(name);
    expect(crossDesign.lastSaved).toBe(lastSaved);
  });
  test('constructs a crossDesign with nodes', () => {
    let id = 0;
    const strainNode = generateNode({ id: id++ });
    const selfNode = generateNode({ id: id++, type: NodeType.Self });
    const xIcon = generateNode({ id: id++, type: NodeType.X });
    const nodes = [strainNode, selfNode, xIcon];
    const crossDesign = generateTree({ nodes });
    testTreeNodesAndEdges(crossDesign, nodes);
  });
  test('constructs a crossDesign with edges and nodes', () => {
    let id = 0;
    const maleStrain = new Strain({ sex: Sex.Male });
    const hermStrain = new Strain();

    const maleNode = generateNode({ id: id++, strain: maleStrain });
    const hermNode = generateNode({ id: id++, strain: hermStrain });
    const xIcon = generateNode({ id: id++, type: NodeType.X });

    const nodes = [maleNode, hermNode, xIcon];
    const edges = [
      generateEdge({
        id: id++,
        source: maleNode.id,
        target: xIcon.id,
        targetHandle: 'left',
      }),
      generateEdge({
        id: id++,
        source: hermNode.id,
        target: xIcon.id,
        sourceHandle: 'left',
        targetHandle: 'right',
      }),
    ];

    const crossDesign = generateTree({ nodes, edges });
    testTreeNodesAndEdges(crossDesign, nodes, edges);
  });
  test('constructs a crossDesign with new list of nodes/edges', () => {
    let id = 0;
    const strainNode = generateNode({
      id: id++,
      strain: new Strain(),
    });
    const selfNode = generateNode({ id: id++, type: NodeType.Self });

    const nodes = [strainNode, selfNode];
    const edges = [
      generateEdge({
        id: id++,
        source: strainNode.id,
        target: strainNode.id,
        sourceHandle: 'bottom',
      }),
    ];

    const crossDesign = generateTree({ nodes, edges });
    expect(crossDesign.nodes).not.toBe(nodes);
    expect(crossDesign.edges).not.toBe(edges);
    testTreeNodesAndEdges(crossDesign, nodes, edges);
  });

  test('.getTasks() returns empty list from no crosses', () => {
    const nodes = [generateNode({})];
    const crossDesign = generateTree({ nodes });
    expect(crossDesign.getTasks(nodes[0])).toHaveLength(0);
  });
  test('.getTasks() returns self-cross tasks', () => {
    let id = 0;
    const hermStrain = new Strain();
    const nodes = [
      generateNode({ id: id++, strain: hermStrain }),
      generateNode({ id: id++, type: NodeType.Self }),
      generateNode({ id: id++ }),
    ];
    const edges = [
      generateEdge({
        id: id++,
        source: '0',
        target: '1',
        sourceHandle: 'bottom',
      }),
      generateEdge({ id: id++, source: '1', target: '2' }),
    ];

    const crossDesign = generateTree({ nodes, edges });
    expect(crossDesign.getTasks(nodes[0])).toHaveLength(0);

    const tasks = crossDesign.getTasks(nodes[2]);
    expect(tasks).toHaveLength(1);
    expect(tasks[0].action).toBe('SelfCross');
    // expect(tasks[0].hermStrain).toBe(JSON.stringify(hermStrain));
    expect(tasks[0].maleStrain).toBeUndefined();
  });
  test('.getTasks() returns regular cross tasks', () => {
    let id = 0;
    const hermStrain = new Strain();
    const maleStrain = new Strain();
    const nodes = [
      generateNode({ id: id++, strain: hermStrain }),
      generateNode({ id: id++, strain: maleStrain }),
      generateNode({ id: id++, type: NodeType.X }),
      generateNode({ id: id++ }),
    ];
    const edges = [
      generateEdge({
        id: id++,
        source: '0',
        target: '2',
        sourceHandle: 'left',
        targetHandle: 'right',
      }),
      generateEdge({
        id: id++,
        source: '1',
        target: '2',
        targetHandle: 'left',
      }),
      generateEdge({ id: id++, source: '2', target: '3' }),
    ];

    const crossDesign = generateTree({ nodes, edges });
    expect(crossDesign.getTasks(nodes[0])).toHaveLength(0);
    expect(crossDesign.getTasks(nodes[1])).toHaveLength(0);

    const tasks = crossDesign.getTasks(nodes[3]);
    expect(tasks).toHaveLength(1);
    expect(tasks[0].action).toBe('Cross');
    // expect(tasks[0].hermStrain).toBe(JSON.stringify(hermStrain));
    // expect(tasks[0].maleStrain).toBe(JSON.stringify(maleStrain));
    expect(tasks[0].dueDate?.getDay()).toBe(new Date().getDay());
  });
  test('.getTasks() generates multiple tasks', () => {
    let id = 0;
    const hermStrain = new Strain({ sex: Sex.Hermaphrodite });
    const maleStrain = new Strain({ sex: Sex.Male });
    const strain3 = new Strain();
    const nodes = [
      generateNode({ id: id++, strain: hermStrain }),
      generateNode({ id: id++, strain: maleStrain }),
      generateNode({ id: id++, type: NodeType.X }),
      generateNode({ id: id++ }),
      generateNode({ id: id++, type: NodeType.Self }),
      generateNode({ id: id++, strain: strain3 }),
    ];
    const edges = [
      generateEdge({
        id: id++,
        source: '0',
        target: '2',
        sourceHandle: 'left',
        targetHandle: 'right',
      }),
      generateEdge({
        id: id++,
        source: '1',
        target: '2',
        targetHandle: 'left',
      }),
      generateEdge({ id: id++, source: '2', target: '3' }),
      generateEdge({ id: id++, source: '3', target: '4' }),
      generateEdge({ id: id++, source: '4', target: '5' }),
    ];

    const crossDesign = generateTree({ nodes, edges });
    expect(crossDesign.getTasks(nodes[0])).toHaveLength(0);
    expect(crossDesign.getTasks(nodes[1])).toHaveLength(0);

    const tasks = crossDesign.getTasks(nodes[5]);
    expect(tasks).toHaveLength(2);
    expect(tasks[0].action).toBe('SelfCross');
    expect(tasks[0].maleStrain).toBeUndefined();
    expect(tasks[1].action).toBe('Cross');
    const today = new Date().getDate();
    const todayPlusThree = moment().add(3, 'days').toDate().getDate();
    expect(tasks[0].dueDate?.getDate()).toBe(todayPlusThree);
    expect(tasks[1].dueDate?.getDate()).toBe(today);
  });
  test('.getTasks() correctly bumps dates', () => {
    let id = 0;
    const hermStrain = new Strain();
    const maleStrain = new Strain();
    const nodes = [
      generateNode({ id: id++, strain: hermStrain }),
      generateNode({ id: id++, strain: maleStrain }),
      generateNode({ id: id++, strain: hermStrain }),
      generateNode({ id: id++, strain: maleStrain }),
      generateNode({ id: id++, strain: hermStrain }),
      generateNode({ id: id++, strain: maleStrain }),
      generateNode({ id: id++, strain: hermStrain }),
      generateNode({ id: id++, strain: maleStrain }),
      generateNode({ id: id++, strain: maleStrain }),
      generateNode({ id: id++, type: NodeType.X }),
      generateNode({ id: id++, type: NodeType.X }),
      generateNode({ id: id++, type: NodeType.X }),
      generateNode({ id: id++, type: NodeType.Self }),
      generateNode({ id: id++, type: NodeType.Self }),
    ];
    const edges = [
      generateEdge({
        id: id++,
        source: '0',
        target: '9',
        sourceHandle: 'left',
        targetHandle: 'right',
      }),
      generateEdge({
        id: id++,
        source: '1',
        target: '9',
        targetHandle: 'left',
      }),
      generateEdge({ id: id++, source: '9', target: '2' }),
      generateEdge({ id: id++, source: '2', target: '12' }),
      generateEdge({ id: id++, source: '12', target: '3' }),
      generateEdge({ id: id++, source: '3', target: '13' }),
      generateEdge({
        id: id++,
        source: '13',
        target: '4',
        targetHandle: 'top',
      }),
      generateEdge({
        id: id++,
        source: '5',
        target: '10',
        sourceHandle: 'left',
        targetHandle: 'right',
      }),
      generateEdge({
        id: id++,
        source: '6',
        target: '10',
        targetHandle: 'left',
      }),
      generateEdge({ id: id++, source: '10', target: '7' }),
      generateEdge({
        id: id++,
        source: '4',
        target: '11',
        sourceHandle: 'left',
        targetHandle: 'right',
      }),
      generateEdge({
        id: id++,
        source: '7',
        target: '11',
        targetHandle: 'left',
      }),
      generateEdge({ id: id++, source: '11', target: '8' }),
    ];
    const crossDesign = generateTree({ nodes, edges });
    const tasks = crossDesign.getTasks(nodes[8]);
    expect(tasks).toHaveLength(5);
    const today = new Date().getDate();
    const todayPlusThree = moment().add(3, 'days').toDate().getDate();
    const todayPlusSix = moment().add(6, 'days').toDate().getDate();
    const todayPlusNine = moment().add(9, 'days').toDate().getDate();
    expect(tasks[0].dueDate?.getDate()).toBe(todayPlusNine);
    expect(tasks[1].dueDate?.getDate()).toBe(todayPlusSix);
    expect(tasks[2].dueDate?.getDate()).toBe(todayPlusThree);
    expect(tasks[3].dueDate?.getDate()).toBe(today);
  });

  test('should be able to serialize and deserialize', () => {
    let id = 0;
    const hermStrain = new Strain({
      allelePairs: [
        new AllelePair({ top: ed3, bot: ed3.toWild() }),
        new AllelePair({ top: ox1059, bot: ox1059.toWild() }),
      ],
      sex: Sex.Hermaphrodite,
    });
    const maleStrain = new Strain();
    const strain3 = new Strain({
      allelePairs: [new AllelePair({ top: n765, bot: n765 })],
      sex: Sex.Hermaphrodite,
    });
    const selfNodeFilter = new StrainFilter({
      alleleNames: new Set(['n766']),
      exprPhenotypes: new Set(),
      supConditions: new Set(),
      reqConditions: new Set(),
      hiddenNodes: new Set(),
      activeConditions: new Set(['25C']),
    });
    const selfNode = generateNode({
      id: id++,
      type: NodeType.Self,
      strain: selfNodeFilter,
    });
    const nodes = [
      generateNode({ id: id++, strain: hermStrain }),
      generateNode({ id: id++, strain: maleStrain }),
      generateNode({ id: id++, type: NodeType.X }),
      generateNode({ id: id++ }),
      generateNode({ id: id++, strain: strain3, parentNode: selfNode.id }),
      selfNode,
    ];
    const edges = [
      generateEdge({
        id: id++,
        source: '0',
        target: '2',
        sourceHandle: 'left',
        targetHandle: 'right',
      }),
      generateEdge({
        id: id++,
        source: '1',
        target: '2',
        targetHandle: 'left',
      }),
      generateEdge({ id: id++, source: '2', target: '3' }),
      generateEdge({ id: id++, source: '3', target: '4' }),
      generateEdge({ id: id++, source: '4', target: '5' }),
    ];

    const crossDesign = generateTree({ nodes, edges });
    const crossDesignBack = CrossDesign.fromJSON(crossDesign.toJSON());

    expect(crossDesignBack.toJSON()).toEqual(crossDesign.toJSON());
    expect(crossDesignBack.generateRecord()).toEqual(
      crossDesign.generateRecord()
    );

    expect(
      crossDesignBack.nodes
        .filter((node) => node.type === NodeType.Strain)
        .every((node) => (node.data as Strain).getAllelePairs !== undefined)
    );
  });

  // Regression test: middle (Self/X) nodes carry a StrainFilter in `.data`,
  // but round-tripping through JSON previously left it as a plain object
  // with no Set methods - `.has()`/`.update()` etc. would throw the first
  // time the filter modal touched a loaded-from-disk cross design.
  test('rehydrates middle-node (Self/X) data into a real StrainFilter instance on deserialize', () => {
    let id = 0;
    const selfNodeFilter = new StrainFilter({
      alleleNames: new Set(['n766']),
      exprPhenotypes: new Set(),
      supConditions: new Set(),
      reqConditions: new Set(),
      hiddenNodes: new Set(),
      activeConditions: new Set(['25C']),
    });
    const selfNode = generateNode({
      id: id++,
      type: NodeType.Self,
      strain: selfNodeFilter,
    });
    const xNode = generateNode({ id: id++, type: NodeType.X });

    const crossDesign = generateTree({ nodes: [selfNode, xNode], edges: [] });
    const crossDesignBack = CrossDesign.fromJSON(crossDesign.toJSON());

    const selfNodeBack = crossDesignBack.nodes.find(
      (node) => node.id === selfNode.id
    );
    const xNodeBack = crossDesignBack.nodes.find(
      (node) => node.id === xNode.id
    );
    expect(selfNodeBack?.data).toBeInstanceOf(StrainFilter);
    expect(xNodeBack?.data).toBeInstanceOf(StrainFilter);

    const filterBack = selfNodeBack?.data as StrainFilter;
    expect(filterBack.alleleNames.has('n766')).toBe(true);
    expect(filterBack.activeConditions.has('25C')).toBe(true);
    expect(() => {
      filterBack.update({
        field: 'alleleNames',
        action: 'add',
        name: 'n765',
        filterId: selfNode.id,
      });
    }).not.toThrow();
  });
});

describe('addToArray', () => {
  // Regression test: findIndex() returns 0 for a match at the first
  // position, same as -1 for no match at all if you only check truthiness -
  // a prior version checked `idx > 0` instead of `idx !== -1`, which meant
  // an item at index 0 was never recognized as already present and got
  // pushed as a duplicate on every update instead of replaced in place.
  test('replaces an existing item at index 0 instead of duplicating it', () => {
    const original = { id: 'a', value: 1 };
    const updated = { id: 'a', value: 2 };
    const result = addToArray([original, { id: 'b', value: 1 }], updated);

    expect(result).toHaveLength(2);
    expect(result.filter((item) => item.id === 'a')).toEqual([updated]);
  });

  test('replaces an existing item at a later index', () => {
    const original = { id: 'a', value: 1 };
    const updated = { id: 'a', value: 2 };
    const result = addToArray([{ id: 'b', value: 1 }, original], updated);

    expect(result).toHaveLength(2);
    expect(result.filter((item) => item.id === 'a')).toEqual([updated]);
  });

  test('appends an item with a new id', () => {
    const result = addToArray([{ id: 'a', value: 1 }], { id: 'b', value: 2 });

    expect(result).toHaveLength(2);
  });
});

describe('applyFilteredProbabilities', () => {
  const makeChild = (id: string, probability: number, hidden = false): Node => {
    const strain = new Strain({ probability, isChild: true });
    return {
      id,
      type: NodeType.Strain,
      position: { x: 0, y: 0 },
      data: strain,
      hidden,
    };
  };

  test('leaves filteredProbability undefined when nothing is hidden', () => {
    const children = [makeChild('a', 0.5), makeChild('b', 0.5)];
    CrossDesign.applyFilteredProbabilities(children);
    children.forEach((node) => {
      expect((node.data as Strain).filteredProbability).toBeUndefined();
    });
  });

  test('renormalizes visible siblings to sum to 1 when one is hidden', () => {
    const children = [
      makeChild('a', 0.5),
      makeChild('b', 0.3),
      makeChild('c', 0.2, true),
    ];
    CrossDesign.applyFilteredProbabilities(children);
    const [a, b, c] = children.map((node) => node.data as Strain);
    expect(a.filteredProbability).toBeCloseTo(0.5 / 0.8);
    expect(b.filteredProbability).toBeCloseTo(0.3 / 0.8);
    expect(c.filteredProbability).toBeUndefined();
  });

  test('clears a previously-set filteredProbability once nothing is hidden anymore', () => {
    const children = [makeChild('a', 0.5), makeChild('b', 0.5, true)];
    CrossDesign.applyFilteredProbabilities(children);
    expect((children[0].data as Strain).filteredProbability).toBeCloseTo(1);

    children[1].hidden = false;
    CrossDesign.applyFilteredProbabilities(children);
    children.forEach((node) => {
      expect((node.data as Strain).filteredProbability).toBeUndefined();
    });
  });
});
